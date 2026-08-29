// ─────────────────────────────────────────────────────────────────────────────
// COHORTS — are the customers we take on now as good as the ones we took before?
//
// The most valuable analysis in lending and the one no incumbent ships, because
// it requires holding two dates at once: WHEN the loan was written, and how it
// has performed SINCE. Read as a single portfolio, a book whose March vintage is
// failing and whose September vintage is clean reports as "slightly
// deteriorating" — which gives nobody anything to do.
//
// ── THE MATURITY TRAP, HANDLED ───────────────────────────────────────────────
// A vintage written last month has had no time to go wrong; one written a year
// ago has had every opportunity. Comparing their PAR without saying so makes
// recent lending look brilliant every single month. So the age of each vintage
// is a column, young vintages are visibly marked as immature, and the chart is
// drawn over vintages old enough to have a verdict.
// ─────────────────────────────────────────────────────────────────────────────
import { studioContext } from "@/lib/analytics/context";
import { cohorts } from "@/lib/analytics/engine";
import { formatValue } from "@/lib/analytics/cube";
import { StudioPage, Band } from "@/components/analytics/StudioPage";
import { VizPanel } from "@/components/analytics/viz/VizPanel";
import { STATUS, seqAt, inkOn } from "@/components/analytics/viz/theme";
import type { SearchParams } from "@/lib/analytics/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Below this, a vintage has not had time to go wrong and its PAR means little. */
const MATURE_MONTHS = 3;

