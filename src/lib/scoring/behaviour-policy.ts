// ─────────────────────────────────────────────────────────────────────────────
// BEHAVIOURAL SCORING & GRADUATION — as policy, not as code.
//
// `sp_CreditScoringAndGraduation` is already ported (src/lib/risk/graduation.ts) and
// its arithmetic is faithful. The problem is that every number in it is a CONSTANT:
// the 100/75/50 repayment cuts, the 0/3/6-day arrears cuts, the 50/50 weights, the
// three risk bands, the 30%/15% steps and the KES 5,000 cap. A second lender who
// scores on four factors, or graduates 20% at a different threshold, cannot be
// expressed — only shipped to.
//
// So the whole matrix moves here, into the `credit` namespace, and the engine
// (behaviour.ts) becomes a reader. Micromart's exact behaviour is one preset among
// many, and `npm run test:behaviour` proves the generalised engine reproduces the
// stored procedure's arithmetic to the decimal.
//
// ── THREE THINGS THE ORIGINAL CANNOT DO, AND THIS CAN ────────────────────────
//
//  1. SCORE A LIVE LOAN. The procedure reads `WHERE l.LoanCleared = 1`. A borrower's
//     score therefore cannot move between taking a loan and clearing it — it is a
//     post-mortem, not a monitor. `window.includeActive` lets an installment paid
//     today change the score today, which is the only way a PD can move several
//     times across one loan cycle.
//
//  2. LOWER A LIMIT. The procedure has no path that reduces anyone. A borrower who
//     graduated to 30,000 and then started missing installments keeps 30,000
//     forever. `demotion` is the missing half of a ladder.
//
//  3. GRADUATE WITHOUT RISKING A CUT. This is the subtle one, and it is a live bug
//     in the original — see `basis` below.
// ─────────────────────────────────────────────────────────────────────────────
import type { ConfigIssue } from "@/lib/config/borrower";

/**
 * What a factor actually measures. A closed vocabulary, because the engine has to
 * be able to COMPUTE each one from the schedule — a lender may weight and band them
 * freely, but may not invent a metric nothing produces.
 */
export type FactorMetric =
  /** amountPaid ÷ amountDue on an installment. Higher is better. */
  | "installment_paid_ratio"
  /** Days between the due date and payment (or today, if unpaid). Lower is better. */
  | "days_late"
  /** Longest run of consecutive installments that fell due unpaid. Lower is better. */
  | "arrears_streak"
  /** Days paid AHEAD of the due date. Higher is better. */
  | "days_early"
  /** Principal ÷ the limit they held at the time. Lower is better. */
  | "limit_utilisation";

export const FACTOR_METRICS: { key: FactorMetric; label: string; unit: string; compare: "gte" | "lte" }[] = [
  { key: "installment_paid_ratio", label: "How much of the installment was paid", unit: "ratio", compare: "gte" },
  { key: "days_late", label: "How late the payment was", unit: "days", compare: "lte" },
  { key: "arrears_streak", label: "Longest run of missed installments", unit: "installments", compare: "lte" },
  { key: "days_early", label: "How far ahead of the due date they paid", unit: "days", compare: "gte" },
  { key: "limit_utilisation", label: "How much of their limit they used", unit: "ratio", compare: "lte" },
];

export const metricSpec = (m: FactorMetric) => FACTOR_METRICS.find((x) => x.key === m)!;

/**
 * One rung of a factor's scoring table.
 *
 * `threshold` is read against the metric's own comparison — `gte` for the
 * higher-is-better metrics, `lte` for the lower-is-better ones. Bands are evaluated
 * in order, so they must be listed best-first, and the last must be the catch-all
 * (`threshold: null`).
 */
export type ScoreBandRule = { threshold: number | null; points: number; label: string };

export type ScoreFactor = {
  key: string;
  label: string;
  /** Percent of the total score. Every enabled factor's weight must sum to 100. */
  weight: number;
  metric: FactorMetric;
  bands: ScoreBandRule[];
  enabled: boolean;
};

/** A lender's own risk vocabulary. Ordered best → worst. */
export type RiskCategory = {
  key: string;
  label: string;
  /** Lowest score (0–100) that lands here. */
  minScore: number;
  /** What a clean record in this category earns. */
  graduationPercent: number;
  /** Typical PD across this category — the fallback when no model has scored them. */
  pdMin: number;
  pdMax: number;
};

