// ─────────────────────────────────────────────────────────────────────────────
// CHANNELS — portal, console, field and USSD, compared.
//
// The question behind this screen is a capital-allocation one: a loan originated
// through the customer portal costs almost nothing to acquire and a loan
// originated by an officer in the field costs a salary and a motorbike. If the
// portal's book performs as well as the field's, the field is being funded out
// of habit. If it performs worse, the portal needs a harder credit gate before
// it is scaled. Either finding is worth more than the chart that produced it.
// ─────────────────────────────────────────────────────────────────────────────
import { studioContext } from "@/lib/analytics/context";
import { cube } from "@/lib/analytics/engine";
import { formatValue } from "@/lib/analytics/cube";
import { StudioPage, Band } from "@/components/analytics/StudioPage";
import { VizPanel, StatTile } from "@/components/analytics/viz/VizPanel";
import { STATUS } from "@/components/analytics/viz/theme";
import type { SearchParams } from "@/lib/analytics/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ChannelsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await studioContext(searchParams);
  const rows = await cube(ctx.orgId, "channel", ctx.filters);

  const total = rows.reduce((s, r) => s + r.disbursed, 0);
  const best = [...rows].filter((r) => r.olb > 0).sort((a, b) => a.par30 - b.par30)[0];
  const worst = [...rows].filter((r) => r.olb > 0).sort((a, b) => b.par30 - a.par30)[0];

  return (
    <StudioPage
      title="Channels"
      blurb="Where loans come from, and whether the cheap channels perform as well as the expensive ones."
      range={ctx.filters.range}
      axes={ctx.axes}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {rows.slice(0, 4).map((r) => (
          <StatTile
            key={r.key}
            label={r.label}
            value={r.disbursed}
            format="money"
            hint={`${r.newLoans.toLocaleString()} loans · ${r.par30.toFixed(1)}% PAR 30`}
          />
        ))}
      </div>

      {best && worst && best.key !== worst.key && (
        <div className="mt-3 rounded-2xl border border-zinc-900/10 bg-white p-4">
          <p className="text-[13px] leading-snug text-zinc-700">
            <strong>{best.label}</strong> produces the cleanest book at {best.par30.toFixed(1)}% PAR 30;{" "}
            <strong>{worst.label}</strong> the worst at {worst.par30.toFixed(1)}%. That gap of{" "}
            {(worst.par30 - best.par30).toFixed(1)} points is a credit-gate difference, an acquisition-quality difference,
            or both — and it is worth knowing which before either channel is scaled.
          </p>
        </div>
      )}

      <Band label="Volume" hint="Where the lending actually originates" />
      <div className="grid gap-3 lg:grid-cols-2">
        <VizPanel
          title="Lending by channel"
          subtitle={`${formatValue(total, "money")} across ${rows.length} channel${rows.length === 1 ? "" : "s"} in this period.`}
          data={rows.map((r) => ({ label: r.label, disbursed: r.disbursed, newLoans: r.newLoans }))}
          series={[{ key: "disbursed", label: "Disbursed", format: "money" }]}
          forms={["donut", "column", "bar", "treemap"]}
          format="money"
          height={280}
          emptyHint="No channel is recorded against loans in this cut."
        />
        <VizPanel
          title="Quality by channel"
          subtitle="PAR 30 as a share of each channel's own book. The chart that decides whether a cheap channel is actually cheap."
          data={rows.map((r) => ({ label: r.label, par30: r.par30 }))}
          series={[{ key: "par30", label: "PAR 30", format: "percent", color: STATUS.critical }]}
          forms={["column", "bar", "radar"]}
          format="percent"
          height={280}
        />
      </div>

      <Band label="Behaviour" hint="What each channel writes" />
      <VizPanel
        title="Ticket size and volume by channel"
        subtitle="A channel writing many small loans and one writing few large ones need entirely different collections operations behind them."
        data={rows.map((r) => ({ label: r.label, avgLoanSize: r.avgLoanSize, newLoans: r.newLoans }))}
        series={[
          { key: "avgLoanSize", label: "Average loan", format: "money" },
          { key: "newLoans", label: "Loans booked", format: "count" },
        ]}
        forms={["column", "bar", "radar"]}
        format="money"
        height={260}
        footnote="Two measures on one axis: money and counts share a scale here, so compare the shapes across channels rather than the two bars against each other."
      />
    </StudioPage>
  );
}
