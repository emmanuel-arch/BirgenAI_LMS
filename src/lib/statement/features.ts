// ─────────────────────────────────────────────────────────────────────────────
// Cashflow feature engineering + transparent affordability read for the M-Pesa
// Statement Cruncher. These engineered features are the inputs for the future
// thin-file / acquisition credit model; the affordability score here is a
// transparent rules-based read (clearly explainable) until that model ships.
// ─────────────────────────────────────────────────────────────────────────────

import type { MpesaTxn, TxnCategory } from "./mpesa-parser";

const INCOME_CATS: TxnCategory[] = ["income_received", "salary", "business_in", "deposit"];
const SPEND_CATS: TxnCategory[] = ["send_money", "paybill", "till", "withdraw", "airtime", "bank_transfer", "gambling", "other"];

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const mean = (a: number[]) => (a.length ? sum(a) / a.length : 0);
const stddev = (a: number[]) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)));
};
const round = (n: number) => Math.round(n);

export type MonthlyRow = { month: string; income: number; expense: number; net: number; gambling: number };

export type CashflowFeatures = {
  monthsCovered: number;
  periodStart: string | null;
  periodEnd: string | null;
  txnCount: number;

  totalIncome: number;
  avgMonthlyIncome: number;
  totalExpense: number;
  avgMonthlyExpense: number;
  avgMonthlyNet: number;
  incomeVolatility: number; // CV = stddev/mean of monthly income (0 = perfectly stable)

  avgBalance: number;
  minBalance: number;
  closingBalance: number;
  balanceTrend: number; // closing - opening

  // behavioural signals
  incomeMonthsRatio: number; // months with income / months covered
  businessInflowCount: number; // "received from" events — trading proxy
  tillPaybillCount: number;

  gamblingOutflow: number;
  gamblingRatio: number; // gambling / gross outflow

  loanInflow: number; // total borrowed (Fuliza/M-Shwari/loan apps)
  loanRepayOutflow: number;
  loanEventCount: number;
  loanDependencyRatio: number; // borrowed / (income + borrowed)

  airtimeSpend: number;
};

export type Affordability = {
  score: number; // 0–100
  band: "Low risk" | "Moderate risk" | "High risk" | "Severe risk";
  recommendedMaxInstallment: number; // KES / month
  reasons: { factor: string; direction: "positive" | "negative"; detail: string }[];
};

export type CrunchResult = {
  features: CashflowFeatures;
  monthly: MonthlyRow[];
  affordability: Affordability;
};

export function computeFeatures(txns: MpesaTxn[]): CashflowFeatures {
  const months = Array.from(new Set(txns.map((t) => t.month))).sort();
  const monthsCovered = months.length || 1;

  const incomeTx = txns.filter((t) => t.direction === "in" && INCOME_CATS.includes(t.category));
  const spendTx = txns.filter((t) => t.direction === "out" && SPEND_CATS.includes(t.category));
  const grossOut = sum(txns.filter((t) => t.direction === "out").map((t) => t.amount));

  const totalIncome = sum(incomeTx.map((t) => t.amount));
  const totalExpense = sum(spendTx.map((t) => t.amount));

  // per-month income for volatility + regularity
  const incomeByMonth = months.map((mo) => sum(incomeTx.filter((t) => t.month === mo).map((t) => t.amount)));
  const incomeMean = mean(incomeByMonth);
  const incomeVolatility = incomeMean > 0 ? stddev(incomeByMonth) / incomeMean : 0;
  const incomeMonthsRatio = months.length ? incomeByMonth.filter((v) => v > 0).length / months.length : 0;

  const balances = txns.map((t) => t.balance).filter((b) => Number.isFinite(b));
  const avgBalance = mean(balances);
  const minBalance = balances.length ? Math.min(...balances) : 0;
  const opening = balances[0] ?? 0;
  const closing = balances[balances.length - 1] ?? 0;

  const gamblingOutflow = sum(txns.filter((t) => t.direction === "out" && t.isGambling).map((t) => t.amount));
  const loanInTx = txns.filter((t) => t.category === "loan_in");
  const loanInflow = sum(loanInTx.map((t) => t.amount));
  const loanRepayOutflow = sum(txns.filter((t) => t.category === "loan_repay").map((t) => t.amount));

  return {
    monthsCovered,
    periodStart: months[0] ?? null,
    periodEnd: months[months.length - 1] ?? null,
    txnCount: txns.length,
    totalIncome: round(totalIncome),
    avgMonthlyIncome: round(totalIncome / monthsCovered),
    totalExpense: round(totalExpense),
    avgMonthlyExpense: round(totalExpense / monthsCovered),
    avgMonthlyNet: round((totalIncome - totalExpense) / monthsCovered),
    incomeVolatility: Number(incomeVolatility.toFixed(2)),
    avgBalance: round(avgBalance),
    minBalance: round(minBalance),
    closingBalance: round(closing),
    balanceTrend: round(closing - opening),
    incomeMonthsRatio: Number(incomeMonthsRatio.toFixed(2)),
    businessInflowCount: incomeTx.filter((t) => t.category === "income_received").length,
    tillPaybillCount: txns.filter((t) => t.category === "till" || t.category === "paybill").length,
    gamblingOutflow: round(gamblingOutflow),
    gamblingRatio: grossOut > 0 ? Number((gamblingOutflow / grossOut).toFixed(3)) : 0,
    loanInflow: round(loanInflow),
    loanRepayOutflow: round(loanRepayOutflow),
    loanEventCount: loanInTx.length,
    loanDependencyRatio: totalIncome + loanInflow > 0 ? Number((loanInflow / (totalIncome + loanInflow)).toFixed(3)) : 0,
    airtimeSpend: round(sum(txns.filter((t) => t.category === "airtime").map((t) => t.amount))),
  };
}

