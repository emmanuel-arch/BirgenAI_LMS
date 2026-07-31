// ─────────────────────────────────────────────────────────────────────────────
// PARITY + BEHAVIOUR CHECK for the decision fabric.
//
// The generalisation in src/lib/decision only earns its place if Mular's live
// underwriting comes out UNCHANGED. `lib/lending/qualify.ts` is what runs for them
// today (via the statement-cruncher route); this script runs both paths over the
// same synthetic borrower reports and diffs the answers that matter — starting
// limit, tier, ceilings, which product is recommended, and the decline reasons.
//
// It then exercises the parts qualify() cannot do at all: rules-mode matching
// against a product's own published eligibility block, and policy knobs (haircuts,
// verdict bands) that no lender could previously reach without a code change.
//
//   npx tsx scripts/verify-decision-engine.ts
// ─────────────────────────────────────────────────────────────────────────────
import { qualify, type ProductLite, type ChargeLite } from "../src/lib/lending/qualify";
import { decide, type ProductCandidate } from "../src/lib/decision/engine";
import { MULAR_POLICY, CREDIT_DEFAULTS, validateCreditPolicy, type CreditPolicy } from "../src/lib/decision/policy";
import { TIERS, WEEKS, interestForWeeks } from "../src/lib/lending/buckets";
import type { InternalReport } from "../src/lib/statement/analyze";

let failures = 0;
const fail = (msg: string) => { failures++; console.log(`  x ${msg}`); };
const pass = (msg: string) => console.log(`  + ${msg}`);

// ── Synthetic borrowers ───────────────────────────────────────────────────────
// Only the fields the two engines actually read are populated; both are pure
// functions of these, so a partial report is a complete input.
type Profile = {
  name: string;
  score: number;
  band: InternalReport["score"]["band"];
  affBand: InternalReport["affordability"]["band"];
  maxInstallment: number;
  net: number;
  months: number;
  gambling: number;
  volatility: number;
  loanDependency: number;
  fuliza: boolean;
  cadence: InternalReport["loanBehaviour"]["repaymentCadence"];
};

function report(p: Profile): InternalReport {
  return {
    generatedAt: "2026-07-31T00:00:00.000Z",
    period: { start: "2026-01-01", end: "2026-06-30", months: p.months, txns: 500 },
    score: { value: p.score, band: p.band, drivers: [] },
    affordability: { score: 60, band: p.affBand, recommendedMaxInstallment: p.maxInstallment, reasons: [] },
    features: {
      monthsCovered: p.months, avgMonthlyNet: p.net,
      gamblingRatio: p.gambling, incomeVolatility: p.volatility, loanDependencyRatio: p.loanDependency,
    } as InternalReport["features"],
    monthly: [], spendByCategory: [], topMerchants: [],
    loanBehaviour: { lenders: [], repaymentCadence: p.cadence, activeExposureEstimate: 0, fulizaReliant: p.fuliza },
    lifestyle: { tags: [], narrative: "" },
    highlights: [],
  };
}

const PROFILES: Profile[] = [
  { name: "Strong trader",       score: 780, band: "Excellent", affBand: "Low risk",      maxInstallment: 22000, net: 41000, months: 6, gambling: 0.00, volatility: 0.20, loanDependency: 0.05, fuliza: false, cadence: "weekly" },
  { name: "Steady shopkeeper",   score: 660, band: "Good",      affBand: "Low risk",      maxInstallment:  9000, net: 18000, months: 6, gambling: 0.01, volatility: 0.30, loanDependency: 0.10, fuliza: false, cadence: "weekly" },
  { name: "Modest hustler",      score: 540, band: "Fair",      affBand: "Moderate risk", maxInstallment:  4200, net:  7000, months: 5, gambling: 0.02, volatility: 0.45, loanDependency: 0.18, fuliza: false, cadence: "biweekly" },
  { name: "Thin file",           score: 520, band: "Fair",      affBand: "Moderate risk", maxInstallment:  3000, net:  5000, months: 2, gambling: 0.00, volatility: 0.35, loanDependency: 0.12, fuliza: false, cadence: "monthly" },
  { name: "Volatile income",     score: 590, band: "Good",      affBand: "Moderate risk", maxInstallment:  5000, net:  8000, months: 6, gambling: 0.00, volatility: 0.78, loanDependency: 0.20, fuliza: false, cadence: "irregular" },
  { name: "Bettor",              score: 610, band: "Good",      affBand: "Moderate risk", maxInstallment:  6000, net:  9000, months: 6, gambling: 0.22, volatility: 0.30, loanDependency: 0.15, fuliza: false, cadence: "weekly" },
  { name: "Loan-stacked",        score: 500, band: "Fair",      affBand: "High risk",     maxInstallment:  2500, net:  3000, months: 6, gambling: 0.03, volatility: 0.50, loanDependency: 0.62, fuliza: true,  cadence: "weekly" },
  { name: "Below the floor",     score: 310, band: "Very Poor", affBand: "High risk",     maxInstallment:  1200, net:  1500, months: 6, gambling: 0.00, volatility: 0.40, loanDependency: 0.25, fuliza: false, cadence: "monthly" },
  { name: "Severe risk",         score: 430, band: "Poor",      affBand: "Severe risk",   maxInstallment:   400, net:  -900, months: 6, gambling: 0.05, volatility: 0.60, loanDependency: 0.35, fuliza: false, cadence: "irregular" },
  { name: "Too small to lend",   score: 470, band: "Poor",      affBand: "High risk",     maxInstallment:   250, net:   600, months: 6, gambling: 0.00, volatility: 0.30, loanDependency: 0.10, fuliza: false, cadence: "monthly" },
];

