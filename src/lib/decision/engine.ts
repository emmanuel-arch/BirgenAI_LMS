// ─────────────────────────────────────────────────────────────────────────────
// THE DECISION FABRIC — one pipeline, seven stages, every one of which explains
// itself.
//
//   [capacity] → [stops] → [limit] → [match] → [price] → [route] → [verdict]
//
// THREE PROPERTIES, and each is a thing the system we are replacing cannot do.
//
//   1. IT IS DECLARATIVE. Every number comes from the lender's CreditPolicy
//      (policy.ts) or from the product's own definition blocks (lib/products).
//      Nothing about Mular, or any other lender, is compiled in.
//
//   2. EVERY STAGE EMITS REASON CODES. Not a score and a verdict, but the ordered
//      list of things that moved the answer — machine code, human sentence, and a
//      direction. This is what makes an adverse decision explainable to the customer
//      standing at the counter, and to a regulator afterwards.
//
//   3. THE WHOLE TRACE IS RETURNED AND STORED. A decision is reproducible: the
//      policy version, the product version, the inputs, and every stage's finding.
//      "Why was I declined in March?" has an answer in March's terms.
//
// PURE AND SERIALISABLE. No database, no clock, no randomness — the same context
// always yields the same decision, which is what makes both the parity check and
// the productised `POST /api/decisions` possible at all.
// ─────────────────────────────────────────────────────────────────────────────
import type { InternalReport } from "@/lib/statement/analyze";
import type { ProductDefinition } from "@/lib/products/definition";
import type { CreditPolicy, ScoreBand, AffordabilityBand } from "./policy";

// ── Vocabulary ────────────────────────────────────────────────────────────────

export type ReasonTone = "up" | "down" | "neutral";
export type ReasonCode = { code: string; label: string; detail: string; tone: ReasonTone };

export type StageKey = "capacity" | "stops" | "limit" | "match" | "price" | "route" | "verdict";

export type StageResult = {
  stage: StageKey;
  /** False means the application cannot proceed past this stage. */
  passed: boolean;
  /** What this stage worked out, for the trace. Always serialisable. */
  outputs: Record<string, unknown>;
  reasons: ReasonCode[];
};

export type MatchedProduct = {
  productId: string;
  name: string;
  /** Ladder rung, when the policy matches by ladder. */
  tier: string | null;
  termCount: number;
  termUnit: "day" | "week" | "fortnight" | "month";
  interestPct: number;
  principal: number;
  interest: number;
  processing: number;
  netDisbursed: number;
  totalRepayable: number;
  installment: number;
  affordable: boolean;
  recommended: boolean;
  /** Why this product was NOT offered, when it was not. */
  rejectedBecause: string | null;
};

export type Verdict = "APPROVE" | "REFER" | "DECLINE";

export type Decision = {
  verdict: Verdict;
  eligible: boolean;
  internalScore: number;
  scoreBand: ScoreBand;
  startingLimit: number;
  tier: string | null;
  ceilings: { score: number; affordability: number; boundBy: "score" | "affordability" | "both" };
  monthlyCapacity: number;
  products: MatchedProduct[];
  recommendedProductId: string | null;
  reasonCodes: ReasonCode[];
  declineReasons: string[];
  /** Every stage, in order — the auditable record of how this was reached. */
  trace: StageResult[];
};

/** One upfront fee, exactly as the lender wrote it on their price list. */
export type ChargeSpec = {
  code?: string;
  percent: boolean;
  amount: number;
  /** Floor and ceiling for a PERCENTAGE fee; ignored for a flat one. */
  minValue?: number | null;
  maxValue?: number | null;
};

/**
 * What one fee costs on this principal. Mirrors lib/payments/request.ts
 * `chargeAmount` deliberately — the number quoted in an offer and the number
 * demanded at the counter must be produced by the same rule.
 */
export function priceCharge(c: ChargeSpec, principal: number): number {
  if (!c.percent) return Math.round(c.amount);
  if (!(principal > 0)) return 0;
  let priced = (principal * c.amount) / 100;
  if (c.minValue != null) priced = Math.max(priced, c.minValue);
  if (c.maxValue != null) priced = Math.min(priced, c.maxValue);
  return Math.round(priced);
}

