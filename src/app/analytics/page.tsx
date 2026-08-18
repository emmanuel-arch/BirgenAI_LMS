// ─────────────────────────────────────────────────────────────────────────────
// THE BOARD VIEW — the whole business on one screen, in the order it is asked
// about.
//
// A board meeting runs in a fixed sequence and it is always the same sequence:
// how big is the book, is it going bad, is money coming in, who is bringing it,
// and what are we selling. So that is the order of this page, top to bottom. It
// is not a grid of every chart we can draw — it is the agenda, rendered.
//
// EVERY NUMBER HERE IS COMPARED. A figure with no baseline is a fact, and a
// board does not need facts, it needs to know whether things got better. The
// previous period is resolved by ranges.ts and — for a to-date range — truncated
// to the same elapsed days, so the 9th of the month is compared with the first
// nine days of last month rather than all thirty-one of them.
// ─────────────────────────────────────────────────────────────────────────────
import Link from "next/link";
import { ArrowRight, TriangleAlert } from "lucide-react";
import { studioContext } from "@/lib/analytics/context";
import { headline, cube, timeSeries } from "@/lib/analytics/engine";
import { previousRange } from "@/lib/analytics/ranges";
import { delta, formatValue, measure } from "@/lib/analytics/cube";
import { StudioPage, Band } from "@/components/analytics/StudioPage";
import { VizPanel, StatTile, Meter } from "@/components/analytics/viz/VizPanel";
import { STATUS } from "@/components/analytics/viz/theme";
import type { SearchParams } from "@/lib/analytics/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AnalyticsOverview({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await studioContext(searchParams);
  const prev = previousRange(ctx.filters.range);

  const [now, before, series, byBranch, byProduct, byRisk] = await Promise.all([
    headline(ctx.orgId, ctx.filters),
    prev ? headline(ctx.orgId, { ...ctx.filters, range: prev }) : Promise.resolve(null),
    timeSeries(ctx.orgId, ctx.filters),
    cube(ctx.orgId, "branch", ctx.filters),
    cube(ctx.orgId, "product", ctx.filters),
    cube(ctx.orgId, "riskBand", ctx.filters),
  ]);

  const d = (cur: number | null, key: Parameters<typeof measure>[0]) => {
    const m = measure(key);
    const p = before ? (before as unknown as Record<string, number | null>)[key] ?? null : null;
    return delta(cur, p, m?.goodDirection ?? "neutral");
  };

  const compare = prev ? `vs ${prev.label.replace(/^vs /, "")}` : "";

  // The book's health, in one sentence, computed rather than templated. This is
  // the line a chair reads out; if it is wrong, everything under it is ignored.
  const verdict =
    now.olb === 0
      ? "There is no open book in this cut — widen the range or clear a filter."
      : now.par30 > 15
        ? `${now.par30.toFixed(1)}% of the book is more than 30 days overdue. That is ${formatValue(now.par30Amount, "money")} not being repaid on schedule, and it is the first thing on this page that needs a decision.`
        : now.par30 > 5
          ? `The book is ${formatValue(now.olb, "money")} with ${now.par30.toFixed(1)}% past 30 days — inside tolerance, worth watching.`
          : `The book is ${formatValue(now.olb, "money")} and ${(100 - now.par30).toFixed(1)}% of it is performing.`;

  return (
    <StudioPage
      title="The board view"
      blurb="Everything on one screen, in the order a board asks for it: how big the book is, whether it is going bad, whether money is coming in, and who is bringing it."
      range={ctx.filters.range}
      axes={ctx.axes}
      actions={
        <Link
          href="/analytics/explorer"
          className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3.5 py-2 text-[12px] font-semibold text-white hover:bg-zinc-800"
        >
          Build your own chart <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      }
    >
      {/* ── The one sentence ─────────────────────────────────────────────── */}
      <div
        className="mb-4 rounded-2xl border p-4 sm:p-5"
        style={{
          borderColor: now.par30 > 15 ? `${STATUS.critical}55` : now.par30 > 5 ? `${STATUS.warning}55` : `${STATUS.good}44`,
          backgroundColor: now.par30 > 15 ? `${STATUS.critical}0d` : now.par30 > 5 ? `${STATUS.warning}0d` : `${STATUS.good}0a`,
        }}
      >
        <div className="flex items-start gap-3">
          {now.par30 > 5 && <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" style={{ color: now.par30 > 15 ? STATUS.critical : STATUS.warning }} />}
          <p className="text-[15px] font-medium leading-snug text-zinc-800">{verdict}</p>
        </div>
      </div>

      {/* ── The headline numbers ─────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Outstanding book"
          value={now.olb}
          format="money"
          hero
          hint={measure("olb")?.definition}
          {...spread(d(now.olb, "olb"), compare)}
        />
        <StatTile label="Disbursed" value={now.disbursed} format="money" hint={measure("disbursed")?.definition} {...spread(d(now.disbursed, "disbursed"), compare)} />
        <StatTile label="Collected" value={now.collected} format="money" hint={measure("collected")?.definition} {...spread(d(now.collected, "collected"), compare)} />
        <StatTile label="PAR 30" value={now.par30} format="percent" hint={measure("par30")?.definition} {...spread(d(now.par30, "par30"), compare)} />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="New loans" value={now.newLoans} format="count" {...spread(d(now.newLoans, "newLoans"), compare)} />
        <StatTile label="Borrowers" value={now.borrowers} format="count" hint="Registered customers, all time." {...spread(d(now.borrowers, "borrowers"), compare)} />
        <StatTile label="Applications" value={now.applications} format="count" {...spread(d(now.applications, "applications"), compare)} />
        <StatTile
          label="Approval rate"
          value={now.approvalRate}
          format="percent"
          hint={measure("approvalRate")?.definition}
          {...spread(d(now.approvalRate, "approvalRate"), compare)}
        />
      </div>

      {/* ── Money ────────────────────────────────────────────────────────── */}
      <Band label="Money" hint="Out against in, over the period" />
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <VizPanel
            title="Disbursed against collected"
            subtitle="The two flows that decide whether the book grows or the cash does. When the blue line runs above the orange one, you are funding growth out of capital."
            data={series.map((s) => ({ label: s.label, disbursed: s.disbursed, collected: s.collected }))}
            series={[
              { key: "disbursed", label: "Disbursed" },
              { key: "collected", label: "Collected" },
            ]}
            forms={["line", "area", "column", "stackedArea"]}
            format="money"
            height={280}
          />
        </div>
        <div className="space-y-3">
          <Meter
            label="Collection rate"
            value={now.collectionRate ?? 0}
            format="percent"
            tone={now.collectionRate != null && now.collectionRate >= 90 ? STATUS.good : now.collectionRate != null && now.collectionRate >= 70 ? STATUS.warning : STATUS.critical}
            caption={`${formatValue(now.collected, "money")} received against ${formatValue(now.dueInPeriod, "money")} that fell due.`}
          />
          <Meter
            label="On-time repayment"
            value={now.onTimeRate ?? 0}
            format="percent"
            tone={now.onTimeRate != null && now.onTimeRate >= 85 ? STATUS.good : now.onTimeRate != null && now.onTimeRate >= 65 ? STATUS.warning : STATUS.critical}
            caption="Installments settled on or before their due date. The leading indicator — it moves before PAR does."
          />
          <Meter
            label="Repeat customers"
            value={now.repeatRate}
            format="percent"
            tone={now.repeatRate >= 40 ? STATUS.good : now.repeatRate >= 20 ? STATUS.warning : STATUS.critical}
            caption="Borrowers who came back for a second loan. The single best evidence the product works."
          />
        </div>
      </div>

      {/* ── Volume ───────────────────────────────────────────────────────── */}
      <Band label="Volume" hint="How much work went through the machine" />
      <div className="grid gap-3 lg:grid-cols-2">
        <VizPanel
          title="Applications, loans and clearances"
          subtitle="The funnel over time. A widening gap between applications and loans is either tightening credit or a queue that is not being worked."
          data={series.map((s) => ({ label: s.label, applications: s.applications, newLoans: s.newLoans, clearedLoans: s.clearedLoans }))}
          series={[
            { key: "applications", label: "Applications" },
            { key: "newLoans", label: "Loans booked" },
            { key: "clearedLoans", label: "Loans cleared" },
          ]}
          forms={["line", "column", "area", "stackedColumn"]}
          format="count"
        />
        <VizPanel
          title="Where the book sits"
          subtitle="Outstanding balance by branch. The bar is the money; the table beneath carries PAR so a big book and a bad one are told apart."
          data={topN(byBranch, "olb", 10).map((r) => ({ label: r.label, olb: r.olb, par30Amount: r.par30Amount }))}
          series={[
            { key: "olb", label: "Outstanding" },
            { key: "par30Amount", label: "of which PAR 30", color: STATUS.critical },
          ]}
          forms={["bar", "column", "stackedColumn", "treemap", "heatmap"]}
          format="money"
          emptyHint="No branch has an open book in this cut."
        />
      </div>

      {/* ── Quality ──────────────────────────────────────────────────────── */}
      <Band label="Quality" hint="Where the book is going wrong first" />
      <div className="grid gap-3 lg:grid-cols-2">
        <VizPanel
          title="Risk mix"
          subtitle="Outstanding balance by the internal score band each borrower carries. A book drifting toward Watch and High is a book that will show up in PAR next quarter."
          data={byRisk.map((r) => ({ label: r.label, olb: r.olb, par30: r.par30 }))}
          series={[{ key: "olb", label: "Outstanding", format: "money" }]}
          forms={["column", "donut", "bar", "treemap"]}
          format="money"
          emptyHint="No scored borrowers with an open loan in this cut."
          footnote="Ordered Prime → High → Unscored, never by size: a risk ladder sorted by value is not a ladder."
        />
        <VizPanel
          title="Product performance"
          subtitle="Volume lent against what is now past 30 days. The shelf that sells is not always the shelf that pays."
          data={topN(byProduct, "disbursed", 8).map((r) => ({ label: r.label, disbursed: r.disbursed, par30: r.par30 }))}
          series={[{ key: "disbursed", label: "Disbursed", format: "money" }]}
          forms={["bar", "column", "donut", "treemap"]}
          format="money"
          emptyHint="No product has lending in this period."
        />
      </div>

      <p className="mt-6 text-[11px] leading-snug text-zinc-400">
        Every figure on this page is aggregated in the database from the live tables, under the filters shown above, using
        the definitions in the metric catalogue — the same ones the lending console&apos;s tiles read. Where a number here
        and a number there disagree, one of them is a bug; there is no second arithmetic.
      </p>
    </StudioPage>
  );
}

/** Spread a delta onto a StatTile without repeating the three props each time. */
function spread(dl: ReturnType<typeof delta>, compareLabel: string) {
  return { deltaPct: dl.pct, deltaGood: dl.good, compareLabel };
}

/** The biggest N by a measure. A leaderboard of forty branches is a spreadsheet. */
function topN<T extends Record<string, unknown>>(rows: T[], key: keyof T, n: number): T[] {
  return [...rows].sort((a, b) => Number(b[key] ?? 0) - Number(a[key] ?? 0)).slice(0, n);
}