export type BehaviourBlock = {
  enabled: boolean;
  window: {
    /** How many recent loans feed the score. The procedure used 2. */
    lookbackLoans: number;
    /**
     * Include the loan they are repaying RIGHT NOW.
     *
     * The procedure cannot: it reads cleared loans only, so a customer's score is
     * frozen from the day they borrow to the day they clear. Turning this on is what
     * makes a score — and therefore a PD — move during the cycle.
     */
    includeActive: boolean;
    /** Ignore a loan with fewer installments than this; too small to judge on. */
    minInstallments: number;
    /**
     * How much less an older loan counts. 0 = every loan equal (the procedure);
     * 0.5 = each older loan carries half the weight of the one after it.
     */
    recencyDecay: number;
  };
  factors: ScoreFactor[];
  categories: RiskCategory[];
};

export type GraduationBlock = {
  enabled: boolean;
  /**
   * When the ladder is evaluated.
   *   on_repayment — after every payment. Pairs with window.includeActive.
   *   on_clearance — when a loan closes. The procedure's effective behaviour.
   *   scheduled    — only on the cron.
   */
  trigger: "on_repayment" | "on_clearance" | "scheduled";
  /** Cleared loans required before the limit may move at all. */
  requireClearedLoans: number;
  /**
   * Require the last N cleared loans to be the SAME principal.
   *
   * The clever part of the original: not "have they borrowed twice" but "have they
   * borrowed the same amount twice and cleared it both times" — they have proved the
   * ceiling is no longer stretching them. 0 disables the rule.
   */
  requireSamePrincipalCycles: number;
  /**
   * WHAT THE INCREASE IS CALCULATED FROM. This is a real defect in the original.
   *
   * The procedure computes `NewLoanLimit = LastLoanPrincipal * (1 + pct)` and then
   * writes it straight into `b.LoanLimit`. A borrower whose limit is 10,000 but who
   * borrowed 5,000 twice — well inside their limit, repaid perfectly — is "graduated"
   * to 6,500. That is a 35% CUT, applied by the graduation routine, recorded in the
   * graduation history, and reported as a success.
   *
   *   last_principal — the original's behaviour, cut and all
   *   current_limit  — grow the limit they hold
   *   higher_of      — grow whichever is larger, so a graduation can never reduce
   */
  basis: "last_principal" | "current_limit" | "higher_of";
  /** The most one graduation may add. The procedure hardcoded 5,000. 0 = uncapped. */
  capPerStep: number;
  /** The limit may never exceed this, however many steps are earned. 0 = uncapped. */
  ceiling: number;
  /** Round the new limit to a clean figure. */
  roundTo: number;
  /**
   * The missing half of the ladder: what happens to a limit when behaviour
   * deteriorates. The procedure only ever goes up.
   */
  demotion: {
    enabled: boolean;
    /** Categories at or below this one lose limit. */
    belowCategory: string;
    /** Percent of the current limit removed. */
    percent: number;
    /** Never take a limit below this. */
    floor: number;
  };
};

// ── Defaults: the platform's own four-band ladder ─────────────────────────────

const REPAYMENT_FACTOR: ScoreFactor = {
  key: "repayment_history",
  label: "Repayment history",
  weight: 50,
  metric: "installment_paid_ratio",
  enabled: true,
  bands: [
    { threshold: 1, points: 100, label: "Paid in full" },
    { threshold: 0.75, points: 75, label: "Paid three quarters" },
    { threshold: 0.5, points: 50, label: "Paid half" },
    { threshold: null, points: 0, label: "Paid less than half" },
  ],
};

const ARREARS_FACTOR: ScoreFactor = {
  key: "days_in_arrears",
  label: "Days in arrears",
  weight: 50,
  metric: "days_late",
  enabled: true,
  // BRUTAL on purpose, and kept from the original: one day late costs 70 points.
  // In a 30-day microloan "a few days late" is most of the way to not paying, and a
  // curve that shrugs at it lends again to someone already sliding.
  bands: [
    { threshold: 0, points: 100, label: "On or before the due date" },
    { threshold: 3, points: 30, label: "1–3 days late" },
    { threshold: 6, points: 10, label: "4–6 days late" },
    { threshold: null, points: 0, label: "More than 6 days late" },
  ],
};

export const BEHAVIOUR_DEFAULTS: BehaviourBlock = {
  enabled: true,
  window: { lookbackLoans: 2, includeActive: true, minInstallments: 1, recencyDecay: 0 },
  factors: [REPAYMENT_FACTOR, ARREARS_FACTOR],
  // Four bands, not the original's three: at 78 and at 99 both scored "Minor risk"
  // and both graduated 30%, so flawlessness was worth nothing.
  categories: [
    { key: "PRIME", label: "Prime", minScore: 86, graduationPercent: 30, pdMin: 0.005, pdMax: 0.03 },
    { key: "STRONG", label: "Strong", minScore: 71, graduationPercent: 20, pdMin: 0.03, pdMax: 0.09 },
    { key: "WATCH", label: "Watch", minScore: 51, graduationPercent: 10, pdMin: 0.09, pdMax: 0.25 },
    { key: "HIGH", label: "High risk", minScore: 0, graduationPercent: 0, pdMin: 0.25, pdMax: 0.9 },
  ],
};

