// ─────────────────────────────────────────────────────────────────────────────
// BRANCHES — office against office, on any measure.
//
// The same ranking machinery as Officers, on a different grain, plus the two
// things a branch comparison needs that an officer one does not: how the book is
// distributed (a lender with 80% of its money in one office has a concentration
// problem nobody has named), and how each office's quality compares on its own
// terms rather than against the size of the biggest.
// ─────────────────────────────────────────────────────────────────────────────
import { studioContext } from "@/lib/analytics/context";
import { cube } from "@/lib/analytics/engine";
import { rank, spread } from "@/lib/analytics/rank";
import { rankMetric, RANK_METRICS, formatValue, type RankMetricKey } from "@/lib/analytics/cube";
import { StudioPage, Band } from "@/components/analytics/StudioPage";
import RankBoard from "@/components/analytics/RankBoard";
import { VizPanel } from "@/components/analytics/viz/VizPanel";
import { STATUS } from "@/components/analytics/viz/theme";
import type { SearchParams } from "@/lib/analytics/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function BranchesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await studioContext(searchParams);
  const metricKey = (RANK_METRICS.some((m) => m.key === ctx.rank) ? ctx.rank : "book") as RankMetricKey;
  const metric = rankMetric(metricKey)!;

  const rows = await cube(ctx.scope, "branch", ctx.filters);
  const ranked = rank(rows, metricKey, ctx.top);

  // Concentration: the share of the whole book sitting in the largest office.
  // Not a chart — a single number with a consequence, so it is a sentence.
  const totalOlb = rows.reduce((s, r) => s + r.olb, 0);
  const biggest = [...rows].sort((a, b) => b.olb - a.olb)[0];
  const concentration = totalOlb > 0 && biggest ? (biggest.olb / totalOlb) * 100 : 0;

  return (
    <StudioPage
      title="Branches"
      blurb="Office against office. Size, quality and growth — and how much of the whole book depends on any one of them."
      range={ctx.filters.range}
      axes={ctx.axes}
      lenses={ctx.lenses}
      activeLenses={ctx.active.map((l) => l.id)}
      split={ctx.split}
      unavailable={ctx.unavailable}
      showGrain={false}
    >
      {rows.length > 1 && concentration > 50 && (
        <div
          className="mb-3 rounded-2xl border p-4"
          style={{ borderColor: `${STATUS.warning}55`, backgroundColor: `${STATUS.warning}0d` }}
        >
          <p className="text-[13px] leading-snug text-zinc-800">
            <strong>{biggest.label}</strong> holds {concentration.toFixed(0)}% of the entire outstanding book (
            {formatValue(biggest.olb, "money")} of {formatValue(totalOlb, "money")}). Concentration at that level means
            one office&apos;s bad quarter is the lender&apos;s bad quarter.
          </p>
        </div>
      )}

      <RankBoard
        rows={ranked}
        metricKey={metricKey}
        metricLabel={metric.label}
        formula={metric.formula}
        caveat={metric.caveat}
        question={metric.question}
        spreadNote={spread(ranked, "branches")}
        unitLabel="branches"
      />

      <Band label="Distribution" hint="Where the money actually sits" />
      <div className="grid gap-3 lg:grid-cols-2">
        <VizPanel
          title="Share of the book"
          subtitle="Outstanding balance by office. A treemap makes concentration obvious in a way a bar chart of the same numbers does not."
          data={rows.map((r) => ({ label: r.label, olb: r.olb }))}
          series={[{ key: "olb", label: "Outstanding", format: "money" }]}
          forms={["treemap", "bar", "donut", "column", "heatmap"]}
          format="money"
          height={300}
          emptyHint="No office has an open book in this cut."
        />
        <VizPanel
          title="Quality by office"
          subtitle="PAR 30 as a percentage of each office's own book — so a small office with a bad book is not hidden behind a large one with a good book."
          data={[...rows].sort((a, b) => b.par30 - a.par30).slice(0, 15).map((r) => ({ label: r.label, par30: r.par30 }))}
          series={[{ key: "par30", label: "PAR 30", format: "percent", color: STATUS.critical }]}
          forms={["bar", "column", "heatmap"]}
          format="percent"
          height={300}
          reference={{ value: 5, label: "5% tolerance" }}
          footnote="The dashed line is a 5% internal tolerance, shown for orientation. It is a common management limit, not a regulatory threshold."
        />
      </div>
    </StudioPage>
  );
}
