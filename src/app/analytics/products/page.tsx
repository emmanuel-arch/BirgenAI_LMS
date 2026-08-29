// ─────────────────────────────────────────────────────────────────────────────
// PRODUCTS — which shelf sells, and which one comes back bad.
//
// Those are different products more often than anybody expects, and putting the
// two facts on one screen is the whole value here. A product ranked first on
// volume and last on quality is not a success with a problem; it is a pricing
// error that has been running long enough to look like a success.
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

export default async function ProductsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await studioContext(searchParams);
  const metricKey = (RANK_METRICS.some((m) => m.key === ctx.rank) ? ctx.rank : "growth") as RankMetricKey;
  const metric = rankMetric(metricKey)!;

  const rows = await cube(ctx.scope, "product", ctx.filters);
  const ranked = rank(rows, metricKey, ctx.top);

  // The disagreement: a product high on volume and low on quality. Naming it is
  // more useful than any chart on the page.
  const byVolume = [...rows].filter((r) => r.disbursed > 0).sort((a, b) => b.disbursed - a.disbursed);
  const byQuality = [...rows].filter((r) => r.olb > 0).sort((a, b) => a.par30 - b.par30);
  const topSeller = byVolume[0];
  const sellerQualityRank = topSeller ? byQuality.findIndex((r) => r.key === topSeller.key) + 1 : 0;
  const disagreement =
    topSeller && byQuality.length >= 3 && sellerQualityRank > byQuality.length / 2
      ? `${topSeller.label} is your biggest seller (${formatValue(topSeller.disbursed, "money")} lent) and ranks ${sellerQualityRank} of ${byQuality.length} on quality at ${topSeller.par30.toFixed(1)}% PAR 30. Volume and quality are pointing in opposite directions on the same shelf.`
      : null;

  return (
    <StudioPage
      title="Products"
      blurb="Which shelf sells, and which one comes back bad. They are rarely the same one."
      range={ctx.filters.range}
      axes={ctx.axes}
      lenses={ctx.lenses}
      activeLenses={ctx.active.map((l) => l.id)}
      split={ctx.split}
      unavailable={ctx.unavailable}
      showGrain={false}
    >
      {disagreement && (
        <div className="mb-3 rounded-2xl border p-4" style={{ borderColor: `${STATUS.warning}55`, backgroundColor: `${STATUS.warning}0d` }}>
          <p className="text-[13px] leading-snug text-zinc-800">{disagreement}</p>
        </div>
      )}

      <RankBoard
        rows={ranked}
        metricKey={metricKey}
        metricLabel={metric.label}
        formula={metric.formula}
        caveat={metric.caveat}
        question={metric.question}
        spreadNote={spread(ranked, "products")}
        unitLabel="products"
      />

      <Band label="Volume against quality" hint="The two facts, side by side" />
      <div className="grid gap-3 lg:grid-cols-2">
        <VizPanel
          title="Does the popular product pay?"
          subtitle="Each dot is a product: money lent across, PAR 30 balance up. Anything in the top right sells well and comes back badly — the most expensive shape a shelf can have."
          data={rows.map((r) => ({ label: r.label, disbursed: r.disbursed, par30Amount: r.par30Amount, newLoans: r.newLoans }))}
          series={[
            { key: "disbursed", label: "Disbursed", format: "money" },
            { key: "par30Amount", label: "PAR 30 balance", format: "money" },
            { key: "newLoans", label: "Loans", format: "count" },
          ]}
          forms={["scatter"]}
          format="money"
          height={300}
          emptyHint="No product has lending in this cut."
        />
        <VizPanel
          title="Book by product, with the late part shown"
          subtitle="Outstanding balance stacked with its overdue portion. Read the proportion, not the height."
          data={[...rows].sort((a, b) => b.olb - a.olb).slice(0, 10).map((r) => ({
            label: r.label,
            clean: Math.max(0, r.olb - r.par30Amount),
            par30: r.par30Amount,
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

      <Band label="Shape of each shelf" hint="Ticket size and demand" />
      <div className="grid gap-3 lg:grid-cols-2">
        <VizPanel
          title="Average ticket by product"
          subtitle="What each product is actually used for. Two products with the same name and very different average tickets are two products."
          data={[...rows].filter((r) => r.avgLoanSize > 0).sort((a, b) => b.avgLoanSize - a.avgLoanSize).map((r) => ({ label: r.label, avgLoanSize: r.avgLoanSize }))}
          series={[{ key: "avgLoanSize", label: "Average loan", format: "money" }]}
          forms={["bar", "column"]}
          format="money"
          height={280}
        />
        <VizPanel
          title="Demand"
          subtitle="Loans booked per product in this period."
          data={[...rows].sort((a, b) => b.newLoans - a.newLoans).slice(0, 10).map((r) => ({ label: r.label, newLoans: r.newLoans }))}
          series={[{ key: "newLoans", label: "Loans booked", format: "count" }]}
          forms={["treemap", "bar", "donut", "column"]}
          format="count"
          height={280}
        />
      </div>
    </StudioPage>
  );
}
