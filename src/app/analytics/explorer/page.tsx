// ─────────────────────────────────────────────────────────────────────────────
// THE CHART BUILDER — the whole cube, unlocked.
//
// Every other screen in the studio is a saved combination of a dimension, a set
// of measures and a form. This one hands those three controls to the reader.
//
// The server's job is narrow and important: read the ticked columns out of the
// URL, work out which single dimension they imply, run ONE aggregate for it, and
// hand the rows down. The builder never queries per keystroke and never receives
// raw rows — the aggregation happens in Postgres exactly as it does on every
// other screen, so a chart somebody builds here and a chart we shipped read the
// same numbers by construction.
//
// The selection is validated server-side before it is queried. A hand-edited URL
// naming a column that does not exist gets dropped rather than reaching the
// query builder — belt and braces on top of the closed dimension table in
// engine.ts, because the URL is the one input a stranger controls.
// ─────────────────────────────────────────────────────────────────────────────
import { studioContext } from "@/lib/analytics/context";
import { cube, type CubeRow } from "@/lib/analytics/engine";
import { field, isDimension, isMeasure } from "@/lib/analytics/fields";
import { StudioPage } from "@/components/analytics/StudioPage";
import ChartBuilder from "@/components/analytics/ChartBuilder";
import type { VizRow } from "@/components/analytics/viz/VizPanel";
import type { DimensionKey } from "@/lib/analytics/cube";
import type { SearchParams } from "@/lib/analytics/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ExplorerPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await studioContext(searchParams);

  // Resolve the ticked columns. Unknown keys are silently dropped — a URL is not
  // a trusted input, and the closed catalogue is the only source of truth for
  // what a column means.
  const picked = ctx.fields.map(field).filter((f) => !!f);
  const dims = picked.filter(isDimension);
  const measures = picked.filter(isMeasure);

  let rows: VizRow[] = [];
  let categoryCount = 0;
  let serverNote: string | null = null;

  // Exactly one dimension is queryable. Zero has nothing to group by; two would
  // need a cross-tab, which is a different screen and a different chart.
  if (dims.length === 1 && measures.length > 0) {
    const dimKey = dims[0].dimensionKey as DimensionKey | undefined;
    if (!dimKey) {
      serverNote = `"${dims[0].label}" cannot be grouped by yet — it is in the catalogue but has no aggregate behind it.`;
    } else {
      try {
        const cubeRows = await cube(ctx.scope, dimKey, ctx.filters);
        categoryCount = cubeRows.length;

        // Only the measures that map onto a cube column can be plotted. One that
        // does not is reported by name rather than drawn as a flat zero line —
        // a zero the reader cannot distinguish from "no data" is worse than an
        // honest gap.
        const unmapped = measures.filter((m) => !m.measureKey);
        if (unmapped.length) {
          serverNote = `${unmapped.map((m) => `"${m.label}"`).join(", ")} ${unmapped.length === 1 ? "is" : "are"} in the catalogue but not yet wired to an aggregate, so ${unmapped.length === 1 ? "it is" : "they are"} left off the chart rather than drawn as zero.`;
        }

        rows = cubeRows.map((r) => {
          const row: VizRow = { label: r.label };
          for (const m of measures) {
            if (!m.measureKey) continue;
            row[m.key] = Number((r as unknown as Record<string, number>)[m.measureKey] ?? 0);
          }
          return row;
        });

        // A ranked chart of forty categories is a spreadsheet with colours on it.
        // The tail is trimmed for the CHART and the count is reported honestly so
        // the checker can still refuse a donut of forty things.
        if (rows.length > 25) {
          const primary = measures.find((m) => m.measureKey)?.key;
          if (primary && dims[0].role === "dimension") {
            rows = [...rows].sort((a, b) => Number(b[primary] ?? 0) - Number(a[primary] ?? 0)).slice(0, 25);
            serverNote = `${categoryCount} categories — showing the largest 25. Narrow the filter to see the rest.`;
          }
        }
      } catch {
        serverNote = "That combination could not be aggregated. Try a different split.";
      }
    }
  }

  return (
    <StudioPage
      title="Chart builder"
      blurb="Tick the columns you want to see. The builder works out which charts can honestly be drawn from them — and for the ones it cannot, it says why."
      range={ctx.filters.range}
      axes={ctx.axes}
      lenses={ctx.lenses}
      activeLenses={ctx.active.map((l) => l.id)}
      split={ctx.split}
      unavailable={ctx.unavailable}
      showGrain={dims.some((d) => d.role === "temporal")}
    >
      <ChartBuilder rows={rows} categoryCount={categoryCount} serverNote={serverNote} />
    </StudioPage>
  );
}

// Re-exported for the type checker's benefit in the map above.
export type { CubeRow };
