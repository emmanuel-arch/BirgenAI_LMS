// ─────────────────────────────────────────────────────────────────────────────
// POST /api/node/bureau — this member sells bureau reach to the ecosystem.
//
// Micromart hold a Metropol contract: signed keys, a whitelisted egress address,
// and an entitlement to 13 of Metropol's 14 report types (swept live on
// 16 Sep 2026 — only report 22 is refused, E029). Most lenders in the ecosystem
// hold none of that, and getting it takes months.
//
// So this endpoint makes the contract a CONTRIBUTION. The Interchange Registry
// asks; this node pulls, using its own vault credentials through its own relay;
// the answer goes back as raw bureau JSON for the Registry to normalise and
// render. Micromart is reimbursed per pull and the ecosystem gets bureau data
// without fourteen separate integrations.
//
// ── THIS ENDPOINT SPENDS REAL MONEY, SO READ THESE FOUR RULES ────────────────
//
//   1. ONLY THE REGISTRY MAY CALL IT. Verified by Ed25519 signature against
//      INTERCHANGE_REGISTRY_PUBKEY. Not a shared secret, not an IP allowlist:
//      a signature over the canonical request cannot be replayed against a
//      different body, and cannot be forged by anyone holding a log of it.
//
//   2. IT IS OFF BY DEFAULT. Without the pubkey AND
//      INTERCHANGE_BUREAU_SELL=1, it answers 503. A node that has not
//      deliberately agreed to sell its bureau reach does not sell it because a
//      deploy turned an endpoint on.
//
//   3. A DAILY CEILING, ENFORCED HERE. The Registry meters too, but the spender
//      is this node and the budget is Micromart's. A bug or a compromise
//      upstream must not be able to run up an unbounded bureau bill — the cap
//      is where the money actually leaves.
//
//   4. THE REQUESTED REPORT SET IS BOUNDED. Only types this contract is known
//      to be entitled to, so a typo cannot spend a pull discovering an E029.
//
// ── WHAT IT RETURNS ──────────────────────────────────────────────────────────
// The bureau's own response bodies, untouched. No mapping, no merging, no
// opinion — the Registry's report kit does all of that, and a member who wants
// to parse it themselves gets exactly what Metropol sent.
// ─────────────────────────────────────────────────────────────────────────────
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runAsPlatform } from "@/lib/db/context";
import { getIntegration } from "@/lib/vault/integrations";
import { verifyRequest } from "@/lib/interchange/signing";
import { pullSingleReport } from "@/lib/crb/metropol";
import { crbRelayEnabled } from "@/lib/crb/relay";
import { nodeMember } from "@/lib/interchange/members";
import { REPORT_REASON, type ReportReason } from "@/lib/crb/catalogue";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Report types this contract is entitled to, confirmed by the 16 Sep 2026 sweep. */
const SELLABLE = new Set([1, 2, 3, 4, 5, 6, 8, 10, 11, 12, 13, 14, 16]);

/** Most pulls a single request may make. A "full file" is four. */
const MAX_REPORTS_PER_REQUEST = 6;

/** Metropol reject an unknown reason code, so it is validated rather than passed through. */
function reportReason(value: unknown): ReportReason {
  const n = Number(value);
  const allowed = Object.values(REPORT_REASON) as number[];
  return (allowed.includes(n) ? n : REPORT_REASON.NEW_APPLICATION) as ReportReason;
}

/** The node's own daily ceiling on billed pulls, whatever the Registry believes. */
function dailyCap(): number {
  const n = Number(process.env.INTERCHANGE_BUREAU_DAILY_CAP);
  return Number.isInteger(n) && n > 0 ? n : 200;
}

function enabled(): boolean {
  return process.env.INTERCHANGE_BUREAU_SELL === "1" && !!process.env.INTERCHANGE_REGISTRY_PUBKEY?.trim();
}

