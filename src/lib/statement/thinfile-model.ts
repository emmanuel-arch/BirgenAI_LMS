// ─────────────────────────────────────────────────────────────────────────────
// Trained thin-file model — inference.
//
// Consumes the fitted logistic artifact (thinfile-weights.json) produced by
// scripts/train-thinfile-model.ts and scores a borrower from M-Pesa cashflow
// features, returning the SAME ThinFileScore shape as the expert scorecard (so it
// is a drop-in). Reason codes are the per-feature contributions to the predicted
// default probability — the DPA explanation, same as the scorecard.
//
// ACTIVATION: the model only takes over live decisions once it has been fitted on
// enough REAL observed outcomes (nObserved ≥ MIN_OBSERVED_TO_ACTIVATE). Until then
// the artifact may hold an expert-distilled bootstrap fit (for validation) but
// isModelActive() returns false and callers stay on the expert scorecard.
// ─────────────────────────────────────────────────────────────────────────────

import type { CashflowFeatures } from "./features";
import type { ThinFileScore, ReasonCode } from "./scorecard";
import { toFeatureMap, FEATURE_LABELS, featureDetail, type ThinFileFeatureKey } from "./model-features";
import { scoreFromPd, bandFor, toneFor, decisionFor } from "./score-scale";
import artifact from "./thinfile-weights.json";

/** Minimum REAL labelled outcomes before the trained model is trusted for decisions. */
export const MIN_OBSERVED_TO_ACTIVATE = 300;

export type ThinFileArtifact = {
  version: string;
  trainedAt: string | null;
  featureKeys: string[];
  mean: number[];
  std: number[];
  coef: number[];
  intercept: number;
  nObserved: number;
  nBootstrap: number;
  metrics: { auc: number; ks: number; brier: number; n: number };
};

export const THINFILE_ARTIFACT = artifact as ThinFileArtifact;

/** Is the artifact a real fit AND trained on enough observed outcomes to trust live? */
export function isModelActive(a: ThinFileArtifact = THINFILE_ARTIFACT): boolean {
  return (
    Array.isArray(a.coef) &&
    a.coef.length === a.featureKeys.length &&
    a.coef.some((c) => c !== 0) &&
    a.nObserved >= MIN_OBSERVED_TO_ACTIVATE
  );
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** Score with the fitted logistic model. Assumes a real artifact (caller gates via the dispatcher). */
export function scoreWithModel(f: CashflowFeatures, a: ThinFileArtifact = THINFILE_ARTIFACT): ThinFileScore {
  const m = toFeatureMap(f);

  let logit = a.intercept;
  const contribs: { key: string; c: number }[] = [];
  a.featureKeys.forEach((k, i) => {
    const x = (m as Record<string, number>)[k] ?? 0;
    const z = a.std[i] ? (x - a.mean[i]) / a.std[i] : 0;
    const c = a.coef[i] * z; // contribution to the log-odds of DEFAULT
    logit += c;
    contribs.push({ key: k, c });
  });

  const pd = Number(sigmoid(logit).toFixed(3)); // P(default)
  const score = scoreFromPd(pd);

  // Contribution to PD: c > 0 raises default odds (bad for borrower → "down").
  // Express as scorecard-style points (negate so "up" = score-positive).
  const toReason = (x: { key: string; c: number }): ReasonCode => {
    const key = x.key as ThinFileFeatureKey;
    return {
      code: x.key.slice(0, 3).toUpperCase(),
      factor: FEATURE_LABELS[key] ?? x.key,
      points: Math.round(-x.c * 100),
      direction: x.c <= 0 ? "up" : "down",
      detail: featureDetail(key, f),
    };
  };

  const reasonCodes = contribs
    .filter((x) => Math.abs(x.c) > 1e-6)
    .sort((p, q) => Math.abs(q.c) - Math.abs(p.c))
    .slice(0, 4)
    .map(toReason);

  return {
    modelVersion: a.version,
    score,
    maxScore: 900,
    pd,
    pdPercent: `${(pd * 100).toFixed(1)}%`,
    band: bandFor(score),
    tone: toneFor(score),
    decision: decisionFor(score),
    reasonCodes,
    breakdown: contribs.map((x) => ({
      code: x.key.slice(0, 3).toUpperCase(),
      factor: FEATURE_LABELS[x.key as ThinFileFeatureKey] ?? x.key,
      points: Math.round(-x.c * 100),
    })),
  };
}
