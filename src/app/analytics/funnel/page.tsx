// ─────────────────────────────────────────────────────────────────────────────
// ORIGINATION FUNNEL — application to disbursement, and where it leaks.
//
// A funnel is only useful if it names the leak, so this one reports the DROP at
// each step rather than only the survivors. The difference matters: "68% approval
// rate" is a statistic, "one in three applications is declined and another one in
// six approved-but-never-disbursed" is two separate problems with two separate
// owners — credit policy owns the first, operations owns the second — and the
// second one is invisible on every funnel that only counts approvals.
// ─────────────────────────────────────────────────────────────────────────────
import { studioContext } from "@/lib/analytics/context";
import { headline, timeSeries, cube } from "@/lib/analytics/engine";
import { previousRange } from "@/lib/analytics/ranges";
import { delta, measure } from "@/lib/analytics/cube";
import { StudioPage, Band } from "@/components/analytics/StudioPage";
import { VizPanel, StatTile } from "@/components/analytics/viz/VizPanel";
import { ORDINAL, STATUS, inkOn } from "@/components/analytics/viz/theme";
import type { SearchParams } from "@/lib/analytics/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function FunnelPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await studioContext(searchParams);
  const prev = previousRange(ctx.filters.range);

  const [now, before, series, byProduct, byChannel] = await Promise.all([
    headline(ctx.scope, ctx.filters),
    prev ? headline(ctx.scope, { ...ctx.filters, range: prev }) : Promise.resolve(null),
    timeSeries(ctx.scope, ctx.filters),
    cube(ctx.scope, "product", ctx.filters),
    cube(ctx.scope, "channel", ctx.filters),
  ]);

  const sp = (key: Parameters<typeof measure>[0], v: number | null) => {
    const m = measure(key);
    const p = before ? (before as unknown as Record<string, number | null>)[key] ?? null : null;
    const dl = delta(v, p, m?.goodDirection ?? "neutral");
    return { deltaPct: dl.pct, deltaGood: dl.good, compareLabel: prev ? `vs ${prev.label.replace(/^vs /, "")}` : "" };
  };

  const undecided = Math.max(0, now.applications - now.approvals - now.declines);

  // The stages. An ordinal ramp — discrete ordered steps, one hue, darkening —
  // never a categorical palette: these are stages of one thing, not four things.
  const stages = [
    { label: "Applications received", value: now.applications, note: "Everything that came in through any channel." },
    { label: "Decided", value: now.approvals + now.declines, note: `${undecided.toLocaleString()} still in the queue.` },
    { label: "Approved", value: now.approvals, note: `${now.declines.toLocaleString()} declined.` },
    { label: "Disbursed", value: now.newLoans, note: "Approved AND the money actually left." },
  ];
  const top = Math.max(1, stages[0].value);

  return (
    <StudioPage
      title="Origination funnel"
      blurb="Application to disbursement, step by step — and the size of the leak at each one."
      range={ctx.filters.range}
      axes={ctx.axes}
      lenses={ctx.lenses}
      activeLenses={ctx.active.map((l) => l.id)}
      split={ctx.split}
      unavailable={ctx.unavailable}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Applications" value={now.applications} format="count" hero {...sp("applications", now.applications)} />
        <StatTile label="Approval rate" value={now.approvalRate} format="percent" hint={measure("approvalRate")?.definition} {...sp("approvalRate", now.approvalRate)} />
        <StatTile label="Loans booked" value={now.newLoans} format="count" {...sp("newLoans", now.newLoans)} />
        <StatTile
          label="Approved but not disbursed"
          value={Math.max(0, now.approvals - now.newLoans)}
          format="count"
          hint="Credit said yes and the money did not move. An operations problem, not a credit one — and invisible on a funnel that stops at approval."
        />
      </div>

      {/* ── The funnel itself ─────────────────────────────────────────────── */}
      <Band label="The funnel" hint="Survivors, and the drop at each step" />
      <div className="rounded-2xl border border-ash-900/10 bg-paper p-4 sm:p-5">
        <div className="space-y-2.5">
          {stages.map((s, i) => {
            const width = (s.value / top) * 100;
            const prevValue = i > 0 ? stages[i - 1].value : null;
            const dropped = prevValue != null ? prevValue - s.value : 0;
            const dropPct = prevValue && prevValue > 0 ? (dropped / prevValue) * 100 : 0;
            // Ordinal ramp — starts at step 250 so the first stage still clears
            // 2:1 against the surface rather than receding into the page.
            const fill = ORDINAL[Math.min(ORDINAL.length - 1, Math.round((i / Math.max(1, stages.length - 1)) * (ORDINAL.length - 1)))];
            return (
              <div key={s.label}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[12.5px] font-medium text-ash-800">{s.label}</span>
                  <span className="text-[12.5px] font-bold tabular-nums text-ash-900">{s.value.toLocaleString()}</span>
                </div>
                <div className="mt-1 flex h-7 items-center overflow-hidden rounded-lg bg-ash-900/[0.04]">
                  <div
                    className="flex h-full items-center rounded-r-[4px] px-2 transition-all duration-500"
                    style={{ width: `${Math.max(width, 4)}%`, backgroundColor: fill }}
                  >
                    {width > 22 && (
                      // The one sanctioned place text wears a fill colour's
                      // contrast partner rather than an ink token: inside a mark.
                      <span className="text-[10px] font-bold tabular-nums" style={{ color: inkOn(fill) }}>
                        {((s.value / top) * 100).toFixed(0)}% of applications
                      </span>
                    )}
                  </div>
                </div>
                <p className="mt-0.5 flex flex-wrap gap-x-2 text-[10.5px] text-ash-500">
                  <span>{s.note}</span>
                  {prevValue != null && dropped > 0 && (
                    <span className="font-semibold" style={{ color: dropPct > 40 ? STATUS.critical : STATUS.warning }}>
                      −{dropped.toLocaleString()} lost here ({dropPct.toFixed(0)}%)
                    </span>
                  )}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      <Band label="Over time" hint="Whether the leak is getting worse" />
      <VizPanel
        title="Applications against loans booked"
        subtitle="The two lines together. A widening gap is either credit tightening — which should be deliberate — or a queue that is not being worked, which is not."
        data={series.map((s) => ({ label: s.label, applications: s.applications, newLoans: s.newLoans }))}
        series={[
          { key: "applications", label: "Applications" },
          { key: "newLoans", label: "Loans booked" },
        ]}
        forms={["line", "column", "area"]}
        format="count"
        height={280}
      />

      <Band label="Where they come from" hint="Channel and product" />
      <div className="grid gap-3 lg:grid-cols-2">
        <VizPanel
          title="Loans by channel"
          subtitle="Portal, console, field or USSD. A loan booked at the counter with no application record is reported as Console rather than Unknown — which is what it is."
          data={byChannel.map((r) => ({ label: r.label, newLoans: r.newLoans, disbursed: r.disbursed }))}
          series={[{ key: "newLoans", label: "Loans booked", format: "count" }]}
          forms={["donut", "column", "bar", "treemap"]}
          format="count"
          emptyHint="No channel is recorded on loans in this cut."
        />
        <VizPanel
          title="Lending by product"
          subtitle="Which shelf the funnel actually feeds."
          data={[...byProduct].sort((a, b) => b.newLoans - a.newLoans).slice(0, 10).map((r) => ({ label: r.label, newLoans: r.newLoans, disbursed: r.disbursed }))}
          series={[
            { key: "newLoans", label: "Loans booked", format: "count" },
          ]}
          forms={["bar", "column", "treemap"]}
          format="count"
        />
      </div>

      <p className="mt-6 text-[11px] leading-snug text-ash-400">
        Approval rate excludes applications still in the queue. Including them makes the rate fall every time a busy week
        arrives, which is a property of the calendar rather than of the credit policy —{" "}
        {undecided.toLocaleString()} application{undecided === 1 ? " is" : "s are"} undecided in this cut.
      </p>
    </StudioPage>
  );
}
