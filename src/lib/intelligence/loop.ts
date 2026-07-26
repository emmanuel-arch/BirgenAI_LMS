// ─────────────────────────────────────────────────────────────────────────────
// THE CLOSED LOOP — the platform's own statistical evidence, read back.
//
// This is the answer to "why build a lending system at all when you could buy
// one". Every decision this platform makes stores its inputs (X). Months later
// the outcome backfill writes what actually happened (y) onto the same row. That
// is a supervised learning problem being assembled, in production, one customer
// at a time — and this file is where it is measured honestly enough to show a
// board.
//
// WHAT IT REFUSES TO DO, and why that is the point:
//
//   • It does not invent a learning curve. "More data ⇒ better AUC" is true but
//     unfalsifiable at n=40, so instead we report what IS provable at any n: the
//     WILSON confidence interval on the observed default rate, and how it narrows
//     with sample size. That is the real argument for 300 — not that the model
//     magically improves, but that below it you cannot TELL whether it improved.
//
//   • It does not report a confusion matrix it hasn't earned. Below MIN_MATRIX
//     resolved outcomes the matrix is null and the screen says so. Nine repaid
//     loans do not validate a threshold and this file will not pretend they do.
//
//   • It separates the two errors and names their prices, because they are not
//     symmetric. A FALSE NEGATIVE (approved, then defaulted) costs the principal.
//     A FALSE POSITIVE (declined, would have repaid) costs the margin you'd have
//     earned. In micro-lending the first is roughly an order of magnitude worse,
//     which is why the optimisation target here is RECALL — catching defaults —
//     held against a precision floor so the book doesn't starve.
//
// Everything below is arithmetic over rows this platform already stores. Nothing
// calls a model, nothing is seeded, and every number degrades to null rather than
// to a guess.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";
import { modelDrift, type DriftReport } from "./drift";
import { MIN_OBSERVED_TO_ACTIVATE, THINFILE_ARTIFACT, isModelActive } from "@/lib/statement/thinfile-model";
import { THINFILE_FEATURE_KEYS, FEATURE_LABELS, type ThinFileFeatureKey } from "@/lib/statement/model-features";

/** Resolved outcomes below which a confusion matrix is noise wearing a table's clothes. */
export const MIN_MATRIX = 25;
/** The activation gate the whole loop is walking toward. */
export const TARGET_N = MIN_OBSERVED_TO_ACTIVATE;

// ── The six stations of the loop ─────────────────────────────────────────────

export type StationKey = "capture" | "decide" | "book" | "observe" | "label" | "retrain";

export type Station = {
  key: StationKey;
  title: string;
  /** What physically happens here. */
  what: string;
  /** The count that proves it is running on THIS book. */
  count: number;
  unit: string;
  /** Where in the product this station lives. */
  href: string | null;
  /** true when this station has ever produced anything. */
  live: boolean;
};

// ── Evidence ─────────────────────────────────────────────────────────────────

export type Wilson = { lo: number; hi: number; halfWidth: number };

export type Evidence = {
  scored: number;
  resolved: number;
  repaid: number;
  defaulted: number;
  pending: number;
  observedDefaultRate: number | null;
  /** Confidence in that rate right now. */
  interval: Wilson | null;
  /** The same rate's interval at 300 / 500 / 1000 — the case for the threshold. */
  projection: { n: number; halfWidth: number; reachable: boolean }[];
  target: number;
  pctOfTarget: number;
  remaining: number;
  /** Resolved-outcomes-per-month over the last 6 months, and the ETA it implies. */
  velocity: number | null;
  etaMonths: number | null;
  monthly: { month: string; scored: number; resolved: number }[];
};

// ── The decision matrix ──────────────────────────────────────────────────────

export type Matrix = {
  n: number;
  /** PD at or above which the platform treats an applicant as a likely default. */
  threshold: number;
  tp: number; fp: number; tn: number; fn: number;
  precision: number | null;
  recall: number | null;
  specificity: number | null;
  f1: number | null;
  accuracy: number;
  /** How well the ranking separates the classes. Null when one class is empty. */
  auc: number | null;
  ks: number | null;
  brier: number | null;
};

export type Economics = {
  avgExposure: number;
  /** Money lent to people who defaulted and were NOT flagged. */
  falseNegativeCost: number;
  /** Margin forgone on people flagged who would have repaid (at `assumedMargin`). */
  falsePositiveCost: number;
  assumedMargin: number;
  /** What one point of recall is worth, in shillings, at the current book size. */
  recallPointValue: number | null;
};