/** A product as the engine needs it: identity, terms, and the definition's rules. */
export type ProductCandidate = {
  id: string;
  name: string;
  /** Flat terms — what the loan actually costs and how long it runs. */
  minPrincipal: number;
  maxPrincipal: number;
  interestPct: number;
  termCount: number;
  termUnit: "day" | "week" | "fortnight" | "month";
  /**
   * Processing charge, flat KES or a percent of principal.
   *
   * Kept for callers that price a single fee. When `charges` is present it wins:
   * a real fee sheet is a LIST, and Micromart's Micro Eazy carries three
   * mandatory before-disbursement fees, not one.
   */
  processing: { percent: boolean; amount: number };
  /**
   * The full upfront fee sheet, priced and summed. Each entry is flat or a
   * percentage of principal, and a percentage is CLAMPED — Micromart's processing
   * fee is 6% but never below KES 650 nor above KES 6,000, which is their actual
   * price list. Charging the raw percentage would undercharge every small loan.
   */
  charges?: ChargeSpec[];
  /** The published rules, when the product has been versioned. */
  eligibility?: ProductDefinition["eligibility"];
  /** The version these terms came off, so the decision can cite it. */
  versionId?: string | null;
};

export type DecisionContext = {
  report: InternalReport;
  policy: CreditPolicy;
  products: ProductCandidate[];
  /** What we already know about this borrower, when we know it. */
  history?: { clearedLoans: number; hasActiveLoan: boolean; age?: number };
};

const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;
const floorTo = (n: number, step: number) => Math.max(0, Math.round(n / step) * step);

/** Periods per year, for turning a monthly capacity into a per-installment one. */
const PER_YEAR = { day: 365, week: 52, fortnight: 26, month: 12 } as const;

// ── The pipeline ──────────────────────────────────────────────────────────────