export const GRADUATION_DEFAULTS: GraduationBlock = {
  enabled: true,
  trigger: "on_repayment",
  requireClearedLoans: 2,
  requireSamePrincipalCycles: 2,
  basis: "higher_of",
  capPerStep: 5000,
  ceiling: 0,
  roundTo: 100,
  demotion: { enabled: false, belowCategory: "HIGH", percent: 25, floor: 0 },
};

/**
 * MICROMART, EXACTLY AS THE STORED PROCEDURE BEHAVES.
 *
 * Three categories on their cuts, 50/50 weights, cleared loans only, the same
 * two-at-the-same-principal rule, the 5,000 cap, and `last_principal` as the basis —
 * cut and all. Reproduced rather than corrected, because the point of a preset is to
 * let a lender migrate onto the new engine without their numbers moving on the day
 * they switch. `npm run test:behaviour` holds this to the procedure's arithmetic.
 */
export const MICROMART_BEHAVIOUR: BehaviourBlock = {
  enabled: true,
  window: { lookbackLoans: 2, includeActive: false, minInstallments: 1, recencyDecay: 0 },
  factors: [REPAYMENT_FACTOR, ARREARS_FACTOR],
  categories: [
    { key: "MINOR", label: "Minor risk", minScore: 76.01, graduationPercent: 30, pdMin: 0.01, pdMax: 0.05 },
    { key: "MODERATE", label: "Moderate", minScore: 51, graduationPercent: 15, pdMin: 0.05, pdMax: 0.2 },
    { key: "MAJOR", label: "Major risk", minScore: 0, graduationPercent: 0, pdMin: 0.2, pdMax: 0.9 },
  ],
};

export const MICROMART_GRADUATION: GraduationBlock = {
  ...GRADUATION_DEFAULTS,
  trigger: "on_clearance",
  basis: "last_principal",
  capPerStep: 5000,
  roundTo: 1,
  demotion: { enabled: false, belowCategory: "MAJOR", percent: 0, floor: 0 },
};

// ── Validation ────────────────────────────────────────────────────────────────