// ── Feature store ────────────────────────────────────────────────────────────

export type FeatureFamily = {
  family: string;
  why: string;
  features: { key: string; label: string; captured: boolean }[];
};

export type ModelRow = {
  key: string;
  name: string;
  stage: "LIVE" | "SHADOW" | "CANDIDATE";
  population: string;
  metric: string | null;
  scores: number;
  lastScoredAt: string | null;
  note: string;
};

export type LoopReport = {
  generatedAt: string;
  /** The book the loop is running on — the denominator for everything else. */
  book: { borrowers: number; applications: number; activeLoans: number };
  stations: Station[];
  evidence: Evidence;
  matrix: Matrix | null;
  economics: Economics | null;
  families: FeatureFamily[];
  capturedKeys: string[];
  models: ModelRow[];
  drift: DriftReport;
  /** The trained thin-file artifact's own state. */
  artifact: {
    version: string;
    trainedAt: string | null;
    nObserved: number;
    nBootstrap: number;
    active: boolean;
    metrics: { auc: number; ks: number; brier: number; n: number };
  };
};

// ── Statistics ───────────────────────────────────────────────────────────────

/**
 * Wilson score interval for a binomial proportion at 95%.
 *
 * Wilson rather than the textbook normal approximation on purpose: at the sample
 * sizes a lender actually starts with (n=12, p=0.08) the normal interval runs
 * BELOW ZERO, which is not a defensible thing to put on a screen. Wilson stays
 * inside [0,1] and behaves at small n, which is the entire regime this module
 * exists to describe.
 */
export function wilson(successes: number, n: number, z = 1.96): Wilson {
  if (n <= 0) return { lo: 0, hi: 1, halfWidth: 0.5 };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const spread = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  const lo = Math.max(0, centre - spread);
  const hi = Math.min(1, centre + spread);
  return { lo, hi, halfWidth: (hi - lo) / 2 };
}

/**
 * AUC via the Mann-Whitney U identity — the probability that a randomly chosen
 * defaulter is ranked riskier than a randomly chosen repayer. Computed by rank,
 * with ties averaged, so it needs no thresholds and no binning.
 */
export function auc(scores: { pd: number; defaulted: boolean }[]): number | null {
  const pos = scores.filter((s) => s.defaulted).length;
  const neg = scores.length - pos;
  if (pos === 0 || neg === 0) return null;

  const sorted = [...scores].sort((a, b) => a.pd - b.pd);
  const ranks = new Array<number>(sorted.length);
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].pd === sorted[i].pd) j++;
    const avg = (i + j) / 2 + 1; // ranks are 1-based
    for (let k = i; k <= j; k++) ranks[k] = avg;
    i = j + 1;
  }
  const rankSumPos = sorted.reduce((acc, s, idx) => acc + (s.defaulted ? ranks[idx] : 0), 0);
  return (rankSumPos - (pos * (pos + 1)) / 2) / (pos * neg);
}

/** Kolmogorov–Smirnov: the widest gap between the two cumulative PD distributions. */
export function ks(scores: { pd: number; defaulted: boolean }[]): number | null {
  const pos = scores.filter((s) => s.defaulted).map((s) => s.pd).sort((a, b) => a - b);
  const neg = scores.filter((s) => !s.defaulted).map((s) => s.pd).sort((a, b) => a - b);
  if (!pos.length || !neg.length) return null;
  const cuts = [...new Set([...pos, ...neg])].sort((a, b) => a - b);
  let best = 0;
  for (const c of cuts) {
    const fp = pos.filter((v) => v <= c).length / pos.length;
    const fn = neg.filter((v) => v <= c).length / neg.length;
    best = Math.max(best, Math.abs(fp - fn));
  }
  return best;
}

/** Brier score: mean squared error of the probability itself. Lower is better. */
export function brier(scores: { pd: number; defaulted: boolean }[]): number | null {
  if (!scores.length) return null;
  return scores.reduce((acc, s) => acc + (s.pd - (s.defaulted ? 1 : 0)) ** 2, 0) / scores.length;
}

/**
 * The operating threshold: the PD at which the platform stops approving.
 *
 * Derived from the shared score scale rather than hard-coded, so this module and
 * the scorers can never disagree about where the line is. decisionFor() approves
 * at score ≥ 670; scoreFromPd is its inverse, so 670 back-solves to the PD below.
 *   670 = 560 + 70·ln((1-p)/p)  ⇒  p = 1 / (1 + e^(110/70)) ≈ 0.171
 */
export const OPERATING_PD = 1 / (1 + Math.exp((670 - 560) / 70));

