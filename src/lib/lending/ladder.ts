// ─────────────────────────────────────────────────────────────────────────────
// THE LADDER — how a customer's limit grows, and why.
//
// This is `sp_CreditScoringAndGraduation` written out in TypeScript: the rules
// Micromart's ServiceSuite actually applies, made explicit, typed, and
// CONFIGURABLE. It is the ecosystem's DEFAULT. A lender may change any number
// here; what they cannot do is change them without the change being visible,
// which is the whole reason the policy is data rather than code.
//
// ── WHY IT IS RESTATED RATHER THAN CALLED ───────────────────────────────────
// The procedure WRITES. It updates Borrowers.RiskScore, Borrowers.LoanLimit and
// LoanGraduationHistory inside a transaction, for one borrower or for the entire
// entity when @BorrowerId is null. That is the lender's job to run, on their
// schedule, against their book — not something a console read should trigger.
//
// So this module never executes it. It computes the SAME answer so the app can
// explain a limit before the lender's job next runs, show a customer what would
// move their score, and let a different lender adopt different numbers. Where
// the two disagree, THEIRS IS RIGHT and this is the bug —
// scripts/verify-ladder.mts checks that claim against real borrowers.
//
// ── AND WHY THIS FILE EXISTS AT ALL ─────────────────────────────────────────
// `checkGraduation` in lib/lms/servicesuite.ts answers a DIFFERENT question with
// a different rule — "5+ cleared loans and no active loan" — which is not what
// the lender's procedure does and never was. That helper decides who may use
// self-service. This decides what somebody's limit becomes. Two rules, two
// jobs; the danger is only in mistaking one for the other.
// ─────────────────────────────────────────────────────────────────────────────

/** One instalment, as the ladder needs to see it. */
export interface LadderInstalment {
  installmentAmount: number;
  amountPaid: number;
  expectedDueDate: Date | string;
  /** Null when it has not been paid — the rules treat that as "late as of today". */
  dateOfPayment: Date | string | null;
}

export interface LadderPolicy {
  /** How many of the most recent CLEARED loans are looked at. Their default: 2. */
  lookbackClearedLoans: number;
  /** Must sum to 1. Their default is an even split. */
  weights: { repaymentHistory: number; daysInArrears: number };
  /**
   * Score for HOW MUCH of an instalment was paid, best band first. `atLeast` is
   * a fraction of the instalment amount.
   */
  repaymentBands: { atLeast: number; score: number }[];
  /** Score for HOW LATE it was, best band first. `withinDays` is inclusive. */
  latenessBands: { withinDays: number; score: number }[];
  /**
   * Label for a final score, highest threshold first.
   *
   * `inclusive` exists because their two bands DISAGREE about it, and the
   * disagreement is not cosmetic:
   *
   *     WHEN score > 76            THEN 'Minor risk'   -- exclusive
   *     WHEN score BETWEEN 51 AND 76 THEN 'Moderate'   -- INCLUSIVE of 51
   *     ELSE 'Major risk'
   *
   * So a score of 50.5 is above 50, below 51, and lands in NEITHER of the first
   * two — it falls through to "Major risk". There is a dead zone between 50 and
   * 51, and a customer sitting in it is scored as the worst band while being
   * numerically better than the threshold everyone quotes. Reproduced here
   * deliberately: this file has to agree with the limit the customer was given,
   * not with the rule as anyone would have written it fresh.
   */
  riskBands: { min: number; inclusive: boolean; label: string }[];
  graduation: {
    minClearedLoans: number;
    /**
     * Their rule, and a surprising one: the cleared loans in the lookback must
     * be for the SAME principal. Somebody who cleared 10,000 then 20,000 does
     * not graduate — the ladder wants a repeated, proven amount rather than a
     * rising one, because a bigger loan repaid once is not evidence the customer
     * can carry it again.
     */
    requireEqualPrincipals: boolean;
    /** Exclusive. Their default: a score of exactly 50 does not graduate. */
    minScore: number;
    /** Percentage uplift by score, highest first. Same inclusivity split as
     *  riskBands above, and from the same CASE expression — a 50.5 earns 0%
     *  and therefore does not graduate at all. */
    percentByScore: { min: number; inclusive: boolean; percent: number }[];
    /**
     * The most a limit may rise in ONE step, in currency. Their default is
     * 5,000: a 30% uplift on a 50,000 loan is 15,000, and the customer gets
     * 5,000. The ladder is deliberately slower than the percentage implies, and
     * a screen that shows the percentage without this cap is lying by omission —
     * which is why `cappedByCeiling` is reported rather than folded away.
     */
    perStepCeiling: number;
  };
}

