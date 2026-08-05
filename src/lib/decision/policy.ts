// ─────────────────────────────────────────────────────────────────────────────
// THE CREDIT POLICY — a lender's underwriting rules, as data.
//
// `src/lib/lending/qualify.ts` already produces the centrepiece a room wants to see:
// internal score → starting limit → matched product, with reason codes. But it is
// MULAR'S underwriting hardcoded into the platform —
//
//     const SCORE_CEILING = { Excellent: 40000, Good: 20000, … }   // one lender's numbers
//     products.filter(p => p.name.toUpperCase().startsWith(tier.key))  // one lender's names
//     const affordabilityCeiling = (weeklyCapacity * 6) / 1.375;   // one lender's mid-term/rate
//
// — which is precisely the pattern this whole architecture exists to remove. The
// second lender needs different ceilings; the third does not call their products
// INUKA; the fourth lends monthly, not weekly. On the old shape each of those is a
// code change shipped to everyone.
//
// So the numbers move here, into a TDL namespace (`credit`), and the pipeline in
// engine.ts reads them. Mular keeps its exact behaviour by holding exactly these
// values — verified, not asserted, by scripts/verify-decision-engine.ts.
//
// WHAT DELIBERATELY DOES *NOT* LIVE HERE: the score itself. How a statement becomes
// a number is a platform capability (lib/statement, lib/scoring) that every lender
// gets the same, because a score a lender can dial is not a score. Policy decides
// what to DO with it.
// ─────────────────────────────────────────────────────────────────────────────
import type { ConfigIssue } from "@/lib/config/borrower";
import {
  BEHAVIOUR_DEFAULTS, GRADUATION_DEFAULTS, MICROMART_BEHAVIOUR, MICROMART_GRADUATION,
  mergeBehaviour, mergeGraduation, validateBehaviour,
  type BehaviourBlock, type GraduationBlock,
} from "@/lib/scoring/behaviour-policy";

export type ScoreBand = "Excellent" | "Good" | "Fair" | "Poor" | "Very Poor";
export const SCORE_BANDS: ScoreBand[] = ["Excellent", "Good", "Fair", "Poor", "Very Poor"];

export type AffordabilityBand = "Low risk" | "Moderate risk" | "High risk" | "Severe risk";

export type CreditPolicy = {
  schemaVersion: 1;

  /** The most a statement of each quality can ever justify, before affordability. */
  scoreCeilings: Record<ScoreBand, number>;

  capacity: {
    /**
     * How much of the assessed monthly repayment capacity may be committed.
     * 1.0 spends the whole assessed capacity; below 1 keeps headroom.
     */
    utilisation: number;
    /**
     * The reference loan used to turn "X per month of capacity" into "Y of
     * principal": a representative term and the all-in cost over it. Both are
     * lender economics, not platform facts.
     */
    referenceTermUnit: "week" | "month";
    referenceTermCount: number;
    referenceAllInPct: number;
    /** Round the derived ceiling down to a clean step. */
    roundTo: number;
    /** An installment may exceed capacity by this fraction and still count affordable. */
    affordabilityTolerance: number;
  };

  /** Hard stops. Each one that fires is a named decline reason, never a silent zero. */
  stops: {
    /** Bands that cannot borrow at all. */
    refuseScoreBands: ScoreBand[];
    refuseAffordabilityBands: AffordabilityBand[];
    /** Refuse when this share of inflow is borrowed money. 0 disables. */
    maxLoanDependency: number;
    /** Refuse when net monthly cashflow is below this. */
    minMonthlyNet: number;
    /** Refuse a statement shorter than this many months. 0 disables. */
    minMonthsCovered: number;
  };

  /** Signals that do not refuse, but tighten the limit and say so. */
  haircuts: {
    /** Betting above this share of outflow cuts the limit by `bettingCutPct`. */
    bettingRatio: number;
    bettingCutPct: number;
    /** Income variation above this cuts the limit by `volatilityCutPct`. */
    incomeVolatility: number;
    volatilityCutPct: number;
    /** A statement under this many months cuts the limit by `thinFileCutPct`. */
    thinFileMonths: number;
    thinFileCutPct: number;
  };

  match: {
    /**
     * How a borrower is matched to products.
     *   rules   — the product's own eligibility + limit blocks decide. The default,
     *             and the only one that works for a lender we have never met.
     *   ladder  — a named tier ladder, matched by product name prefix. Mular's
     *             existing arrangement, kept so their live behaviour is expressible
     *             rather than approximated.
     */
    mode: "rules" | "ladder";
    /** mode = "ladder". Bands the starting limit is snapped into. */
    ladder: { key: string; label: string; min: number; max: number; step: number }[];
    /** Prefer the shortest affordable term, or the cheapest total cost. */
    prefer: "shortest_affordable" | "lowest_installment" | "cheapest_total";
  };

  /**
   * How a REPEAT borrower is scored on their own repayment record, and what that
   * earns them. Ported from sp_CreditScoringAndGraduation and made per-lender —
   * see lib/scoring/behaviour-policy.ts.
   */
  behaviour: BehaviourBlock;
  graduation: GraduationBlock;

  verdict: {
    /** At or above this score, and affordable → APPROVE without a human. */
    autoApproveAbove: number;
    /** Below this, DECLINE. Between the two, REFER to an officer. */
    autoDeclineBelow: number;
    /** Never auto-approve more than this, whatever the score. 0 = no cap. */
    autoApproveMaxAmount: number;
  };
};