export async function POST(request: Request) {
  const raw = await request.text();

  if (!enabled()) {
    return NextResponse.json(
      {
        error: "BUREAU_SELL_DISABLED",
        message:
          "This node does not sell bureau reach. Set INTERCHANGE_BUREAU_SELL=1 and INTERCHANGE_REGISTRY_PUBKEY to enable it.",
      },
      { status: 503 },
    );
  }

  // ── 1. Only the Registry ──────────────────────────────────────────────────
  const verified = verifyRequest({
    method: "POST",
    path: "/api/node/bureau",
    body: raw,
    headers: request.headers,
    publicKeyHex: process.env.INTERCHANGE_REGISTRY_PUBKEY!.trim(),
  });
  if (!verified.ok) {
    return NextResponse.json({ error: verified.failure, message: verified.message }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const identityNumber = String(body.identity_number ?? "").replace(/\D/g, "");
  const identityType = String(body.identity_type ?? "001");
  const onBehalfOf = String(body.on_behalf_of ?? "");
  const requested = Array.isArray(body.report_types) ? body.report_types.map(Number) : [];

  if (!identityNumber) {
    return NextResponse.json({ error: "identity_number is required." }, { status: 400 });
  }
  if (!onBehalfOf) {
    return NextResponse.json({ error: "on_behalf_of is required — a pull is billed to a member." }, { status: 400 });
  }

  // ── 4. A bounded, entitled report set ─────────────────────────────────────
  const types = [...new Set(requested)].filter((t) => SELLABLE.has(t));
  const rejected = [...new Set(requested)].filter((t) => !SELLABLE.has(t));
  if (types.length === 0) {
    return NextResponse.json(
      {
        error: "NO_SELLABLE_REPORTS",
        message: `None of the requested report types are on this contract. Entitled: ${[...SELLABLE].join(", ")}.`,
        rejected,
      },
      { status: 400 },
    );
  }
  if (types.length > MAX_REPORTS_PER_REQUEST) {
    return NextResponse.json(
      { error: "TOO_MANY_REPORTS", message: `At most ${MAX_REPORTS_PER_REQUEST} report types per request.` },
      { status: 413 },
    );
  }

  // ── The contract holder's own credentials ─────────────────────────────────
  const holderCode = process.env.INTERCHANGE_BUREAU_MEMBER?.trim() || "KE/LENDER/3005";
  const member = nodeMember(holderCode);
  if (!member) {
    return NextResponse.json(
      { error: "UNKNOWN_HOLDER", message: `${holderCode} is not a member this node runs.` },
      { status: 500 },
    );
  }

  // ── TWO DIFFERENT "SLUGS", AND THEY ARE NOT THE SAME NAMESPACE ────────────
  // `member.org` is a CONNECTION slug from lib/enterprise/connections — which
  // ServiceSuite database to read — and it is "micromart-fintech". The LMS org
  // that owns the vault, the CRB integration and the billing is slug
  // "micromart". Looking the tenant up by the connection slug finds nothing and
  // fails with NO_ORG, which reads like a missing tenant rather than a mixed-up
  // identifier. The bureau tenant is therefore named explicitly.
  const orgSlug = process.env.INTERCHANGE_BUREAU_ORG_SLUG?.trim() || "micromart";
  const org = await runAsPlatform(() =>
    prisma.org.findFirst({ where: { slug: orgSlug }, select: { id: true, name: true } }),
  );
  if (!org) {
    return NextResponse.json(
      {
        error: "NO_ORG",
        message: `No LMS org with slug "${orgSlug}". Set INTERCHANGE_BUREAU_ORG_SLUG to the tenant whose Metropol contract this node spends.`,
      },
      { status: 500 },
    );
  }

  const cfg = await runAsPlatform(() => getIntegration(org.id, "CRB"));
  if (!cfg) {
    return NextResponse.json(
      { error: "NO_BUREAU_CONFIG", message: `${org.name} has no CRB integration in the vault.` },
      { status: 503 },
    );
  }
  if (!crbRelayEnabled()) {
    return NextResponse.json(
      {
        error: "NO_RELAY",
        message:
          "The CRB relay is not configured on this node, and Metropol answer only whitelisted addresses. Set CRB_RELAY_URL and CRB_RELAY_SECRET.",
      },
      { status: 503 },
    );
  }

  // ── 3. The ceiling, counted where the money leaves ────────────────────────
  const since = new Date(Date.now() - 86_400_000);
  const spentToday = await runAsPlatform(() =>
    prisma.kycCheck.count({
      where: { orgId: org.id, kind: "CRB", provider: { startsWith: "Interchange/" }, createdAt: { gte: since } },
    }),
  );
  if (spentToday + types.length > dailyCap()) {
    return NextResponse.json(
      {
        error: "DAILY_CAP_REACHED",
        message: `This node's bureau ceiling of ${dailyCap()} pulls in 24h would be exceeded (${spentToday} already spent).`,
        spent_today: spentToday,
        cap: dailyCap(),
      },
      { status: 429 },
    );
  }

  // ── The pulls ─────────────────────────────────────────────────────────────
  // Serial, not parallel: several simultaneous requests from one relay address
  // is the shape a bureau rate-limits, and a 429 halfway through leaves a
  // half-pulled file that was still billed.
  const pulls: Record<string, unknown>[] = [];
  let billed = 0;

  for (const type of types) {
    const r = await pullSingleReport(
      cfg as Parameters<typeof pullSingleReport>[0],
      { identityNumber, identityType },
      type,
      { loanAmount: Number(body.loan_amount ?? 10_000), reportReason: reportReason(body.report_reason) },
    );
    if (r.ok) billed++;
    pulls.push({
      report_type: r.code,
      ok: r.ok,
      payload: r.json,
      api_code: r.apiCode,
      message: r.message,
      ms: r.ms,
    });
  }

  // ── The receipt this node keeps ───────────────────────────────────────────
  // Filed against the ORG, not against a borrower: the subject of an ecosystem
  // pull is very often not this lender's customer, and inventing a Borrower row
  // for somebody who never applied here would corrupt the book to make an audit
  // trail tidy. The provider prefix keeps these out of every screen that reads
  // "the latest bureau file for this customer".
  await runAsPlatform(() =>
    prisma.kycCheck.create({
      data: {
        orgId: org.id,
        kind: "CRB",
        passed: billed > 0,
        provider: `Interchange/${onBehalfOf}`,
        payload: {
          soldTo: onBehalfOf,
          reportTypes: types,
          billedPulls: billed,
          pulledAt: new Date().toISOString(),
          // The identifier is NOT stored. This node performed a lookup on
          // another member's customer; keeping their national ID here would
          // build exactly the central register the architecture refuses to be.
          results: pulls.map((p) => ({ report_type: p.report_type, ok: p.ok, api_code: p.api_code, ms: p.ms })),
        } as unknown as Prisma.InputJsonValue,
      },
    }),
  );

  return NextResponse.json({
    contract_holder: holderCode,
    on_behalf_of: onBehalfOf,
    pulls,
    billed,
    cached: false,
    rejected_types: rejected,
  });
}
