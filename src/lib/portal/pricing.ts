// ─────────────────────────────────────────────────────────────────────────────
// PRICING A CUSTOMER-CHOSEN TERM.
//
// Micromart quotes Micro Eazy as "8.25% a week, 10 weeks", and the app used to
// sell it exactly that way: every customer paid 82.5% whether they needed the
// money for ten weeks or one. The rate is PER WEEK, so a customer who repays in
// one week owes 8.25%, in five weeks 41.25% — KSh 10,000 over five weeks is
// KSh 14,125, not KSh 18,250. The term is the customer's to choose, from one
// period up to the product's own maximum, and the price follows the choice.
//
// Flat interest only, for the same reason lib/decision/candidates.ts refuses to
// fan out anything else: on a reducing balance the whole-term cost is not linear
// in the term, and pricing it as if it were understates a shorter loan.
//
// THE FEES ARE THE LENDER'S SHEET, applied the way their ProductFeesTypes say:
//   before-disbursement   paid before the money moves
//   on-disbursement       deducted from the principal sent
//   on-repayment          spread across the instalments
// ─────────────────────────────────────────────────────────────────────────────
import { chargesAt, priceShelfCharge, type ShelfCharge } from "./shelf";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type PricedLoan = {
  principal: number;
  termCount: number;
  termUnit: string;
  ratePerPeriod: number;
  totalRatePct: number;
  interest: number;
  fees: { code: string; name: string; when: ShelfCharge["when"]; amount: number }[];
  upfront: number;
  deducted: number;
  spread: number;
  netDisbursed: number;
  totalRepayable: number;
  installments: { seq: number; amount: number }[];
};

export function priceLoan(args: {
  principal: number;
  ratePerPeriod: number;
  termCount: number;
  termUnit: string;
  method: "flat" | "reducing";
  charges: ShelfCharge[];
}): PricedLoan {
  const { principal, ratePerPeriod, termCount, termUnit } = args;
  const n = Math.max(1, Math.round(termCount));

  const principalPortions: number[] = [];
  const interestPortions: number[] = [];
  if (args.method === "reducing") {
    const per = round2(principal / n);
    let outstanding = principal;
    let placed = 0;
    for (let i = 1; i <= n; i++) {
      const p = i === n ? round2(principal - placed) : per;
      interestPortions.push(round2((outstanding * ratePerPeriod) / 100));
      principalPortions.push(p);
      placed = round2(placed + p);
      outstanding = round2(outstanding - p);
    }
  } else {
    const interest = round2((principal * ratePerPeriod * n) / 100);
    const pPer = round2(principal / n);
    const iPer = round2(interest / n);
    for (let i = 1; i <= n; i++) {
      principalPortions.push(i === n ? round2(principal - pPer * (n - 1)) : pPer);
      interestPortions.push(i === n ? round2(interest - iPer * (n - 1)) : iPer);
    }
  }
  const interest = round2(interestPortions.reduce((a, b) => a + b, 0));

  const fees = chargesAt(args.charges, principal).map((c) => ({
    code: c.code, name: c.name, when: c.when, amount: priceShelfCharge(c, principal),
  }));
  const upfront = fees.filter((f) => f.when === "before-disbursement").reduce((a, f) => a + f.amount, 0);
  const deducted = fees.filter((f) => f.when === "on-disbursement").reduce((a, f) => a + f.amount, 0);
  const spread = fees.filter((f) => f.when === "on-repayment").reduce((a, f) => a + f.amount, 0);

  // Flat: equal instalments of the whole total, the remainder on the last row —
  // buildSchedule's convention, and the one the app's quote uses, so a plan the
  // customer reshaped against the app's rows sums to exactly this total.
  const total = round2(principal + interest + spread);
  let installments: { seq: number; amount: number }[];
  if (args.method === "reducing") {
    const sPer = round2(spread / n);
    installments = principalPortions.map((p, i) => ({
      seq: i + 1,
      amount: round2(p + interestPortions[i] + (i === n - 1 ? round2(spread - sPer * (n - 1)) : sPer)),
    }));
  } else {
    const per = round2(total / n);
    installments = Array.from({ length: n }, (_, i) => ({ seq: i + 1, amount: i === n - 1 ? round2(total - per * (n - 1)) : per }));
  }

  return {
    principal,
    termCount: n,
    termUnit,
    ratePerPeriod,
    totalRatePct: round2(ratePerPeriod * n),
    interest,
    fees,
    upfront,
    deducted,
    spread,
    netDisbursed: round2(principal - deducted),
    totalRepayable: round2(principal + interest + spread),
    installments,
  };
}
