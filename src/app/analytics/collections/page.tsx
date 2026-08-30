// ─────────────────────────────────────────────────────────────────────────────
// COLLECTIONS — what fell due, what came in, and the gap between them.
//
// The gap IS the screen. Every other collections view shows what was collected,
// which sounds like good news right up until you put it beside what was supposed
// to arrive. A month with record collections and a falling collection RATE is a
// month the book grew faster than the recovery function, and only the second
// number says so.
// ─────────────────────────────────────────────────────────────────────────────
import { studioContext } from "@/lib/analytics/context";
import { headline, timeSeries, cube } from "@/lib/analytics/engine";
import { previousRange } from "@/lib/analytics/ranges";
import { delta, formatValue, measure } from "@/lib/analytics/cube";
import { StudioPage, Band } from "@/components/analytics/StudioPage";
import { VizPanel, StatTile, Meter } from "@/components/analytics/viz/VizPanel";
import { STATUS } from "@/components/analytics/viz/theme";
import type { SearchParams } from "@/lib/analytics/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function CollectionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await studioContext(searchParams);
  const prev = previousRange(ctx.filters.range);

  const [now, before, series, byOfficer, byBranch] = await Promise.all([
    headline(ctx.scope, ctx.filters),
    prev ? headline(ctx.scope, { ...ctx.filters, range: prev }) : Promise.resolve(null),
    timeSeries(ctx.scope, ctx.filters),
    cube(ctx.scope, "officer", ctx.filters),
    cube(ctx.scope, "branch", ctx.filters),
  ]);

  const sp = (key: Parameters<typeof measure>[0], v: number | null) => {
    const m = measure(key);
    const p = before ? (before as unknown as Record<string, number | null>)[key] ?? null : null;
    const dl = delta(v, p, m?.goodDirection ?? "neutral");
    return { deltaPct: dl.pct, deltaGood: dl.good, compareLabel: prev ? `vs ${prev.label.replace(/^vs /, "")}` : "" };
  };

  const shortfall = Math.max(0, now.dueInPeriod - now.collected);

  return (
    <StudioPage
      title="Collections"
      blurb="What fell due, what actually arrived, and who is closing the gap between them."
      range={ctx.filters.range}
      axes={ctx.axes}
      lenses={ctx.lenses}
      activeLenses={ctx.active.map((l) => l.id)}
      split={ctx.split}
      unavailable={ctx.unavailable}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Collected" value={now.collected} format="money" hero {...sp("collected", now.collected)} />
        <StatTile label="Fell due" value={now.dueInPeriod} format="money" hint="Scheduled installments with a due date inside this period." />
        <StatTile label="Shortfall" value={shortfall} format="money" hint="Due less collected. Not the same as arrears — some of this will still arrive." />
        <StatTile label="Collection rate" value={now.collectionRate} format="percent" {...sp("collectionRate", now.collectionRate)} />
      </div>

      <Band label="The gap" hint="Money in, against money expected" />
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <VizPanel
            title="Collections over the period"
            subtitle="What came in. Read it beside the collection rate to the right — a record month at a falling rate means the book grew faster than the recovery function."
            data={series.map((s) => ({ label: s.label, collected: s.collected, disbursed: s.disbursed }))}
            series={[
              { key: "collected", label: "Collected" },
              { key: "disbursed", label: "Disbursed" },
            ]}
            forms={["column", "line", "area"]}
            format="money"
            height={300}
          />
        </div>
        <div className="space-y-3">
          <Meter
            label="Collection rate"
            value={now.collectionRate ?? 0}
            format="percent"
            tone={now.collectionRate != null && now.collectionRate >= 90 ? STATUS.good : now.collectionRate != null && now.collectionRate >= 70 ? STATUS.warning : STATUS.critical}
            caption={`${formatValue(now.collected, "money")} of ${formatValue(now.dueInPeriod, "money")}.`}
          />
          <Meter
            label="On-time settlement"
            value={now.onTimeRate ?? 0}
            format="percent"
            tone={now.onTimeRate != null && now.onTimeRate >= 85 ? STATUS.good : now.onTimeRate != null && now.onTimeRate >= 65 ? STATUS.warning : STATUS.critical}
            caption="Installments paid on or before the due date, rather than eventually."
          />
          <div className="rounded-2xl border border-ash-900/10 bg-paper p-4">
            <p className="text-[10px] uppercase tracking-wide text-ash-500">How this is counted</p>
            <p className="mt-1 text-[11px] leading-snug text-ash-600">
              Collections are deduplicated across STK and C2B on the M-Pesa receipt number. An STK payment also lands as a
              paybill confirmation, and counting both is the reconciliation error this platform exists to catch — so the
              figure above is a receipt-level union, not a sum of two ledgers.
            </p>
          </div>
        </div>
      </div>

      <Band label="Who is collecting" hint="Cleared loans as a share of what each had open" />
      <div className="grid gap-3 lg:grid-cols-2">
        <VizPanel
          title="Clearance by officer"
          subtitle="Loans taken all the way to settled, as a share of the loans that officer had open to settle. The nearest honest proxy for collection effort at officer grain."
          data={[...byOfficer]
            .filter((r) => r.loans >= 3)
            .sort((a, b) => (b.clearedLoans / Math.max(1, b.loans)) - (a.clearedLoans / Math.max(1, a.loans)))
            .slice(0, 12)
            .map((r) => ({ label: r.label, rate: (r.clearedLoans / Math.max(1, r.loans)) * 100 }))}
          series={[{ key: "rate", label: "Clearance rate", format: "percent" }]}
          forms={["bar", "column"]}
          format="percent"
          height={300}
          emptyHint="No officer has enough loans in this cut to compare."
          footnote="Officers with fewer than three loans are excluded rather than shown at 100% — a perfect record over two loans is not a record."
        />
        <VizPanel
          title="Outstanding arrears by branch"
          subtitle="Where the uncollected money is sitting. This is the deployment map for a collections push."
          data={[...byBranch].sort((a, b) => b.overdue - a.overdue).slice(0, 12).map((r) => ({ label: r.label, overdue: r.overdue }))}
          series={[{ key: "overdue", label: "Overdue amount", color: STATUS.warning }]}
          forms={["bar", "treemap", "column", "heatmap"]}
          format="money"
          height={300}
        />
      </div>
    </StudioPage>
  );
}
