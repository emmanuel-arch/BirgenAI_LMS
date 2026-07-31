// ─────────────────────────────────────────────────────────────────────────────
// ⚠ SUPERSEDED BY src/lib/decision/engine.ts — DO NOT ADD RULES HERE.
//
// This file is MULAR'S underwriting, hardcoded: the SCORE_CEILING table, the
// INUKA/KUZA/FADHILI ladder, the name-prefix product match and the 6-week/37.5%
// reference loan are all one lender's numbers living in platform code. The decision
// fabric replaces every one of them with policy a lender holds
// (lib/decision/policy.ts, TDL namespace `credit`) plus the product's own published
// eligibility block.
//
// It is still here because it is the LIVE path for Mular via
// /api/enterprise/statement-cruncher, and it stays until that route is cut over.
// `decide()` under MULAR_POLICY is proven to reproduce this function's output —
// limit, tier, ceilings, recommendation, pricing and decline reasons — across ten
// borrower profiles by `npm run test:decisions`. The cutover is: read the org's
// `credit` policy, call `decide()`, map the result. Any new rule added here instead
// of there will silently apply to Mular alone and to no other lender.
//
// ─────────────────────────────────────────────────────────────────────────────
// STARTING LIMIT · PRODUCT MATCH · REASON CODES — the moment after the crunch.
//
// A brand-new customer has no cleared loans, so behavioural graduation (risk/
// graduation.ts) has nothing to say yet. What we DO have is the Internal Report from
// their M-Pesa statement. This turns that report into three things an officer can
// read aloud to the customer:
//
//   1. a STARTING LIMIT (in KES),
//   2. the PRODUCT TIER + the terms it unlocks (Inuka / Kuza / Fadhili),
//   3. the REASON CODES — why that limit, why that product, in plain words.
//
// The limit is the LOWER of two independent ceilings, so neither a good score nor a
// fat statement alone can over-lend:
//   • a SCORE ceiling  — how creditworthy the statement says they are, and
//   • an AFFORDABILITY ceiling — how much the cashflow can actually repay.
// Whichever binds is named in the reasons, because "why is my limit only this?" is
// the first question every customer asks.
// ─────────────────────────────────────────────────────────────────────────────
import type { InternalReport } from "@/lib/statement/analyze";
import { TIERS, WEEKS, interestForWeeks, tierForLimit, snapLimitToTier, type TierKey } from "./buckets";

export type ProductLite = {
  id: string;
  name: string;
  minPrincipal: number;
  maxPrincipal: number;
  interestRate: number;
  repaymentPeriod: number; // weeks
};
/** A processing charge, keyed to a product. */
export type ChargeLite = { productId: string | null; amount: number; isPercent: boolean };

export type ReasonTone = "up" | "down" | "neutral";
export type ReasonCode = { code: string; label: string; detail: string; tone: ReasonTone };

export type QualifiedProduct = {
  productId: string;
  name: string;
  tier: TierKey;
  weeks: number;
  interestPct: number;
  principal: number;
  interest: number;
  processing: number;
  netDisbursed: number; // principal − processing (deducted at disbursement)
  totalRepayable: number; // principal + interest
  weeklyInstallment: number;
  affordable: boolean; // installment within the cashflow's weekly capacity
  recommended: boolean;
};

export type Qualification = {
  eligible: boolean;
  internalScore: number;
  scoreBand: string;
  startingLimit: number;
  tier: TierKey | null;
  /** The two ceilings, so the UI can show which one bound the limit. */
  ceilings: { score: number; affordability: number; boundBy: "score" | "affordability" | "both" };
  monthlyCapacity: number; // recommendedMaxInstallment
  reasonCodes: ReasonCode[];
  products: QualifiedProduct[];
  recommendedProductId: string | null;
  declineReasons: string[];
};

const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
const clampRound = (n: number, step: number) => Math.max(0, Math.round(n / step) * step);