export const CREDIT_DEFAULTS: CreditPolicy = {
  schemaVersion: 1,
  scoreCeilings: { Excellent: 40_000, Good: 20_000, Fair: 9_000, Poor: 3_000, "Very Poor": 0 },
  capacity: {
    utilisation: 1,
    referenceTermUnit: "week",
    referenceTermCount: 6,
    referenceAllInPct: 37.5,
    roundTo: 500,
    affordabilityTolerance: 0.05,
  },
  stops: {
    refuseScoreBands: ["Very Poor"],
    refuseAffordabilityBands: ["Severe risk"],
    maxLoanDependency: 0.5,
    minMonthlyNet: 0,
    minMonthsCovered: 0,
  },
  haircuts: {
    bettingRatio: 0.05, bettingCutPct: 0,
    incomeVolatility: 0.6, volatilityCutPct: 0,
    thinFileMonths: 3, thinFileCutPct: 0,
  },
  match: {
    mode: "rules",
    ladder: [],
    prefer: "shortest_affordable",
  },
  behaviour: BEHAVIOUR_DEFAULTS,
  graduation: GRADUATION_DEFAULTS,
  verdict: { autoApproveAbove: 1001, autoDeclineBelow: 0, autoApproveMaxAmount: 0 },
};

/**
 * Mular's live underwriting, expressed as policy.
 *
 * Every number here is lifted from `lib/lending/qualify.ts` + `lib/lending/buckets.ts`
 * as they stand today. This preset exists so the generalisation can be PROVEN
 * behaviour-preserving rather than hoped to be — see scripts/verify-decision-engine.ts,
 * which runs both paths over the same reports and diffs them.
 */
export const MULAR_POLICY: CreditPolicy = {
  ...CREDIT_DEFAULTS,
  behaviour: MICROMART_BEHAVIOUR,
  graduation: MICROMART_GRADUATION,
  match: {
    mode: "ladder",
    ladder: [
      { key: "INUKA", label: "Inuka", min: 1_000, max: 5_000, step: 500 },
      { key: "KUZA", label: "Kuza", min: 6_000, max: 10_000, step: 1_000 },
      { key: "FADHILI", label: "Fadhili", min: 11_000, max: 1_000_000, step: 1_000 },
    ],
    prefer: "shortest_affordable",
  },
};