/**
 * Micromart's configuration, and the ecosystem default — read off
 * sp_CreditScoringAndGraduation on 1 Sep 2026.
 */
export const DEFAULT_LADDER: LadderPolicy = {
  lookbackClearedLoans: 2,
  weights: { repaymentHistory: 0.5, daysInArrears: 0.5 },
  repaymentBands: [
    { atLeast: 1.0, score: 100 },
    { atLeast: 0.75, score: 75 },
    { atLeast: 0.5, score: 50 },
    { atLeast: 0, score: 0 },
  ],
  latenessBands: [
    { withinDays: 0, score: 100 },
    { withinDays: 3, score: 30 },
    { withinDays: 6, score: 10 },
    { withinDays: Number.POSITIVE_INFINITY, score: 0 },
  ],
  riskBands: [
    { min: 76, inclusive: false, label: "Minor risk" },
    { min: 51, inclusive: true, label: "Moderate" },
    { min: Number.NEGATIVE_INFINITY, inclusive: true, label: "Major risk" },
  ],
  graduation: {
    minClearedLoans: 2,
    requireEqualPrincipals: true,
    minScore: 50,
    percentByScore: [
      { min: 76, inclusive: false, percent: 30 },
      { min: 51, inclusive: true, percent: 15 },
      { min: Number.NEGATIVE_INFINITY, inclusive: true, percent: 0 },
    ],
    perStepCeiling: 5000,
  },
};

const asDate = (v: Date | string): Date => (v instanceof Date ? v : new Date(v));

/** Whole days between two dates, ignoring the clock — DATEDIFF(DAY, …) semantics. */
function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / 86_400_000);
}

export interface LadderScore {
  repaymentHistory: number;
  daysInArrears: number;
  riskScore: number;
  riskBand: string;
  instalmentsUsed: number;
}

/**
 * Score one loan's instalments.
 *
 * AVERAGED PER LOAN, THEN PER BORROWER — not pooled. Their procedure groups by
 * (BorrowerId, LoanId) and then averages those loan averages, so a loan with
 * twenty instalments counts the same as one with four. Pooling every instalment
 * instead would silently weight the longer loan, and for a book that mixes
 * 4-week and 10-week products that is a different ladder.
 */
export function scoreLoan(instalments: LadderInstalment[], policy: LadderPolicy = DEFAULT_LADDER): {
  repaymentHistory: number;
  daysInArrears: number;
  count: number;
} {
  if (instalments.length === 0) return { repaymentHistory: 0, daysInArrears: 0, count: 0 };
  const now = new Date();

  let paidTotal = 0;
  let lateTotal = 0;
  for (const it of instalments) {
    const amount = Number(it.installmentAmount) || 0;
    const paid = Number(it.amountPaid) || 0;
    const fraction = amount > 0 ? paid / amount : 0;
    paidTotal += policy.repaymentBands.find((b) => fraction >= b.atLeast)?.score ?? 0;

    // An unpaid instalment is measured against TODAY, which is what makes the
    // score fall while somebody is still late rather than only after they pay.
    const late = daysBetween(asDate(it.expectedDueDate), it.dateOfPayment ? asDate(it.dateOfPayment) : now);
    lateTotal += policy.latenessBands.find((b) => late <= b.withinDays)?.score ?? 0;
  }

  return {
    repaymentHistory: paidTotal / instalments.length,
    daysInArrears: lateTotal / instalments.length,
    count: instalments.length,
  };
}