export function monthlyBreakdown(txns: MpesaTxn[]): MonthlyRow[] {
  const months = Array.from(new Set(txns.map((t) => t.month))).sort();
  return months.map((mo) => {
    const inMo = txns.filter((t) => t.month === mo);
    const income = sum(inMo.filter((t) => t.direction === "in" && INCOME_CATS.includes(t.category)).map((t) => t.amount));
    const expense = sum(inMo.filter((t) => t.direction === "out" && SPEND_CATS.includes(t.category)).map((t) => t.amount));
    const gambling = sum(inMo.filter((t) => t.isGambling && t.direction === "out").map((t) => t.amount));
    return { month: mo, income: round(income), expense: round(expense), net: round(income - expense), gambling: round(gambling) };
  });
}

export function assessAffordability(f: CashflowFeatures): Affordability {
  let score = 50;
  const reasons: Affordability["reasons"] = [];

  // Positive net cashflow (up to +20)
  if (f.avgMonthlyNet > 0) {
    const boost = Math.min(20, Math.round((f.avgMonthlyNet / Math.max(1, f.avgMonthlyIncome)) * 25));
    score += boost;
    reasons.push({ factor: "Positive monthly cashflow", direction: "positive", detail: `Keeps ~KES ${f.avgMonthlyNet.toLocaleString()} after spending each month.` });
  } else {
    score -= 10;
    reasons.push({ factor: "Negative cashflow", direction: "negative", detail: "Spends as much or more than they receive each month." });
  }

  // Income stability (up to +10 / -10)
  if (f.incomeVolatility <= 0.5 && f.avgMonthlyIncome > 0) {
    score += 10;
    reasons.push({ factor: "Stable income", direction: "positive", detail: `Monthly income is consistent (volatility ${f.incomeVolatility}).` });
  } else if (f.incomeVolatility > 1) {
    score -= 10;
    reasons.push({ factor: "Erratic income", direction: "negative", detail: `Income swings a lot month to month (volatility ${f.incomeVolatility}).` });
  }

  // Income regularity (up to +8)
  if (f.incomeMonthsRatio >= 0.8) {
    score += 8;
    reasons.push({ factor: "Earns every month", direction: "positive", detail: `Received income in ${Math.round(f.incomeMonthsRatio * 100)}% of months.` });
  }

  // Gambling (up to -28) — a meaningful betting share is a strong adverse signal.
  if (f.gamblingRatio > 0.02) {
    const penalty = Math.min(28, Math.round(f.gamblingRatio * 110));
    score -= penalty;
    reasons.push({ factor: "Gambling activity", direction: "negative", detail: `${Math.round(f.gamblingRatio * 100)}% of outflow goes to betting (KES ${f.gamblingOutflow.toLocaleString()}).` });
  }

  // Loan dependency (up to -15)
  if (f.loanDependencyRatio > 0.15) {
    const penalty = Math.min(15, Math.round(f.loanDependencyRatio * 40));
    score -= penalty;
    reasons.push({ factor: "Reliance on digital loans", direction: "negative", detail: `${Math.round(f.loanDependencyRatio * 100)}% of inflow is borrowed (${f.loanEventCount} loan events).` });
  }

  // Balance cushion (up to +5)
  if (f.avgBalance > f.avgMonthlyExpense * 0.5 && f.avgMonthlyExpense > 0) {
    score += 5;
    reasons.push({ factor: "Maintains a balance", direction: "positive", detail: `Average balance ~KES ${f.avgBalance.toLocaleString()}.` });
  }

  score = Math.max(0, Math.min(100, score));
  const band: Affordability["band"] = score >= 70 ? "Low risk" : score >= 50 ? "Moderate risk" : score >= 30 ? "High risk" : "Severe risk";

  // Conservative recommended instalment: a third of average monthly surplus.
  const recommendedMaxInstallment = Math.max(0, round(0.33 * Math.max(0, f.avgMonthlyNet)));

  return { score, band, recommendedMaxInstallment, reasons };
}

export function crunch(txns: MpesaTxn[]): CrunchResult {
  const features = computeFeatures(txns);
  return { features, monthly: monthlyBreakdown(txns), affordability: assessAffordability(features) };
}