export function decide(ctx: DecisionContext): Decision {
  const { report, policy, products } = ctx;
  const trace: StageResult[] = [];
  const reasonCodes: ReasonCode[] = [];
  const declineReasons: string[] = [];

  const f = report.features;
  const aff = report.affordability;
  const lb = report.loanBehaviour;
  const scoreBand = report.score.band as ScoreBand;
  const score = report.score.value;

  // ── 1 · CAPACITY ────────────────────────────────────────────────────────────
  // How much principal the cashflow can actually carry, expressed through the
  // lender's own reference loan rather than a number baked into the platform.
  const cap = policy.capacity;
  const usableMonthly = aff.recommendedMaxInstallment * cap.utilisation;
  const perPeriod = (usableMonthly * 12) / PER_YEAR[cap.referenceTermUnit === "week" ? "week" : "month"];
  const affordabilityCeiling = floorTo(
    (perPeriod * cap.referenceTermCount) / (1 + cap.referenceAllInPct / 100),
    cap.roundTo,
  );

  trace.push({
    stage: "capacity",
    passed: true,
    outputs: { monthlyCapacity: aff.recommendedMaxInstallment, usableMonthly, perPeriod, affordabilityCeiling },
    reasons: [{
      code: "AFFORDABILITY",
      label: "Repayment capacity",
      detail: `Statements support about ${kes(aff.recommendedMaxInstallment)}/month in repayments`,
      tone: aff.band === "Low risk" ? "up" : aff.band === "Moderate risk" ? "neutral" : "down",
    }],
  });

  // ── 2 · STOPS ───────────────────────────────────────────────────────────────
  // Hard refusals. Each one that fires is NAMED — an adverse decision with no stated
  // reason is the thing regulators and customers both object to, correctly.
  const stops = policy.stops;
  const stopReasons: ReasonCode[] = [];

  if (stops.refuseScoreBands.includes(scoreBand)) {
    declineReasons.push(`Internal score ${score} (${scoreBand}) is below the lending floor.`);
    stopReasons.push({ code: "STOP_SCORE", label: "Score floor", detail: `${scoreBand} is refused by policy`, tone: "down" });
  }
  if (stops.refuseAffordabilityBands.includes(aff.band as AffordabilityBand)) {
    declineReasons.push("Cashflow shows severe repayment risk — no affordable installment.");
    stopReasons.push({ code: "STOP_AFFORDABILITY", label: "Affordability floor", detail: `${aff.band} is refused by policy`, tone: "down" });
  }
  if (f.avgMonthlyNet <= stops.minMonthlyNet && affordabilityCeiling < 1000) {
    declineReasons.push(`Spending exceeds income (${kes(f.avgMonthlyNet)}/mo net) — nothing free to repay from.`);
    stopReasons.push({ code: "STOP_CASHFLOW", label: "No free cashflow", detail: `Net ${kes(f.avgMonthlyNet)}/month`, tone: "down" });
  }
  if (stops.maxLoanDependency > 0 && lb.fulizaReliant && f.loanDependencyRatio > stops.maxLoanDependency) {
    declineReasons.push(`Heavy reliance on digital loans (${Math.round(f.loanDependencyRatio * 100)}% of inflow is borrowed).`);
    stopReasons.push({ code: "STOP_EXPOSURE", label: "Borrowed inflow", detail: `${pct(f.loanDependencyRatio)} of inflow is borrowed`, tone: "down" });
  }
  if (stops.minMonthsCovered > 0 && f.monthsCovered < stops.minMonthsCovered) {
    declineReasons.push(`Statement covers ${f.monthsCovered} month(s); ${stops.minMonthsCovered} are required.`);
    stopReasons.push({ code: "STOP_HISTORY", label: "Too little history", detail: `${f.monthsCovered} of ${stops.minMonthsCovered} months`, tone: "down" });
  }

  trace.push({ stage: "stops", passed: declineReasons.length === 0, outputs: { declineReasons }, reasons: stopReasons });

  // ── 3 · LIMIT ───────────────────────────────────────────────────────────────
  // The lower of two independent ceilings, then any haircuts. Neither a good score
  // nor a fat statement alone can over-lend, and whichever ceiling BINDS is named —
  // because "why is my limit only this?" is the first question every customer asks.
  const scoreCeiling = policy.scoreCeilings[scoreBand] ?? 0;
  const boundBy: "score" | "affordability" | "both" =
    scoreCeiling === affordabilityCeiling ? "both" : scoreCeiling < affordabilityCeiling ? "score" : "affordability";

  let rawLimit = Math.min(scoreCeiling, affordabilityCeiling);
  const hc = policy.haircuts;
  const applied: { code: string; pct: number }[] = [];
  const cut = (code: string, percent: number) => {
    if (percent <= 0) return;
    rawLimit = rawLimit * (1 - percent / 100);
    applied.push({ code, pct: percent });
  };
  if (f.gamblingRatio > hc.bettingRatio) cut("BETTING", hc.bettingCutPct);
  if (f.incomeVolatility > hc.incomeVolatility) cut("VOLATILITY", hc.volatilityCutPct);
  if (f.monthsCovered < hc.thinFileMonths) cut("THIN_FILE", hc.thinFileCutPct);
  if (applied.length) rawLimit = floorTo(rawLimit, cap.roundTo);

  // The ladder (when the lender uses one) snaps the raw limit onto a rung.
  const rung = policy.match.mode === "ladder" ? rungFor(policy, rawLimit) : null;
  const smallestOffer =
    policy.match.mode === "ladder"
      ? (policy.match.ladder[0]?.min ?? 0)
      : Math.min(...(products.length ? products.map((p) => p.minPrincipal) : [0]));

  if (rawLimit < smallestOffer && declineReasons.length === 0) {
    declineReasons.push(`Affordable amount (${kes(rawLimit)}) is below the smallest product (${kes(smallestOffer)}).`);
  }

  const eligible = declineReasons.length === 0 && (policy.match.mode !== "ladder" || !!rung);
  const startingLimit = !eligible ? 0 : rung ? snapToRung(rawLimit, rung) : floorTo(rawLimit, cap.roundTo);
  // A refused applicant has NO tier. The rung still had to be computed to know
  // whether one existed, but reporting "INUKA" beside a decline reads as an offer
  // that was withdrawn, and every screen downstream would render it as one.
  const tier = eligible ? rung?.key ?? null : null;

  // The reason codes a customer actually hears, in the order they matter.
  reasonCodes.push({
    code: "SCORE", label: "Internal score",
    detail: `${score} — ${scoreBand} on the M-Pesa read`,
    tone: scoreBand === "Excellent" || scoreBand === "Good" ? "up" : scoreBand === "Fair" ? "neutral" : "down",
  });
  reasonCodes.push(trace[0].reasons[0]); // AFFORDABILITY, already worded
  reasonCodes.push({
    code: "CASHFLOW", label: "Monthly cashflow",
    detail: f.avgMonthlyNet >= 0
      ? `Keeps ${kes(f.avgMonthlyNet)}/month after spending`
      : `Spends ${kes(-f.avgMonthlyNet)}/month more than it takes in`,
    tone: f.avgMonthlyNet >= 0 ? "up" : "down",
  });
  if (lb.repaymentCadence === "weekly" || lb.repaymentCadence === "biweekly") {
    reasonCodes.push({ code: "CADENCE", label: "Repayment rhythm", detail: `Already repays obligations ${lb.repaymentCadence} — suits a weekly loan`, tone: "up" });
  }
  if (lb.fulizaReliant || f.loanDependencyRatio > 0.3) {
    reasonCodes.push({ code: "EXPOSURE", label: "Existing loan load", detail: `${Math.round(f.loanDependencyRatio * 100)}% of inflow is borrowed — limit kept conservative`, tone: "down" });
  }
  if (f.gamblingRatio > hc.bettingRatio) {
    reasonCodes.push({ code: "BETTING", label: "Betting spend", detail: `${Math.round(f.gamblingRatio * 100)}% of outflow goes to betting — capped for prudence`, tone: "down" });
  }
  if (f.monthsCovered < hc.thinFileMonths) {
    reasonCodes.push({ code: "THIN_FILE", label: "Short history", detail: `Only ${f.monthsCovered} month${f.monthsCovered === 1 ? "" : "s"} of statement — starting small`, tone: "down" });
  }
  if (f.incomeVolatility > hc.incomeVolatility) {
    reasonCodes.push({ code: "VOLATILITY", label: "Uneven income", detail: `Income swings month to month (${Math.round(f.incomeVolatility * 100)}% variation)`, tone: "down" });
  }
  if (eligible) {
    reasonCodes.push({ code: "GRADUATION", label: "Room to grow", detail: "First loan starts here; the limit graduates automatically on clean repayment", tone: "neutral" });
    reasonCodes.push({
      code: "BOUND", label: "What set the limit",
      detail: boundBy === "score"
        ? "The internal score is the ceiling here — a stronger statement would lift it"
        : boundBy === "affordability"
          ? "Affordability is the ceiling — the cashflow, not the score, is the limit"
          : "Score and affordability agree on this limit",
      tone: "neutral",
    });
  }

  trace.push({
    stage: "limit",
    passed: eligible,
    outputs: { scoreCeiling, affordabilityCeiling, boundBy, rawLimit, haircuts: applied, startingLimit, tier },
    reasons: reasonCodes.filter((r) => ["SCORE", "BOUND", "BETTING", "VOLATILITY", "THIN_FILE"].includes(r.code)),
  });

  // ── 4 · MATCH ───────────────────────────────────────────────────────────────
  const { offered, matchReasons } = matchProducts(ctx, { eligible, startingLimit, rung });
  trace.push({
    stage: "match",
    passed: offered.length > 0,
    outputs: { mode: policy.match.mode, considered: products.length, offered: offered.length },
    reasons: matchReasons,
  });

  // ── 5 · PRICE ───────────────────────────────────────────────────────────────
  // Affordability is judged per installment, against the same capacity the ceiling
  // came from — so an "affordable" product is one this cashflow genuinely carries.
  for (const p of offered) {
    const capacityPerPeriod = (usableMonthly * 12) / PER_YEAR[p.termUnit];
    p.affordable = p.installment <= capacityPerPeriod * (1 + cap.affordabilityTolerance);
  }
  const recommended = recommend(offered, policy);
  if (recommended) recommended.recommended = true;

  trace.push({
    stage: "price",
    passed: offered.length > 0,
    outputs: {
      prefer: policy.match.prefer,
      affordableCount: offered.filter((p) => p.affordable).length,
      recommendedProductId: recommended?.productId ?? null,
    },
    reasons: recommended
      ? [{
          code: "RECOMMENDED", label: "Recommended offer",
          detail: `${recommended.name}: ${kes(recommended.principal)} over ${recommended.termCount} ${recommended.termUnit}s, ${kes(recommended.installment)} per ${recommended.termUnit}`,
          tone: recommended.affordable ? "up" : "neutral",
        }]
      : [],
  });

  // ── 6 · ROUTE ───────────────────────────────────────────────────────────────
  // Not a decision about the borrower — a decision about who decides. Kept in the
  // trace because "who was allowed to approve this" is an audit question.
  trace.push({
    stage: "route",
    passed: true,
    outputs: {
      clearedLoans: ctx.history?.clearedLoans ?? 0,
      path: (ctx.history?.clearedLoans ?? 0) > 0 ? "repeat" : "new",
    },
    reasons: [],
  });

  // ── 7 · VERDICT ─────────────────────────────────────────────────────────────
  // Adverse outcomes are never automatic beyond the stated floor, and an approval is
  // only automatic inside the band AND the amount the lender said it trusted.
  const v = policy.verdict;
  let verdict: Verdict;
  if (!eligible || offered.length === 0) {
    verdict = "DECLINE";
    if (offered.length === 0 && declineReasons.length === 0) {
      declineReasons.push("No product in the catalogue fits this borrower's limit and profile.");
    }
  } else if (score < v.autoDeclineBelow) {
    verdict = "DECLINE";
    declineReasons.push(`Internal score ${score} is below the automatic decline floor (${v.autoDeclineBelow}).`);
  } else if (
    score >= v.autoApproveAbove &&
    recommended?.affordable &&
    (v.autoApproveMaxAmount === 0 || (recommended?.principal ?? 0) <= v.autoApproveMaxAmount)
  ) {
    verdict = "APPROVE";
  } else {
    verdict = "REFER";
  }

  trace.push({
    stage: "verdict",
    passed: verdict !== "DECLINE",
    outputs: { verdict, autoApproveAbove: v.autoApproveAbove, autoDeclineBelow: v.autoDeclineBelow },
    reasons: [{
      code: `VERDICT_${verdict}`,
      label: "Outcome",
      detail: verdict === "APPROVE"
        ? "Inside the automatic approval band and affordable"
        : verdict === "DECLINE"
          ? declineReasons[0] ?? "Does not meet the lending policy"
          : "Needs an officer's judgement — outside the automatic band",
      tone: verdict === "APPROVE" ? "up" : verdict === "DECLINE" ? "down" : "neutral",
    }],
  });

  return {
    verdict,
    eligible,
    internalScore: score,
    scoreBand,
    startingLimit,
    tier,
    ceilings: { score: scoreCeiling, affordability: affordabilityCeiling, boundBy },
    monthlyCapacity: aff.recommendedMaxInstallment,
    products: offered,
    recommendedProductId: recommended?.productId ?? null,
    reasonCodes,
    declineReasons,
    trace,
  };
}