/**
 * MICROMART — Micro Eazy. ServiceSuite parity on the commercial matrix, with two
 * departures that are named, measured and argued for rather than assumed.
 *
 * THE BEHAVIOUR HALF is `sp_CreditScoringAndGraduation` verbatim: repayment history
 * and days in arrears at 50/50, the 100/75/50/0 and 100/30/10/0 cuts, three
 * categories at >76 / 51–76 / below, earning 30% / 15% / 0%, a KES 5,000 cap per
 * step, and graduation gated on TWO cleared loans OF THE SAME PRINCIPAL — the
 * genuinely clever part of the original, since it asks not "have they borrowed
 * twice" but "have they proved this ceiling has stopped stretching them".
 *
 * DEPARTURE 1 — `window.includeActive: true`.
 *   The procedure reads `WHERE l.LoanCleared = 1`, so a borrower's score is frozen
 *   between borrowing and clearing: a post-mortem, not a monitor. Measured against
 *   Micromart's own book on 6 Aug 2026, cleared-only leaves 97 of 150 sampled
 *   borrowers with NO SCORE AT ALL — only 2 of their 162 borrowers have cleared two
 *   loans yet. Parity here would blind the platform to its own book for months,
 *   through exactly the pilot window that has to demonstrate the ladder working.
 *   Future installments are not punished (an undue instalment is not late), so
 *   including live loans is generous, not harsh.
 *
 * DEPARTURE 2 — `graduation.basis: "higher_of"`.
 *   The procedure computes the new limit from the LAST PRINCIPAL, so a borrower
 *   holding a KES 10,000 limit who twice borrowed 5,000 and repaid perfectly is
 *   "graduated" to 6,500 — a 35% CUT, recorded in the graduation history and
 *   reported as a success. `higher_of` grows whichever of limit and last principal
 *   is larger, so a graduation can never reduce a limit. Measured impact on
 *   Micromart's book today: ZERO borrowers — nobody has yet cleared two loans at
 *   the same principal — which makes this the cheapest possible moment to fix it.
 *
 * Everything else — trigger on clearance, rounding to the shilling — is parity,
 * and each was measured at zero impact before being adopted.
 *
 * THE ORIGINATION HALF has no counterpart in the procedure: ServiceSuite scores a
 * repayment record, not an M-Pesa statement. The reference loan is Micro Eazy's own
 * shape (10 weeks at 82.5% — the fees are collected before disbursement and never
 * appear in an instalment, so including them would double-count against
 * affordability), and the starting ceilings keep a first cycle small on the
 * principle the ladder is built on: lend little, then let behaviour earn the rest.
 */
export const MICROMART_POLICY: CreditPolicy = {
  ...CREDIT_DEFAULTS,
  behaviour: {
    ...MICROMART_BEHAVIOUR,
    window: { ...MICROMART_BEHAVIOUR.window, includeActive: true }, // departure 1
  },
  graduation: {
    ...MICROMART_GRADUATION,
    basis: "higher_of", // departure 2
    // The stock preset points demotion at a category key ("HIGH") that does not
    // exist in this matrix, so switching demotion on would silently match nobody.
    demotion: { enabled: false, belowCategory: "MAJOR", percent: 25, floor: 0 },
  },
  capacity: {
    ...CREDIT_DEFAULTS.capacity,
    referenceTermUnit: "week",
    referenceTermCount: 10, // Micro Eazy's full term
    referenceAllInPct: 82.5, // 8.25% per week × 10 — instalment cost only
  },
  // A first cycle is deliberately small; graduation adds at most KES 5,000 a time.
  // The floor is the product's own minimum bookable amount — below KES 5,000 there
  // is no Micro Eazy loan to offer.
  scoreCeilings: { Excellent: 25_000, Good: 15_000, Fair: 8_000, Poor: 5_000, "Very Poor": 0 },
  verdict: {
    // Micromart's own product rule: "Min Credit Score 500". A disclosed floor is
    // the only automatic adverse decision this policy makes.
    autoDeclineBelow: 500,
    // Nothing auto-approves at launch — every Micro Eazy loan meets one of their
    // officers. Raise this once the closed loop has outcomes to justify it.
    autoApproveAbove: 1001,
    autoApproveMaxAmount: 0,
  },
};

// ── Validation ────────────────────────────────────────────────────────────────

