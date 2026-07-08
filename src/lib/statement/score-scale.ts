// ─────────────────────────────────────────────────────────────────────────────
// Shared score scale — keeps the EXPERT scorecard and the TRAINED logistic model
// on one identical 300–900 scale, banding and decision policy, so a borrower's
// number means the same thing regardless of which model produced it.
// ─────────────────────────────────────────────────────────────────────────────

export const SCORE_MIN = 300;
export const SCORE_MAX = 900;

export type ScoreBand = "Excellent" | "Good" | "Fair" | "Poor" | "High Risk";
export type ScoreTone = "good" | "warn" | "high" | "bad";
export type ScoreDecision = "APPROVE" | "REFER" | "DECLINE";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** PD → 300–900 score (inverse of the expert calibration link; lower PD → higher score). */
export function scoreFromPd(pd: number): number {
  const p = clamp(pd, 0.001, 0.999);
  return clamp(Math.round(560 + 70 * Math.log((1 - p) / p)), SCORE_MIN, SCORE_MAX);
}

export function bandFor(score: number): ScoreBand {
  return score >= 740 ? "Excellent" : score >= 670 ? "Good" : score >= 600 ? "Fair" : score >= 520 ? "Poor" : "High Risk";
}

export function toneFor(score: number): ScoreTone {
  return score >= 670 ? "good" : score >= 600 ? "warn" : score >= 520 ? "high" : "bad";
}

export function decisionFor(score: number): ScoreDecision {
  return score >= 670 ? "APPROVE" : score >= 560 ? "REFER" : "DECLINE";
}
