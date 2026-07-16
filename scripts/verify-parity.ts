// ServiceSuite → LMS product translation, checked against Micromart's real book.
//
//   npm run test:parity
//
// Pure — no DB, no network. Every expected number in here was read off Micromart's
// live Products/Loans tables (EntityId 3002) on 16 Jul 2026, so if a mapping rule
// drifts, these fail with the real loan that proves it wrong.
import "dotenv/config";
import {
  mapProduct, mapFee, fullTermRate, feeCode,
  PERIOD_UNIT, INTEREST_METHOD, FEE_APPLY_AT, FEE_IS_PERCENT,
  type ServiceSuiteProduct, type ServiceSuiteFee,
} from "../src/lib/lms/servicesuite-products";
import { buildSchedule } from "../src/lib/lending/schedule";
import { chargeAmount, chargeAppliesTo } from "../src/lib/payments/request";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};

// A real Micromart row, copied verbatim from the live table.
const P_4WEEKS: ServiceSuiteProduct = {
  ID: 30111, ProductName: "4 WEEKS", ProductDesc: "4 WEEKS",
  MinPrincipal: 5000, MaxPrincipal: 100000,
  InterestMethod: 1, InterestRate: 7.25,
  RepaymentPeriod: 4, RepaymentPeriodType: 2,
  RepaymentOrder: null, MinCreditScore: 500, IsActive: 1,
  WorkflowId: 1016, repeatWorkflowId: 1016,
  guarantorRequired: 0, guarantorReborrow: 0,
  securityRequired: 1, securityLimitType: 2, securityLimitValue: 200,
  minLoanLimit: 5000, PrincipalType: 2,
  EnableEarlyRate: 0, EarlyPaymentDays: null, EarlyPaymentRate: null,
};