// ── Mular's live catalogue, as both engines see it ────────────────────────────
const LITE: ProductLite[] = [];
const CANDIDATES: ProductCandidate[] = [];
for (const tier of TIERS) {
  for (const w of WEEKS) {
    const id = `${tier.key}-${w}`;
    const rate = interestForWeeks(w);
    LITE.push({ id, name: `${tier.key} ${w}WK`, minPrincipal: tier.min, maxPrincipal: tier.max, interestRate: rate, repaymentPeriod: w });
    CANDIDATES.push({
      id, name: `${tier.key} ${w}WK`,
      minPrincipal: tier.min, maxPrincipal: tier.max,
      interestPct: rate, termCount: w, termUnit: "week",
      processing: { percent: tier.processing.percent, amount: tier.processing.amount },
    });
  }
}
const CHARGES: ChargeLite[] = LITE.map((p) => {
  const tier = TIERS.find((t) => p.name.startsWith(t.key))!;
  return { productId: p.id, amount: tier.processing.amount, isPercent: tier.processing.percent };
});

// ── 1 · Policies are internally coherent ──────────────────────────────────────
console.log("\nPolicy validation");
for (const [label, policy] of [["defaults", CREDIT_DEFAULTS], ["Mular preset", MULAR_POLICY]] as [string, CreditPolicy][]) {
  const issues = validateCreditPolicy(policy);
  if (issues.length) { fail(`${label}: ${issues.map((i) => `${i.path} — ${i.message}`).join("; ")}`); }
  else pass(`${label} valid`);
}

