// Dispatcher — pick the live thin-file scorer.
//
// Uses the TRAINED logistic model once it has been fitted on enough real observed
// outcomes (isModelActive); otherwise falls back to the transparent EXPERT
// scorecard. Same input/output either way, so every caller is model-agnostic.

import type { CashflowFeatures } from "./features";
import { scoreThinFile, type ThinFileScore } from "./scorecard";
import { scoreWithModel, isModelActive, THINFILE_ARTIFACT } from "./thinfile-model";

export function scoreThinFileAuto(f: CashflowFeatures): ThinFileScore {
  return isModelActive() ? scoreWithModel(f) : scoreThinFile(f);
}

/** Which scorer is currently live (for diagnostics / admin surfaces). */
export function activeScorer(): { kind: "trained" | "expert"; version: string; nObserved: number } {
  return isModelActive()
    ? { kind: "trained", version: THINFILE_ARTIFACT.version, nObserved: THINFILE_ARTIFACT.nObserved }
    : { kind: "expert", version: "thinfile-scorecard-v1", nObserved: THINFILE_ARTIFACT.nObserved };
}