/** Combine per-loan averages into the borrower's score. */
export function scoreBorrower(
  loans: { repaymentHistory: number; daysInArrears: number; count: number }[],
  policy: LadderPolicy = DEFAULT_LADDER,
): LadderScore {
  const scored = loans.filter((l) => l.count > 0);
  if (scored.length === 0) {
    return { repaymentHistory: 0, daysInArrears: 0, riskScore: 0, riskBand: bandFor(0, policy), instalmentsUsed: 0 };
  }
  const avg = (pick: (l: (typeof scored)[number]) => number) =>
    scored.reduce((s, l) => s + pick(l), 0) / scored.length;

  const repaymentHistory = round2(avg((l) => l.repaymentHistory));
  const daysInArrears = round2(avg((l) => l.daysInArrears));
  const riskScore = round2(
    policy.weights.repaymentHistory * avg((l) => l.repaymentHistory) +
      policy.weights.daysInArrears * avg((l) => l.daysInArrears),
  );

  return {
    repaymentHistory,
    daysInArrears,
    riskScore,
    riskBand: bandFor(riskScore, policy),
    instalmentsUsed: scored.reduce((s, l) => s + l.count, 0),
  };
}

/** True when `score` clears a threshold, honouring its inclusivity. */
function clears(score: number, t: { min: number; inclusive: boolean }): boolean {
  return t.inclusive ? score >= t.min : score > t.min;
}

function bandFor(score: number, policy: LadderPolicy): string {
  return (
    policy.riskBands.find((b) => clears(score, b))?.label ??
    policy.riskBands[policy.riskBands.length - 1].label
  );
}

/** Rounded the way SQL Server's ROUND(x, 2) does — half away from zero. */
function round2(n: number): number {
  return Math.sign(n) * Math.round(Math.abs(n) * 100) / 100;
}

export interface GraduationInput {
  riskScore: number;
  clearedLoans: number;
  /** Principals of the cleared loans in the lookback, for the equality rule. */
  clearedPrincipals: number[];
  /** The amount the ladder steps up FROM — their `LastLoanPrincipal`. */
  lastLoanPrincipal: number;
}

export interface GraduationOutcome {
  eligible: boolean;
  percent: number;
  /** What the percentage alone would have granted. */
  uncappedIncrease: number;
  increase: number;
  newLimit: number | null;
  /** True when the ceiling paid out less than the percentage earned. */
  cappedByCeiling: boolean;
  /** Why not, in the customer's language. Empty when eligible. */
  blockedBy: string[];
}

/**
 * Would this customer's limit move, and to what?
 *
 * Returns the REASONS when it would not. A ladder that only answers yes or no
 * is a ladder customers ring up about, and "you need one more cleared loan at
 * the same amount" is the single most actionable sentence this system can say.
 */
export function graduate(input: GraduationInput, policy: LadderPolicy = DEFAULT_LADDER): GraduationOutcome {
  const g = policy.graduation;
  const blockedBy: string[] = [];

  if (input.clearedLoans < g.minClearedLoans) {
    const need = g.minClearedLoans - input.clearedLoans;
    blockedBy.push(`${need} more cleared loan${need === 1 ? "" : "s"} at this amount.`);
  }

  if (g.requireEqualPrincipals) {
    const principals = input.clearedPrincipals.slice(0, policy.lookbackClearedLoans);
    if (principals.length >= g.minClearedLoans && new Set(principals).size > 1) {
      blockedBy.push("Your last two cleared loans were for different amounts — the ladder needs the same amount twice.");
    }
  }

  if (input.riskScore <= g.minScore) {
    blockedBy.push(`A score above ${g.minScore}. Yours is ${round2(input.riskScore)}.`);
  }

  const percent = g.percentByScore.find((p) => clears(input.riskScore, p))?.percent ?? 0;
  if (percent <= 0 && blockedBy.length === 0) {
    blockedBy.push("A score high enough to earn a step up.");
  }

  if (blockedBy.length > 0) {
    return { eligible: false, percent, uncappedIncrease: 0, increase: 0, newLimit: null, cappedByCeiling: false, blockedBy };
  }

  const uncappedIncrease = (input.lastLoanPrincipal * percent) / 100;
  const capped = uncappedIncrease > g.perStepCeiling;
  const increase = capped ? g.perStepCeiling : uncappedIncrease;

  return {
    eligible: true,
    percent,
    uncappedIncrease,
    increase,
    newLimit: input.lastLoanPrincipal + increase,
    cappedByCeiling: capped,
    blockedBy: [],
  };
}
