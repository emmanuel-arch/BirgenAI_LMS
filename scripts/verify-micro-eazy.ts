// ─────────────────────────────────────────────────────────────────────────────
// MICRO EAZY — does the shelf Micromart's board will look at actually exist, and
// does it decide the way we say it decides?
//
//   npm run test:micro-eazy
//
// Seven checks, in the order a loan meets them:
//   1. the two products, to the shilling
//   2. the fee sheet
//   3. the "Micro Eazy" workflow — Risk → Customer Service, CRB gate, route
//   4. borrower onboarding rules
//   5. THE TERM FAN-OUT — one candidate per bookable term, priced correctly
//   6. THE DISBURSEMENT ROUTE — stage beats org mode, and the fallback is intact
//   7. the credit policy, which is what decides every limit
//
// Writes nothing.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { platformPrisma } from "../prisma/seed-client";
import { enterPlatform, runWithOrg } from "../src/lib/db/context";
import { read } from "../src/lib/config/store";
import { decide, priceCharge, type ProductCandidate } from "../src/lib/decision/engine";
import { candidatesFor, collapseByProduct } from "../src/lib/decision/candidates";
import { resolveDisbursementRoute } from "../src/lib/lending/disbursement-route";
import type { CreditPolicy } from "../src/lib/decision/policy";
import type { InternalReport } from "../src/lib/statement/analyze";

let failures = 0;
const fail = (m: string) => { failures++; console.log(`  x ${m}`); };
const pass = (m: string) => console.log(`  + ${m}`);
const check = (ok: boolean, m: string) => (ok ? pass(m) : fail(m));
const kes = (n: number) => `KES ${Math.round(n).toLocaleString("en-KE")}`;

function report(net: number, maxInstallment: number): InternalReport {
  return {
    generatedAt: "2026-08-06T00:00:00.000Z",
    period: { start: "2026-02-01", end: "2026-07-31", months: 6, txns: 500 },
    // Band strings are the policy's own keys ("Good", not "GOOD") — scoreCeilings
    // is indexed by them, and a mismatched case silently yields a zero ceiling.
    score: { value: 720, band: "Good", drivers: [] },
    affordability: { score: 62, band: "Low risk", recommendedMaxInstallment: maxInstallment, reasons: [] },
    features: {
      monthsCovered: 6, avgMonthlyNet: net,
      gamblingRatio: 0, incomeVolatility: 0.2, loanDependencyRatio: 0.1,
    } as InternalReport["features"],
    monthly: [], spendByCategory: [], topMerchants: [],
    loanBehaviour: { lenders: [], repaymentCadence: "monthly", activeExposureEstimate: 0, fulizaReliant: false },
    lifestyle: { tags: [], narrative: "" },
    highlights: [],
  };
}

