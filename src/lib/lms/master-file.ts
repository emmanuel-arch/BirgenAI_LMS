// ─────────────────────────────────────────────────────────────────────────────
// THE MASTER FILE — every scrutiny this ecosystem has ever obtained about one
// borrower, in one place, with a number for how much of them we actually know.
//
// ── THE PROBLEM ──────────────────────────────────────────────────────────────
// A lender does not run one check on a customer. Over a relationship they
// accumulate an identity verification, a registry match, a bureau report, an
// M-Pesa affordability read, a cross-lender exposure answer, a stack of parsed
// documents, a consent record, and a repayment history — and every one of those
// lands in a DIFFERENT table, written by a different pipeline, surfaced on a
// different screen, if at all. Nobody has ever been able to answer the simplest
// question an underwriter asks: WHAT DO WE ACTUALLY KNOW ABOUT THIS PERSON?
//
// ── WHY THIS IS AN AGGREGATOR AND NOT A TABLE ────────────────────────────────
// The obvious build is a `MasterFile` table that every pipeline also writes to.
// It is the wrong one, and the failure is predictable: the day somebody adds a
// new check and forgets the second write, the master file is silently
// incomplete — and a dossier that is quietly missing a report is worse than no
// dossier, because it is trusted.
//
// So the master file is COMPOSED at read time from the tables that already own
// each artifact. A new scrutiny appears in it because its SOURCE is registered
// here, once — never because a writer remembered. It cannot drift out of sync
// with the truth, because it has no copy of the truth to drift from.
//
// ── AND WHY IT CARRIES A WEIGHT ──────────────────────────────────────────────
// Each class of evidence is worth something, and they are not worth the same. A
// verified identity backed by an IPRS match is the foundation everything else
// stands on; a parsed utility bill is a footnote. `weight` totals what is held
// against what could be held, so a lender can see at a glance whether a decision
// is resting on evidence or on optimism — and, on the Interchange, how much a
// member is actually contributing when they publish a file.
//
// Stale evidence decays, but only where staleness means something. A bureau
// report from 2023 is a poor guide to today's exposure. An IPRS match is a fact
// about a person's identity and does not rot.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";
import { runWithOrg } from "@/lib/db/context";
import { reportCodeOf } from "@/lib/crb/rows";
import { reportByCode } from "@/lib/crb/catalogue";
import type { BehaviourResult } from "@/lib/scoring/behaviour";

export type EvidenceKind =
  | "identity"
  | "registry"
  | "bureau"
  | "interchange"
  | "affordability"
  | "repayment"
  | "document"
  | "consent";

export type Evidence = {
  id: string;
  kind: EvidenceKind;
  /** What it is, in the words an officer would use. */
  title: string;
  /** Who produced it — the provider, the registry, the model. */
  source: string;
  at: string; // ISO
  /** The finding, in one line. */
  headline: string;
  /** The supporting detail, as it would be read down a phone line. */
  facts: { label: string; value: string }[];
  /** What this contributed to the file's weight, after any decay. */
  contributed: number;
  /** Where the full artifact can be read, when there is somewhere. */
  href?: string;
  tone: "good" | "warn" | "bad" | "neutral";
};

/** A scrutiny that could exist for this customer and does not. */
export type Gap = {
  kind: EvidenceKind;
  title: string;
  /** What it would tell you, and therefore why the gap matters. */
  why: string;
  /** What it is worth — so the officer can spend effort where it counts. */
  worth: number;
  href?: string;
};

export type MasterFile = {
  evidence: Evidence[];
  gaps: Gap[];
  /** 0–100. What share of the knowable is actually known about this customer. */
  weight: number;
  /** Newest first, so "when did we last learn anything" is one read. */
  lastLearnedAt: string | null;
};

/**
 * WHAT EACH CLASS OF EVIDENCE IS WORTH, and whether it goes off.
 *
 * The numbers sum to 100 and are a credit judgement, not an arbitrary scale:
 *
 *   identity 20 + registry 10   nothing else means anything if this is the wrong
 *                               person, and a government registry match is the
 *                               only one of our checks a fraudster cannot supply
 *   repayment 25                the single best predictor of repayment is
 *                               repayment — it outranks everything we can buy
 *   affordability 15            what they can actually service, from their own
 *                               cashflow rather than their own account of it
 *   bureau 15                   what they owe elsewhere, as reported
 *   interchange 10              what they owe elsewhere, as ANSWERED IN REAL TIME
 *                               by the other lenders — smaller only because
 *                               coverage depends on who has joined
 *   document 3 + consent 2      the paperwork, and the lawful basis for holding
 *                               any of the above
 */