// ── 2 · Parity with the live Mular path ───────────────────────────────────────
console.log("\nParity — decide(MULAR_POLICY) vs the live qualify()");
for (const p of PROFILES) {
  const r = report(p);
  const before = qualify(r, LITE, CHARGES);
  const after = decide({ report: r, policy: MULAR_POLICY, products: CANDIDATES });

  const diffs: string[] = [];
  const cmp = (field: string, a: unknown, b: unknown) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push(`${field}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
  };
  cmp("eligible", before.eligible, after.eligible);
  cmp("startingLimit", before.startingLimit, after.startingLimit);
  cmp("tier", before.tier, after.tier);
  cmp("ceilings", before.ceilings, after.ceilings);
  cmp("recommendedProductId", before.recommendedProductId, after.recommendedProductId);
  cmp("declineReasons", before.declineReasons, after.declineReasons);
  cmp("offeredCount", before.products.length, after.products.length);

  // The priced figures on the recommended offer must match to the shilling.
  const bRec = before.products.find((x) => x.recommended);
  const aRec = after.products.find((x) => x.recommended);
  if (bRec && aRec) {
    cmp("principal", bRec.principal, aRec.principal);
    cmp("interest", bRec.interest, aRec.interest);
    cmp("processing", bRec.processing, aRec.processing);
    cmp("netDisbursed", bRec.netDisbursed, aRec.netDisbursed);
    cmp("installment", bRec.weeklyInstallment, aRec.installment);
    cmp("affordable", bRec.affordable, aRec.affordable);
  } else if (Boolean(bRec) !== Boolean(aRec)) {
    diffs.push(`recommended presence: ${Boolean(bRec)} -> ${Boolean(aRec)}`);
  }

  if (diffs.length) fail(`${p.name}: ${diffs.join(" | ")}`);
  else {
    pass(`${p.name.padEnd(20)} ${after.eligible ? `KES ${after.startingLimit.toLocaleString()} · ${after.tier}` : `declined — ${after.declineReasons[0] ?? "no reason"}`}`);
  }
}

// ── 3 · Every outcome is explained ────────────────────────────────────────────
console.log("\nExplainability — no silent answers");
for (const p of PROFILES) {
  const d = decide({ report: report(p), policy: MULAR_POLICY, products: CANDIDATES });
  if (d.reasonCodes.length === 0) fail(`${p.name}: no reason codes at all`);
  else if (!d.eligible && d.declineReasons.length === 0) fail(`${p.name}: declined with no stated reason`);
  else if (d.trace.length !== 7) fail(`${p.name}: trace has ${d.trace.length} stages, expected 7`);
  else pass(`${p.name.padEnd(20)} ${d.verdict.padEnd(7)} ${d.reasonCodes.length} reasons · ${d.trace.length} stages`);
}

// ── 4 · Things qualify() could never do ───────────────────────────────────────
console.log("\nGeneralisation — capabilities the hardcoded path did not have");

// (a) Rules mode: a product's own eligibility block gates it, with no name prefix.
{
  const gated: ProductCandidate[] = [
    { id: "starter", name: "Starter", minPrincipal: 1000, maxPrincipal: 20000, interestPct: 12, termCount: 8, termUnit: "week", processing: { percent: false, amount: 300 } },
    {
      id: "premier", name: "Premier", minPrincipal: 1000, maxPrincipal: 50000, interestPct: 9, termCount: 12, termUnit: "week", processing: { percent: false, amount: 300 },
      eligibility: {
        minCreditScore: 700, minAge: 0, maxAge: 0, minClearedLoans: 3,
        guarantor: { required: false, count: 0, canReborrow: false },
        security: { required: false, coverPct: 100 }, oneAtATime: true,
      },
    },
  ];
  const rules: CreditPolicy = { ...CREDIT_DEFAULTS, match: { ...CREDIT_DEFAULTS.match, mode: "rules" } };
  const newcomer = decide({ report: report(PROFILES[0]), policy: rules, products: gated, history: { clearedLoans: 0, hasActiveLoan: false } });
  const veteran = decide({ report: report(PROFILES[0]), policy: rules, products: gated, history: { clearedLoans: 5, hasActiveLoan: false } });

  const newcomerIds = newcomer.products.map((x) => x.productId);
  const veteranIds = veteran.products.map((x) => x.productId);
  if (newcomerIds.includes("premier")) fail("rules mode: Premier offered to a borrower with 0 cleared loans");
  else pass("rules mode: Premier withheld until its minClearedLoans is met");
  if (!veteranIds.includes("premier")) fail("rules mode: Premier withheld from a qualifying veteran");
  else pass("rules mode: Premier offered once the product's own rule is satisfied");
}

// (b) Haircuts: a bettor's limit is cut by policy, not by an edit to the platform.
{
  const strict: CreditPolicy = { ...MULAR_POLICY, haircuts: { ...MULAR_POLICY.haircuts, bettingCutPct: 40 } };
  const bettor = PROFILES.find((p) => p.name === "Bettor")!;
  const base = decide({ report: report(bettor), policy: MULAR_POLICY, products: CANDIDATES });
  const cut = decide({ report: report(bettor), policy: strict, products: CANDIDATES });
  if (cut.startingLimit >= base.startingLimit) fail(`haircut had no effect: ${base.startingLimit} -> ${cut.startingLimit}`);
  else pass(`betting haircut: KES ${base.startingLimit.toLocaleString()} -> ${cut.startingLimit.toLocaleString()} by policy alone`);
}

// (c) Verdict bands: auto-approve is reachable, and respects its own amount cap.
{
  const auto: CreditPolicy = { ...MULAR_POLICY, verdict: { autoApproveAbove: 700, autoDeclineBelow: 350, autoApproveMaxAmount: 0 } };
  const capped: CreditPolicy = { ...auto, verdict: { ...auto.verdict, autoApproveMaxAmount: 1000 } };
  const strong = report(PROFILES[0]);
  const a = decide({ report: strong, policy: auto, products: CANDIDATES });
  const b = decide({ report: strong, policy: capped, products: CANDIDATES });
  if (a.verdict !== "APPROVE") fail(`expected APPROVE for a strong file, got ${a.verdict}`);
  else pass("verdict: strong file auto-approves inside the band");
  if (b.verdict !== "REFER") fail(`expected REFER when the amount exceeds autoApproveMaxAmount, got ${b.verdict}`);
  else pass("verdict: an amount above the trust cap falls back to a human");
}

console.log(failures === 0 ? "\nDecision fabric verified.\n" : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
