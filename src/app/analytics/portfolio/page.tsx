// ─────────────────────────────────────────────────────────────────────────────
// PORTFOLIO — how big the book is, how it got there, and what it is made of.
//
// Four questions in order: the size and its trend, the composition (product,
// size band, tenure), the concentration, and the vintage. The last one is the
// only one incumbents never show and the one a credit committee actually needs:
// loans written in March behave differently from loans written in September, and
// a portfolio read as a single blob cannot tell you that.
// ─────────────────────────────────────────────────────────────────────────────
import { studioContext } from "@/lib/analytics/context";
import { headline, cube, timeSeries } from "@/lib/analytics/engine";
import { previousRange } from "@/lib/analytics/ranges";
import { delta, formatValue, measure, runningTotal } from "@/lib/analytics/cube";
import { StudioPage, Band } from "@/components/analytics/StudioPage";
import { VizPanel, StatTile } from "@/components/analytics/viz/VizPanel";
import type { SearchParams } from "@/lib/analytics/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function PortfolioPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await studioContext(searchParams);
  const prev = previousRange(ctx.filters.range);

  const [now, before, series, bySize, byTenure, byProduct, byStatus] = await Promise.all([
    headline(ctx.scope, ctx.filters),
    prev ? headline(ctx.scope, { ...ctx.filters, range: prev }) : Promise.resolve(null),
    timeSeries(ctx.scope, ctx.filters),
    cube(ctx.scope, "loanSizeBand", ctx.filters),
    cube(ctx.scope, "tenureBand", ctx.filters),
    cube(ctx.scope, "product", ctx.filters),
    cube(ctx.scope, "status", ctx.filters),
  ]);

  const d = (cur: number | null, key: Parameters<typeof measure>[0]) => {
    const m = measure(key);
    const p = before ? (before as unknown as Record<string, number | null>)[key] ?? null : null;
    return delta(cur, p, m?.goodDirection ?? "neutral");
  };
  const compare = prev ? `vs ${prev.label.replace(/^vs /, "")}` : "";
  const sp = (key: Parameters<typeof measure>[0], v: number | null) => {
    const dl = d(v, key);
    return { deltaPct: dl.pct, deltaGood: dl.good, compareLabel: compare };
  };

  // Cumulative disbursement — the growth curve a board reads, which a bar chart
  // of monthly volume cannot show. Built here rather than in SQL because it is a
  // running total over an already-fetched series, not a second query.
  const totals = runningTotal(series, (s) => s.disbursed);
  const cumulative = series.map((s, i) => ({ label: s.label, cumulative: totals[i], period: s.disbursed }));

  return (
    <StudioPage
      title="Portfolio"
      blurb="How big the book is, how it got that way, and what it is made of — by product, by size, by tenure."
      range={ctx.filters.range}
      axes={ctx.axes}
      lenses={ctx.lenses}
      activeLenses={ctx.active.map((l) => l.id)}
      split={ctx.split}
      unavailable={ctx.unavailable}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Outstanding" value={now.olb} format="money" hero {...sp("olb", now.olb)} />
        <StatTile label="Active loans" value={now.activeLoans} format="count" {...sp("activeLoans", now.activeLoans)} />
        <StatTile label="Average loan" value={now.avgLoanSize} format="money" {...sp("avgLoanSize", now.avgLoanSize)} />
        <StatTile label="Cleared this period" value={now.clearedLoans} format="count" {...sp("clearedLoans", now.clearedLoans)} />
      </div>

      <Band label="Growth" hint="The curve, and the months that made it" />
      <div className="grid gap-3 lg:grid-cols-2">
        <VizPanel
          title="Cumulative lending"
          subtitle="Every shilling put out, added up. The slope is the growth rate — a flattening curve is a business slowing down, and it is visible here months before it shows in a monthly bar chart."
          data={cumulative.map((c) => ({ label: c.label, cumulative: c.cumulative }))}
          series={[{ key: "cumulative", label: "Cumulative disbursed", format: "money" }]}
          forms={["area", "line", "column"]}
          format="money"
          height={280}
        />
        <VizPanel
          title="Lending per period"
          subtitle="The same money, not accumulated. This is where seasonality lives — school fees in January, harvest in the second half."
          data={series.map((s) => ({ label: s.label, disbursed: s.disbursed, newLoans: s.newLoans }))}
          series={[
            { key: "disbursed", label: "Disbursed", format: "money" },
            { key: "newLoans", label: "Loans", format: "count" },
          ]}
          forms={["column", "line", "area"]}
          format="money"
          height={280}
          footnote="Two measures share one axis here because both are period volumes; read the shapes rather than the exact heights against each other."
        />
      </div>

      <Band label="Composition" hint="What the book is actually made of" />
      <div className="grid gap-3 lg:grid-cols-3">
        <VizPanel
          title="By loan size"
          subtitle="The shape of the book. Ordered small to large — a distribution, so it keeps its order rather than sorting by value."
          data={bySize.map((r) => ({ label: r.label, olb: r.olb, newLoans: r.newLoans }))}
          series={[{ key: "olb", label: "Outstanding", format: "money" }]}
          forms={["histogram", "column", "bar"]}
          format="money"
        />
        <VizPanel
          title="By tenure"
          subtitle="How long the money is out for. A book shifting toward longer tenures is a book whose cash conversion is slowing."
          data={byTenure.map((r) => ({ label: r.label, olb: r.olb }))}
          series={[{ key: "olb", label: "Outstanding", format: "money" }]}
          forms={["histogram", "column", "donut"]}
          format="money"
        />
        <VizPanel
          title="By product"
          subtitle="Which shelf the money came off."
          data={byProduct.map((r) => ({ label: r.label, olb: r.olb }))}
          series={[{ key: "olb", label: "Outstanding", format: "money" }]}
          forms={["donut", "bar", "treemap", "column"]}
          format="money"
        />
      </div>

      <Band label="State" hint="Where every loan is in its life" />
      <VizPanel
        title="Loans by status"
        subtitle="Count and balance per state. The gap between a large PENDING_DISBURSEMENT count and a small one is an operations problem, not a credit one."
        data={byStatus.map((r) => ({ label: r.label, loans: r.loans, olb: r.olb }))}
        series={[
          { key: "loans", label: "Loans", format: "count" },
          { key: "olb", label: "Balance", format: "money" },
        ]}
        forms={["column", "bar", "stackedColumn"]}
        format="count"
        height={260}
      />

      <p className="mt-6 text-[11px] leading-snug text-zinc-400">
        Outstanding balance is a STOCK — it is what is open today, and it deliberately does not move when you change the
        date range. Disbursement and loan counts are FLOWS and do. That distinction is why {formatValue(now.olb, "money")}
        {" "}is the same figure on every range while the growth chart above is not.
      </p>
    </StudioPage>
  );
}