// ── Matching ──────────────────────────────────────────────────────────────────

type Rung = CreditPolicy["match"]["ladder"][number];

function rungFor(policy: CreditPolicy, limit: number): Rung | null {
  // Highest rung whose floor the limit reaches; gaps between rungs snap DOWN, so a
  // limit of 5,400 on a 1k–5k / 6k–10k ladder lands on the lower rung rather than
  // being rounded up into money the cashflow did not justify.
  for (let i = policy.match.ladder.length - 1; i >= 0; i--) {
    if (limit >= policy.match.ladder[i].min) return policy.match.ladder[i];
  }
  return null;
}

function snapToRung(raw: number, rung: Rung): number {
  const capped = Math.min(raw, rung.max);
  return Math.max(rung.min, Math.round(capped / rung.step) * rung.step);
}

function matchProducts(
  ctx: DecisionContext,
  state: { eligible: boolean; startingLimit: number; rung: Rung | null },
): { offered: MatchedProduct[]; matchReasons: ReasonCode[] } {
  const { policy, products, report } = ctx;
  const matchReasons: ReasonCode[] = [];
  if (!state.eligible) return { offered: [], matchReasons };

  const score = report.score.value;
  const history = ctx.history;
  const offered: MatchedProduct[] = [];

  for (const p of products) {
    const reject = rejectionFor(p, state, policy, score, history);
    if (reject) continue; // Not offered; the reason is summarised below, not per-row noise.

    const principal = Math.min(state.startingLimit, p.maxPrincipal);
    const interest = Math.round((principal * p.interestPct) / 100);
    // The whole upfront sheet, clamped per fee — not one fee, and not a raw
    // percentage. `charges` wins when the caller supplied it; `processing` is the
    // single-fee shorthand the parity fixtures still use.
    const processing = p.charges?.length
      ? p.charges.reduce((sum, c) => sum + priceCharge(c, principal), 0)
      : priceCharge(p.processing, principal);
    const totalRepayable = principal + interest;

    offered.push({
      productId: p.id,
      name: p.name,
      tier: state.rung?.key ?? null,
      termCount: p.termCount,
      termUnit: p.termUnit,
      interestPct: p.interestPct,
      principal,
      interest,
      processing,
      netDisbursed: principal - processing,
      totalRepayable,
      installment: Math.round(totalRepayable / Math.max(1, p.termCount)),
      affordable: false, // set by the price stage
      recommended: false,
      rejectedBecause: null,
    });
  }

  // Shortest term first — the price stage's preferences read down this order.
  offered.sort((a, b) => a.termCount - b.termCount);

  matchReasons.push({
    code: "MATCH",
    label: "Products matched",
    detail: policy.match.mode === "ladder"
      ? `${offered.length} on the ${state.rung?.label ?? "—"} rung, from ${products.length} in the catalogue`
      : `${offered.length} of ${products.length} products fit this borrower's limit and profile`,
    tone: offered.length > 0 ? "up" : "down",
  });

  return { offered, matchReasons };
}

