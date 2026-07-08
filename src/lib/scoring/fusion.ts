// ─────────────────────────────────────────────────────────────────────────────
// Score fusion — the best NEW/returning-customer decision.
//
// A brand-new borrower has only M-Pesa cashflow (thin-file). A returning/graduated
// borrower ALSO has an internal repayment track record + the lender's product/agent
// as-of signal (origination engine). When both exist we BLEND them: cashflow speaks
// to affordability, the origination model to repayment history. Weighting leans on
// track-record for repeat borrowers and on cashflow for thin-file applicants.
// ─────────────────────────────────────────────────────────────────────────────

import { scoreFromPd, bandFor, toneFor, decisionFor, type ScoreBand, type ScoreTone, type ScoreDecision } from "@/lib/statement/score-scale";

export type FusedScore = {
  pd: number;
  score: number;
  band: ScoreBand;
  tone: ScoreTone;
  decision: ScoreDecision;
  engine: "thin-file" | "origination" | "fused";
  components: { thinFilePd?: number; originationPd?: number; weightThinFile?: number; weightOrigination?: number };
};

/** Blend a thin-file (cashflow) PD with an origination (track-record) PD. Either may be null. */
export function fuseScores(input: {
  thinFilePd?: number | null;
  originationPd?: number | null;
  hasHistory?: boolean;
}): FusedScore {
  const thin = input.thinFilePd == null ? null : Number(input.thinFilePd);
  const orig = input.originationPd == null ? null : Number(input.originationPd);

  let pd: number;
  let engine: FusedScore["engine"];
  let components: FusedScore["components"];

  if (thin != null && Number.isFinite(thin) && orig != null && Number.isFinite(orig)) {
    // Repeat borrower → trust the repayment track record more; thin-file → trust cashflow more.
    const wOrig = input.hasHistory ? 0.6 : 0.4;
    const wThin = 1 - wOrig;
    pd = wOrig * orig + wThin * thin;
    engine = "fused";
    components = { thinFilePd: thin, originationPd: orig, weightThinFile: wThin, weightOrigination: wOrig };
  } else if (orig != null && Number.isFinite(orig)) {
    pd = orig; engine = "origination"; components = { originationPd: orig };
  } else if (thin != null && Number.isFinite(thin)) {
    pd = thin; engine = "thin-file"; components = { thinFilePd: thin };
  } else {
    throw new Error("fuseScores: at least one of thinFilePd / originationPd is required.");
  }

  const clamped = Math.max(0.001, Math.min(0.999, pd));
  const score = scoreFromPd(clamped);
  return {
    pd: Number(clamped.toFixed(3)),
    score,
    band: bandFor(score),
    tone: toneFor(score),
    decision: decisionFor(score),
    engine,
    components,
  };
}
