// ─────────────────────────────────────────────────────────────────────────────
// ANALYTICS STUDIO — the book, drawn.
//
// Server-rendered from the live tables (the same aggregates the console's tiles
// and Riri's analyst quote — no second arithmetic to drift). The charts follow
// the house dataviz rules: one axis, thin marks, a legend the moment there are
// two series, categorical hues in FIXED order (sky, amber, emerald, violet,
// rose — validated for CVD separation and contrast), sequential = one hue,
// values in ink not in series color, and every chart has a table beneath it —
// a chart you cannot check is a chart you should not act on.
// ─────────────────────────────────────────────────────────────────────────────
import { redirect } from "next/navigation";
import Link from "next/link";
import { LineChart, Landmark, Users, Package, ArrowRight, FileBarChart } from "lucide-react";
import { auth } from "@/lib/auth";
import { hasReportAccess } from "@/lib/rbac/authz";
import { prisma } from "@/lib/prisma";
import { portfolioTrend } from "@/lib/intelligence/portfolio";
import { PageHeader } from "@/components/shell/PageHeader";
import { AnalysisStudioCharts } from "@/components/dashboard/AnalysisStudioCharts";
import { resolveOrg } from "@/lib/tenancy";
import { getGroupBook, getGroupTrend } from "@/lib/analytics/group";
import { GroupBoard } from "@/components/analytics/GroupBoard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
const short = (n: number) => (Math.abs(n) >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : Math.abs(n) >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)));
const num = (d: unknown) => Number(d ?? 0);

// The validated categorical order (sky, amber, emerald, violet, rose). Series
// keep their hue when filters change — color follows the entity, never rank.
const CAT = { disbursed: "#0284c7", collected: "#059669" };

const WEEKS = 12;

