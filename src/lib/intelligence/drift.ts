// ─────────────────────────────────────────────────────────────────────────────
// Model drift — is the scoring model still telling the truth about this book?
//
// Every score the platform issues stores its features (X) and, months later, the
// outcome backfill writes what actually happened (y) onto the same ScoreSnapshot.
// That closed loop is only worth having if someone reads it back, and this file is
// the reader. It asks two independent questions:
//
//   CALIBRATION — of the loans whose outcome we now know, did they default at the
//   rate the model predicted? A model that said "10% PD" over a cohort that
//   defaulted at 22% is underestimating risk, and every approval it grants is
//   priced wrong. This compares realised default rate to mean predicted PD over
//   resolved snapshots.
//
//   POPULATION — are the borrowers being scored TODAY still the kind of borrowers
//   the model was watched against? Measured as the Population Stability Index
//   (PSI) between the recent window's score distribution and the older baseline.
//   PSI is the industry's standard drift number precisely because it is dumb:
//   fixed bins, observable arithmetic, no model inside the monitor.
//
// Everything here is deliberately explainable — the same discipline as the
// early-warning weights. And it is honest about thin evidence: below the minimum
// sample sizes the verdict is INSUFFICIENT, never a confident guess. Nine repaid
// loans do not validate a model, and this file will not pretend they do.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";

export type DriftVerdict = "STABLE" | "WATCH" | "DRIFTING" | "INSUFFICIENT";

export type CalibrationReport = {
  /** Snapshots with a known outcome AND a predicted PD. */
  resolved: number;
  defaults: number;
  /** defaults / resolved. */
  realisedRate: number | null;
  /** Mean predicted PD over the same resolved cohort. */
  predictedRate: number | null;
  /** realisedRate − predictedRate. Positive = the model UNDERESTIMATES risk. */
  gap: number | null;
  verdict: DriftVerdict;
  note: string;
};

export type PopulationReport = {
  baselineCount: number;
  recentCount: number;
  psi: number | null;
  baselineMeanScore: number | null;
  recentMeanScore: number | null;
  verdict: DriftVerdict;
  note: string;
};

export type DriftReport = {
  /** The worse of the two verdicts; INSUFFICIENT only when neither can speak. */
  status: DriftVerdict;
  calibration: CalibrationReport;
  population: PopulationReport;
  computedAt: string;
};

export type DriftInput = {
  /** Credit scores from the older window (the model's "normal"). */
  baselineScores: number[];
  /** Credit scores from the recent window. */
  recentScores: number[];
  /** Resolved outcomes: predicted PD and whether the loan actually defaulted. */
  resolved: { pd: number | null; defaulted: boolean }[];
};

// ── Evidence floors and verdict boundaries ────────────────────────────────────
//
// The floors are the honesty line: below them the answer is "not enough outcomes
// yet", full stop. The PSI boundaries (0.10 / 0.25) are the ones every credit-risk
// textbook and regulator uses; the calibration boundaries are in percentage points
// of default rate, where a 5pp miss is worth watching and a 10pp miss is a model
// telling a different story than the book.

/** Minimum resolved outcomes before calibration gets a verdict. */
export const MIN_RESOLVED = 20;
/** Minimum snapshots on EACH side before PSI gets a verdict. */
export const MIN_WINDOW = 15;
export const PSI_WATCH = 0.1;
export const PSI_DRIFT = 0.25;
export const CAL_WATCH = 0.05;
export const CAL_DRIFT = 0.1;

/** Days that separate "recent" from "baseline" when reading the DB. */
export const RECENT_WINDOW_DAYS = 90;

// Scores live on the 300–900 scale everywhere in the platform; fixed bins make
// PSI comparable between runs (data-driven bins would move under the comparison).
const SCORE_MIN = 300;
const SCORE_MAX = 900;
const BINS = 8;

const rank: Record<DriftVerdict, number> = { INSUFFICIENT: -1, STABLE: 0, WATCH: 1, DRIFTING: 2 };

function binShares(scores: number[]): number[] {
  const width = (SCORE_MAX - SCORE_MIN) / BINS;
  const counts = new Array<number>(BINS).fill(0);
  for (const s of scores) {
    const i = Math.min(BINS - 1, Math.max(0, Math.floor((s - SCORE_MIN) / width)));
    counts[i]++;
  }
  // Laplace smoothing: an empty bin on one side must not blow PSI to infinity.
  const n = scores.length + 0.5 * BINS;
  return counts.map((c) => (c + 0.5) / n);
}

/**
 * Population Stability Index between two score samples.
 * Σ (recentShare − baselineShare) × ln(recentShare / baselineShare), over fixed
 * 300–900 bins. 0 = identical populations; ≥0.25 = a materially different one.
 */