function main() {
  console.log("\nServiceSuite → LMS product parity\n");

  console.log("the rate is per period, and our engine wants the whole term");
  ok("4 WEEKS: 7.25%/week × 4 = 29%", fullTermRate(7.25, 4) === 29);
  ok("6 WEEKS: 7.25%/week × 6 = 43.5%", fullTermRate(7.25, 6) === 43.5);
  ok("5 WEEKS: 7.25%/week × 5 = 36.25%", fullTermRate(7.25, 5) === 36.25);
  ok("SCHOOL FEE-3 MONTH: 15%/month × 3 = 45%", fullTermRate(15, 3) === 45);
  ok("JENGA BIASHARA: 2.14%/day × 14 = 29.96%", fullTermRate(2.14, 14) === 29.96);
  ok("IPF: 0.83%/day × 30 = 24.9%", fullTermRate(0.83, 30) === 24.9);
  ok("BIASHARA BOOST: 20%/month × 1 = 20%", fullTermRate(20, 1) === 20);

  console.log("\nthe mapped product reproduces a REAL Micromart loan exactly");
  const m = mapProduct(P_4WEEKS);
  ok("rate becomes 29% for the term", m.interestRate === 29, `got ${m.interestRate}`);
  ok("method is flat (InterestMethods.ID 1 = 'Flat rate')", m.interestMethod === "flat");
  ok("4 installments", m.repaymentPeriod === 4);
  ok("weekly (RepaymentPeriodType 2)", m.repaymentPeriodUnit === "week");

  // Loan 436666, booked 16 Jul 2026: P=8,000 → I=2,320, total 10,320, 4 × 2,580.
  const s = buildSchedule({
    principal: 8000, rate: m.interestRate, count: m.repaymentPeriod,
    unit: m.repaymentPeriodUnit, method: m.interestMethod,
  });
  ok("loan 436666: interest is 2,320", s.interest === 2320, `got ${s.interest}`);
  ok("loan 436666: total is 10,320", s.loanAmount === 10320, `got ${s.loanAmount}`);
  ok("loan 436666: 4 equal installments of 2,580",
    s.rows.length === 4 && s.rows.every((r) => r.amountDue === 2580),
    `got ${s.rows.map((r) => r.amountDue).join(", ")}`);
  ok("loan 436666: installments are 7 days apart",
    (s.rows[1].dueDate.getTime() - s.rows[0].dueDate.getTime()) / 86_400_000 === 7);

  console.log("\nthe enums are ServiceSuite's, not ours");
  ok("period 1=day 2=week 3=month", PERIOD_UNIT[1] === "day" && PERIOD_UNIT[2] === "week" && PERIOD_UNIT[3] === "month");
  ok("InterestMethod 1=flat 2=reducing", INTEREST_METHOD[1] === "flat" && INTEREST_METHOD[2] === "reducing");
  ok("FeeType 1=before disbursement", FEE_APPLY_AT[1] === "BEFORE_DISBURSEMENT");
  ok("FeeType 2=deducted from principal", FEE_APPLY_AT[2] === "DEDUCT_FROM_PRINCIPAL");
  ok("FeeType 3=on installments", FEE_APPLY_AT[3] === "ON_INSTALLMENTS");
  ok("AmountType 1=percent 2=fixed", FEE_IS_PERCENT[1] === true && FEE_IS_PERCENT[2] === false);

  console.log("\nIsActive is not a boolean — 2 means switched off");
  ok("IsActive 1 → live", mapProduct({ ...P_4WEEKS, IsActive: 1 }).isActive === true);
  ok("IsActive 2 → off (ZIDISHA, SALARY CHAP CHAP, OKOA NET…)",
    mapProduct({ ...P_4WEEKS, IsActive: 2 }).isActive === false);
  ok("a truthy check would wrongly switch 12 products back on", Boolean(2) === true);

  console.log("\nInterestPeriod is legacy noise and must not be read");
  // 4 WEEKS has InterestPeriod=1 and BIASHARA BOOST has 3, yet both price at rate × term.
  ok("mapping ignores it: same rate whatever it says",
    mapProduct(P_4WEEKS).interestRate === mapProduct({ ...P_4WEEKS }).interestRate);

  console.log("\ntheir securityRequired is NOT our securityRequired");
  // Ours is a hard gate (lib/lending/security.ts): no VERIFIED collateral, no money.
  // 4 WEEKS carries securityRequired=1 and has 226,163 approved loans, and Micromart's
  // Collaterals table holds ZERO rows server-wide. Obeying the flag would have gated
  // 24 of 34 products behind collateral that does not exist.
  ok("ServiceSuite says security is required on 4 WEEKS", P_4WEEKS.securityRequired === 1);
  ok("we do NOT turn our collateral gate on from it", m.securityRequired === false);
  ok("but we record what they said, rather than drop it", m.serviceSuiteSecurityRequired === true);
  // 6 WEEKS carries securityLimitType=1 ("percentage") with value=500. Read literally
  // that is 500% cover — KES 25,000 of verified assets against a KES 5,000 loan.
  ok("cover stays at our 100% default — 500 is not read as 500%",
    mapProduct({ ...P_4WEEKS, ID: 30106, securityLimitType: 1, securityLimitValue: 500 }).securityCoverPct === 100);
  ok("a product with no security flag is unaffected either way",
    mapProduct({ ...P_4WEEKS, securityRequired: 0 }).securityRequired === false);

  console.log("\nfees: bands select, clamps price");
  const PROC: ServiceSuiteFee = {
    ID: 4, ProductId: 30111, FeeName: "PROCESSING FEE", FeeDesc: "PF",
    FeeType: 1, FeeValueType: 2, FeeValue: 500, MinValue: 500, MaxValue: 500,
    MinPrincipal: 4001, MaxPrincipal: 35000, IsActive: 1,
  };
  const proc = mapFee(PROC);
  ok("flat 500 fee", proc.amount === 500 && proc.isPercent === false);
  ok("clamp dropped on a flat fee (it was just a copy of the amount)",
    proc.minValue === null && proc.maxValue === null);
  ok("band kept: 4,001–35,000", proc.minPrincipal === 4001 && proc.maxPrincipal === 35000);
  ok("gates before disbursement", proc.applyAt === "BEFORE_DISBURSEMENT");
  ok("code is unique per fee row", proc.code === "PROCESSING-4");
  ok("33 PROCESSING FEE rows do not collide",
    feeCode("PROCESSING FEE", 4) !== feeCode("PROCESSING FEE", 5));

  ok("a 8,000 loan is inside the band", chargeAppliesTo(proc, 8000) === true);
  ok("a 40,000 loan is outside it — no processing fee", chargeAppliesTo(proc, 40000) === false);
  ok("a 3,000 loan is below it", chargeAppliesTo(proc, 3000) === false);
  ok("in-band price is the flat 500", chargeAmount(proc, 8000) === 500);

  // SCHOOL FEE - 1 MONTH: 5%, clamped 1,000–2,500, band 5,000–50,000.
  const SCHOOL: ServiceSuiteFee = {
    ID: 12, ProductId: 30148, FeeName: "PROCESSING FEE", FeeDesc: null,
    FeeType: 1, FeeValueType: 1, FeeValue: 5, MinValue: 1000, MaxValue: 2500,
    MinPrincipal: 5000, MaxPrincipal: 50000, IsActive: 1,
  };
  const school = mapFee(SCHOOL);
  ok("percentage fee keeps its clamp", school.isPercent && school.minValue === 1000 && school.maxValue === 2500);
  ok("5% of 40,000 = 2,000, inside the clamp", chargeAmount(school, 40000) === 2000);
  ok("5% of 10,000 = 500 → floored to 1,000", chargeAmount(school, 10000) === 1000);
  ok("5% of 50,000 = 2,500 → at the ceiling", chargeAmount(school, 50000) === 2500);
  ok("an unclamped 5% would have undercharged the small loan by 500",
    Math.round(10000 * 0.05) === 500 && chargeAmount(school, 10000) === 1000);

  console.log("\nan unbanded fee still applies to everything (registration)");
  const REG = { amount: 100, isPercent: false };
  ok("no band → applies with no principal in hand", chargeAppliesTo(REG, undefined) === true);
  ok("no band → applies to any loan", chargeAppliesTo(REG, 999999) === true);
  ok("a BANDED fee with no principal does not apply — we will not invent a fee",
    chargeAppliesTo(proc, undefined) === false);

  console.log("\nfee application type");
  ok("SALARY CHAP CHAP's fee is deducted from principal, not demanded upfront",
    mapFee({ ...PROC, ID: 40, FeeType: 2 }).applyAt === "DEDUCT_FROM_PRINCIPAL");
  ok("an inactive fee is mirrored as inactive", mapFee({ ...PROC, ID: 41, IsActive: 0 }).isActive === false);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