async function main() {
  const p = platformPrisma();
  enterPlatform();
  const org = await p.org.findUnique({ where: { slug: "micromart" }, select: { id: true, mode: true } });
  if (!org) throw new Error('No org with slug "micromart".');

  // ── 1 · Products ───────────────────────────────────────────────────────────
  console.log("1 · Products");
  const products = await p.product.findMany({ where: { orgId: org.id, isActive: true }, orderBy: { name: "asc" } });
  check(products.length === 2, `shelf holds exactly 2 active products (found ${products.length}: ${products.map((x) => x.name).join(", ")})`);

  const EXPECT = [
    { name: "Micro Eazy", rate: 82.5, period: 10, min: 1, unit: "week", minLoanLimit: null as number | null, perPeriod: 8.25, ssId: 30219 },
    { name: "Micro Eazy Monthly", rate: 44, period: 2, min: 1, unit: "month", minLoanLimit: 5000 as number | null, perPeriod: 22, ssId: 30220 },
  ];
  for (const e of EXPECT) {
    const row = products.find((x) => x.name === e.name);
    if (!row) { fail(`${e.name} is missing`); continue; }
    const ok =
      Number(row.minPrincipal) === 5000 && Number(row.maxPrincipal) === 100_000 &&
      Number(row.interestRate) === e.rate && row.repaymentPeriod === e.period &&
      row.minRepaymentPeriod === e.min && row.repaymentPeriodUnit === e.unit &&
      Number(row.penaltyRate) === 20 && row.minCreditScore === 500 &&
      row.guarantorRequired === false && row.guarantorReborrow === false && row.securityRequired === false &&
      (e.minLoanLimit === null ? row.minLoanLimit === null : Number(row.minLoanLimit) === e.minLoanLimit);
    check(ok, `${e.name}: ${kes(5000)}–${kes(100_000)} · flat ${e.perPeriod}% per ${e.unit} · ${e.min}–${e.period} ${e.unit} · rollover 20% · min score 500`);
    check(Math.abs(Number(row.interestRate) / row.repaymentPeriod - e.perPeriod) < 0.001,
      `  whole-term ${e.rate}% ÷ ${e.period} recovers ${e.perPeriod}% per ${e.unit} exactly`);
    check(row.serviceSuiteProductId === e.ssId, `  posts to ServiceSuite product ${e.ssId}`);
  }

  // ── 2 · Charges ────────────────────────────────────────────────────────────
  console.log("\n2 · Charges");
  const charges = await p.charge.findMany({ where: { orgId: org.id, isActive: true }, orderBy: { code: "asc" } });
  const EXPECT_C = [
    { code: "PF", percent: true, amount: 6, min: 650, max: 6000 },
    { code: "CRB", percent: false, amount: 100, min: 100, max: 100 },
    { code: "SF", percent: false, amount: 50, min: 50, max: 50 },
  ];
  for (const e of EXPECT_C) {
    const row = charges.find((c) => c.code === e.code);
    if (!row) { fail(`charge ${e.code} is missing`); continue; }
    const ok =
      row.isPercent === e.percent && Number(row.amount) === e.amount &&
      Number(row.minValue) === e.min && Number(row.maxValue) === e.max &&
      Number(row.minPrincipal) === 5000 && Number(row.maxPrincipal) === 100_000 &&
      row.applyAt === "BEFORE_DISBURSEMENT" && row.productId === null;
    check(ok, `${e.code}: ${e.percent ? `${e.amount}% clamped ${kes(e.min)}–${kes(e.max)}` : kes(e.amount)} · before disbursement · band ${kes(5000)}–${kes(100_000)} · org-wide`);
  }

  // ── 3 · Workflow ───────────────────────────────────────────────────────────
  console.log("\n3 · Workflow");
  const wf = await p.workflow.findFirst({ where: { orgId: org.id, title: "Micro Eazy" }, select: { id: true } });
  if (!wf) { fail('workflow "Micro Eazy" is missing'); }
  else {
    const stages = await p.workflowStage.findMany({ where: { workflowId: wf.id }, orderBy: { order: "asc" } });
    check(stages.length === 2, `two stages (found ${stages.length})`);
    const [risk, cs] = stages;
    check(risk?.title === "Risk" && risk?.accessTier === 1 && !risk.canFinalize, "stage 1 — Risk · Initiator · does not finalize");
    check(risk?.crbRequired === true, "stage 1 carries the CRB gate (a pull under 30 days old or it will not advance)");
    check(cs?.title === "Customer Service" && cs?.accessTier === 2 && cs.canFinalize, "stage 2 — Customer Service · Authorizor · finalizes");
    check(cs?.parentId === risk?.id, "stage 2 sits under stage 1 in the tree (ServiceSuite ParentStage parity)");
    check(cs?.otpRequired === true, "finalizing stage is OTP-gated");
    check(cs?.disbursementRoute === "LENDER_BRIDGE", "finalizing stage routes to LENDER_BRIDGE — Micromart's own workflow disburses");
    const wired = products.filter((x) => x.newWorkflowId === wf.id && x.repeatWorkflowId === wf.id).length;
    check(wired === 2, `both products route new AND repeat loans through it (${wired}/2)`);
  }

  // ── 4 · Borrower rules ─────────────────────────────────────────────────────
  console.log("\n4 · Borrower rules");
  const doc = await read<{ rules: Record<string, { enabled?: boolean; min?: number; max?: number; afterDays?: number }> }>(org.id, "borrower");
  const r = doc.value.rules;
  check(r.age?.enabled === true && r.age?.min === 22 && r.age?.max === 70, "age limit 22–70");
  check(r.referees?.enabled === true && r.referees?.min === 1 && r.referees?.max === 1, "referees required, 1–1");
  check(r.joiningFee?.enabled === false, "no joining fee");
  check(r.reactivationFee?.enabled === false, "no dormant-account reactivation fee");
  check(r.dormancy?.enabled === true, `dormancy on (after ${r.dormancy?.afterDays}d — unit unconfirmed with Micromart)`);

  // ── 5 · Term fan-out ───────────────────────────────────────────────────────
  console.log("\n5 · Term fan-out — the engine chooses the term, not just the product");
  const candidates = await runWithOrg(org.id, () => candidatesFor(org.id));
  const me = candidates.filter((c) => c.name === "Micro Eazy");
  const mem = candidates.filter((c) => c.name === "Micro Eazy Monthly");
  check(me.length === 10, `Micro Eazy fans out to 10 bookable terms, 1–10 weeks (found ${me.length})`);
  check(mem.length === 2, `Micro Eazy Monthly fans out to 2 bookable terms, 1–2 months (found ${mem.length})`);
  const w4 = me.find((c) => c.termCount === 4);
  check(!!w4 && Math.abs(w4.interestPct - 33) < 0.001, `4 weeks prices at 8.25% × 4 = 33% (found ${w4?.interestPct}%)`);
  const w10 = me.find((c) => c.termCount === 10);
  check(!!w10 && Math.abs(w10.interestPct - 82.5) < 0.001, "10 weeks prices at 82.5% — unchanged from the fixed-term behaviour");

  // The whole fee sheet, not whichever fee the database returned first.
  const sheet = w10?.charges ?? [];
  check(sheet.length === 3, `each candidate carries all 3 upfront fees (found ${sheet.length}: ${sheet.map((c) => c.code).join(", ")})`);
  const feesAt = (principal: number) => sheet.reduce((s, c) => s + priceCharge(c, principal), 0);
  check(feesAt(5_000) === 800, `fees on ${kes(5_000)} = ${kes(feesAt(5_000))} — PF floored to 650 (not the raw 6% = 300), + CRB 100 + SF 50`);
  check(feesAt(25_000) === 1_650, `fees on ${kes(25_000)} = ${kes(feesAt(25_000))} — PF 1,500 + CRB 100 + SF 50`);
  check(feesAt(100_000) === 6_150, `fees on ${kes(100_000)} = ${kes(feesAt(100_000))} — PF capped at 6,000 + CRB 100 + SF 50`);

  // The org's OWN published policy, not the platform defaults — its reference loan
  // is what converts cashflow into a principal, and it is Micro Eazy's shape.
  const livePolicy = (await read<CreditPolicy>(org.id, "credit")).value;
  console.log("\n   what three cashflows are actually offered:");
  const PROFILES = [
    { label: "tight    (net 18,000/mo)", net: 18_000, inst: 4_500 },
    { label: "middling (net 45,000/mo)", net: 45_000, inst: 12_000 },
    { label: "strong   (net 120,000/mo)", net: 120_000, inst: 32_000 },
  ];
  for (const prof of PROFILES) {
    const d = decide({
      report: report(prof.net, prof.inst),
      policy: livePolicy,
      products: candidates as ProductCandidate[],
      history: { clearedLoans: 0, hasActiveLoan: false },
    });
    const rec = d.products.find((o) => o.recommended);
    const shelf = collapseByProduct(d.products);
    console.log(
      `   ${prof.label} -> ${d.verdict.padEnd(7)} ` +
      (rec ? `${rec.name} · ${kes(rec.principal)} over ${rec.termCount} ${rec.termUnit}${rec.termCount > 1 ? "s" : ""} · ${kes(rec.installment)}/${rec.termUnit}` : "no offer"),
    );
    check(shelf.length <= 2, `      shelf collapses ${d.products.length} priced candidates to ${shelf.length} row(s) — never a product twice`);
    check(d.verdict !== "DECLINE", "      a good statement is not declined outright");
  }

  // ── 6 · Disbursement route ─────────────────────────────────────────────────
  console.log("\n6 · Disbursement route");
  const bridged = resolveDisbursementRoute({ stageRoute: "LENDER_BRIDGE", stageTitle: "Customer Service", orgMode: "NATIVE" });
  check(bridged.route === "LENDER_BRIDGE" && bridged.source === "stage", "a stage's choice beats the org's mode (NATIVE org, stage says bridge)");
  const native = resolveDisbursementRoute({ stageRoute: "LMS_NATIVE", stageTitle: "Customer Service", orgMode: "BRIDGED" });
  check(native.route === "LMS_NATIVE" && native.source === "stage", "a BRIDGED lender can send ONE workflow through our B2C queue");
  const inheritB = resolveDisbursementRoute({ stageRoute: null, orgMode: "BRIDGED" });
  check(inheritB.route === "LENDER_BRIDGE" && inheritB.source === "org-mode", "unset stage on a BRIDGED org still posts to the lender — old behaviour intact");
  const inheritN = resolveDisbursementRoute({ stageRoute: null, orgMode: "NATIVE" });
  check(inheritN.route === "LMS_NATIVE" && inheritN.source === "org-mode", "unset stage on a NATIVE org still books here — old behaviour intact");

  // ── 7 · Credit policy ──────────────────────────────────────────────────────
  console.log("\n7 · Credit policy");
  const policyDoc = await read<CreditPolicy>(org.id, "credit");
  if (policyDoc.isDefault) {
    fail("Micromart has never published a credit policy — every decision runs on platform defaults");
    console.log("    npx tsx scripts/seed-micromart-policy.ts");
  } else {
    const c = policyDoc.value.capacity;
    const g = policyDoc.value.graduation;
    const b = policyDoc.value.behaviour;
    pass(`published v${policyDoc.version}`);
    check(c.referenceTermCount === 10 && c.referenceTermUnit === "week" && c.referenceAllInPct === 82.5,
      `  reference loan is Micro Eazy's own shape — ${c.referenceTermCount} ${c.referenceTermUnit}s at ${c.referenceAllInPct}% all-in`);
    check(b.categories.some((x) => x.minScore === 76.01 && x.graduationPercent === 30) &&
      b.categories.some((x) => x.minScore === 51 && x.graduationPercent === 15),
      "  ServiceSuite parity on the graduation matrix — Minor 30%, Moderate 15%");
    check(g.requireClearedLoans === 2 && g.requireSamePrincipalCycles === 2 && g.capPerStep === 5000,
      "  ServiceSuite parity on the gate — 2 cleared at the same principal, KES 5,000 per step");
    check(g.basis === "higher_of", "  basis higher_of — a graduation can never CUT a limit (the procedure's own defect)");
    check(b.window.includeActive === true, "  live loans are scored — a score moves on repayment, not only on clearance");
    check(policyDoc.value.verdict.autoDeclineBelow === 500, "  declines below 500, matching Micromart's own product rule");
    const demoKey = g.demotion.belowCategory;
    check(b.categories.some((x) => x.key === demoKey), `  demotion points at a category that exists (${demoKey})`);
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  await p.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