export function psi(baselineScores: number[], recentScores: number[]): number {
  const b = binShares(baselineScores);
  const r = binShares(recentScores);
  let total = 0;
  for (let i = 0; i < BINS; i++) total += (r[i] - b[i]) * Math.log(r[i] / b[i]);
  return Math.round(total * 1000) / 1000;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function calibrationOf(resolved: DriftInput["resolved"]): CalibrationReport {
  const scored = resolved.filter((r) => r.pd != null);
  const n = scored.length;
  const defaults = scored.filter((r) => r.defaulted).length;

  if (n < MIN_RESOLVED) {
    return {
      resolved: n, defaults, realisedRate: null, predictedRate: null, gap: null,
      verdict: "INSUFFICIENT",
      note: `Only ${n} scored loan${n === 1 ? " has" : "s have"} a known outcome — calibration needs at least ${MIN_RESOLVED} before a verdict means anything.`,
    };
  }

  const realised = defaults / n;
  const predicted = mean(scored.map((r) => r.pd!))!;
  const gap = Math.round((realised - predicted) * 1000) / 1000;
  const abs = Math.abs(gap);
  const verdict: DriftVerdict = abs >= CAL_DRIFT ? "DRIFTING" : abs >= CAL_WATCH ? "WATCH" : "STABLE";

  const note =
    verdict === "STABLE"
      ? `Across ${n} resolved loans the book defaulted at ${pct(realised)} against a predicted ${pct(predicted)} — the model is reading this book about right.`
      : gap > 0
        ? `Across ${n} resolved loans the book defaulted at ${pct(realised)} but the model predicted ${pct(predicted)} — it is UNDERESTIMATING risk by ${pct(abs)}. Approvals are being priced too kindly.`
        : `Across ${n} resolved loans the book defaulted at ${pct(realised)} against a predicted ${pct(predicted)} — the model is ${pct(abs)} too pessimistic. You may be declining borrowers who would have repaid.`;

  return { resolved: n, defaults, realisedRate: realised, predictedRate: predicted, gap, verdict, note };
}

function populationOf(baselineScores: number[], recentScores: number[]): PopulationReport {
  const b = baselineScores.length;
  const r = recentScores.length;

  if (b < MIN_WINDOW || r < MIN_WINDOW) {
    return {
      baselineCount: b, recentCount: r, psi: null,
      baselineMeanScore: mean(baselineScores), recentMeanScore: mean(recentScores),
      verdict: "INSUFFICIENT",
      note: `Not enough scoring history to compare windows yet (${b} baseline, ${r} recent; each side needs ${MIN_WINDOW}).`,
    };
  }

  const value = psi(baselineScores, recentScores);
  const bMean = Math.round(mean(baselineScores)!);
  const rMean = Math.round(mean(recentScores)!);
  const verdict: DriftVerdict = value >= PSI_DRIFT ? "DRIFTING" : value >= PSI_WATCH ? "WATCH" : "STABLE";
  const direction = rMean < bMean ? "weaker" : rMean > bMean ? "stronger" : "similar";

  const note =
    verdict === "STABLE"
      ? `The borrowers being scored now look like the ones before them (PSI ${value.toFixed(2)}, mean score ${bMean} → ${rMean}).`
      : `The applicant pool has shifted (PSI ${value.toFixed(2)}, mean score ${bMean} → ${rMean} — ${direction} profiles). ${verdict === "DRIFTING" ? "The model was tuned on a different population than it is scoring today." : "Worth watching before it becomes material."}`;

  return { baselineCount: b, recentCount: r, psi: value, baselineMeanScore: bMean, recentMeanScore: rMean, verdict, note };
}

/**
 * Pure drift computation — the seed and the tests feed this directly; the DB
 * reader below only gathers its input. The overall status is the WORSE of the two
 * component verdicts; INSUFFICIENT only when neither component has the evidence
 * to speak.
 */
export function computeDrift(input: DriftInput): DriftReport {
  const calibration = calibrationOf(input.resolved);
  const population = populationOf(input.baselineScores, input.recentScores);
  const spoken = [calibration.verdict, population.verdict].filter((v) => v !== "INSUFFICIENT");
  const status: DriftVerdict = spoken.length ? spoken.reduce((a, v) => (rank[v] > rank[a] ? v : a)) : "INSUFFICIENT";
  return { status, calibration, population, computedAt: new Date().toISOString() };
}

/**
 * Measure drift for an org from its own ScoreSnapshot history.
 * Recent = the last RECENT_WINDOW_DAYS of scores; baseline = everything before
 * (each side capped at 500 newest). Calibration reads every resolved outcome.
 */
export async function modelDrift(orgId: string): Promise<DriftReport> {
  const cutoff = new Date(Date.now() - RECENT_WINDOW_DAYS * 86400000);

  const [recent, baseline, resolved] = await Promise.all([
    prisma.scoreSnapshot.findMany({
      where: { orgId, score: { not: null }, createdAt: { gte: cutoff } },
      select: { score: true },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
    prisma.scoreSnapshot.findMany({
      where: { orgId, score: { not: null }, createdAt: { lt: cutoff } },
      select: { score: true },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
    prisma.scoreSnapshot.findMany({
      where: { orgId, outcome: { in: ["REPAID", "DEFAULTED"] } },
      select: { pd: true, outcome: true },
      orderBy: { outcomeObservedAt: "desc" },
      take: 1000,
    }),
  ]);

  return computeDrift({
    baselineScores: baseline.map((s) => s.score!),
    recentScores: recent.map((s) => s.score!),
    resolved: resolved.map((s) => ({ pd: s.pd != null ? Number(s.pd) : null, defaulted: s.outcome === "DEFAULTED" })),
  });
}
