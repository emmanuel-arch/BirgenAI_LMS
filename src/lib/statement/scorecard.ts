// ─────────────────────────────────────────────────────────────────────────────
// Thin-file (acquisition) credit scorecard — BirgenAI Statement Scorer v1.
//
// WHAT THIS IS (and isn't): a transparent, points-based EXPERT scorecard that maps
// M-Pesa cashflow features to a 300–900 credit score, a calibrated default
// probability, and adverse-action reason codes. It is NOT a supervised-trained
// model — that requires a labelled dataset (M-Pesa features → observed default),
// which only exists once lms.birgenai.com onboards consenting borrowers and we
// observe repayment. The scorecard is the standard pre-data approach and is built
// so each feature's weight can be re-fit by logistic regression later WITHOUT
// changing any calling code (same inputs/outputs).
//
// Design: additive points around a 600 base, monotonic per feature, clamped to
// [300, 900]; score → PD via a calibrated logistic link. Reason codes are the
// largest-magnitude contributions (the DPA explanation + appeal basis).
// ─────────────────────────────────────────────────────────────────────────────

import type { CashflowFeatures } from "./features";

export const SCORECARD_VERSION = "thinfile-scorecard-v1";

export type ReasonCode = {
  code: string;
  factor: string;
  points: number;
  direction: "up" | "down";
  detail: string;
};

export type ThinFileScore = {
  modelVersion: string;
  score: number; // 300–900
  maxScore: 900;
  pd: number; // default probability 0–1
  pdPercent: string;
  band: "Excellent" | "Good" | "Fair" | "Poor" | "High Risk";
  tone: "good" | "warn" | "high" | "bad";
  decision: "APPROVE" | "REFER" | "DECLINE";
  reasonCodes: ReasonCode[];
  breakdown: { code: string; factor: string; points: number }[];
};

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function scoreThinFile(f: CashflowFeatures): ThinFileScore {
  const parts: { code: string; factor: string; points: number; detail: string }[] = [];
  const add = (code: string, factor: string, points: number, detail: string) =>
    parts.push({ code, factor, points: Math.round(points), detail });

  // 1) Surplus ratio (disposable income share) — the strongest affordability signal.
  const surplusRatio = f.avgMonthlyIncome > 0 ? f.avgMonthlyNet / f.avgMonthlyIncome : -1;
  add(
    "AFF",
    "Disposable income",
    f.avgMonthlyIncome > 0 ? clamp(surplusRatio * 260, -120, 130) : -120,
    f.avgMonthlyIncome > 0
      ? `Keeps ~${Math.round(surplusRatio * 100)}% of income (KES ${f.avgMonthlyNet.toLocaleString()}/mo).`
      : "No clear regular income detected.",
  );

  // 2) Income level (log-scaled, diminishing returns).
  const incPts =
    f.avgMonthlyIncome >= 50000 ? 70 :
    f.avgMonthlyIncome >= 20000 ? 50 :
    f.avgMonthlyIncome >= 10000 ? 30 :
    f.avgMonthlyIncome >= 5000 ? 10 : -25;
  add("INC", "Income level", incPts, `Average income KES ${f.avgMonthlyIncome.toLocaleString()}/mo.`);

  // 3) Income stability (coefficient of variation).
  const stabPts =
    f.incomeVolatility <= 0.3 ? 50 :
    f.incomeVolatility <= 0.6 ? 25 :
    f.incomeVolatility <= 1.0 ? 0 :
    f.incomeVolatility <= 1.5 ? -30 : -55;
  add("STB", "Income stability", stabPts, `Income volatility ${f.incomeVolatility}.`);

  // 4) Income regularity (how many months had income).
  const regPts =
    f.incomeMonthsRatio >= 0.9 ? 40 :
    f.incomeMonthsRatio >= 0.6 ? 20 :
    f.incomeMonthsRatio >= 0.3 ? 0 : -40;
  add("REG", "Earning consistency", regPts, `Earned in ${Math.round(f.incomeMonthsRatio * 100)}% of months.`);

  // 5) Gambling exposure (strong adverse).
  add("GMB", "Gambling exposure", -clamp(f.gamblingRatio * 700, 0, 170),
    f.gamblingRatio > 0 ? `${Math.round(f.gamblingRatio * 100)}% of outflow to betting.` : "No betting activity.");

  // 6) Digital-loan dependency.
  add("DEP", "Loan dependency", -clamp((f.loanDependencyRatio - 0.1) * 300, 0, 110),
    f.loanDependencyRatio > 0 ? `${Math.round(f.loanDependencyRatio * 100)}% of inflow borrowed (${f.loanEventCount} loans).` : "Not reliant on digital loans.");

  // 7) Balance cushion (avg balance vs monthly spend).
  const cushion = f.avgMonthlyExpense > 0 ? f.avgBalance / f.avgMonthlyExpense : (f.avgBalance > 0 ? 1 : 0);
  const cushPts = cushion >= 1 ? 50 : cushion >= 0.5 ? 30 : cushion >= 0.2 ? 10 : 0;
  add("BAL", "Balance cushion", cushPts, `Average balance KES ${f.avgBalance.toLocaleString()}.`);

  // 8) Balance trend (is the wallet growing or draining?).
  const trendPts = f.balanceTrend > f.avgMonthlyIncome * 0.25 ? 20 : f.balanceTrend < -f.avgMonthlyIncome * 0.25 ? -20 : 0;
  add("TRD", "Balance trend", trendPts, f.balanceTrend >= 0 ? "Balance is growing over the period." : "Balance is draining over the period.");

  // 9) Loan-repayment discipline (only when loans are present).
  if (f.loanInflow > 0) {
    const repayRatio = f.loanRepayOutflow / f.loanInflow;
    const repPts = repayRatio >= 0.9 ? 20 : repayRatio < 0.5 ? -20 : 0;
    add("RPY", "Loan repayment", repPts, `Repaid ~${Math.round(repayRatio * 100)}% of borrowed funds.`);
  }

  const total = parts.reduce((s, p) => s + p.points, 0);
  const score = clamp(Math.round(600 + total), 300, 900);

  // Calibrated logistic link: higher score → lower PD.
  const pd = Number((1 / (1 + Math.exp((score - 560) / 70))).toFixed(3));

  const band: ThinFileScore["band"] =
    score >= 740 ? "Excellent" : score >= 670 ? "Good" : score >= 600 ? "Fair" : score >= 520 ? "Poor" : "High Risk";
  const tone: ThinFileScore["tone"] =
    score >= 670 ? "good" : score >= 600 ? "warn" : score >= 520 ? "high" : "bad";
  const decision: ThinFileScore["decision"] = score >= 670 ? "APPROVE" : score >= 560 ? "REFER" : "DECLINE";

  const reasonCodes: ReasonCode[] = parts
    .filter((p) => p.points !== 0)
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points))
    .slice(0, 4)
    .map((p) => ({ code: p.code, factor: p.factor, points: p.points, direction: p.points >= 0 ? "up" : "down", detail: p.detail }));

  return {
    modelVersion: SCORECARD_VERSION,
    score,
    maxScore: 900,
    pd,
    pdPercent: `${(pd * 100).toFixed(1)}%`,
    band,
    tone,
    decision,
    reasonCodes,
    breakdown: parts.map((p) => ({ code: p.code, factor: p.factor, points: p.points })),
  };
}
