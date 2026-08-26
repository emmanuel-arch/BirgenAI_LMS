// ─────────────────────────────────────────────────────────────────────────────
// SPRINT 3 ACCEPTANCE — the exposure engine, end to end, from a real node.
//
//   npx tsx scripts/interchange-verify.ts [subjectNationalId]
//
// Blueprint v2 Table 7 sets Sprint 3's done-when as "p95 under 400 ms on the
// REAL Micromart book". This is the test of that sentence, and it runs from the
// node rather than from the Registry — because the node is what a member
// actually is, and the broker running anywhere else would defeat the privacy
// argument the whole design rests on.
//
// It differs from the Registry's own verify:exposure in the one way that
// matters: nothing here is seeded. The books are Micromart's and Axe's live
// Serviceconnect, ingested through the blinded OPRF, and the borrowers it
// screens for are people who owe somebody money this morning.
//
// WHAT EACH CHECK IS ACTUALLY DEFENDING
//   · no false negatives — a member holding the borrower is never screened out
//   · degradation is visible — a silent node marks the result partial
//   · identity is withheld — lender names need identity.disclose
//   · the gate refuses — no consent_ref, no answer
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import mssql from "mssql";
import { ORGS } from "../src/lib/enterprise/connections";
import { runReadOnlyQuery } from "../src/lib/enterprise/mssql";
import { NODE_MEMBERS } from "../src/lib/interchange/members";
import { tokenPreview } from "../src/lib/interchange/oprf";
import { queryExposure, screen } from "../src/lib/interchange/broker";
import {
  authorise,
  deriveToken,
  deriveTokens,
  fetchFilters,
  issueConsent,
  memberIdentity,
  plainPost,
  signedPost,
  MANDATORY_SCOPES,
} from "../src/lib/interchange/registry";

const G = (s: string) => `\x1b[32m${s}\x1b[0m`;
const R = (s: string) => `\x1b[31m${s}\x1b[0m`;
const D = (s: string) => `\x1b[2m${s}\x1b[0m`;
const B = (s: string) => `\x1b[1m${s}\x1b[0m`;

/** Micromart Fintech is the portal lender, so it is the one that asks. */
const CALLER = "KE/LENDER/3005";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) {
    pass++;
    console.log(`  ${G("✓")} ${name.padEnd(52)} ${D(detail)}`);
  } else {
    fail++;
    console.log(`  ${R("✗")} ${name.padEnd(52)} ${detail}`);
  }
}

/**
 * Find a borrower who really is on more than one member's book.
 *
 * Invented IDs would prove nothing — the product exists to catch the person who
 * is three lenders deep, and on real books that person has to be found rather
 * than constructed. This looks for national IDs that appear with open money in
 * BOTH Axe's book and Micromart's.
 */
async function findSharedBorrower(): Promise<string | null> {
  const axeIds = await runReadOnlyQuery(
    ORGS.axe,
    `SELECT DISTINCT TOP 4000 b.NationalID
       FROM Loans l JOIN Borrowers b ON b.ID = l.BorrowerId AND b.EntityId = l.EntityId
      WHERE l.EntityId = 3003 AND l.isApproved = 1 AND l.LoanCleared = 0 AND l.LoanBalance > 0
        AND b.NationalID IS NOT NULL AND LEN(LTRIM(RTRIM(b.NationalID))) BETWEEN 6 AND 9`,
    [],
    { timeoutMs: 60_000, maxRows: 4000 },
  );
  const ids = axeIds.rows.map((r) => String(r.NationalID).trim()).filter(Boolean);
  if (ids.length === 0) return null;

  // Ask Micromart's book which of those it also lends to, in one round trip.
  const list = ids.slice(0, 2000);
  const table = list.map((id) => `('${id.replace(/'/g, "''")}')`).join(",");
  const hit = await runReadOnlyQuery(
    ORGS["micromart-fintech"],
    `SELECT TOP 1 b.NationalID
       FROM (VALUES ${table}) AS v(id)
       JOIN Borrowers b ON LTRIM(RTRIM(b.NationalID)) = v.id
       JOIN Loans l ON l.BorrowerId = b.ID AND l.EntityId = b.EntityId
      WHERE b.EntityId IN (3002, 3005) AND l.isApproved = 1
        AND l.LoanCleared = 0 AND l.LoanBalance > 0`,
    [],
    { timeoutMs: 120_000, maxRows: 1 },
  );
  return hit.rows.length ? String(hit.rows[0].NationalID).trim() : null;
}

