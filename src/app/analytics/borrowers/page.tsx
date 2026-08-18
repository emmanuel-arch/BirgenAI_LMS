// ─────────────────────────────────────────────────────────────────────────────
// BORROWERS — who your customers actually are.
//
// Demographics are the section every incumbent renders as three static pie
// charts nobody looks at twice, and the reason nobody looks is that the charts
// are never crossed with anything. "62% men" is trivia. "Men take 71% of the
// money and carry 84% of the arrears" is a credit policy conversation.
//
// So every panel here plots a demographic axis against a MONEY or QUALITY
// measure, not against a headcount. The headcount is in the table underneath.
// ─────────────────────────────────────────────────────────────────────────────
import { studioContext } from "@/lib/analytics/context";
import { headline, cube } from "@/lib/analytics/engine";
import { previousRange } from "@/lib/analytics/ranges";
import { delta, formatValue, measure } from "@/lib/analytics/cube";
import { StudioPage, Band } from "@/components/analytics/StudioPage";
import { VizPanel, StatTile } from "@/components/analytics/viz/VizPanel";
import { STATUS } from "@/components/analytics/viz/theme";
import type { SearchParams } from "@/lib/analytics/params";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function BorrowersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await studioContext(searchParams);
  const prev = previousRange(ctx.filters.range);

  const [now, before, byAge, byGender, byRisk, byKyc] = await Promise.all([
    headline(ctx.orgId, ctx.filters),
    prev ? headline(ctx.orgId, { ...ctx.filters, range: prev }) : Promise.resolve(null),
    cube(ctx.orgId, "ageBand", ctx.filters),
    cube(ctx.orgId, "gender", ctx.filters),
    cube(ctx.orgId, "riskBand", ctx.filters),
    cube(ctx.orgId, "kycStatus", ctx.filters),
  ]);

  const sp = (key: Parameters<typeof measure>[0], v: number | null) => {
    const m = measure(key);
    const p = before ? (before as unknown as Record<string, number | null>)[key] ?? null : null;
    const dl = delta(v, p, m?.goodDirection ?? "neutral");
    return { deltaPct: dl.pct, deltaGood: dl.good, compareLabel: prev ? `vs ${prev.label.replace(/^vs /, "")}` : "" };
  };

  // The crossing that makes the demographics worth reading: which group takes
  // the money and which group carries the arrears, as shares of each total.
  const totalOlb = byGender.reduce((s, r) => s + r.olb, 0);
  const totalPar = byGender.reduce((s, r) => s + r.par30Amount, 0);
  const genderCross = byGender.map((r) => ({
    label: r.label,
    shareOfBook: totalOlb > 0 ? (r.olb / totalOlb) * 100 : 0,
    shareOfArrears: totalPar > 0 ? (r.par30Amount / totalPar) * 100 : 0,
  }));

  return (
    <StudioPage
      title="Borrowers"
      blurb="Who your customers are — and, more usefully, which of them the money and the risk are actually with."
      range={ctx.filters.range}
      axes={ctx.axes}
      showGrain={false}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Customers" value={now.borrowers} format="count" hero {...sp("borrowers", now.borrowers)} />
        <StatTile label="New this period" value={now.newBorrowers} format="count" {...sp("newBorrowers", now.newBorrowers)} />
        <StatTile label="Repeat rate" value={now.repeatRate} format="percent" hint={measure("repeatRate")?.definition} {...sp("repeatRate", now.repeatRate)} />
        <StatTile label="Average score" value={now.avgScore} format="score" hint={measure("avgScore")?.definition} {...sp("avgScore", now.avgScore)} />
      </div>

      <Band label="Who has the money" hint="Demographics crossed with the book, not with headcount" />
      <div className="grid gap-3 lg:grid-cols-2">
        <VizPanel
          title="Book by age band"
          subtitle="Outstanding balance by the borrower's age. The shape of who your lending actually serves — which is usually not the shape of who walks through the door."
          data={byAge.map((r) => ({ label: r.label, olb: r.olb, borrowers: r.borrowers }))}
          series={[{ key: "olb", label: "Outstanding", format: "money" }]}
          forms={["histogram", "column", "bar"]}
          format="money"
          height={280}
          footnote="Ordered youngest to oldest, always — a distribution sorted by value is not a distribution."
        />
        <VizPanel
          title="Share of book against share of arrears"
          subtitle="Two percentages per group. Where the second bar is taller than the first, that group is carrying more of the risk than of the money — the only demographic finding that is actually actionable."
          data={genderCross.map((g) => ({ label: g.label, book: g.shareOfBook, arrears: g.shareOfArrears }))}
          series={[
            { key: "book", label: "Share of book", format: "percent" },
            { key: "arrears", label: "Share of arrears", format: "percent", color: STATUS.critical },
          ]}
          forms={["column", "bar", "radar"]}
          format="percent"
          height={280}
          emptyHint="No gender is recorded against borrowers with an open loan in this cut."
        />
      </div>

      <Band label="Composition" hint="The raw mix" />
      <div className="grid gap-3 lg:grid-cols-3">
        <VizPanel
          title="Risk bands"
          subtitle="Customers by internal score band."
          data={byRisk.map((r) => ({ label: r.label, borrowers: r.borrowers }))}
          series={[{ key: "borrowers", label: "Customers", format: "count" }]}
          forms={["column", "donut", "bar"]}
          format="count"
        />
        <VizPanel
          title="Gender"
          subtitle="As recorded on the customer file."
          data={byGender.map((r) => ({ label: r.label, borrowers: r.borrowers }))}
          series={[{ key: "borrowers", label: "Customers", format: "count" }]}
          forms={["donut", "column", "bar"]}
          format="count"
        />
        <VizPanel
          title="KYC status"
          subtitle="How far each customer got through verification. A large unverified tail is a compliance exposure and a disbursement bottleneck at the same time."
          data={byKyc.map((r) => ({ label: r.label, borrowers: r.borrowers }))}
          series={[{ key: "borrowers", label: "Customers", format: "count" }]}
          forms={["column", "bar", "donut"]}
          format="count"
        />
      </div>

      <Band label="Value" hint="What each group is worth" />
      <VizPanel
        title="Average loan size by age band"
        subtitle="How much each cohort actually borrows. A flat line means the credit policy is not differentiating; a steep one means it is — and the risk chart above says whether it should be."
        data={byAge.map((r) => ({ label: r.label, avgLoanSize: r.avgLoanSize, par30: r.par30 }))}
        series={[{ key: "avgLoanSize", label: "Average loan", format: "money" }]}
        forms={["histogram", "column", "line"]}
        format="money"
        height={260}
        footnote={`Book average is ${formatValue(now.avgLoanSize, "money")}.`}
      />
    </StudioPage>
  );
}
