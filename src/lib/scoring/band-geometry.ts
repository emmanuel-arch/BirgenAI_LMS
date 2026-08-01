// ─────────────────────────────────────────────────────────────────────────────
// WHERE A FACTOR'S BANDS SIT ON AN AXIS.
//
// A scoring table is read by `bandFor()` in ORDER — best rung first, first match
// wins — which means the same array describes two opposite pictures depending on
// the metric's comparison:
//
//   lte (days late)      best band nearest zero, array order IS screen order
//   gte (ratio paid)     best band at the top of the range, array order REVERSED
//
// A curve editor that gets this inversion wrong lets a lender drag a shape and
// publish a different one — the bug would be silent, and its symptom would be a
// borrower scored under a rung nobody meant to create. So the mapping lives here,
// alone, in a module with no React in it, and `npm run test:credit-policy` holds
// it to `bandFor()`'s own arithmetic across every metric.
//
// Pure geometry: no pixels. The editor scales these into its viewBox.
// ─────────────────────────────────────────────────────────────────────────────
import type { ScoreBandRule } from "./behaviour-policy";

/** A plateau: the band that applies from `x0` up to `x1` on an ascending axis. */
export type BandSegment = { x0: number; x1: number; band: number };
/** A draggable boundary at `x`, belonging to `band`'s threshold. */
export type BandDivider = { x: number; band: number };

/**
 * Lay the bands out left-to-right in the metric, whichever way they are read.
 *
 * `band` on both segments and dividers is an index into the ORIGINAL array, so a
 * caller can drag a screen feature and patch the right rule.
 */
export function bandGeometry(
  bands: ScoreBandRule[],
  compare: "gte" | "lte",
  dmax: number,
): { segments: BandSegment[]; dividers: BandDivider[] } {
  const n = bands.length;
  const ts = bands.slice(0, n - 1).map((b) => b.threshold ?? 0);
  const segments: BandSegment[] = [];
  const dividers: BandDivider[] = [];

  // A lone catch-all covers everything, and has no boundary to drag.
  if (n === 0) return { segments, dividers };
  if (n === 1 || ts.length === 0) return { segments: [{ x0: 0, x1: dmax, band: n - 1 }], dividers };

  if (compare === "lte") {
    let prev = 0;
    for (let i = 0; i < n - 1; i++) {
      segments.push({ x0: prev, x1: ts[i], band: i });
      dividers.push({ x: ts[i], band: i });
      prev = ts[i];
    }
    segments.push({ x0: prev, x1: dmax, band: n - 1 });
  } else {
    // The catch-all is LEFTMOST here: everything below the lowest rung falls through.
    segments.push({ x0: 0, x1: ts[n - 2], band: n - 1 });
    for (let i = n - 2; i >= 1; i--) segments.push({ x0: ts[i], x1: ts[i - 1], band: i });
    segments.push({ x0: ts[0], x1: dmax, band: 0 });
    for (let i = n - 2; i >= 0; i--) dividers.push({ x: ts[i], band: i });
  }

  return { segments, dividers };
}

/**
 * What the drawn curve says a measurement scores.
 *
 * This must agree with `bandFor()` for every value, which is the whole point of
 * the module — see scripts/verify-credit-policy.ts.
 */
export function pointsAtValue(bands: ScoreBandRule[], compare: "gte" | "lte", value: number, dmax: number): number {
  const { segments } = bandGeometry(bands, compare, Math.max(dmax, value));
  // Segments are half-open [x0, x1) except the last, so a value landing exactly on
  // a boundary belongs to the band that CLAIMS it — the same tie the engine breaks.
  for (const s of segments) {
    const isLast = s === segments[segments.length - 1];
    const inside = compare === "lte"
      ? value <= s.x1 && (value > s.x0 || s.x0 === 0)
      : (value >= s.x0 && (value < s.x1 || isLast));
    if (inside) return bands[s.band].points;
  }
  return bands[bands.length - 1]?.points ?? 0;
}

/**
 * Keep a threshold between its neighbours.
 *
 * Crossing one is exactly the edit `validateBehaviour` rejects as "out of order",
 * and the rung it would swallow becomes unreachable — so a drag is clamped rather
 * than allowed to produce a document the server will refuse.
 */
export function clampThreshold(
  bands: ScoreBandRule[],
  compare: "gte" | "lte",
  index: number,
  value: number,
  dmax: number,
  step: number,
): number {
  const at = (i: number) => (i >= 0 && i < bands.length ? bands[i].threshold : undefined);
  const lower = compare === "lte" ? at(index - 1) : at(index + 1);
  const upper = compare === "lte" ? at(index + 1) : at(index - 1);
  const min = lower == null ? 0 : lower + step;
  const max = upper == null ? dmax : upper - step;
  // A factor with more rungs than the axis has room for would invert min and max;
  // the lower bound wins, so the drag stalls instead of jumping.
  return Math.max(min, Math.min(Math.max(min, max), value));
}
