// ─────────────────────────────────────────────────────────────────────────────
// Canonical thin-file model feature vector — the SINGLE source of truth shared by
// training (scripts/train-thinfile-model.ts) and inference (thinfile-model.ts).
//
// CashflowFeatures (the raw M-Pesa crunch output, stored as LmsApplication.
// featuresSnapshot = the training X) is mapped to a compact, scale-stable vector
// of monotone-meaningful signals. Keep this the ONLY place the mapping lives so a
// model fitted on these features scores identically in the app.
// ─────────────────────────────────────────────────────────────────────────────

import type { CashflowFeatures } from "./features";

export const THINFILE_FEATURE_KEYS = [
  "surplusRatio",          // disposable income share of income
  "logIncome",             // log1p(avg monthly income) — diminishing returns
  "incomeVolatility",      // CV of monthly income (lower = steadier)
  "incomeMonthsRatio",     // share of months with income
  "gamblingRatio",         // betting share of outflow
  "loanDependencyRatio",   // borrowed / (income + borrowed)
  "cushionRatio",          // avg balance / monthly spend
  "balanceTrendRatio",     // (closing-opening) / monthly income
  "loanRepayRatio",        // repaid / borrowed (discipline)
  "businessActivity",      // log1p(till/paybill + business-in count)
] as const;

export type ThinFileFeatureKey = (typeof THINFILE_FEATURE_KEYS)[number];

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const safe = (n: number) => (Number.isFinite(n) ? n : 0);

/** Map raw cashflow features → the model feature map (named, for readability). */
export function toFeatureMap(f: CashflowFeatures): Record<ThinFileFeatureKey, number> {
  const inc = Math.max(0, f.avgMonthlyIncome || 0);
  const surplus = inc > 0 ? clamp((f.avgMonthlyNet || 0) / inc, -1, 1.5) : -1;
  const cushion =
    f.avgMonthlyExpense > 0 ? clamp((f.avgBalance || 0) / f.avgMonthlyExpense, 0, 3) : f.avgBalance > 0 ? 1 : 0;
  const trend = inc > 0 ? clamp((f.balanceTrend || 0) / inc, -1, 1) : 0;
  const repay = f.loanInflow > 0 ? clamp((f.loanRepayOutflow || 0) / f.loanInflow, 0, 1.2) : 1;

  return {
    surplusRatio: safe(surplus),
    logIncome: safe(Math.log1p(inc)),
    incomeVolatility: clamp(safe(f.incomeVolatility), 0, 3),
    incomeMonthsRatio: clamp(safe(f.incomeMonthsRatio), 0, 1),
    gamblingRatio: clamp(safe(f.gamblingRatio), 0, 1),
    loanDependencyRatio: clamp(safe(f.loanDependencyRatio), 0, 1),
    cushionRatio: safe(cushion),
    balanceTrendRatio: safe(trend),
    loanRepayRatio: safe(repay),
    businessActivity: safe(Math.log1p((f.tillPaybillCount || 0) + (f.businessInflowCount || 0))),
  };
}

/** Ordered numeric vector (matches THINFILE_FEATURE_KEYS) for matrix math. */
export function toFeatureVector(f: CashflowFeatures): number[] {
  const m = toFeatureMap(f);
  return THINFILE_FEATURE_KEYS.map((k) => m[k]);
}

/**
 * Human-readable explanation for a feature, derived from the borrower's actual
 * cashflow — the same quality of detail the expert scorecard gives, so the trained
 * model's reason codes read the same to officers (DPA explanation + appeal basis).
 */
export function featureDetail(key: ThinFileFeatureKey, f: CashflowFeatures): string {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
  switch (key) {
    case "surplusRatio":
      return f.avgMonthlyIncome > 0
        ? `Keeps ~${pct(f.avgMonthlyNet / f.avgMonthlyIncome)} of income (${kes(f.avgMonthlyNet)}/mo).`
        : "No clear regular income detected.";
    case "logIncome":
      return `Average income ${kes(f.avgMonthlyIncome)}/mo.`;
    case "incomeVolatility":
      return `Income volatility ${f.incomeVolatility}${
        f.incomeVolatility <= 0.3 ? " (very steady)" : f.incomeVolatility > 1 ? " (erratic)" : ""
      }.`;
    case "incomeMonthsRatio":
      return `Earned in ${pct(f.incomeMonthsRatio)} of months covered.`;
    case "gamblingRatio":
      return f.gamblingRatio > 0
        ? `${pct(f.gamblingRatio)} of outflow to betting (${kes(f.gamblingOutflow)}).`
        : "No betting activity.";
    case "loanDependencyRatio":
      return f.loanDependencyRatio > 0
        ? `${pct(f.loanDependencyRatio)} of inflow is borrowed (${f.loanEventCount} loan events).`
        : "Not reliant on digital loans.";
    case "cushionRatio": {
      const cushion = f.avgMonthlyExpense > 0 ? f.avgBalance / f.avgMonthlyExpense : 0;
      return `Average balance ${kes(f.avgBalance)}${f.avgMonthlyExpense > 0 ? ` (~${cushion.toFixed(1)}× monthly spend)` : ""}.`;
    }
    case "balanceTrendRatio":
      return f.balanceTrend >= 0 ? "Wallet balance grew over the period." : "Wallet balance drained over the period.";
    case "loanRepayRatio":
      return f.loanInflow > 0
        ? `Repaid ~${pct(f.loanRepayOutflow / f.loanInflow)} of borrowed funds.`
        : "No recent borrowing to repay.";
    case "businessActivity":
      return `${f.tillPaybillCount} till/paybill + ${f.businessInflowCount} business-in events.`;
  }
}

/** Human labels for reason codes / UI. */
export const FEATURE_LABELS: Record<ThinFileFeatureKey, string> = {
  surplusRatio: "Disposable income",
  logIncome: "Income level",
  incomeVolatility: "Income stability",
  incomeMonthsRatio: "Earning consistency",
  gamblingRatio: "Gambling exposure",
  loanDependencyRatio: "Loan dependency",
  cushionRatio: "Balance cushion",
  balanceTrendRatio: "Balance trend",
  loanRepayRatio: "Loan repayment",
  businessActivity: "Business activity",
};
