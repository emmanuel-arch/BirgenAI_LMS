import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasFeature } from "@/lib/billing/entitlements";
import { portfolioEarlyWarning } from "@/lib/intelligence/earlywarning";
import { PrintButton } from "@/components/print/PrintButton";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
const num = (d: unknown) => Number(d ?? 0);
const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0);

export default async function PortfolioReport() {
  const session = await auth();
  if (!session?.user?.orgId) redirect("/login");
  const orgId = session.user.orgId;

  // PAR 30 is a standard portfolio metric and stays on every plan. The ranked
  // watchlist below it is the Premium early-warning engine, and does not.
  const scanEntitled = await hasFeature(orgId, "portfolio-scan");

  const monthStart = new Date(); monthStart.setHours(0, 0, 0, 0); monthStart.setDate(1);
  const par30Cutoff = new Date(Date.now() - 30 * 86400000);

  const [org, olbAgg, activeCount, disb, c2b, stk, appsByStatus, outcomes, borrowers, byProduct, products, ew] = await Promise.all([
    prisma.org.findUnique({ where: { id: orgId }, select: { name: true, slug: true, accent: true, mode: true } }),
    prisma.loan.aggregate({ where: { orgId, status: "ACTIVE" }, _sum: { balance: true } }),
    prisma.loan.count({ where: { orgId, status: "ACTIVE" } }),
    prisma.disbursement.aggregate({ where: { orgId, state: { in: ["CONFIRMED", "MANUAL_CONFIRMED"] }, updatedAt: { gte: monthStart } }, _sum: { amount: true }, _count: true }),
    prisma.c2BReceipt.aggregate({ where: { orgId, createdAt: { gte: monthStart } }, _sum: { amount: true } }),
    prisma.paymentIntent.aggregate({ where: { orgId, state: "SUCCESS", updatedAt: { gte: monthStart } }, _sum: { amount: true } }),
    prisma.loanApplication.groupBy({ by: ["status"], where: { orgId }, _count: true }),
    prisma.loanApplication.groupBy({ by: ["outcome"], where: { orgId }, _count: true }),
    prisma.borrower.count({ where: { orgId } }),
    prisma.loan.groupBy({ by: ["productId"], where: { orgId, status: "ACTIVE" }, _sum: { balance: true }, _count: true, orderBy: { _sum: { balance: "desc" } } }),
    prisma.product.findMany({ where: { orgId }, select: { id: true, name: true } }),
    portfolioEarlyWarning(orgId),
  ]);

  const olb = num(olbAgg._sum.balance);
  const collected = num(c2b._sum.amount) + num(stk._sum.amount);
  const appMap = new Map(appsByStatus.map((a) => [a.status as string, a._count]));
  const g = (k: string) => appMap.get(k) ?? 0;
  const waiting = g("SUBMITTED") + g("AI_PRESCREEN") + g("OFFICER_REVIEW") + g("REFERRED");
  const approved = g("APPROVED") + g("DISBURSED");
  const declined = g("DECLINED");
  const outMap = new Map(outcomes.map((o) => [o.outcome, o._count]));
  const repaid = outMap.get("REPAID") ?? 0, defaulted = outMap.get("DEFAULTED") ?? 0;
  const nameOf = new Map(products.map((p) => [p.id, p.name]));
  const par30 = pct(ew.tiles.atRiskValue, olb);

  const KPI = [
    { l: "Outstanding book", v: kes(olb), s: `${activeCount} active loans` },
    { l: "PAR 30", v: `${par30.toFixed(1)}%`, s: kes(ew.tiles.atRiskValue) },
    { l: "Disbursed MTD", v: kes(num(disb._sum.amount)), s: `${disb._count} loans` },
    { l: "Collected MTD", v: kes(collected), s: "paybill + STK" },
    { l: "Approval rate", v: `${pct(approved, approved + declined).toFixed(0)}%`, s: `${approved} approved` },
    { l: "Default rate", v: `${pct(defaulted, repaid + defaulted).toFixed(1)}%`, s: `${repaid} repaid · ${defaulted} defaulted` },
    { l: "Applications waiting", v: String(waiting), s: "awaiting decision" },
    { l: "Borrowers", v: String(borrowers), s: "on the book" },
  ];

  const asOf = new Date();

  return (
    <div className="min-h-screen bg-white text-zinc-900 print-doc">
      <div className="no-print border-b border-zinc-900/10 bg-white/80 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 h-14 flex items-center justify-between">
          <Link href="/console" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800"><ArrowLeft className="h-4 w-4" /> Console</Link>
          <PrintButton label="Download report" />
        </div>
      </div>

      <main className="mx-auto max-w-3xl px-4 sm:px-6 py-8 print-exact">
        <header className="flex items-start justify-between gap-4 border-b-2 pb-4" style={{ borderColor: org?.accent ?? "#000" }}>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl text-lg font-bold text-white" style={{ backgroundColor: org?.accent ?? "#000" }}>
              {org?.name.slice(0, 1)}
            </div>
            <div>
              <p className="text-base font-bold leading-tight">{org?.name}</p>
              <p className="text-[11px] text-zinc-500 leading-tight">{org?.slug}.birgenai.com · {org?.mode === "NATIVE" ? "Native book" : "Bridged"}</p>
            </div>
          </div>
          <div className="text-right">
            <h1 className="text-lg font-bold tracking-tight">PORTFOLIO REPORT</h1>
            <p className="text-[11px] text-zinc-500">As at {asOf.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</p>
          </div>
        </header>

        <section className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-2 print-break">
          {KPI.map((k) => (
            <div key={k.l} className="rounded-lg border border-zinc-900/10 px-2.5 py-2">
              <p className="text-[9px] uppercase tracking-wide text-zinc-500">{k.l}</p>
              <p className="text-sm font-bold" style={{ color: org?.accent }}>{k.v}</p>
              <p className="text-[9px] text-zinc-500">{k.s}</p>
            </div>
          ))}
        </section>

        <section className="mt-6 print-break">
          <h2 className="text-[11px] uppercase tracking-widest text-zinc-500">Book by product</h2>
          <table className="mt-2 w-full text-[11px]">
            <thead>
              <tr className="border-y border-zinc-900/10 text-zinc-500">
                <th className="py-1.5 text-left font-medium">Product</th>
                <th className="py-1.5 text-right font-medium">Loans</th>
                <th className="py-1.5 text-right font-medium">Outstanding</th>
                <th className="py-1.5 text-right font-medium">Share</th>
              </tr>
            </thead>
            <tbody>
              {byProduct.map((p) => (
                <tr key={p.productId} className="border-b border-zinc-900/5">
                  <td className="py-1.5 font-medium">{nameOf.get(p.productId) ?? "—"}</td>
                  <td className="py-1.5 text-right tabular-nums">{p._count}</td>
                  <td className="py-1.5 text-right tabular-nums">{kes(num(p._sum.balance))}</td>
                  <td className="py-1.5 text-right tabular-nums text-zinc-500">{pct(num(p._sum.balance), olb).toFixed(0)}%</td>
                </tr>
              ))}
              {byProduct.length === 0 && <tr><td colSpan={4} className="py-2 text-zinc-500">No active loans.</td></tr>}
            </tbody>
          </table>
        </section>

        {scanEntitled && (
        <section className="mt-6 print-break">
          <h2 className="text-[11px] uppercase tracking-widest text-zinc-500">
            Early-warning watchlist <span className="text-zinc-400">· {ew.rows.length} flagged · projected loss {kes(ew.tiles.projectedLoss)}</span>
          </h2>
          {ew.rows.length === 0 ? (
            <p className="mt-2 text-[12px] text-zinc-500">No active loan is showing early-warning signals.</p>
          ) : (
            <table className="mt-2 w-full text-[11px]">
              <thead>
                <tr className="border-y border-zinc-900/10 text-zinc-500">
                  <th className="py-1.5 text-left font-medium">Borrower</th>
                  <th className="py-1.5 text-left font-medium">Product</th>
                  <th className="py-1.5 text-right font-medium">DPD</th>
                  <th className="py-1.5 text-right font-medium">Risk</th>
                  <th className="py-1.5 text-right font-medium">Balance</th>
                  <th className="py-1.5 text-left font-medium pl-3">Recommended action</th>
                </tr>
              </thead>
              <tbody>
                {ew.rows.slice(0, 15).map((r) => (
                  <tr key={r.loanId} className="border-b border-zinc-900/5">
                    <td className="py-1.5 font-medium">{r.name}</td>
                    <td className="py-1.5 text-zinc-600">{r.product}</td>
                    <td className="py-1.5 text-right tabular-nums">{r.dpd}</td>
                    <td className={`py-1.5 text-right font-semibold ${r.band === "HIGH" ? "text-rose-700" : r.band === "ELEVATED" ? "text-amber-700" : "text-zinc-600"}`}>{r.riskScore} {r.band}</td>
                    <td className="py-1.5 text-right tabular-nums">{kes(r.balance)}</td>
                    <td className="py-1.5 text-zinc-600 pl-3">{r.action.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        )}

        <footer className="mt-8 border-t border-zinc-900/10 pt-3 text-[10px] leading-relaxed text-zinc-500">
          <p>Generated {asOf.toLocaleString("en-GB")} by {session.user.name ?? "staff"}. Figures reflect the loan book at the moment of issue.</p>
          <p className="mt-1">Powered by BirgenAI · lms.birgenai.com</p>
        </footer>
      </main>
    </div>
  );
}