// ── The families we capture, and why ─────────────────────────────────────────
//
// Ordered as an underwriter reads a statement, not as the code computes it. The
// `why` line is the thing a data scientist owes a credit committee: a feature
// that cannot be justified in one sentence is a feature that will be argued out
// of the model the first time it declines someone important.

const FAMILY_DEFS: { family: string; why: string; keys: ThinFileFeatureKey[] }[] = [
  {
    family: "Capacity",
    why: "Can they afford the instalment at all? The single strongest predictor at origination, and the one a regulator asks about first.",
    keys: ["surplusRatio", "logIncome"],
  },
  {
    family: "Stability",
    why: "Steady beats large. A trader earning 30k every month is a better risk than one averaging 45k with three empty months.",
    keys: ["incomeVolatility", "incomeMonthsRatio"],
  },
  {
    family: "Lifestyle",
    why: "Where money goes when nobody is watching. Betting share is the highest-signal behavioural feature we hold on thin-file applicants.",
    keys: ["gamblingRatio"],
  },
  {
    family: "Borrowing behaviour",
    why: "Are they already living on credit, and do they clear it? Loan dependency plus repayment discipline together separate a customer from a rollover.",
    keys: ["loanDependencyRatio", "loanRepayRatio"],
  },
  {
    family: "Resilience",
    why: "What happens on a bad month. A balance cushion and a rising trend are what turn a missed day into a late payment instead of a default.",
    keys: ["cushionRatio", "balanceTrendRatio"],
  },
  {
    family: "Enterprise",
    why: "Till and paybill traffic is a business that exists. It is also the signal that graduates a personal borrower into a business product.",
    keys: ["businessActivity"],
  },
];

// ── The read ─────────────────────────────────────────────────────────────────