export function validateCreditPolicy(p: CreditPolicy): ConfigIssue[] {
  const out: ConfigIssue[] = [];
  const bad = (path: string, message: string) => out.push({ path, message });

  for (const band of SCORE_BANDS) {
    const v = p.scoreCeilings[band];
    if (!Number.isFinite(v) || v < 0) bad(`scoreCeilings.${band}`, `The ${band} ceiling must be zero or more.`);
  }
  // A stronger statement must never justify less than a weaker one, or the ladder
  // reads backwards to anyone the limit is explained to.
  for (let i = 1; i < SCORE_BANDS.length; i++) {
    const better = p.scoreCeilings[SCORE_BANDS[i - 1]];
    const worse = p.scoreCeilings[SCORE_BANDS[i]];
    if (worse > better) {
      bad(`scoreCeilings.${SCORE_BANDS[i]}`, `${SCORE_BANDS[i]} is allowed more than ${SCORE_BANDS[i - 1]} — the ladder runs backwards.`);
    }
  }

  if (p.capacity.utilisation <= 0 || p.capacity.utilisation > 1) {
    bad("capacity.utilisation", "Capacity utilisation must be above 0 and at most 1 (100% of assessed capacity).");
  }
  if (p.capacity.referenceTermCount < 1) bad("capacity.referenceTermCount", "The reference term needs at least one period.");
  if (p.capacity.referenceAllInPct < 0) bad("capacity.referenceAllInPct", "The reference cost cannot be negative.");
  if (p.capacity.roundTo < 1) bad("capacity.roundTo", "Rounding step must be at least 1.");
  if (p.capacity.affordabilityTolerance < 0 || p.capacity.affordabilityTolerance > 0.5) {
    bad("capacity.affordabilityTolerance", "Tolerance must be between 0 and 50% — beyond that, 'affordable' stops meaning anything.");
  }

  if (p.stops.maxLoanDependency < 0 || p.stops.maxLoanDependency > 1) {
    bad("stops.maxLoanDependency", "Loan dependency is a share of inflow: between 0 and 1.");
  }
  if (p.stops.refuseScoreBands.length === SCORE_BANDS.length) {
    bad("stops.refuseScoreBands", "Every score band is refused — nobody could ever borrow.");
  }

  for (const [key, cut] of [
    ["bettingCutPct", p.haircuts.bettingCutPct],
    ["volatilityCutPct", p.haircuts.volatilityCutPct],
    ["thinFileCutPct", p.haircuts.thinFileCutPct],
  ] as const) {
    if (cut < 0 || cut >= 100) bad(`haircuts.${key}`, "A haircut must be between 0 and 99% — 100% would decline by stealth rather than by rule.");
  }

  if (p.match.mode === "ladder") {
    if (p.match.ladder.length === 0) bad("match.ladder", "Ladder matching needs at least one rung.");
    for (let i = 0; i < p.match.ladder.length; i++) {
      const r = p.match.ladder[i];
      if (r.min > r.max) bad(`match.ladder.${i}`, `Rung "${r.label}" has a minimum above its maximum.`);
      if (r.step < 1) bad(`match.ladder.${i}`, `Rung "${r.label}" needs a rounding step of at least 1.`);
      if (i > 0 && r.min <= p.match.ladder[i - 1].min) {
        bad(`match.ladder.${i}`, `Rung "${r.label}" does not start above the rung below it.`);
      }
    }
  }

  out.push(...validateBehaviour(p.behaviour, p.graduation));

  if (p.verdict.autoDeclineBelow > p.verdict.autoApproveAbove) {
    bad("verdict.autoDeclineBelow", "The auto-decline floor is above the auto-approve ceiling — every application would be both.");
  }

  return out;
}

/** Fill a stored policy forward to the current shape. */
export function mergeCreditPolicy(stored: unknown): CreditPolicy {
  const s = (stored ?? {}) as Partial<CreditPolicy>;
  const d = CREDIT_DEFAULTS;
  return {
    schemaVersion: 1,
    scoreCeilings: { ...d.scoreCeilings, ...s.scoreCeilings },
    capacity: { ...d.capacity, ...s.capacity },
    stops: { ...d.stops, ...s.stops },
    haircuts: { ...d.haircuts, ...s.haircuts },
    match: { ...d.match, ...s.match, ladder: s.match?.ladder ?? d.match.ladder },
    behaviour: mergeBehaviour(s.behaviour),
    graduation: mergeGraduation(s.graduation),
    verdict: { ...d.verdict, ...s.verdict },
  };
}