export default async function AnalyticsPage() {
  const session = await auth();
  if (!session?.user?.orgId) redirect("/login");
  if (!(await hasReportAccess(session, "reports.analytics"))) redirect("/console");
  const orgId = session.user.orgId;

  // ── A BRIDGED LENDER'S ANALYTICS ARE THEIR OWN BOOK, NOT OURS ─────────────
  //
  // Everything below this branch aggregates OUR Postgres, which is right for a
  // native lender who originates through us and meaningless for a bridged one:
  // it would show Micromart the 162 applications we happen to have handled
  // instead of the 160,044 customers and Ksh 549m they actually run.
  //
  // So a connected bridged lender gets the group board — every entity on their
  // server, in the metric definitions their own dashboard uses. A bridged lender
  // whose connection is down falls through to the native view rather than to an
  // error: a studio that shows nothing teaches nothing.
  // The READ is wrapped, never the render: JSX inside a try/catch looks guarded
  // and is not, because React renders after this function returns and the catch
  // is long gone. So the group data is fetched here and the markup is built
  // outside — the same reason redirect() sits outside the try in the borrower
  // resolver.
  const tenant = await resolveOrg(session.user.orgSlug ?? "");
  let group: { book: Awaited<ReturnType<typeof getGroupBook>>; trend: Awaited<ReturnType<typeof getGroupTrend>>; name: string } | null = null;
  if (tenant?.mode === "BRIDGED" && tenant.bridgedReady && tenant.registry) {
    try {
      const [book, groupTrend, org] = await Promise.all([
        getGroupBook(tenant.registry),
        getGroupTrend(tenant.registry, 12),
        prisma.org.findUnique({ where: { id: orgId }, select: { name: true } }),
      ]);
      group = { book, trend: groupTrend, name: org?.name ?? "Group" };
    } catch {
      // Their database being unreachable falls through to the native view below,
      // which is empty for a bridged lender but is at least not an error page.
      group = null;
    }
  }

  if (group) {
    return (
      <main className="mx-auto max-w-6xl px-4 sm:px-6 py-6 sm:py-8">
        <PageHeader
          icon={LineChart}
          title="Portfolio analytics"
          subtitle="Every entity this lender runs, read live from their own system and reported in their own definitions — the same OLB, PQS and NPL their managers see on the ServiceSuite dashboard."
        />
        <div className="mt-5">
          <GroupBoard book={group.book} trend={group.trend} orgName={group.name} />
        </div>
      </main>
    );
  }

  const since = new Date(Date.now() - WEEKS * 7 * 86_400_000);
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

  const [activeLoans, borrowers, avgScore, disbursements, receipts, stk, loans, apps, products, staff, trend, overdue] = await Promise.all([
    prisma.loan.findMany({ where: { orgId, status: "ACTIVE" }, select: { balance: true, createdBy: true, productId: true } }),
    prisma.borrower.count({ where: { orgId } }),
    prisma.borrower.aggregate({ where: { orgId, creditScore: { not: null } }, _avg: { creditScore: true } }),
    prisma.disbursement.findMany({
      where: { orgId, state: { in: ["SENT", "CONFIRMED", "MANUAL_CONFIRMED"] }, createdAt: { gte: since } },
      select: { amount: true, createdAt: true },
    }),
    prisma.c2BReceipt.findMany({ where: { orgId, createdAt: { gte: since } }, select: { amount: true, createdAt: true, transId: true } }),
    prisma.paymentIntent.findMany({
      where: { orgId, state: "SUCCESS", createdAt: { gte: since } },
      select: { amount: true, createdAt: true, mpesaReceipt: true },
    }),
    prisma.loan.findMany({ where: { orgId }, select: { status: true, loanAmount: true, balance: true, createdBy: true, productId: true } }),
    prisma.loanApplication.groupBy({ by: ["productId", "status"], where: { orgId }, _count: true }),
    prisma.product.findMany({ where: { orgId }, select: { id: true, name: true } }),
    prisma.staffUser.findMany({ where: { orgId }, select: { id: true, firstName: true, otherName: true } }),
    portfolioTrend(orgId, 30),
    // PAR30: balance sitting on loans whose oldest overdue installment is >30 days old.
    prisma.installment.findMany({
      where: { orgId, status: "OVERDUE", dueDate: { lt: new Date(Date.now() - 30 * 86_400_000) } },
      select: { loanId: true, loan: { select: { balance: true, status: true } } },
    }),
  ]);

  // ── Analysis Studio: customer & repayment analytics (real tables) ─────────────
  const sixMoAgo = new Date(); sixMoAgo.setMonth(sixMoAgo.getMonth() - 5); sixMoAgo.setDate(1); sixMoAgo.setHours(0, 0, 0, 0);
  const [borrowersDetail, branchRows, retLoans, insts] = await Promise.all([
    prisma.borrower.findMany({ where: { orgId }, select: { dob: true, gender: true, riskBand: true, branchId: true } }),
    prisma.branch.findMany({ where: { orgId }, select: { id: true, name: true } }),
    prisma.loan.findMany({ where: { orgId }, select: { borrowerId: true, borrowDate: true } }),
    prisma.installment.findMany({ where: { orgId, dueDate: { gte: sixMoAgo } }, select: { dueDate: true, paidAt: true, status: true } }),
  ]);

  const ageOf = (dob: Date | null) => {
    if (!dob) return null;
    const t = new Date(); let a = t.getFullYear() - dob.getFullYear();
    const m = t.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && t.getDate() < dob.getDate())) a--;
    return a >= 0 && a < 130 ? a : null;
  };
  const AGE_BANDS: [string, number, number][] = [["18–24", 0, 24], ["25–34", 25, 34], ["35–44", 35, 44], ["45–54", 45, 54], ["55–64", 55, 64], ["65+", 65, 200]];
  const ageCounts = AGE_BANDS.map(([bucket]) => ({ bucket, count: 0 }));
  let ageSum = 0, ageN = 0;
  for (const b of borrowersDetail) { const a = ageOf(b.dob); if (a == null) continue; ageSum += a; ageN++; const idx = AGE_BANDS.findIndex(([, lo, hi]) => a >= lo && a <= hi); if (idx >= 0) ageCounts[idx].count++; }

  const genderMap = new Map<string, number>();
  for (const b of borrowersDetail) { const g = b.gender === "M" ? "Men" : b.gender === "F" ? "Women" : "Other"; genderMap.set(g, (genderMap.get(g) ?? 0) + 1); }
  const gender = ["Men", "Women", "Other"].filter((l) => genderMap.has(l)).map((l) => ({ label: l, count: genderMap.get(l)! }));

  const RISK_ORDER = ["PRIME", "STRONG", "WATCH", "HIGH"];
  const riskMap = new Map<string, number>();
  for (const b of borrowersDetail) { const r = b.riskBand && RISK_ORDER.includes(b.riskBand) ? b.riskBand : "Unscored"; riskMap.set(r, (riskMap.get(r) ?? 0) + 1); }
  const risk = [...RISK_ORDER, "Unscored"].filter((r) => riskMap.has(r)).map((band) => ({ band, count: riskMap.get(band)! }));

  const branchName = new Map(branchRows.map((b) => [b.id, b.name]));
  const regMap = new Map<string, number>();
  for (const b of borrowersDetail) { const n = b.branchId ? (branchName.get(b.branchId) ?? "—") : "Unassigned"; regMap.set(n, (regMap.get(n) ?? 0) + 1); }
  const regions = [...regMap.entries()].map(([name, customers]) => ({ name, customers })).sort((a, b) => b.customers - a.customers).slice(0, 8);

  const monthKey = (d: Date) => d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
  const monthsSeq: string[] = []; { const c = new Date(sixMoAgo); for (let i = 0; i < 6; i++) { monthsSeq.push(monthKey(c)); c.setMonth(c.getMonth() + 1); } }
  const repayMap = new Map(monthsSeq.map((m) => [m, { onTime: 0, late: 0, missed: 0 }]));
  for (const it of insts) {
    const row = repayMap.get(monthKey(it.dueDate)); if (!row) continue;
    if (it.status === "PAID") { if (it.paidAt && it.paidAt.getTime() <= it.dueDate.getTime() + 86_400_000) row.onTime++; else row.late++; }
    else if (it.status === "PARTIAL") row.late++;
    else if (it.status === "OVERDUE") row.missed++;
  }
  const repayment = monthsSeq.map((m) => ({ month: m, ...repayMap.get(m)! }));
  const totOnTime = repayment.reduce((s, m) => s + m.onTime, 0);
  const totSettled = repayment.reduce((s, m) => s + m.onTime + m.late + m.missed, 0);
  const onTimeRatePct = totSettled > 0 ? (totOnTime / totSettled) * 100 : null;

  const firstByBorrower = new Map<string, number>();
  for (const l of retLoans) { const t = l.borrowDate.getTime(); const cur = firstByBorrower.get(l.borrowerId); if (cur == null || t < cur) firstByBorrower.set(l.borrowerId, t); }
  const retMap = new Map(monthsSeq.map((m) => [m, { created: 0, returning: 0 }]));
  for (const l of retLoans) { const row = retMap.get(monthKey(l.borrowDate)); if (!row) continue; if (firstByBorrower.get(l.borrowerId) === l.borrowDate.getTime()) row.created++; else row.returning++; }
  const retention = monthsSeq.map((m) => ({ month: m, ...retMap.get(m)! }));
  const loanCountByBorrower = new Map<string, number>();
  for (const l of retLoans) loanCountByBorrower.set(l.borrowerId, (loanCountByBorrower.get(l.borrowerId) ?? 0) + 1);
  const withLoan = loanCountByBorrower.size, repeat = [...loanCountByBorrower.values()].filter((c) => c > 1).length;
  const repeatRatePct = withLoan > 0 ? (repeat / withLoan) * 100 : 0;

  const analysis = {
    age: ageCounts, gender, risk, regions, repayment, retention,
    headline: { customers: borrowers, avgAge: ageN > 0 ? Math.round(ageSum / ageN) : null, repeatRatePct, onTimeRatePct },
  };

  // ── KPIs ─────────────────────────────────────────────────────────────────────
  const olb = activeLoans.reduce((s, l) => s + num(l.balance), 0);
  const par30Loans = new Map<string, number>();
  for (const i of overdue) if (i.loan.status === "ACTIVE") par30Loans.set(i.loanId, num(i.loan.balance));
  const par30 = olb > 0 ? ([...par30Loans.values()].reduce((a, b) => a + b, 0) / olb) * 100 : 0;

  // Receipts + successful STK, deduped by M-Pesa receipt — an STK payment also
  // lands as a C2B confirmation, and counting it twice is the reconciliation
  // sin this platform exists to catch.
  const c2bRefs = new Set(receipts.map((r) => r.transId));
  const inflows: { amount: number; at: Date }[] = [
    ...receipts.map((r) => ({ amount: num(r.amount), at: r.createdAt })),
    ...stk.filter((s) => !s.mpesaReceipt || !c2bRefs.has(s.mpesaReceipt)).map((s) => ({ amount: num(s.amount), at: s.createdAt })),
  ];
  const collectedMonth = inflows.filter((r) => r.at >= monthStart).reduce((s, r) => s + r.amount, 0);
  const disbursedMonth = disbursements.filter((d) => d.createdAt >= monthStart).reduce((s, d) => s + num(d.amount), 0);

  // ── 12-week money flow ───────────────────────────────────────────────────────
  const weekIdx = (d: Date) => Math.min(WEEKS - 1, Math.max(0, Math.floor((d.getTime() - since.getTime()) / (7 * 86_400_000))));
  const flow = Array.from({ length: WEEKS }, (_, i) => ({
    label: new Date(since.getTime() + i * 7 * 86_400_000).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
    disbursed: 0, collected: 0,
  }));
  for (const d of disbursements) flow[weekIdx(d.createdAt)].disbursed += num(d.amount);
  for (const r of inflows) flow[weekIdx(r.at)].collected += r.amount;
  const flowMax = Math.max(1, ...flow.map((w) => Math.max(w.disbursed, w.collected)));

  // ── Best agents (the officer's OWN book — Loan.createdBy is the originator) ──
  const staffName = new Map(staff.map((s) => [s.id, `${s.firstName ?? ""} ${s.otherName ?? ""}`.trim() || "Staff"]));
  type AgentRow = { id: string; name: string; active: number; cleared: number; olb: number; par: number };
  const agentMap = new Map<string, AgentRow>();
  for (const l of loans) {
    const id = l.createdBy ?? "unassigned";
    const row = agentMap.get(id) ?? { id, name: id === "unassigned" ? "Unassigned" : staffName.get(id) ?? "Former staff", active: 0, cleared: 0, olb: 0, par: 0 };
    if (l.status === "ACTIVE") { row.active++; row.olb += num(l.balance); }
    if (l.status === "CLEARED") row.cleared++;
    agentMap.set(id, row);
  }
  // PAR per officer: overdue-30 balance attributed through the loan's originator.
  const loanOwner = new Map<string, string>();
  const allActive = await prisma.loan.findMany({ where: { orgId, status: "ACTIVE" }, select: { id: true, createdBy: true } });
  for (const l of allActive) loanOwner.set(l.id, l.createdBy ?? "unassigned");
  for (const [loanId, bal] of par30Loans) {
    const owner = loanOwner.get(loanId);
    if (!owner) continue;
    const row = agentMap.get(owner);
    if (row) row.par += bal;
  }
  const agents = [...agentMap.values()]
    .filter((a) => a.active + a.cleared > 0)
    .map((a) => ({ ...a, healthy: a.olb > 0 ? Math.max(0, 100 - (a.par / a.olb) * 100) : 100 }))
    .sort((a, b) => b.olb - a.olb)
    .slice(0, 8);
  const agentMaxOlb = Math.max(1, ...agents.map((a) => a.olb));

  // ── Product catalogue & popularity ───────────────────────────────────────────
  const productName = new Map(products.map((p) => [p.id, p.name]));
  type ProdRow = { id: string; name: string; apps: number; approved: number; declined: number; active: number; volume: number };
  const prodMap = new Map<string, ProdRow>();
  const prodRow = (id: string | null) => {
    const key = id ?? "unknown";
    const row = prodMap.get(key) ?? { id: key, name: productName.get(key ?? "") ?? "—", apps: 0, approved: 0, declined: 0, active: 0, volume: 0 };
    prodMap.set(key, row);
    return row;
  };
  for (const a of apps) {
    const row = prodRow(a.productId);
    row.apps += a._count;
    if (a.status === "APPROVED") row.approved += a._count;
    if (a.status === "DECLINED") row.declined += a._count;
  }
  for (const l of loans) {
    const row = prodRow(l.productId);
    row.volume += num(l.loanAmount);
    if (l.status === "ACTIVE") row.active++;
  }
  const prods = [...prodMap.values()].filter((p) => p.name !== "—" || p.apps > 0).sort((a, b) => b.volume - a.volume).slice(0, 8);
  const prodMax = Math.max(1, ...prods.map((p) => p.volume));

  const atRisk = trend.at(-1)?.atRiskPct ?? null;

  return (
    <main className="mx-auto max-w-5xl px-4 sm:px-6 py-8">
      <PageHeader
        icon={LineChart}
        title="Analytics Studio"
        subtitle="The book drawn from the live tables — money flow, the people moving it, and the products carrying it."
      >
        <Link href="/console/intelligence/reports" className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-800">
          <FileBarChart className="h-3.5 w-3.5" /> Build a report
        </Link>
      </PageHeader>

      {/* ── KPI strip ── */}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Outstanding (OLB)" value={kes(olb)} />
        <Kpi label="PAR 30" value={`${par30.toFixed(1)}%`} tone={par30 > 10 ? "text-rose-600" : par30 > 5 ? "text-amber-600" : "text-emerald-600"} />
        <Kpi label="Collected · month" value={kes(collectedMonth)} />
        <Kpi label="Disbursed · month" value={kes(disbursedMonth)} />
        <Kpi label="Borrowers" value={borrowers.toLocaleString()} />
        <Kpi label="Avg internal score" value={avgScore._avg.creditScore != null ? String(Math.round(avgScore._avg.creditScore)) : "—"} />
      </div>

      {/* ── Money flow: disbursed vs collected, 12 weeks, one axis ── */}
      <div className="glass mt-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><Landmark className="h-4 w-4" style={{ color: "var(--brand)" }} /> Money flow · last {WEEKS} weeks</h2>
          <div className="flex items-center gap-3 text-[10px] text-zinc-500">
            <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-[3px]" style={{ backgroundColor: CAT.disbursed }} /> Disbursed</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-[3px]" style={{ backgroundColor: CAT.collected }} /> Collected</span>
          </div>
        </div>
        <div className="mt-3 flex items-end gap-1.5" style={{ height: 128 }}>
          {flow.map((w) => (
            <div key={w.label} className="flex h-full flex-1 flex-col justify-end">
              <div className="flex flex-1 items-end justify-center gap-[2px]">
                <div className="w-1/3 max-w-3 rounded-t-[4px]" style={{ height: `${(w.disbursed / flowMax) * 100}%`, backgroundColor: CAT.disbursed }}
                  title={`${w.label} — disbursed ${kes(w.disbursed)}`} />
                <div className="w-1/3 max-w-3 rounded-t-[4px]" style={{ height: `${(w.collected / flowMax) * 100}%`, backgroundColor: CAT.collected }}
                  title={`${w.label} — collected ${kes(w.collected)}`} />
              </div>
              <p className="mt-1 truncate text-center text-[8px] text-zinc-400">{w.label}</p>
            </div>
          ))}
        </div>
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] text-zinc-400">The numbers behind the bars</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead><tr className="text-left text-zinc-500"><th className="py-1 pr-3 font-medium">Week of</th><th className="py-1 pr-3 text-right font-medium">Disbursed</th><th className="py-1 text-right font-medium">Collected</th></tr></thead>
              <tbody>
                {flow.map((w) => (
                  <tr key={w.label} className="border-t border-zinc-900/5">
                    <td className="py-1 pr-3 text-zinc-600">{w.label}</td>
                    <td className="py-1 pr-3 text-right tabular-nums text-zinc-700">{short(w.disbursed)}</td>
                    <td className="py-1 text-right tabular-nums text-zinc-700">{short(w.collected)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        {atRisk != null && (
          <p className="mt-2 text-[11px] text-zinc-500">
            Portfolio at risk is <span className="font-bold">{atRisk.toFixed(1)}%</span> as of the last batch score —{" "}
            <Link href="/console/intelligence/scoring" className="font-semibold underline" style={{ color: "var(--brand)" }}>work it backwards in Credit Scoring</Link>.
          </p>
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* ── Best agents ── */}
        <div className="glass p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><Users className="h-4 w-4" style={{ color: "var(--brand)" }} /> Officers, by book</h2>
          <p className="mt-0.5 text-[11px] text-zinc-500">Bar = outstanding book · the % is how much of it is performing (outside PAR 30).</p>
          <div className="mt-3 space-y-2.5">
            {agents.length === 0 && <p className="text-sm text-zinc-500">No originated loans yet.</p>}
            {agents.map((a) => (
              <div key={a.id}>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate font-medium text-zinc-700">{a.name}</span>
                  <span className="shrink-0 tabular-nums text-zinc-500">
                    {kes(a.olb)} · <span className={a.healthy >= 90 ? "font-bold text-emerald-600" : a.healthy >= 70 ? "font-bold text-amber-600" : "font-bold text-rose-600"}>{Math.round(a.healthy)}%</span>
                  </span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-zinc-900/[0.06]" title={`${a.name}: ${a.active} active · ${a.cleared} cleared · ${kes(a.par)} in PAR 30`}>
                  <div className="h-full rounded-r-[4px]" style={{ width: `${(a.olb / agentMaxOlb) * 100}%`, backgroundColor: "#0284c7" }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Product popularity ── */}
        <div className="glass p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><Package className="h-4 w-4" style={{ color: "var(--brand)" }} /> Products, by volume</h2>
          <p className="mt-0.5 text-[11px] text-zinc-500">Bar = lifetime volume lent · with demand and the approval rate beside it.</p>
          <div className="mt-3 space-y-2.5">
            {prods.length === 0 && <p className="text-sm text-zinc-500">No products with activity yet.</p>}
            {prods.map((p) => {
              const decided = p.approved + p.declined;
              return (
                <div key={p.id}>
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate font-medium text-zinc-700">{p.name}</span>
                    <span className="shrink-0 tabular-nums text-zinc-500">
                      {p.apps} apps{decided > 0 ? ` · ${Math.round((p.approved / decided) * 100)}% approved` : ""}
                    </span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-zinc-900/[0.06]" title={`${p.name}: ${kes(p.volume)} lent · ${p.active} active loans`}>
                    <div className="h-full rounded-r-[4px]" style={{ width: `${(p.volume / prodMax) * 100}%`, backgroundColor: "#059669" }} />
                  </div>
                </div>
              );
            })}
          </div>
          <Link href="/console/products" className="mt-3 inline-flex items-center gap-1 text-[11px] font-bold" style={{ color: "var(--brand)" }}>
            Open the product builder <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </div>

      {/* ── Customer & repayment analytics — cinematic, from the live tables ── */}
      <AnalysisStudioCharts data={analysis} />
    </main>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="glass px-3 py-2.5">
      <p className="text-[9px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={`text-sm font-bold leading-tight ${tone ?? "text-zinc-800"}`}>{value}</p>
    </div>
  );
}