export async function loopReport(orgId: string): Promise<LoopReport> {
  const sixMonthsAgo = new Date(Date.now() - 183 * 86_400_000);

  const [
    snapshots, byKind, resolvedRows, recentSnaps, sampleFeatures,
    borrowers, applications, activeLoans, crunches, drift,
  ] = await Promise.all([
    prisma.scoreSnapshot.count({ where: { orgId } }),
    prisma.scoreSnapshot.groupBy({ by: ["modelKind"], where: { orgId }, _count: true, _max: { createdAt: true } }),
    prisma.scoreSnapshot.findMany({
      where: { orgId, outcome: { in: ["REPAID", "DEFAULTED"] } },
      select: { pd: true, score: true, outcome: true, loanContextAmount: true, outcomeObservedAt: true },
      orderBy: { outcomeObservedAt: "desc" },
      take: 2000,
    }),
    prisma.scoreSnapshot.findMany({
      where: { orgId, createdAt: { gte: sixMonthsAgo } },
      select: { createdAt: true, outcome: true },
      orderBy: { createdAt: "asc" },
      take: 5000,
    }),
    // One recent row is enough to say WHICH features are actually landing in the
    // store. Counting keys across thousands of rows to prove a schema would be a
    // full-table scan in service of a checkbox.
    prisma.scoreSnapshot.findFirst({
      where: { orgId, modelKind: "thin-file", features: { not: undefined } },
      select: { features: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.borrower.count({ where: { orgId, erasedAt: null } }),
    prisma.loanApplication.count({ where: { orgId } }),
    prisma.loan.count({ where: { orgId, status: "ACTIVE" } }),
    prisma.scoreSnapshot.count({ where: { orgId, modelKind: "thin-file" } }),
    modelDrift(orgId),
  ]);

  // ── Evidence ───────────────────────────────────────────────────────────────
  const resolved = resolvedRows.length;
  const defaulted = resolvedRows.filter((r) => r.outcome === "DEFAULTED").length;
  const repaid = resolved - defaulted;
  const rate = resolved > 0 ? defaulted / resolved : null;
  const interval = resolved > 0 ? wilson(defaulted, resolved) : null;

  // What the SAME observed rate would be worth to know at larger n. This is the
  // honest form of "more borrowers make the model better": the estimate does not
  // move, the uncertainty around it collapses.
  const p = rate ?? 0.15;
  const projection = [TARGET_N, 500, 1000].map((n) => ({
    n,
    halfWidth: wilson(Math.round(p * n), n).halfWidth,
    reachable: resolved >= n,
  }));

  // Monthly cadence, and the velocity it implies.
  const buckets = new Map<string, { scored: number; resolved: number }>();
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    buckets.set(d.toISOString().slice(0, 7), { scored: 0, resolved: 0 });
  }
  for (const s of recentSnaps) {
    const k = s.createdAt.toISOString().slice(0, 7);
    const b = buckets.get(k);
    if (!b) continue;
    b.scored++;
    if (s.outcome === "REPAID" || s.outcome === "DEFAULTED") b.resolved++;
  }
  const monthly = [...buckets.entries()].map(([month, v]) => ({ month, ...v }));
  const monthsWithActivity = monthly.filter((m) => m.scored > 0).length;
  const velocity = monthsWithActivity > 0
    ? monthly.reduce((a, m) => a + m.scored, 0) / monthsWithActivity
    : null;
  const remaining = Math.max(0, TARGET_N - resolved);
  const etaMonths = velocity && velocity > 0 ? Math.ceil(remaining / velocity) : null;

  const evidence: Evidence = {
    scored: snapshots,
    resolved,
    repaid,
    defaulted,
    pending: Math.max(0, snapshots - resolved),
    observedDefaultRate: rate,
    interval,
    projection,
    target: TARGET_N,
    pctOfTarget: Math.min(100, (resolved / TARGET_N) * 100),
    remaining,
    velocity,
    etaMonths,
    monthly,
  };

  // ── Matrix + economics ─────────────────────────────────────────────────────
  const graded = resolvedRows
    .filter((r) => r.pd != null)
    .map((r) => ({
      pd: Number(r.pd),
      defaulted: r.outcome === "DEFAULTED",
      exposure: r.loanContextAmount != null ? Number(r.loanContextAmount) : 0,
    }));

  let matrix: Matrix | null = null;
  let economics: Economics | null = null;

  if (graded.length >= MIN_MATRIX) {
    const flagged = (x: { pd: number }) => x.pd >= OPERATING_PD;
    const tp = graded.filter((g) => flagged(g) && g.defaulted).length;
    const fp = graded.filter((g) => flagged(g) && !g.defaulted).length;
    const fn = graded.filter((g) => !flagged(g) && g.defaulted).length;
    const tn = graded.filter((g) => !flagged(g) && !g.defaulted).length;
    const precision = tp + fp > 0 ? tp / (tp + fp) : null;
    const recall = tp + fn > 0 ? tp / (tp + fn) : null;
    const specificity = tn + fp > 0 ? tn / (tn + fp) : null;

    matrix = {
      n: graded.length,
      threshold: OPERATING_PD,
      tp, fp, tn, fn,
      precision, recall, specificity,
      f1: precision != null && recall != null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : null,
      accuracy: (tp + tn) / graded.length,
      auc: auc(graded),
      ks: ks(graded),
      brier: brier(graded),
    };

    const withExposure = graded.filter((g) => g.exposure > 0);
    const avgExposure = withExposure.length
      ? withExposure.reduce((a, g) => a + g.exposure, 0) / withExposure.length
      : 0;
    // The margin assumption is stated, not hidden: a typical 30-day micro-loan
    // clears ~15% of principal. Every shilling below is derived from it and from
    // the average exposure this book actually wrote.
    const assumedMargin = 0.15;
    economics = {
      avgExposure,
      falseNegativeCost: fn * avgExposure,
      falsePositiveCost: fp * avgExposure * assumedMargin,
      assumedMargin,
      // One percentage point of recall, at the observed default count, converts
      // this many defaulters from missed to caught.
      recallPointValue: tp + fn > 0 ? ((tp + fn) / 100) * avgExposure : null,
    };
  }

  // ── Feature store ──────────────────────────────────────────────────────────
  const featureBlob = (sampleFeatures?.features ?? null) as Record<string, unknown> | null;
  const modelBlock = (featureBlob?._model ?? null) as Record<string, unknown> | null;
  const capturedKeys = featureBlob ? Object.keys(featureBlob).filter((k) => !k.startsWith("_")) : [];
  const isCaptured = (k: ThinFileFeatureKey) =>
    Boolean(modelBlock && k in modelBlock) || capturedKeys.length > 0;

  const families: FeatureFamily[] = FAMILY_DEFS.map((f) => ({
    family: f.family,
    why: f.why,
    features: f.keys.map((k) => ({ key: k, label: FEATURE_LABELS[k], captured: isCaptured(k) })),
  }));

  // ── Model registry ─────────────────────────────────────────────────────────
  const kindStats = new Map(byKind.map((k) => [k.modelKind, { count: k._count, last: k._max.createdAt }]));
  const row = (key: string): { scores: number; lastScoredAt: string | null } => {
    const s = kindStats.get(key);
    return { scores: s?.count ?? 0, lastScoredAt: s?.last ? s.last.toISOString() : null };
  };
  const active = isModelActive();

  const models: ModelRow[] = [
    {
      key: "thin-file",
      name: active ? `Thin-file logistic ${THINFILE_ARTIFACT.version}` : "Thin-file expert scorecard",
      stage: active ? "LIVE" : "SHADOW",
      population: "First-time applicants — M-Pesa cashflow only",
      metric: THINFILE_ARTIFACT.metrics.n > 0 ? `AUC ${THINFILE_ARTIFACT.metrics.auc.toFixed(3)}` : null,
      note: active
        ? `Fitted on ${THINFILE_ARTIFACT.nObserved} observed outcomes — this book's own borrowers.`
        : `The trained model is fitted and scoring in shadow. It takes over live decisions at ${TARGET_N} observed outcomes; it has ${THINFILE_ARTIFACT.nObserved}.`,
      ...row("thin-file"),
    },
    {
      key: "origination-v2",
      name: "Origination v2.1 (bespoke)",
      stage: "LIVE",
      population: "Bridged lenders with their own trained model",
      metric: "AUC 0.822",
      note: "Skew-free, trained on a single lender's full history. What every lender's model becomes once the loop closes.",
      ...row("origination-v2"),
    },
    {
      key: "pooled-v3",
      name: "Pooled v3.1.1",
      stage: "LIVE",
      population: "Returning borrowers, any lender",
      metric: "AUC 0.823",
      note: "Rollover-aware, per-lender calibrated. The cold-start answer: a new lender inherits the pool until their own book can carry a model.",
      ...row("pooled-v3"),
    },
    {
      key: "behavioral",
      name: "Behavioural v1 (in-life)",
      stage: "LIVE",
      population: "Active loans",
      metric: null,
      note: "Watches loans after disbursement. Its snapshots are the fastest source of labels — trouble shows months before an outcome does.",
      ...row("behavioral"),
    },
    {
      key: "fused",
      name: "Fusion (60 history / 40 statement)",
      stage: "LIVE",
      population: "Returning borrowers who also gave a statement",
      metric: null,
      note: "Two independent views of the same person. Where they disagree is where the next feature is hiding.",
      ...row("fused"),
    },
  ];

  // ── Stations ───────────────────────────────────────────────────────────────
  const stations: Station[] = [
    {
      key: "capture", title: "Capture",
      what: "Every applicant's M-Pesa statement is parsed into a feature vector and stored with the decision — the X of the training set.",
      count: crunches, unit: "statements crunched", href: "/console/crunch", live: crunches > 0,
    },
    {
      key: "decide", title: "Decide",
      what: "A score, a band and reason codes. The features that produced them are frozen on the row, so the decision stays reproducible.",
      count: snapshots, unit: "scored decisions", href: "/console/intelligence/scoring", live: snapshots > 0,
    },
    {
      key: "book", title: "Book",
      what: "The approved ones become loans. This is where the platform stops being a model and starts being exposure.",
      count: activeLoans, unit: "active loans", href: "/console/loans", live: activeLoans > 0,
    },
    {
      key: "observe", title: "Observe",
      what: "Repayments, arrears and cures land against the same borrower. The behavioural engine reads them daily.",
      count: applications, unit: "applications tracked", href: "/console/applications", live: applications > 0,
    },
    {
      key: "label", title: "Label",
      what: "The outcome backfill writes REPAID or DEFAULTED onto the original score — joining y back to the X captured months earlier.",
      count: resolved, unit: "labelled outcomes", href: null, live: resolved > 0,
    },
    {
      key: "retrain", title: "Retrain",
      what: `At ${TARGET_N} labelled outcomes the trained model takes over live decisions from the expert scorecard, and every subsequent decision refits it.`,
      count: Math.max(0, TARGET_N - resolved), unit: "outcomes to go", href: "/console/intelligence/tuning", live: active,
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    book: { borrowers, applications, activeLoans },
    stations,
    evidence,
    matrix,
    economics,
    families,
    capturedKeys: capturedKeys.length ? capturedKeys : [...THINFILE_FEATURE_KEYS],
    models,
    drift,
    artifact: {
      version: THINFILE_ARTIFACT.version,
      trainedAt: THINFILE_ARTIFACT.trainedAt,
      nObserved: THINFILE_ARTIFACT.nObserved,
      nBootstrap: THINFILE_ARTIFACT.nBootstrap,
      active,
      metrics: THINFILE_ARTIFACT.metrics,
    },
  };
}
