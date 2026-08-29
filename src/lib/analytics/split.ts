// ─────────────────────────────────────────────────────────────────────────────
// SIDE BY SIDE — turning a split result into the shape VizPanel already draws.
//
// VizPanel has always been multi-series with a per-series colour. So comparing
// two books needs no new chart: it needs the engine's `by` breakdown reshaped
// into one series per book, each wearing that book's own accent. The colour is
// doing real work here — it is the same accent the realm switch paints the
// console with, so "the gold one is the branch book" is learned once and holds
// everywhere.
//
// ── ONE MEASURE AT A TIME, DELIBERATELY ──────────────────────────────────────
// A combined chart can draw disbursed AND collected together because colour is
// free to mean "which flow". Split, colour already means "which book", and a
// chart cannot encode two things in one channel. So a split panel shows ONE
// measure across every book, and the measures that used to share a panel are
// drawn as panels beside each other. That is why "side by side" is the honest
// name for it.
// ─────────────────────────────────────────────────────────────────────────────
import type { CubeRow, CubeMeasures, TimeRow, TimePoint } from "./engine";
import type { EntityLens } from "./scope";
import type { VizRow, VizSeries } from "@/components/analytics/viz/VizPanel";

export type SplitChart = { data: VizRow[]; series: VizSeries[] };

/** A series key that cannot collide with a measure name. */
const seriesKey = (entityId: number) => `e${entityId}`;

function seriesFor(lenses: EntityLens[]): VizSeries[] {
  return lenses.map((l) => ({ key: seriesKey(l.id), label: l.label, color: l.accent }));
}

/**
 * A time series, one line per book.
 *
 * Books with no activity in a bucket are drawn as ZERO rather than omitted —
 * liveTimeSeries guarantees every book a slot in every bucket for exactly this
 * reason. A missing point would let the axis rescale around the busy book and
 * make the quiet one look like it stopped existing rather than like it is small.
 */
export function splitTrend(
  rows: TimeRow[],
  lenses: EntityLens[],
  measure: keyof Omit<TimePoint, "label">,
): SplitChart {
  return {
    series: seriesFor(lenses),
    data: rows.map((r) => {
      const out: VizRow = { label: r.label };
      for (const l of lenses) {
        out[seriesKey(l.id)] = r.by?.find((s) => s.entityId === l.id)?.[measure] ?? 0;
      }
      return out;
    }),
  };
}

/**
 * A cube, one bar per book within each category.
 *
 * Categories are ordered by the COMBINED total, not by either book's, so the
 * ordering does not flip depending on which book happens to be selected — a
 * league table that reorders itself when you change an unrelated control is a
 * league table nobody trusts.
 */
export function splitCube(
  rows: CubeRow[],
  lenses: EntityLens[],
  measure: keyof CubeMeasures,
  opts: { top?: number } = {},
): SplitChart {
  const ordered = [...rows].sort((a, b) => Math.abs(b[measure]) - Math.abs(a[measure]));
  const cut = opts.top ? ordered.slice(0, opts.top) : ordered;
  return {
    series: seriesFor(lenses),
    data: cut.map((r) => {
      const out: VizRow = { label: r.label };
      for (const l of lenses) {
        out[seriesKey(l.id)] = r.by?.find((s) => s.entityId === l.id)?.[measure] ?? 0;
      }
      return out;
    }),
  };
}

export type LensFigure = { label: string; value: number | null; color: string };

/**
 * One headline measure, per book — what a stat tile prints under its own figure.
 *
 * The combined number stays the headline and the books sit beneath it. Replacing
 * the total with two smaller numbers would answer "how are the books doing"
 * while silently dropping "how are WE doing", and a general manager needs both
 * in that order.
 */
export function lensFigures(
  by: Array<{ entityId: number }> | undefined,
  lenses: EntityLens[],
  measure: string,
): LensFigure[] {
  if (!by?.length) return [];
  return lenses.map((l) => {
    const slice = by.find((s) => s.entityId === l.id) as Record<string, unknown> | undefined;
    const raw = slice?.[measure];
    return { label: l.label, value: typeof raw === "number" ? raw : null, color: l.accent };
  });
}