const CLASS: Record<EvidenceKind, { max: number; halfLifeDays: number | null; label: string }> = {
  identity: { max: 20, halfLifeDays: null, label: "Identity verification" },
  registry: { max: 10, halfLifeDays: null, label: "Government registry (IPRS)" },
  repayment: { max: 25, halfLifeDays: 180, label: "Repayment record" },
  affordability: { max: 15, halfLifeDays: 180, label: "M-Pesa affordability" },
  bureau: { max: 15, halfLifeDays: 180, label: "Credit bureau (Metropol)" },
  interchange: { max: 10, halfLifeDays: 90, label: "Interchange exposure — CRB 2.0" },
  document: { max: 3, halfLifeDays: null, label: "Supporting documents" },
  consent: { max: 2, halfLifeDays: null, label: "Consent on file" },
};

const days = (from: Date | string, to = new Date()) =>
  Math.max(0, (to.getTime() - new Date(from).getTime()) / 86_400_000);

/**
 * What a piece of evidence is still worth, given its age.
 *
 * Decay is halved-per-half-life and FLOORED AT 40% of face value. Old evidence
 * is weaker, never worthless: a bureau report from two years ago still tells you
 * this person has a credit history, which is more than nothing — and a model
 * that drove old evidence to zero would rate a fifteen-year customer the same as
 * a stranger, which is the opposite of the truth.
 */
function decayed(max: number, at: Date | string, halfLifeDays: number | null): number {
  if (halfLifeDays == null) return max;
  const factor = Math.pow(0.5, days(at) / halfLifeDays);
  return Math.round(max * Math.max(0.4, factor) * 10) / 10;
}

const iso = (d: Date | string) => new Date(d).toISOString();
const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;

/**
 * The findings worth reading out of ANY Metropol report.
 *
 * Driven by a table of keys rather than a switch on the report code, and that is
 * the important choice: the fourteen reports overlap heavily — twelve of them
 * carry `credit_score`, eight carry `delinquency_code`, several carry
 * `account_info` — so a per-code extractor would be fourteen near-copies that
 * drift the first time Metropol add a field. This reads whatever is present and
 * stays quiet about the rest.
 *
 * Verified against real responses for all twelve reports this lender is entitled
 * to (2 Sep 2026).
 */
function bureauFacts(raw: Record<string, unknown>): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  const num = (v: unknown): number | null => {
    const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
    return Number.isFinite(n) ? n : null;
  };
  const push = (label: string, value: string | null) => { if (value != null && value !== "") out.push({ label, value }); };
  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});

  push("Bureau score", num(raw.credit_score) != null ? String(num(raw.credit_score)) : null);
  // The code alone is opaque; their own summary is what an officer can read out.
  if (raw.delinquency_code != null) {
    push("Delinquency", `${raw.delinquency_code}${raw.delinquency_summary ? ` — ${raw.delinquency_summary}` : ""}`);
  }
  if (arr(raw.account_info).length) push("Credit accounts", `${arr(raw.account_info).length} on file`);
  if (num(raw.outstanding_balance) != null) push("Outstanding elsewhere", kes(num(raw.outstanding_balance)!));
  if (num(raw.days_in_arrears) != null) push("Days in arrears", String(num(raw.days_in_arrears)));

  const income = obj(raw.income_estimation);
  if (num(income.estimated_amount) != null) push("Estimated income", `${kes(num(income.estimated_amount)!)} / month`);

  const enq = obj(raw.no_of_enquiries);
  if (num(enq.last_12_months) != null) push("Enquiries (12m)", String(num(enq.last_12_months)));

  const summary = obj(raw.credit_info);
  if (num(summary.generic_account_count) != null) push("Generic accounts", String(num(summary.generic_account_count)));
  if (num(summary.mobile_account_count_active) != null) push("Mobile accounts (active)", String(num(summary.mobile_account_count_active)));

  if (arr(raw.guarantors).length) push("Guarantors", String(arr(raw.guarantors).length));
  if (arr(raw.stakeholders).length) push("Stakeholders", String(arr(raw.stakeholders).length));
  if (arr(raw.metro_score_trend).length) push("Score trend", `${arr(raw.metro_score_trend).length} months`);

  // Identity verification (report 1) and the identity scrub (report 6).
  if (raw.success === true || raw.message === "Identity found") push("Registry", String(raw.message ?? "Identity found"));
  push("Date of birth", raw.date_of_birth ? String(raw.date_of_birth) : raw.dob ? String(raw.dob) : null);
  push("Citizenship", raw.citizenship ? String(raw.citizenship) : null);
  // A date of death against a live application is the single most important
  // negative this API returns, so it is stated rather than left as a null.
  if (raw.date_of_death) push("DATE OF DEATH", String(raw.date_of_death));
  push("ID serial", raw.serial_number ? String(raw.serial_number) : null);
  if (arr(raw.names).length) push("Names on file", arr(raw.names).map(String).join(" · "));
  if (arr(raw.phone).length) push("Known numbers", arr(raw.phone).map(String).join(" · "));
  if (arr(raw.bio_nationality).length) push("Nationality", arr(raw.bio_nationality).map(String).join(", "));
  if (raw.has_fraud === true) push("FRAUD FLAG", "raised by the bureau");
  if (raw.trx_id) push("Bureau transaction", String(raw.trx_id));

  return out;
}