// How far a spotless statement can reach, by internal band. The affordability
// ceiling almost always pulls this down — it is the aspiration, not the answer.
const SCORE_CEILING: Record<string, number> = {
  Excellent: 40000,
  Good: 20000,
  Fair: 9000,
  Poor: 3000,
  "Very Poor": 0,
};

/**
 * Turn an Internal Report + the lender's live tier catalogue into a starting limit,
 * a matched product tier, and the reasons behind both. Pure and serialisable.
 */
export function qualify(report: InternalReport, products: ProductLite[], charges: ChargeLite[]): Qualification {
  const f = report.features;
  const aff = report.affordability;
  const lb = report.loanBehaviour;
  const scoreBand = report.score.band;
  const score = report.score.value;

  // ── the two ceilings ────────────────────────────────────────────────────────
  const scoreCeiling = SCORE_CEILING[scoreBand] ?? 0;
  // Monthly repayment capacity → a weekly-loan principal it can clear over a mid
  // (6-week) term at the mid (37.5%) rate. Conservative by construction.
  const weeklyCapacity = (aff.recommendedMaxInstallment * 12) / 52;
  const affordabilityCeiling = clampRound((weeklyCapacity * 6) / 1.375, 500);

  const rawLimit = Math.min(scoreCeiling, affordabilityCeiling);
  const boundBy: "score" | "affordability" | "both" =
    scoreCeiling === affordabilityCeiling ? "both" : scoreCeiling < affordabilityCeiling ? "score" : "affordability";

  // ── hard stops → decline with reasons ───────────────────────────────────────
  const declineReasons: string[] = [];
  if (scoreBand === "Very Poor") declineReasons.push(`Internal score ${score} (Very Poor) is below the lending floor.`);
  if (aff.band === "Severe risk") declineReasons.push("Cashflow shows severe repayment risk — no affordable installment.");
  if (f.avgMonthlyNet <= 0 && affordabilityCeiling < 1000) declineReasons.push(`Spending exceeds income (${kes(f.avgMonthlyNet)}/mo net) — nothing free to repay from.`);
  if (lb.fulizaReliant && f.loanDependencyRatio > 0.5) declineReasons.push(`Heavy reliance on digital loans (${Math.round(f.loanDependencyRatio * 100)}% of inflow is borrowed).`);
  if (rawLimit < TIERS[0].min && declineReasons.length === 0) declineReasons.push(`Affordable amount (${kes(rawLimit)}) is below the smallest product (${kes(TIERS[0].min)}).`);

  const tier = declineReasons.length === 0 ? tierForLimit(rawLimit) : null;
  const startingLimit = tier ? snapLimitToTier(rawLimit, tier) : 0;

  // ── reason codes (the star of the show) ─────────────────────────────────────
  const reasonCodes: ReasonCode[] = [];
  reasonCodes.push({ code: "SCORE", label: "Internal score", detail: `${score} — ${scoreBand} on the M-Pesa read`, tone: scoreBand === "Excellent" || scoreBand === "Good" ? "up" : scoreBand === "Fair" ? "neutral" : "down" });
  reasonCodes.push({ code: "AFFORDABILITY", label: "Repayment capacity", detail: `Statements support about ${kes(aff.recommendedMaxInstallment)}/month in repayments`, tone: aff.band === "Low risk" ? "up" : aff.band === "Moderate risk" ? "neutral" : "down" });
  reasonCodes.push({ code: "CASHFLOW", label: "Monthly cashflow", detail: f.avgMonthlyNet >= 0 ? `Keeps ${kes(f.avgMonthlyNet)}/month after spending` : `Spends ${kes(-f.avgMonthlyNet)}/month more than it takes in`, tone: f.avgMonthlyNet >= 0 ? "up" : "down" });
  if (lb.repaymentCadence === "weekly" || lb.repaymentCadence === "biweekly")
    reasonCodes.push({ code: "CADENCE", label: "Repayment rhythm", detail: `Already repays obligations ${lb.repaymentCadence} — suits a weekly loan`, tone: "up" });
  if (lb.fulizaReliant || f.loanDependencyRatio > 0.3)
    reasonCodes.push({ code: "EXPOSURE", label: "Existing loan load", detail: `${Math.round(f.loanDependencyRatio * 100)}% of inflow is borrowed — limit kept conservative`, tone: "down" });
  if (f.gamblingRatio > 0.05)
    reasonCodes.push({ code: "BETTING", label: "Betting spend", detail: `${Math.round(f.gamblingRatio * 100)}% of outflow goes to betting — capped for prudence`, tone: "down" });
  if (f.monthsCovered < 3)
    reasonCodes.push({ code: "THIN_FILE", label: "Short history", detail: `Only ${f.monthsCovered} month${f.monthsCovered === 1 ? "" : "s"} of statement — starting small`, tone: "down" });
  if (f.incomeVolatility > 0.6)
    reasonCodes.push({ code: "VOLATILITY", label: "Uneven income", detail: `Income swings month to month (${Math.round(f.incomeVolatility * 100)}% variation)`, tone: "down" });
  if (tier)
    reasonCodes.push({ code: "GRADUATION", label: "Room to grow", detail: `First loan starts here; the limit graduates automatically on clean repayment`, tone: "neutral" });
  if (tier)
    reasonCodes.push({ code: "BOUND", label: "What set the limit", detail: boundBy === "score" ? `The internal score is the ceiling here — a stronger statement would lift it` : boundBy === "affordability" ? `Affordability is the ceiling — the cashflow, not the score, is the limit` : `Score and affordability agree on this limit`, tone: "neutral" });

  // ── matched products (the tier's terms, priced against THIS limit) ───────────
  const chargeFor = (pid: string) => charges.find((c) => c.productId === pid);
  const tierProducts = tier
    ? products
        .filter((p) => p.name.toUpperCase().startsWith(tier.key))
        .sort((a, b) => a.repaymentPeriod - b.repaymentPeriod)
    : [];

  const qualified: QualifiedProduct[] = tierProducts.map((p) => {
    const principal = Math.min(startingLimit, Number(p.maxPrincipal));
    const interest = Math.round((principal * Number(p.interestRate)) / 100);
    const ch = chargeFor(p.id);
    const processing = ch ? (ch.isPercent ? Math.round((principal * ch.amount) / 100) : ch.amount) : 0;
    const totalRepayable = principal + interest;
    const weeklyInstallment = Math.round(totalRepayable / p.repaymentPeriod);
    return {
      productId: p.id, name: p.name, tier: tier!.key, weeks: p.repaymentPeriod,
      interestPct: Number(p.interestRate), principal, interest, processing,
      netDisbursed: principal - processing, totalRepayable, weeklyInstallment,
      affordable: weeklyInstallment <= weeklyCapacity * 1.05,
      recommended: false,
    };
  });

  // Recommend the shortest term the customer can comfortably carry (cheapest total
  // interest); if none fit the weekly capacity, recommend the longest (lowest weekly).
  let recommendedProductId: string | null = null;
  if (qualified.length) {
    const affordableOnes = qualified.filter((q) => q.affordable);
    const chosen = affordableOnes.length ? affordableOnes[0] : qualified[qualified.length - 1];
    chosen.recommended = true;
    recommendedProductId = chosen.productId;
  }

  return {
    eligible: declineReasons.length === 0 && !!tier,
    internalScore: score,
    scoreBand,
    startingLimit,
    tier: tier?.key ?? null,
    ceilings: { score: scoreCeiling, affordability: affordabilityCeiling, boundBy },
    monthlyCapacity: aff.recommendedMaxInstallment,
    reasonCodes,
    products: qualified,
    recommendedProductId,
    declineReasons,
  };
}
