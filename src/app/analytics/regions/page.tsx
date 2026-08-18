// ─────────────────────────────────────────────────────────────────────────────
// REGIONS — the office tree rolled up one level.
//
// A "region" here is a branch's PARENT in the org tree, falling back to the
// branch itself where it has none. That is a deliberate two-level read rather
// than a recursive roll-up: every lender on this platform runs a region → branch
// shape, and a recursive CTE would answer a question nobody has asked while
// making the query considerably harder to reason about. A deeper tree rolls to
// its own parent, which is honest, and the branch screen is one click away.
//
// The two panels are deliberately the same money at two grains, side by side. A
// regional average is the easiest number in lending to be misled by: one office
// in serious trouble inside a large healthy region disappears completely.
// ─────────────────────────────────────────────────────────────────────────────
import { studioContext } from "@/lib/analytics/context";
import { cube } from "@/lib/analytics/engine";
import { rank, spread } from "@/lib/analytics/rank";
import { rankMetric, RANK_METRICS, type RankMetricKey } from "@/lib/analytics/cube";
import { StudioPage, Band } from "@/components/analytics/StudioPage";
import RankBoard from "@/components/analytics/RankBoard";
import { VizPanel } from "@/components/analytics/viz/VizPanel";
import type { SearchParams } from "@/lib/analytics/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function RegionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await studioContext(searchParams);
  const metricKey = (RANK_METRICS.some((m) => m.key === ctx.rank) ? ctx.rank : "book") as RankMetricKey;
  const metric = rankMetric(metricKey)!;

  const [rows, branches] = await Promise.all([
    cube(ctx.orgId, "region", ctx.filters),
    cube(ctx.orgId, "branch", ctx.filters),
  ]);
  const ranked = rank(rows, metricKey, ctx.top);

  return (
    <StudioPage
      title="Regions"
      blurb="The office tree rolled up. Where the business is concentrated, and which regions are carrying the risk."
      range={ctx.filters.range}
      axes={ctx.axes}
      showGrain={false}
    >
      <RankBoard
        rows={ranked}
        metricKey={metricKey}
        metricLabel={metric.label}
        formula={metric.formula}
        caveat={metric.caveat}
        question={metric.question}
        spreadNote={spread(ranked, "regions")}
        unitLabel="regions"
      />

      <Band label="Inside the regions" hint="Every office, so a regional average is never taken on trust" />
      <div className="grid gap-3 lg:grid-cols-2">
        <VizPanel
          title="Region by outstanding"
          subtitle="The roll-up. Read it against the office breakdown beside it — a healthy regional average can hide one office in serious trouble."
          data={rows.map((r) => ({ label: r.label, olb: r.olb, disbursed: r.disbursed }))}
          series={[
            { key: "olb", label: "Outstanding", format: "money" },
            { key: "disbursed", label: "Disbursed this period", format: "money" },
          ]}
          forms={["column", "bar", "radar"]}
          format="money"
          height={300}
        />
        <VizPanel
          title="Every office in the tree"
          subtitle="The same money, one level down. This is the check on the chart beside it."
          data={[...branches].sort((a, b) => b.olb - a.olb).slice(0, 20).map((r) => ({ label: r.label, olb: r.olb }))}
          series={[{ key: "olb", label: "Outstanding", format: "money" }]}
          forms={["heatmap", "bar", "treemap"]}
          format="money"
          height={300}
        />
      </div>
    </StudioPage>
  );
}