export default async function CohortsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await studioContext(searchParams);
  const rows = await cohorts(ctx.scope, 18);

  const mature = rows.filter((r) => r.ageMonths >= MATURE_MONTHS && r.openBalance > 0);
  const worstPar = Math.max(1, ...rows.map((r) => r.par30Pct));

  // The trend across mature vintages — is credit quality drifting, and which way?
  const half = Math.floor(mature.length / 2);
  const early = mature.slice(0, half);
  const late = mature.slice(half);
  const avg = (xs: typeof mature) => (xs.length ? xs.reduce((s, r) => s + r.par30Pct, 0) / xs.length : 0);
  const drift = mature.length >= 4 ? avg(late) - avg(early) : null;

  return (
    <StudioPage
      title="Cohorts"
      blurb="Each month's lending, followed forward. Whether the customers you take on now behave like the ones you took on before."
      range={ctx.filters.range}
      axes={ctx.axes}
      lenses={ctx.lenses}
      activeLenses={ctx.active.map((l) => l.id)}
      split={ctx.split}
      unavailable={ctx.unavailable}
      showGrain={false}
    >
      {drift != null && Math.abs(drift) > 1 && (
        <div
          className="mb-4 rounded-2xl border p-4"
          style={{
            borderColor: drift > 0 ? `${STATUS.critical}55` : `${STATUS.good}44`,
            backgroundColor: drift > 0 ? `${STATUS.critical}0d` : `${STATUS.good}0a`,
          }}
        >
          <p className="text-[13px] leading-snug text-zinc-800">
            {drift > 0 ? (
              <>
                Recent vintages are performing <strong>{drift.toFixed(1)} points worse</strong> than earlier ones
                ({avg(late).toFixed(1)}% PAR against {avg(early).toFixed(1)}%). Credit standards, pricing or the mix of
                who is being lent to has shifted — and the month it shifted is visible in the table below.
              </>
            ) : (
              <>
                Recent vintages are performing <strong>{Math.abs(drift).toFixed(1)} points better</strong> than earlier
                ones ({avg(late).toFixed(1)}% PAR against {avg(early).toFixed(1)}%). Whatever changed, it worked.
              </>
            )}
          </p>
        </div>
      )}

      <Band label="Vintage quality" hint={`Mature vintages only — ${MATURE_MONTHS} months or older`} />
      <VizPanel
        title="PAR 30 by origination month"
        subtitle="Each bar is one month's lending, judged on its own open balance. A rising line to the right means the book you are writing today is worse than the book you wrote a year ago."
        data={mature.map((r) => ({ label: r.label, par30Pct: r.par30Pct }))}
        series={[{ key: "par30Pct", label: "PAR 30 of that vintage", format: "percent", color: STATUS.critical }]}
        forms={["column", "line", "bar", "heatmap"]}
        format="percent"
        height={280}
        emptyHint={`No vintage is ${MATURE_MONTHS} months old yet with an open balance.`}
        footnote="Measured against each vintage's OWN open balance, never the whole book's — that is the only denominator that lets two vintages be compared."
      />

      <Band label="Vintage volume" hint="What each month actually wrote" />
      <div className="grid gap-3 lg:grid-cols-2">
        <VizPanel
          title="Lending by vintage"
          subtitle="Money out per origination month, with the customer intake behind it."
          data={rows.map((r) => ({ label: r.label, disbursed: r.disbursed, newBorrowers: r.newBorrowers }))}
          series={[
            { key: "disbursed", label: "Disbursed", format: "money" },
            { key: "newBorrowers", label: "New customers", format: "count" },
          ]}
          forms={["column", "line", "area"]}
          format="money"
          height={280}
        />
        <VizPanel
          title="How much of each vintage has cleared"
          subtitle="The share of that month's loans fully repaid. Older vintages should be near complete; where they are not, that money is still out there."
          data={rows.map((r) => ({ label: r.label, clearedPct: r.clearedPct }))}
          series={[{ key: "clearedPct", label: "Cleared", format: "percent", color: STATUS.good }]}
          forms={["column", "line", "heatmap"]}
          format="percent"
          height={280}
        />
      </div>

      {/* ── The matrix ───────────────────────────────────────────────────── */}
      <Band label="The vintage table" hint="Every month, every number" />
      <div className="overflow-x-auto rounded-2xl border border-zinc-900/10 bg-white">
        <table className="w-full min-w-[760px] text-[12px]">
          <thead>
            <tr className="border-b border-zinc-900/[0.07] text-left text-[10px] uppercase tracking-wide text-zinc-400">
              <th className="px-4 py-2.5 font-semibold">Vintage</th>
              <th className="px-3 py-2.5 text-right font-semibold">Age</th>
              <th className="px-3 py-2.5 text-right font-semibold">Loans</th>
              <th className="px-3 py-2.5 text-right font-semibold">New customers</th>
              <th className="px-3 py-2.5 text-right font-semibold">Disbursed</th>
              <th className="px-3 py-2.5 text-right font-semibold">Avg loan</th>
              <th className="px-3 py-2.5 text-right font-semibold">Cleared</th>
              <th className="px-3 py-2.5 text-right font-semibold">Still open</th>
              <th className="px-3 py-2.5 text-right font-semibold">PAR 30</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const immature = r.ageMonths < MATURE_MONTHS;
              // Sequential fill on the PAR cell — one hue, more is darker. This is
              // magnitude, not identity, so it must never be a categorical hue.
              const fill = r.openBalance > 0 ? seqAt(r.par30Pct / worstPar) : "transparent";
              return (
                <tr key={r.cohort} className={`border-b border-zinc-900/[0.04] last:border-0 ${immature ? "opacity-55" : ""}`}>
                  <td className="px-4 py-2 font-medium text-zinc-800">
                    {r.label}
                    {immature && (
                      <span className="ml-1.5 rounded bg-zinc-900/[0.07] px-1 py-0.5 text-[8px] font-bold uppercase text-zinc-500" title="Too young for its arrears figure to mean anything">
                        immature
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-500">{r.ageMonths}mo</td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-700">{r.loans.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-700">{r.newBorrowers.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-700">{formatValue(r.disbursed, "money", { compact: true })}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-700">{formatValue(r.avgLoanSize, "money", { compact: true })}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-700">{r.clearedPct.toFixed(0)}%</td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-700">{formatValue(r.openBalance, "money", { compact: true })}</td>
                  <td className="px-3 py-2 text-right">
                    {r.openBalance > 0 ? (
                      <span
                        className="inline-block rounded px-1.5 py-0.5 text-[11px] font-bold tabular-nums"
                        style={{ backgroundColor: fill, color: inkOn(fill) }}
                      >
                        {r.par30Pct.toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-zinc-300">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-zinc-500">
                  No lending in the last 18 months to build vintages from.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[11px] leading-snug text-zinc-400">
        Vintages under {MATURE_MONTHS} months old are dimmed and marked. Their arrears figure is not wrong, it is just too
        early to mean anything — a loan written six weeks ago has not had the opportunity to be ninety days late, and a
        chart that ranks it against a year-old vintage makes recent lending look brilliant every single month.
      </p>
    </StudioPage>
  );
}