export function validateBehaviour(b: BehaviourBlock, g: GraduationBlock): ConfigIssue[] {
  const out: ConfigIssue[] = [];
  const bad = (path: string, message: string) => out.push({ path, message });

  const active = b.factors.filter((f) => f.enabled);
  if (b.enabled && active.length === 0) bad("behaviour.factors", "Scoring is on but every factor is disabled — nobody could be scored.");

  const total = active.reduce((s, f) => s + f.weight, 0);
  if (active.length > 0 && Math.abs(total - 100) > 0.01) {
    bad("behaviour.factors", `Factor weights add up to ${total}%, not 100% — the score would not be out of 100.`);
  }

  const seen = new Set<string>();
  for (const f of b.factors) {
    if (seen.has(f.key)) bad(`behaviour.factors.${f.key}`, `Two factors share the key "${f.key}".`);
    seen.add(f.key);
    if (f.weight < 0) bad(`behaviour.factors.${f.key}`, "A factor's weight cannot be negative.");
    if (f.bands.length === 0) { bad(`behaviour.factors.${f.key}`, `"${f.label}" has no scoring bands.`); continue; }
    if (f.bands[f.bands.length - 1].threshold !== null) {
      bad(`behaviour.factors.${f.key}`, `"${f.label}" has no catch-all band — a value outside every rung would score nothing.`);
    }
    for (const band of f.bands) {
      if (band.points < 0 || band.points > 100) bad(`behaviour.factors.${f.key}`, `"${band.label}" awards ${band.points} points; the range is 0–100.`);
    }
    // Bands are read in order, so they must be listed best-first or an early rung
    // swallows the ones after it and the later bands become unreachable.
    const spec = metricSpec(f.metric);
    const rungs = f.bands.filter((x) => x.threshold !== null).map((x) => x.threshold as number);
    for (let i = 1; i < rungs.length; i++) {
      const ordered = spec.compare === "gte" ? rungs[i] < rungs[i - 1] : rungs[i] > rungs[i - 1];
      if (!ordered) {
        bad(`behaviour.factors.${f.key}`, `"${f.label}" bands are out of order — ${rungs[i]} after ${rungs[i - 1]} can never be reached.`);
        break;
      }
    }
  }

  if (b.window.lookbackLoans < 1) bad("behaviour.window.lookbackLoans", "Score at least one loan.");
  if (b.window.recencyDecay < 0 || b.window.recencyDecay >= 1) {
    bad("behaviour.window.recencyDecay", "Recency decay must be between 0 and just under 1.");
  }
  if (b.window.minInstallments < 1) bad("behaviour.window.minInstallments", "A loan needs at least one installment to be judged on.");

  if (b.categories.length === 0) bad("behaviour.categories", "Define at least one risk category.");
  for (let i = 1; i < b.categories.length; i++) {
    if (b.categories[i].minScore >= b.categories[i - 1].minScore) {
      bad(`behaviour.categories.${i}`, `"${b.categories[i].label}" does not sit below "${b.categories[i - 1].label}" — categories must run best to worst.`);
    }
  }
  const floor = b.categories[b.categories.length - 1];
  if (floor && floor.minScore > 0) bad("behaviour.categories", `The lowest category starts at ${floor.minScore}; a score below it would fall through to nothing.`);
  for (const c of b.categories) {
    if (c.graduationPercent < 0 || c.graduationPercent > 100) bad(`behaviour.categories.${c.key}`, "Graduation percent must be between 0 and 100.");
    if (c.pdMin < 0 || c.pdMax > 1 || c.pdMin > c.pdMax) bad(`behaviour.categories.${c.key}`, "PD range must run from a lower to a higher probability, both between 0 and 1.");
  }

  // ── Graduation ──
  if (g.requireClearedLoans < 0) bad("graduation.requireClearedLoans", "Cannot require a negative number of loans.");
  if (g.requireSamePrincipalCycles > g.requireClearedLoans && g.requireClearedLoans > 0) {
    bad("graduation.requireSamePrincipalCycles", `You require ${g.requireSamePrincipalCycles} loans at the same principal but only ${g.requireClearedLoans} cleared loans — the stricter rule can never be met.`);
  }
  if (g.requireSamePrincipalCycles > b.window.lookbackLoans && g.requireSamePrincipalCycles > 0) {
    bad("graduation.requireSamePrincipalCycles", `The same-principal rule looks at ${g.requireSamePrincipalCycles} loans but scoring only loads ${b.window.lookbackLoans}.`);
  }
  if (g.capPerStep < 0) bad("graduation.capPerStep", "The per-step cap cannot be negative. Use 0 for uncapped.");
  if (g.ceiling > 0 && g.capPerStep > g.ceiling) bad("graduation.capPerStep", "A single step may add more than the absolute ceiling allows.");
  if (g.roundTo < 1) bad("graduation.roundTo", "Rounding step must be at least 1.");
  if (g.trigger === "on_repayment" && !b.window.includeActive) {
    bad("graduation.trigger", "Graduating on every repayment only makes sense if scoring includes the live loan — otherwise nothing changes until the loan clears.");
  }
  if (g.demotion.enabled) {
    if (!b.categories.some((c) => c.key === g.demotion.belowCategory)) {
      bad("graduation.demotion.belowCategory", `"${g.demotion.belowCategory}" is not one of your risk categories.`);
    }
    if (g.demotion.percent <= 0 || g.demotion.percent >= 100) bad("graduation.demotion.percent", "A demotion must remove between 1 and 99% of the limit.");
    if (g.demotion.floor < 0) bad("graduation.demotion.floor", "The demotion floor cannot be negative.");
  }

  return out;
}

// ── Merge-forward ─────────────────────────────────────────────────────────────

export function mergeBehaviour(stored: unknown): BehaviourBlock {
  const s = (stored ?? {}) as Partial<BehaviourBlock>;
  const d = BEHAVIOUR_DEFAULTS;
  return {
    enabled: s.enabled ?? d.enabled,
    window: { ...d.window, ...s.window },
    // Factors and categories are replaced WHOLE when present, never merged item by
    // item: a lender who removed a factor must not have it silently reinstated by a
    // platform default on the next read.
    factors: Array.isArray(s.factors) && s.factors.length ? s.factors : d.factors,
    categories: Array.isArray(s.categories) && s.categories.length ? s.categories : d.categories,
  };
}

export function mergeGraduation(stored: unknown): GraduationBlock {
  const s = (stored ?? {}) as Partial<GraduationBlock>;
  const d = GRADUATION_DEFAULTS;
  return { ...d, ...s, demotion: { ...d.demotion, ...s.demotion } };
}
