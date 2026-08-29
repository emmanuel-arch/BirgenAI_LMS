// ─────────────────────────────────────────────────────────────────────────────
// CASH FLOW — money out against money in, and the net position.
//
// The question this page answers is the one that decides whether a lender can
// keep lending next month, and it is almost never on a lending dashboard:
// NET FLOW. Disbursements are cash out; collections are cash in; the difference
// is what the float is doing. A lender growing fast is, by construction, cash
// negative — that is not a problem, it is the business model, and it becomes a
// problem the moment nobody is watching how negative.
//
// The net series is drawn as a diverging chart around zero, because up-and-down
// around a baseline is exactly the shape the data has and any other form hides it.
// ─────────────────────────────────────────────────────────────────────────────
import { studioContext } from "@/lib/analytics/context";
import { headline, timeSeries } from "@/lib/analytics/engine";
import { previousRange } from "@/lib/analytics/ranges";
import { delta, formatValue, runningTotal } from "@/lib/analytics/cube";
import { StudioPage, Band } from "@/components/analytics/StudioPage";
import { VizPanel, StatTile } from "@/components/analytics/viz/VizPanel";
import { STATUS, CATEGORICAL } from "@/components/analytics/viz/theme";
import type { SearchParams } from "@/lib/analytics/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function CashflowPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await studioContext(searchParams);
  const prev = previousRange(ctx.filters.range);

  const [now, before, series] = await Promise.all([
    headline(ctx.scope, ctx.filters),
    prev ? headline(ctx.scope, { ...ctx.filters, range: prev }) : Promise.resolve(null),
    timeSeries(ctx.scope, ctx.filters),
  ]);

  const net = now.collected - now.disbursed;
  const netBefore = before ? before.collected - before.disbursed : null;
  const netDelta = delta(net, netBefore, "neutral");

  // Running cash position across the period — the line a treasurer reads.
  const cumulative = runningTotal(series, (s) => s.collected - s.disbursed);
  const flow = series.map((s, i) => ({
    label: s.label,
    out: -s.disbursed,
    in: s.collected,
    net: s.collected - s.disbursed,
    cumulative: cumulative[i],
  }));

  const worst = [...flow].sort((a, b) => a.net - b.net)[0];

  return (
    <StudioPage
      title="Cash flow"
      blurb="Money out against money in, and what the float is actually doing underneath the growth."
      range={ctx.filters.range}
      axes={ctx.axes}
      lenses={ctx.lenses}
      activeLenses={ctx.active.map((l) => l.id)}
      split={ctx.split}
      unavailable={ctx.unavailable}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Net position"
          value={net}
          format="money"
          hero
          hint="Collected less disbursed. Negative means you funded growth out of capital this period."
          deltaPct={netDelta.pct}
          deltaGood={netDelta.good}
          compareLabel={prev ? `vs ${prev.label.replace(/^vs /, "")}` : ""}
        />
        <StatTile label="Cash out" value={now.disbursed} format="money" hint="Principal disbursed to borrowers." />
        <StatTile label="Cash in" value={now.collected} format="money" hint="Receipts, deduplicated across STK and paybill." />
        <StatTile
          label="Cover ratio"
          value={now.disbursed > 0 ? (now.collected / now.disbursed) * 100 : null}
          format="percent"
          hint="Collections as a share of disbursements. Above 100% the book is self-funding; below it, you are putting capital in."
        />
      </div>

      {net < 0 && (
        <div className="mt-3 rounded-2xl border p-4" style={{ borderColor: `${CATEGORICAL[0]}44`, backgroundColor: `${CATEGORICAL[0]}0a` }}>
          <p className="text-[13px] leading-snug text-zinc-800">
            Net {formatValue(Math.abs(net), "money")} of capital went out this period — collections covered{" "}
            {now.disbursed > 0 ? ((now.collected / now.disbursed) * 100).toFixed(0) : "0"}% of lending. For a growing book
            that is expected, not alarming; what matters is whether the gap is funded and whether it is widening.
          </p>
        </div>
      )}

      <Band label="The two flows" hint="Out below the line, in above it" />
      <VizPanel
        title="Cash out against cash in"
        subtitle="Disbursements drawn below zero, collections above. The visual gap between the two bands is the capital being consumed or released."
        data={flow.map((f) => ({ label: f.label, out: f.out, in: f.in }))}
        series={[
          { key: "in", label: "Collected" },
          { key: "out", label: "Disbursed (out)", color: STATUS.serious },
        ]}
        forms={["column", "stackedColumn", "line", "area"]}
        format="money"
        height={300}
        reference={{ value: 0, label: "break-even" }}
      />

      <Band label="The position" hint="Where the float ends up" />
      <div className="grid gap-3 lg:grid-cols-2">
        <VizPanel
          title="Net per period"
          subtitle="Collected less disbursed, period by period. Crossings of the zero line are the moments the business changed direction."
          data={flow.map((f) => ({ label: f.label, net: f.net }))}
          series={[{ key: "net", label: "Net flow", format: "money" }]}
          forms={["column", "line", "area"]}
          format="money"
          height={280}
          reference={{ value: 0, label: "break-even" }}
          footnote={worst ? `The deepest period was ${worst.label} at ${formatValue(worst.net, "money")}.` : undefined}
        />
        <VizPanel
          title="Cumulative cash position"
          subtitle="The running total across the period. A line falling steadily is a lender funding growth; a line falling faster than it did last quarter is one to raise at the next board meeting."
          data={flow.map((f) => ({ label: f.label, cumulative: f.cumulative }))}
          series={[{ key: "cumulative", label: "Cumulative net", format: "money" }]}
          forms={["area", "line", "column"]}
          format="money"
          height={280}
          reference={{ value: 0, label: "start of period" }}
        />
      </div>

      <p className="mt-6 text-[11px] leading-snug text-zinc-400">
        This is the LOAN BOOK&apos;s cash movement, not the company&apos;s. Operating costs, salaries, capital injections
        and the M-Pesa float itself are not in here — those live in Ledgerly. What this page tells you is whether lending
        is consuming cash or releasing it.
      </p>
    </StudioPage>
  );
}