/**
 * Assemble one borrower's master file.
 *
 * `behaviour` is passed in rather than read here because Customer 360 has
 * already computed it against the lender's live book, and scoring the same
 * instalments twice on one page would be two database round trips to get the
 * same answer — and, if the credit policy were edited between them, two
 * different ones.
 */
export async function readMasterFile(
  orgId: string,
  borrowerId: string,
  opts: { behaviour?: BehaviourResult | null; clearedLoans?: number; hasLiveBook?: boolean } = {},
): Promise<MasterFile> {
  // runWithOrg, explicitly, the way lib/risk/graduation reads its loan facts.
  // Row-level security refuses a query with no tenant context, and a staff request
  // happens to have one already — so relying on that would work on every screen
  // and throw the moment a cron, a script or a queue worker composed a file.
  const [kycSession, checks, snapshots, documents, consent] = await runWithOrg(orgId, () =>
    Promise.all([
      prisma.kycSession.findFirst({ where: { orgId, borrowerId }, orderBy: { createdAt: "desc" } }),
      prisma.kycCheck.findMany({ where: { orgId, borrowerId }, orderBy: { createdAt: "desc" }, take: 40 }),
      prisma.scoreSnapshot.findMany({ where: { orgId, borrowerId }, orderBy: { createdAt: "desc" }, take: 20 }),
      prisma.document.findMany({ where: { orgId, borrowerId }, orderBy: { createdAt: "desc" }, take: 20 }),
      prisma.consent.findFirst({ where: { orgId, borrowerId }, orderBy: { createdAt: "desc" } }),
    ]),
  );

  const evidence: Evidence[] = [];
  const gaps: Gap[] = [];
  // One entry per CLASS counts toward the weight, and it is the BEST one. Three
  // bureau pulls are three artifacts and one piece of knowledge; letting them
  // stack would let a lender inflate a file by re-pulling the same report.
  const best = new Map<EvidenceKind, number>();
  const credit = (kind: EvidenceKind, value: number) => {
    best.set(kind, Math.max(best.get(kind) ?? 0, value));
    return value;
  };

  // ── Identity ───────────────────────────────────────────────────────────────
  if (kycSession) {
    const verified = kycSession.status === "VERIFIED";
    const w = verified ? decayed(CLASS.identity.max, kycSession.createdAt, CLASS.identity.halfLifeDays) : 0;
    evidence.push({
      id: `kyc-${kycSession.id}`,
      kind: "identity",
      title: "Identity verification",
      source: kycSession.provider ?? "internal",
      at: iso(kycSession.createdAt),
      headline: verified
        ? "Identity verified — cleared for disbursement."
        : `Verification ${String(kycSession.status).toLowerCase().replace(/_/g, " ")} — money cannot leave yet.`,
      facts: [
        { label: "Liveness", value: kycSession.livenessScore != null ? `${kycSession.livenessScore}${kycSession.livenessPassed ? " · passed" : ""}` : "—" },
        { label: "Face match", value: kycSession.faceMatchScore != null ? String(kycSession.faceMatchScore) : "—" },
        { label: "ID quality", value: kycSession.idQualityScore != null ? String(kycSession.idQualityScore) : "—" },
      ],
      contributed: credit("identity", w),
      tone: verified ? "good" : "warn",
    });

    // The registry answer is its own piece of evidence, and deliberately not a
    // line inside the one above: IPRS is the ONE check a fraudster cannot
    // supply, so a file that has it is categorically different from one that
    // merely has good selfie scores.
    if (kycSession.iprsMatched) {
      evidence.push({
        id: `iprs-${kycSession.id}`,
        kind: "registry",
        title: "Government registry match",
        source: "IPRS",
        at: iso(kycSession.createdAt),
        headline: `Matched against the national register${kycSession.iprsName ? ` as ${kycSession.iprsName}` : ""}.`,
        facts: [{ label: "Registry name", value: kycSession.iprsName ?? "—" }],
        contributed: credit("registry", decayed(CLASS.registry.max, kycSession.createdAt, CLASS.registry.halfLifeDays)),
        tone: "good",
      });
    }
  }

  // ── Bureau and the Interchange ─────────────────────────────────────────────
  //
  // Three different things arrive as CRB rows, told apart by PROVIDER:
  //
  //   metropol:report-<n>   ONE Metropol report, with the bureau's raw answer
  //                         kept. Twelve of the fourteen answered for a real
  //                         subject on 2 Sep 2026; report 22 came back E029 (not
  //                         entitled) and report 4 is a binary PDF with no JSON.
  //   Metropol CRB          the MERGED file the console's own pull writes.
  //   …interchange…         the exchange's real-time answer — a different
  //                         question by opposite means: Metropol report what
  //                         lenders FILED weeks ago, the Interchange asks the
  //                         other lenders NOW.
  //
  // ── WHY EACH REPORT IS ITS OWN LINE, AND WHY DEPTH SETS THE WEIGHT ─────────
  // Every one of them is a separate artifact with its own price, its own date and
  // its own reach, and a dossier that merged them would lose exactly the thing
  // that makes it auditable. But they are ONE BODY OF KNOWLEDGE: pulling report 8
  // and report 12 does not make a lender twice as informed, it makes them
  // informed once and billed twice.
  //
  // So the bureau class is worth `max × the DEEPEST report held`. Report 1 alone
  // (depth 0.15) earns 2.3 of the 15 — an identity check is not a credit file.
  // Report 12 (depth 1.00) earns all of it. That is the whole answer to "how does
  // each individual piece count", and it prices the next pull honestly: buying
  // report 13 after report 12 adds nothing, and the file says so by not moving.
  for (const c of checks) {
    if (c.kind !== "CRB") continue;
    const viaInterchange = (c.provider ?? "").toLowerCase().includes("interchange");
    const kind: EvidenceKind = viaInterchange ? "interchange" : "bureau";
    const p = (c.payload ?? {}) as Record<string, unknown>;
    const code = reportCodeOf(c.provider);

    if (code != null) {
      const def = reportByCode(code as never);
      const raw = (p.raw ?? {}) as Record<string, unknown>;
      const facts = bureauFacts(raw);
      const depth = typeof p.depth === "number" ? p.depth : def?.depth ?? 0.5;
      evidence.push({
        id: `crb-${c.id}`,
        kind: "bureau",
        title: `Metropol Report ${code} — ${String(p.reportName ?? def?.name ?? "Credit report")}`,
        source: `Metropol CRB · report type ${code}`,
        at: iso(c.createdAt),
        headline: String(p.answers ?? def?.answers ?? "Bureau report on file."),
        facts: facts.length ? facts : [{ label: "Fields returned", value: String(Object.keys(raw).length) }],
        // The DEEPEST report wins the class; the rest are listed and contribute
        // nothing further, which is the point.
        contributed: credit("bureau", decayed(CLASS.bureau.max * depth, c.createdAt, CLASS.bureau.halfLifeDays)),
        tone: "good",
      });
      continue;
    }

    const facts: { label: string; value: string }[] = [];
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    if (n(p.score) != null) facts.push({ label: "Bureau score", value: String(p.score) });
    if (n(p.totalOutstanding) != null) facts.push({ label: "Outstanding elsewhere", value: kes(n(p.totalOutstanding)!) });
    if (n(p.activeAccounts) != null) facts.push({ label: "Active accounts", value: String(p.activeAccounts) });
    if (n(p.lenders) != null) facts.push({ label: "Lenders reporting", value: String(p.lenders) });
    evidence.push({
      id: `crb-${c.id}`,
      kind,
      title: viaInterchange ? "Interchange exposure — CRB 2.0" : "Credit bureau file (merged)",
      source: c.provider ?? "metropol",
      at: iso(c.createdAt),
      headline: viaInterchange
        ? "What the other lenders answered, in real time, without anybody pooling a book."
        : c.passed === false
          ? "Adverse listing on file."
          : "The lender's whole report set, run and merged into one file.",
      facts: facts.length ? facts : [{ label: "Result", value: c.passed === false ? "Adverse" : "Clear" }],
      contributed: credit(kind, decayed(CLASS[kind].max, c.createdAt, CLASS[kind].halfLifeDays)),
      tone: c.passed === false ? "bad" : "good",
    });
  }

  // ── Affordability, from their own cashflow ─────────────────────────────────
  const crunch = snapshots.find((s) => s.modelKind === "thin-file" || s.modelKind === "origination-v2" || s.modelKind === "fused");
  if (crunch) {
    const f = (crunch.features ?? {}) as Record<string, unknown>;
    const facts: { label: string; value: string }[] = [];
    if (crunch.score != null) facts.push({ label: "Statement score", value: `${crunch.score} / 900` });
    if (crunch.pd != null) facts.push({ label: "Modelled default risk", value: `${(Number(crunch.pd) * 100).toFixed(1)}%` });
    const afford = f.recommendedMaxInstallment ?? f.affordability;
    if (typeof afford === "number") facts.push({ label: "Can service", value: `${kes(afford)}/month` });
    evidence.push({
      id: `crunch-${crunch.id}`,
      kind: "affordability",
      title: "M-Pesa affordability report",
      source: `${crunch.modelKind} · ${crunch.modelVersion}`,
      at: iso(crunch.createdAt),
      headline: "Scored from their own statement — what they earn, spend and can service.",
      facts: facts.length ? facts : [{ label: "Band", value: crunch.riskBand ?? "—" }],
      contributed: credit("affordability", decayed(CLASS.affordability.max, crunch.createdAt, CLASS.affordability.halfLifeDays)),
      tone: "good",
    });
  }

  // ── The repayment record ───────────────────────────────────────────────────
  // The strongest single piece of evidence in the file, and the only one that
  // cannot be bought: it is what this customer actually did with money we lent.
  if (opts.behaviour?.scored) {
    const bh = opts.behaviour;
    evidence.push({
      id: "repayment-live",
      kind: "repayment",
      title: "Repayment record",
      source: "this console, computed live from the lender's own schedule",
      at: iso(new Date()),
      headline: `${bh.score.toFixed(1)} / 100${bh.category ? ` — ${bh.category.label}` : ""}, from ${bh.installmentsUsed} instalments across ${bh.loans.length} loan${bh.loans.length === 1 ? "" : "s"}.`,
      facts: bh.factors.map((f) => ({ label: f.label, value: `${f.raw.toFixed(1)} / 100 (weight ${f.weight}%)` })),
      contributed: credit("repayment", CLASS.repayment.max),
      tone: bh.score >= 76 ? "good" : bh.score >= 51 ? "warn" : "bad",
    });
  }

  // ── Paperwork ──────────────────────────────────────────────────────────────
  const parsed = documents.filter((d) => d.status === "PARSED");
  if (documents.length > 0) {
    const newest = documents[0];
    evidence.push({
      id: "documents",
      kind: "document",
      title: "Supporting documents",
      source: newest.parserMode === "simulation" ? "document parser (simulation)" : "document parser",
      at: iso(newest.createdAt),
      headline: `${documents.length} document${documents.length === 1 ? "" : "s"} on file, ${parsed.length} read and structured.`,
      facts: documents.slice(0, 5).map((d) => ({ label: d.kind.replace(/_/g, " ").toLowerCase(), value: d.status.replace(/_/g, " ").toLowerCase() })),
      contributed: credit("document", parsed.length > 0 ? CLASS.document.max : CLASS.document.max / 2),
      tone: parsed.length > 0 ? "good" : "neutral",
    });
  }

  // ── The lawful basis for holding any of it ─────────────────────────────────
  if (consent) {
    const grants = (consent.grants ?? {}) as Record<string, unknown>;
    const granted = Object.entries(grants).filter(([, v]) => v === true).map(([k]) => k);
    evidence.push({
      id: `consent-${consent.id}`,
      kind: "consent",
      title: "Consent on file",
      source: `version ${consent.version}`,
      at: iso(consent.createdAt),
      headline: granted.length
        ? `Permission granted for ${granted.length} of ${Object.keys(grants).length} uses.`
        : "A consent record exists, but nothing is permitted under it.",
      facts: Object.entries(grants).map(([k, v]) => ({
        label: k.replace(/([A-Z])/g, " $1").toLowerCase(),
        value: v === true ? "granted" : "withheld",
      })),
      contributed: credit("consent", CLASS.consent.max),
      tone: granted.length ? "good" : "warn",
    });
  }

  // ── WHAT IS MISSING ────────────────────────────────────────────────────────
  // The half of the file that makes it actionable. A dossier that lists only what
  // you have tells an underwriter nothing about what they should go and get.
  const has = (k: EvidenceKind) => (best.get(k) ?? 0) > 0;
  if (!has("identity")) {
    gaps.push({ kind: "identity", title: "Identity verification", worth: CLASS.identity.max, why: "Nothing else in this file means anything if this is the wrong person — and no money may be disbursed until it is done.", href: `/console/kyc/${borrowerId}?from=360` });
  }
  if (!has("registry")) {
    gaps.push({ kind: "registry", title: "Government registry match", worth: CLASS.registry.max, why: "IPRS is the one check a fraudster cannot supply. Without it, a good selfie score is all that stands behind this identity.", href: `/console/kyc/${borrowerId}?from=360` });
  }
  if (!has("repayment")) {
    gaps.push({
      kind: "repayment", title: "Repayment record", worth: CLASS.repayment.max,
      why: opts.hasLiveBook
        ? "No instalment has fallen due for this customer yet, so there is nothing to score. It arrives on its own with their first repayment."
        : "The lender's book did not answer, so their repayment history could not be read.",
    });
  }
  if (!has("affordability")) {
    gaps.push({ kind: "affordability", title: "M-Pesa affordability report", worth: CLASS.affordability.max, why: "What they can actually service, from their own cashflow rather than their own account of it.", href: `/console/crunch?borrowerId=${borrowerId}&from=360` });
  }
  if (!has("bureau")) {
    gaps.push({ kind: "bureau", title: "Credit bureau report", worth: CLASS.bureau.max, why: "What they owe other lenders, as filed. A billed pull — the cost is why this is a decision, not a default." });
  }
  if (!has("interchange")) {
    gaps.push({ kind: "interchange", title: "Interchange exposure — CRB 2.0", worth: CLASS.interchange.max, why: "What the other lenders would answer right now, rather than what they filed a month ago. Nothing is pooled and no book is exposed." });
  }
  if (!has("consent")) {
    gaps.push({ kind: "consent", title: "Consent on file", worth: CLASS.consent.max, why: "The lawful basis for holding everything above it. Without it, the file is evidence of a problem rather than of a customer." });
  }

  const weight = Math.min(100, Math.round([...best.values()].reduce((s, v) => s + v, 0)));
  evidence.sort((a, b) => b.at.localeCompare(a.at));

  return {
    evidence,
    gaps: gaps.sort((a, b) => b.worth - a.worth),
    weight,
    lastLearnedAt: evidence[0]?.at ?? null,
  };
}

/** The classes and what each is worth — for the UI's legend, and for the export. */
export const EVIDENCE_CLASSES = CLASS;
