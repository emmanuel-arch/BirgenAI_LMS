// ─────────────────────────────────────────────────────────────────────────────
// RISK & ARREARS — where the book is going wrong, and where it will go wrong next.
//
// Two different questions, and most lending dashboards only answer the first.
//
//   WHERE IT HAS GONE WRONG is PAR: the money already past due. Backward-looking,
//   unarguable, and the number the board asks for.
//
//   WHERE IT WILL GO WRONG is the risk mix and the on-time rate. A book drifting
//   toward the Watch band, or an on-time rate slipping while PAR holds steady, is
//   a book whose PAR moves next quarter. On-time rate turns first — usually a
//   full cycle before anything shows in arrears.
//
// Both are on this page, in that order, because the second one is the actionable
// one and it is the one nobody looks at.
// ─────────────────────────────────────────────────────────────────────────────
import { studioContext } from "@/lib/analytics/context";
import { headline, cube } from "@/lib/analytics/engine";
import { previousRange } from "@/lib/analytics/ranges";
import { delta, formatValue, measure } from "@/lib/analytics/cube";
import { StudioPage, Band } from "@/components/analytics/StudioPage";
import { VizPanel, StatTile, Meter } from "@/components/analytics/viz/VizPanel";
import { STATUS } from "@/components/analytics/viz/theme";
import type { SearchParams } from "@/lib/analytics/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function RiskPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await studioContext(searchParams);
  const prev = previousRange(ctx.filters.range);

  const [now, before, byRisk, byBranch, byProduct, bySize] = await Promise.all([
    headline(ctx.scope, ctx.filters),
    prev ? headline(ctx.scope, { ...ctx.filters, range: prev }) : Promise.resolve(null),
    cube(ctx.scope, "riskBand", ctx.filters),
    cube(ctx.scope, "branch", ctx.filters),
    cube(ctx.scope, "product", ctx.filters),
    cube(ctx.scope, "loanSizeBand", ctx.filters),
  ]);

  const sp = (key: Parameters<typeof measure>[0], v: number | null) => {
    const m = measure(key);
    const p = before ? (before as unknown as Record<string, number | null>)[key] ?? null : null;
    const dl = delta(v, p, m?.goodDirection ?? "neutral");
    return { deltaPct: dl.pct, deltaGood: dl.good, compareLabel: prev ? `vs ${prev.label.replace(/^vs /, "")}` : "" };
  };

  // The concentration of trouble: how much of ALL the arrears sits in the worst
  // few branches. The single most actionable number on this page, because it
  // turns "PAR is 12%" into "two offices are the problem".
  const totalPar = byBranch.reduce((s, r) => s + r.par30Amount, 0);
  const worst = [...byBranch].sort((a, b) => b.par30Amount - a.par30Amount);
  const topTwoShare = totalPar > 0 ? ((worst[0]?.par30Amount ?? 0) + (worst[1]?.par30Amount ?? 0)) / totalPar * 100 : 0;

  const tone = (v: number) => (v <= 5 ? STATUS.good : v <= 12 ? STATUS.warning : STATUS.critical);

  return (
    <StudioPage
      title="Risk & arrears"
      blurb="Where the book has gone wrong, and — more usefully — where it is about to."
      range={ctx.filters.range}
      axes={ctx.axes}
      lenses={ctx.lenses}
      activeLenses={ctx.active.map((l) => l.id)}
      split={ctx.split}
      unavailable={ctx.unavailable}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="PAR 30" value={now.par30} format="percent" hero hint={measure("par30")?.definition} {...sp("par30", now.par30)} />
        <StatTile label="PAR 30 balance" value={now.par30Amount} format="money" hint="The money behind the percentage." {...sp("par30Amount", now.par30Amount)} />
        <StatTile label="Past 90 days" value={now.nplAmount} format="money" hint="The line most lenders treat as unrecoverable." {...sp("nplAmount", now.nplAmount)} />
        <StatTile label="On-time rate" value={now.onTimeRate} format="percent" hint="The leading indicator — it moves a full cycle before PAR does." {...sp("onTimeRate", now.onTimeRate)} />
      </div>

      {totalPar > 0 && worst.length > 2 && topTwoShare > 60 && (
        <div className="mt-3 rounded-2xl border p-4" style={{ borderColor: `${STATUS.serious}55`, backgroundColor: `${STATUS.serious}0d` }}>
          <p className="text-[13px] leading-snug text-ash-800">
            {topTwoShare.toFixed(0)}% of all arrears sits in <strong>{worst[0].label}</strong> and{" "}
            <strong>{worst[1].label}</strong> — {formatValue((worst[0]?.par30Amount ?? 0) + (worst[1]?.par30Amount ?? 0), "money")} of{" "}
            {formatValue(totalPar, "money")}. The portfolio does not have a PAR problem; two offices do.
          </p>
        </div>
      )}

      <Band label="Where it already went wrong" hint="Backward-looking, and unarguable" />
      <div className="grid gap-3 lg:grid-cols-2">
        <VizPanel
          title="Arrears by branch"
          subtitle="The money past 30 days, by office. Absolute amounts — this is the chart for deciding where to send a collections team."
          data={worst.slice(0, 12).map((r) => ({ label: r.label, par30Amount: r.par30Amount, overdue: r.overdue }))}
          series={[
            { key: "par30Amount", label: "PAR 30 balance", color: STATUS.critical },
            { key: "overdue", label: "Overdue amount", color: STATUS.warning },
          ]}
          forms={["bar", "column", "treemap"]}
          format="money"
          height={300}
        />
        <VizPanel
          title="PAR rate by product"
          subtitle="As a share of each product's own book, so a small bad product is not hidden behind a large good one."
          data={[...byProduct].sort((a, b) => b.par30 - a.par30).slice(0, 10).map((r) => ({ label: r.label, par30: r.par30 }))}
          series={[{ key: "par30", label: "PAR 30", format: "percent", color: STATUS.critical }]}
          forms={["bar", "column", "heatmap"]}
          format="percent"
          height={300}
          reference={{ value: now.par30, label: "book average" }}
          footnote="The dashed line is the book's own average, not a target — the products above it are the ones dragging it up."
        />
      </div>

      <Band label="Where it is about to" hint="The leading indicators" />
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="space-y-3">
          <Meter
            label="On-time repayment"
            value={now.onTimeRate ?? 0}
            format="percent"
            tone={now.onTimeRate != null && now.onTimeRate >= 85 ? STATUS.good : now.onTimeRate != null && now.onTimeRate >= 65 ? STATUS.warning : STATUS.critical}
            caption="Installments settled on or before the due date. Watch this, not PAR — by the time PAR moves, the money is already late."
          />
          <Meter
            label="Collection rate"
            value={now.collectionRate ?? 0}
            format="percent"
            tone={now.collectionRate != null && now.collectionRate >= 90 ? STATUS.good : now.collectionRate != null && now.collectionRate >= 70 ? STATUS.warning : STATUS.critical}
            caption={`${formatValue(now.collected, "money")} received against ${formatValue(now.dueInPeriod, "money")} due.`}
          />
          <Meter
            label="Share of book past 90 days"
            value={now.olb > 0 ? (now.nplAmount / now.olb) * 100 : 0}
            format="percent"
            tone={tone(now.olb > 0 ? (now.nplAmount / now.olb) * 100 : 0)}
            caption="Past 90 days is where most lenders stop expecting repayment and start expecting recovery."
          />
        </div>
        <div className="lg:col-span-2">
          <VizPanel
            title="Risk mix — the book by score band"
            subtitle="Outstanding balance against arrears, per internal risk band. If the Watch and High bands are growing as a share of the book, PAR follows them by about a quarter."
            data={byRisk.map((r) => ({
              label: r.label,
              clean: Math.max(0, r.olb - r.par30Amount),
              par30: r.par30Amount,
            }))}
            series={[
              { key: "clean", label: "Performing" },
              { key: "par30", label: "Past 30 days", color: STATUS.critical },
            ]}
            forms={["stackedColumn", "column", "bar"]}
            format="money"
            height={300}
            emptyHint="No scored borrowers with an open loan in this cut."
            footnote="Ordered Prime → High → Unscored. A risk ladder sorted by size is not a ladder."
          />
        </div>
      </div>

      <Band label="Is it a size problem?" hint="Whether the trouble tracks the ticket" />
      <VizPanel
        title="PAR by loan size band"
        subtitle="Which ticket sizes go bad. A rising line to the right says the credit policy is too generous at the top; a spike at the bottom usually means the small tickets are not being chased because they are not worth chasing."
        data={bySize.map((r) => ({ label: r.label, par30: r.par30, olb: r.olb }))}
        series={[{ key: "par30", label: "PAR 30", format: "percent", color: STATUS.critical }]}
        forms={["histogram", "column", "line"]}
        format="percent"
        height={260}
      />
    </StudioPage>
  );
}