async function main() {
  console.log(`\n${B("Interchange Sprint 3 acceptance")} ${D(`→ ${process.env.INTERCHANGE_URL} · as ${CALLER}`)}\n`);

  const who = memberIdentity(CALLER);

  // ── Filters ───────────────────────────────────────────────────────────────
  const filters = await fetchFilters();
  const memberCodes = NODE_MEMBERS.map((m) => m.code);
  check(
    "every ingested member has published a filter",
    filters.length >= 3,
    `${filters.length} filters · ${filters.reduce((a, f) => a + f.item_count, 0).toLocaleString()} tokens covered`,
  );
  check(
    "a filter reveals bits, never tokens",
    filters.every((f) => typeof f.bits === "string" && !("tokens" in f)),
    `${filters[0]?.m ?? 0} bits, k=${filters[0]?.k ?? 0}`,
  );

  // ── A real, shared borrower ───────────────────────────────────────────────
  console.log(`\n  ${D("Finding a borrower who is on more than one live book")}`);
  const shared = process.argv[2] ?? (await findSharedBorrower());
  if (!shared) {
    console.log(`  ${R("✗")} no borrower found on both books — cannot prove cross-lender exposure`);
    process.exit(1);
  }
  const subject = await deriveToken(who, "national_id", shared);
  check("a borrower exists on two members' live books", true, `subject ${tokenPreview(subject)}`);

  // ── Screening ─────────────────────────────────────────────────────────────
  const askable = memberCodes.filter((c) => c !== CALLER);
  const candidates = screen(subject, askable, filters);
  check(
    "the shared borrower screens in",
    candidates.length >= 1,
    `${candidates.length} of ${askable.length} members would be contacted`,
  );

  // A token nobody holds should screen almost everyone out. 99999999 is not a
  // valid Kenyan ID, so no real book can contain it.
  const strangerToken = await deriveToken(who, "national_id", "99999999");
  const strangerCandidates = screen(strangerToken, askable, filters);
  check(
    "an unknown borrower screens members out",
    strangerCandidates.length <= 1,
    `${strangerCandidates.length} of ${askable.length} would be contacted`,
  );

  // No false negatives: ask EVERY member directly and confirm nobody who holds
  // the borrower was screened out. This is the property the design depends on.
  let falseNegatives = 0;
  for (const code of askable) {
    const r = await signedPost(who, "/api/node/exposure", { subject_token: subject, member_code: code });
    if (r.json.has_exposure === true && !candidates.includes(code)) falseNegatives++;
  }
  check("no false negatives — nobody holding is screened out", falseNegatives === 0, `${falseNegatives} missed`);

  // ── The gate ──────────────────────────────────────────────────────────────
  console.log(`\n  ${D("The gate — no consent_ref, no answer")}`);

  const unconsented = await signedPost(who, "/api/exchange", {
    service_code: "exposure-v1",
    subject_token: subject,
  });
  check(
    "a query with no consent_ref is refused",
    unconsented.status === 403 && String(unconsented.json.outcome ?? "").includes("NO_CONSENT"),
    `${unconsented.status} ${String(unconsented.json.outcome ?? "")}`,
  );

  const consent = await issueConsent({
    subjectToken: subject,
    memberCode: CALLER,
    scopes: MANDATORY_SCOPES,
    capturedVia: "PWA",
  });
  check("consent issued on the PWA channel", consent.ok, consent.ok ? consent.ref : consent.message);
  if (!consent.ok) process.exit(1);

  const rawId = await plainPost("/api/consent", {
    subject_token: shared,
    member_code: CALLER,
    scopes: MANDATORY_SCOPES,
    captured_via: "PWA",
  });
  check(
    "a raw national ID is refused at the consent boundary",
    rawId.status === 422 && rawId.json.error === "IDENTIFIER_NOT_TOKENISED",
    `${rawId.status} ${String(rawId.json.error ?? "")}`,
  );

  const authz = await authorise(who, {
    serviceCode: "exposure-v1",
    subjectToken: subject,
    consentRef: consent.ref,
  });
  check("the Registry authorises the query", authz.ok, authz.ok ? `audit ${authz.auditId.slice(0, 8)}` : authz.reason);

  // ── The query ─────────────────────────────────────────────────────────────
  console.log(`\n  ${D("Exposure — fan out, aggregate, degrade honestly")}`);

  const result = await queryExposure({
    who,
    memberCodes,
    filters,
    subjectToken: subject,
    discloseLenders: false,
  });

  check(
    "exposure found on another member's book",
    result.lenders >= 1 && result.activeLoans >= 1,
    `${result.activeLoans} loans across ${result.lenders} lender(s) · ${result.outstandingBand} · worst ${result.worstBucket}`,
  );
  check(
    "every queried node answered",
    !result.partial,
    result.partial
      ? `${result.responded}/${result.queried} — silent: ${result.silent.map((s) => `${s.memberCode} (${s.reason})`).join(", ")}`
      : `${result.responded}/${result.queried} responded`,
  );
  check("lender identities withheld without consent", result.lendersNamed === null, "lenders_named: null");

  const disclosed = await queryExposure({
    who,
    memberCodes,
    filters,
    subjectToken: subject,
    discloseLenders: true,
  });
  check(
    "lender identities revealed only when disclosed",
    Array.isArray(disclosed.lendersNamed) && disclosed.lendersNamed.length === disclosed.lenders,
    `${disclosed.lendersNamed?.join(", ") ?? "none"}`,
  );

  const none = await queryExposure({
    who,
    memberCodes,
    filters,
    subjectToken: strangerToken,
    discloseLenders: false,
  });
  check("a borrower with no exposure returns cleanly", none.lenders === 0, `${none.queried} queried, 0 found`);

  // ── Latency ───────────────────────────────────────────────────────────────
  console.log(`\n  ${D("Latency — the 400ms budget, on the real books")}`);

  // Real subjects, sampled from Axe's live book, so the timings include the
  // members who actually hold them rather than only Bloom misses.
  const sample = await runReadOnlyQuery(
    ORGS.axe,
    `SELECT DISTINCT TOP 30 b.NationalID
       FROM Loans l JOIN Borrowers b ON b.ID = l.BorrowerId AND b.EntityId = l.EntityId
      WHERE l.EntityId = 3003 AND l.isApproved = 1 AND l.LoanCleared = 0 AND l.LoanBalance > 0
        AND b.NationalID IS NOT NULL AND LEN(LTRIM(RTRIM(b.NationalID))) BETWEEN 6 AND 9`,
    [],
    { timeoutMs: 60_000, maxRows: 30 },
  );
  const sampleIds = sample.rows.map((r) => String(r.NationalID).trim());
  const sampleTokens = await deriveTokens(who, "national_id", sampleIds, "serving");

  const samples: number[] = [];
  for (const token of sampleTokens) {
    const t = Date.now();
    await queryExposure({ who, memberCodes, filters, subjectToken: token, discloseLenders: false });
    samples.push(Date.now() - t);
  }
  samples.sort((a, b) => a - b);
  const p50 = samples[Math.floor(samples.length * 0.5)];
  const p95 = samples[Math.floor(samples.length * 0.95)];
  check(
    "p95 exposure query under 400ms",
    p95 < 400,
    `p50 ${p50}ms · p95 ${p95}ms · max ${samples.at(-1)}ms · n=${samples.length}`,
  );

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
