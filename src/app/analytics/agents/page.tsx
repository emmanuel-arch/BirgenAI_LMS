// ─────────────────────────────────────────────────────────────────────────────
// OFFICERS — ranked by whichever definition of "best" the reader chose.
//
// The most-requested screen in every lending business and the one most often
// built wrong. See src/lib/analytics/rank.ts for why the metric is a control
// rather than a decision we made on the lender's behalf.
//
// The scatter below the table is the argument the table cannot make: book size
// on one axis, book quality on the other. It is the one chart that shows whether
// the officers writing the most business are also the ones whose business comes
// back — and at most lenders, they are not.
// ─────────────────────────────────────────────────────────────────────────────
import { studioContext } from "@/lib/analytics/context";
import { cube } from "@/lib/analytics/engine";
import { rank, spread } from "@/lib/analytics/rank";
import { rankMetric, RANK_METRICS, type RankMetricKey } from "@/lib/analytics/cube";
import { StudioPage, Band } from "@/components/analytics/StudioPage";
import RankBoard from "@/components/analytics/RankBoard";
import { VizPanel } from "@/components/analytics/viz/VizPanel";
import { STATUS } from "@/components/analytics/viz/theme";
import type { SearchParams } from "@/lib/analytics/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AgentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await studioContext(searchParams);
  const metricKey = (RANK_METRICS.some((m) => m.key === ctx.rank) ? ctx.rank : "riskAdjusted") as RankMetricKey;
  const metric = rankMetric(metricKey)!;

  const rows = await cube(ctx.scope, "officer", ctx.filters);
  const ranked = rank(rows, metricKey, ctx.top);

  return (
    <StudioPage
      title="Officers"
      blurb="Who is lending, how much, and whether it comes back. The ranking rule is yours to choose — and the order changes when you do."
      range={ctx.filters.range}
      axes={ctx.axes}
      lenses={ctx.lenses}
      activeLenses={ctx.active.map((l) => l.id)}
      split={ctx.split}
      unavailable={ctx.unavailable}
      showGrain={false}
    >
      <RankBoard
        rows={ranked}
        metricKey={metricKey}
        metricLabel={metric.label}
        formula={metric.formula}
        caveat={metric.caveat}
        question={metric.question}
        spreadNote={spread(ranked, "officers")}
        unitLabel="officers"
      />

      <Band label="Volume against quality" hint="The chart the league table cannot draw" />
      <div className="grid gap-3 lg:grid-cols-2">
        <VizPanel
          title="Does a bigger book mean a worse one?"
          subtitle="Each dot is an officer: outstanding balance across, PAR 30 balance up. A cloud that slopes upward means growth is being bought with quality — which is a management problem, not an officer problem."
          data={rows.map((r) => ({ label: r.label, olb: r.olb, par30Amount: r.par30Amount, activeLoans: r.activeLoans }))}
          series={[
            { key: "olb", label: "Outstanding", format: "money" },
            { key: "par30Amount", label: "PAR 30 balance", format: "money" },
            { key: "activeLoans", label: "Active loans", format: "count" },
          ]}
          forms={["scatter"]}
          format="money"
          height={300}
          emptyHint="No officer has an open book in this cut."
          footnote="Point size is the officer's active loan count, so a large clean dot and a small clean dot are told apart."
        />
        <VizPanel
          title="Book, and the part of it that is late"
          subtitle="Outstanding balance per officer with the overdue portion stacked on top. A tall red segment on a short bar is more urgent than a short one on a tall bar."
          data={ranked.map((r) => ({
            label: r.label,
            clean: Math.max(0, r.row.olb - r.row.par30Amount),
            par30: r.row.par30Amount,
          }))}
          series={[
            { key: "clean", label: "Performing" },
            { key: "par30", label: "PAR 30", color: STATUS.critical },
          ]}
          forms={["stackedColumn", "bar", "column"]}
          format="money"
          height={300}
        />
      </div>
    </StudioPage>
  );
}