/**
 * Why a product is not on offer — or null if it is.
 *
 * In "rules" mode this reads the product's OWN published eligibility block, which is
 * the whole point: the lender writes the rule once, on the product, and the engine
 * obeys it without knowing anything about that lender. In "ladder" mode a name prefix
 * selects the rung, which is how Mular's catalogue is arranged today.
 */
function rejectionFor(
  p: ProductCandidate,
  state: { startingLimit: number; rung: Rung | null },
  policy: CreditPolicy,
  score: number,
  history: DecisionContext["history"],
): string | null {
  if (policy.match.mode === "ladder") {
    if (!state.rung) return "No ladder rung for this limit.";
    if (!p.name.toUpperCase().startsWith(state.rung.key)) return `Not on the ${state.rung.label} rung.`;
    return null;
  }

  // rules mode
  if (state.startingLimit < p.minPrincipal) {
    return `Limit ${state.startingLimit} is below this product's minimum ${p.minPrincipal}.`;
  }
  const e = p.eligibility;
  if (e) {
    if (e.minCreditScore > 0 && score < e.minCreditScore) return `Score ${score} below the product's minimum ${e.minCreditScore}.`;
    if (e.minClearedLoans > 0 && (history?.clearedLoans ?? 0) < e.minClearedLoans) {
      return `Needs ${e.minClearedLoans} cleared loan(s); borrower has ${history?.clearedLoans ?? 0}.`;
    }
    if (e.oneAtATime && history?.hasActiveLoan) return "Borrower already holds a live loan on this product.";
    if (e.minAge > 0 && history?.age !== undefined && history.age < e.minAge) return `Below the product's minimum age (${e.minAge}).`;
    if (e.maxAge > 0 && history?.age !== undefined && history.age > e.maxAge) return `Above the product's maximum age (${e.maxAge}).`;
  }
  return null;
}

function recommend(offered: MatchedProduct[], policy: CreditPolicy): MatchedProduct | null {
  if (offered.length === 0) return null;
  const affordable = offered.filter((p) => p.affordable);

  switch (policy.match.prefer) {
    case "lowest_installment":
      return [...offered].sort((a, b) => a.installment - b.installment)[0];
    case "cheapest_total":
      return (affordable.length ? affordable : offered).slice().sort((a, b) => a.totalRepayable - b.totalRepayable)[0];
    case "shortest_affordable":
    default:
      // The shortest term they can comfortably carry — cheapest in total interest.
      // If none fits the capacity, the LONGEST is offered instead: the lowest
      // per-period installment is the most honest thing to put in front of someone
      // whose cashflow is tight, and the officer still has to agree.
      return affordable.length ? affordable[0] : offered[offered.length - 1];
  }
}
