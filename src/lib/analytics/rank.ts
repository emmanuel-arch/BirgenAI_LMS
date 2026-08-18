// ─────────────────────────────────────────────────────────────────────────────
// RANKING — turning a cube into a league table, under a definition the reader
// chose.
//
// "Best agent" is not a fact. At Micromart it is four different people:
//
//   · the one carrying the biggest book        (tenure and territory)
//   · the one whose book is cleanest           (often the one with three loans)
//   · the one who disbursed most this quarter  (whose PAR arrives in the next one)
//   · the one who collects most of what is due (the one nobody promotes)
//
// A product that silently picks one of those and prints "Top Officers" is making
// a political claim in the voice of an analysis. So the definition is a control,
// it is printed next to the answer, and its known weakness is printed with it.
// The caveats in RANK_METRICS are not hedging — a league table read without them
// gets somebody promoted for the wrong reason.
// ─────────────────────────────────────────────────────────────────────────────
import type { CubeRow } from "./engine";
import { rankMetric, type RankMetricKey, type MeasureFormat } from "./cube";

export type RankedRow = {
  key: string;
  label: string;
  /** The value this row is ranked on. */
  score: number;
  /** How the score reads. */
  format: MeasureFormat;
  /** Position, 1-based, after sorting. */
  position: number;
  /** The row's own numbers, so the table can show the context behind the rank. */
  row: CubeRow;
  /**
   * True when the row's sample is too small for its score to mean anything.
   * A 100% clean book of two loans is not a 100% clean book.
   */
  thin: boolean;
};

/** How small is too small, per metric. Below this the score is flagged, never hidden. */
const THIN_THRESHOLD: Partial<Record<RankMetricKey, (r: CubeRow) => boolean>> = {
  quality: (r) => r.activeLoans < 5,
  riskAdjusted: (r) => r.activeLoans < 5,
  conversion: (r) => r.newLoans < 5,
  retention: (r) => r.borrowers < 10,
  collection: (r) => r.activeLoans < 5,
  efficiency: (r) => r.activeLoans < 3,
};

function scoreOf(metric: RankMetricKey, r: CubeRow): number {
  switch (metric) {
    case "book":
      return r.olb;
    case "quality":
      // The share of the book that is NOT past 30 days. A row with no book has
      // no quality to report and scores zero rather than a flattering 100%.
      return r.olb > 0 ? 100 - (r.par30Amount / r.olb) * 100 : 0;
    case "growth":
      return r.disbursed;
    case "conversion":
      // Loans booked as a share of the borrowers approached. The cube does not
      // carry applications per officer, so this uses the closest honest proxy:
      // loans per distinct borrower touched.
      return r.borrowers > 0 ? (r.newLoans / r.borrowers) * 100 : 0;
    case "collection":
      // Cleared loans as a share of the loans that were open to clear.
      return r.loans > 0 ? (r.clearedLoans / r.loans) * 100 : 0;
    case "productivity":
      return r.newLoans;
    case "retention":
      return r.borrowers > 0 ? (r.loans / r.borrowers - 1) * 100 : 0;
    case "riskAdjusted":
      return r.olb > 0 ? r.olb * (1 - r.par30Amount / r.olb) : 0;
    case "efficiency":
      return r.activeLoans > 0 ? r.olb / r.activeLoans : 0;
  }
}

export function rank(rows: CubeRow[], metric: RankMetricKey, top = 10): RankedRow[] {
  const def = rankMetric(metric);
  const isThin = THIN_THRESHOLD[metric];
  const goodDown = def?.goodDirection === "down";

  return rows
    .map((row) => ({
      key: row.key,
      label: row.label,
      score: scoreOf(metric, row),
      format: (def?.format ?? "count") as MeasureFormat,
      position: 0,
      row,
      thin: isThin ? isThin(row) : false,
    }))
    // Rows with nothing in them are dropped, not ranked last: an officer with no
    // loans at all is absent from the book, not the worst performer on it.
    .filter((r) => r.row.loans > 0 || r.row.borrowers > 0)
    .sort((a, b) => (goodDown ? a.score - b.score : b.score - a.score))
    .slice(0, top)
    .map((r, i) => ({ ...r, position: i + 1 }));
}

/**
 * The spread between the top and the bottom of a ranking, as a sentence.
 *
 * The most useful thing about a league table is usually not who is first — it is
 * how far apart the ends are. A 3% spread means the metric is not discriminating
 * and the table should be ignored; a 60% spread is a management problem.
 */
export function spread(ranked: RankedRow[], unitLabel: string): string | null {
  if (ranked.length < 3) return null;
  const top = ranked[0];
  const bottom = ranked[ranked.length - 1];
  if (top.score === 0) return null;
  const ratio = bottom.score !== 0 ? top.score / bottom.score : Infinity;
  if (!Number.isFinite(ratio)) {
    return `${top.label} is ahead of a bottom of the table that is at zero — the gap is not a ranking, it is a presence-or-absence.`;
  }
  if (ratio < 1.25) {
    return `Top to bottom is only ${((ratio - 1) * 100).toFixed(0)}% apart. On this measure the ${unitLabel} are not meaningfully different — ranking them is reading noise.`;
  }
  return `${top.label} is ${ratio.toFixed(1)}× the bottom of this table. That gap is the finding, not the order.`;
}
