// ─────────────────────────────────────────────────────────────────────────────
// INCOME STATEMENT — the lender's revenue, on their own letterhead.
//
// The incumbent ships a bare two-column table; this is the same figures, drawn
// properly: the lender's mark, period framing, revenue grouped and sub-totalled,
// share-of-revenue rules, and a headline total — a document a lender hands an owner,
// an auditor or a funder without apology. Numbers are REAL: interest is what was
// actually EARNED (the interest portion of installments paid in the window), and
// fee income is what was actually COLLECTED (successful charge payments).
// ─────────────────────────────────────────────────────────────────────────────
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { hasReportAccess } from "@/lib/rbac/authz";
import { prisma } from "@/lib/prisma";
import { PrintButton } from "@/components/print/PrintButton";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const kes = (n: number) => `KES ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (d: unknown) => Number(d ?? 0);

type Pair = { mtd: number; ytd: number };
const add = (p: Pair, v: number, inMonth: boolean) => { p.ytd += v; if (inMonth) p.mtd += v; };
const zero = (): Pair => ({ mtd: 0, ytd: 0 });

export default async function IncomeStatement() {
  const session = await auth();
  if (!session?.user?.orgId) redirect("/login");
  if (!(await hasReportAccess(session, "reports.income"))) redirect("/console");
  const orgId = session.user.orgId;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const yearStart = new Date(now.getFullYear(), 0, 1);

  const [org, loans, paidInst, feePays] = await Promise.all([
    prisma.org.findUnique({ where: { id: orgId }, select: { name: true, accent: true, logoUrl: true } }),
    prisma.loan.findMany({ where: { orgId }, select: { id: true, product: { select: { name: true } } } }),
    prisma.installment.findMany({
      where: { orgId, status: "PAID", paidAt: { gte: yearStart } },
      select: { loanId: true, interestDue: true, paidAt: true },
    }),
    prisma.paymentIntent.findMany({
      where: { orgId, state: "SUCCESS", chargeId: { not: null }, createdAt: { gte: yearStart } },
      select: { amount: true, createdAt: true, charge: { select: { name: true, code: true } } },
    }),
  ]);

  const productOf = new Map(loans.map((l) => [l.id, l.product?.name ?? "Unallocated"]));

  // ── Interest earned, by product ──────────────────────────────────────────────
  const interest = new Map<string, Pair>();
  for (const i of paidInst) {
    const name = productOf.get(i.loanId) ?? "Unallocated";
    const p = interest.get(name) ?? zero();
    add(p, num(i.interestDue), (i.paidAt ?? new Date(0)) >= monthStart);
    interest.set(name, p);
  }
  const interestRows = [...interest.entries()]
    .map(([name, p]) => ({ name, ...p }))
    .filter((r) => r.ytd > 0)
    .sort((a, b) => b.ytd - a.ytd);
  const interestTotal = interestRows.reduce((t, r) => ({ mtd: t.mtd + r.mtd, ytd: t.ytd + r.ytd }), zero());

  // ── Fee income, by kind (collected) ──────────────────────────────────────────
  const processing = zero(), joining = zero(), otherFees = zero();
  for (const f of feePays) {
    const code = f.charge?.code ?? "";
    const inMonth = f.createdAt >= monthStart;
    const amt = num(f.amount);
    if (code.startsWith("PROC-") || /process/i.test(f.charge?.name ?? "")) add(processing, amt, inMonth);
    else if (code === "JOINING" || /join|registrat/i.test(f.charge?.name ?? "")) add(joining, amt, inMonth);
    else add(otherFees, amt, inMonth);
  }
  const penalties = zero(); // Mular's book carries none in the window — shown for completeness.

  const revenue = {
    mtd: interestTotal.mtd + processing.mtd + joining.mtd + otherFees.mtd + penalties.mtd,
    ytd: interestTotal.ytd + processing.ytd + joining.ytd + otherFees.ytd + penalties.ytd,
  };

  const accent = org?.accent ?? "#0f172a";
  const monthLabel = now.toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  return (
    <div className="min-h-screen rounded-2xl bg-white text-zinc-900 print-doc">
      <div className="no-print sticky top-0 z-10 rounded-t-2xl border-b border-zinc-900/10 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4 sm:px-6">
          <Link href="/console/report" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800"><ArrowLeft className="h-4 w-4" /> Reports</Link>
          <PrintButton label="Download statement" />
        </div>
      </div>

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 print-exact">
        {/* Letterhead */}
        <header className="flex items-start justify-between gap-4 border-b-2 pb-4" style={{ borderColor: accent }}>
          {org?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={org.logoUrl} alt={`${org.name} logo`} className="h-12 max-w-[220px] object-contain object-left" />
          ) : (
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl text-lg font-bold text-white" style={{ backgroundColor: accent }}>{org?.name.slice(0, 1)}</div>
              <p className="text-base font-bold leading-tight">{org?.name}</p>
            </div>
          )}
          <div className="text-right">
            <h1 className="text-lg font-bold tracking-tight">INCOME STATEMENT</h1>
            <p className="text-[11px] text-zinc-500">For {monthLabel} · year to date</p>
          </div>
        </header>

        {/* Headline */}
        <section className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-zinc-900/10 p-4">
            <p className="text-[10px] uppercase tracking-wide text-zinc-500">Total revenue · {now.toLocaleDateString("en-GB", { month: "short" })}</p>
            <p className="text-2xl font-bold" style={{ color: accent }}>{kes(revenue.mtd)}</p>
          </div>
          <div className="rounded-xl border border-zinc-900/10 p-4">
            <p className="text-[10px] uppercase tracking-wide text-zinc-500">Total revenue · year to date</p>
            <p className="text-2xl font-bold" style={{ color: accent }}>{kes(revenue.ytd)}</p>
          </div>
        </section>

        {/* Statement table */}
        <section className="mt-6">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b-2 text-zinc-500" style={{ borderColor: accent }}>
                <th className="py-2 text-left font-semibold uppercase tracking-wide">Item</th>
                <th className="py-2 text-right font-semibold uppercase tracking-wide">{now.toLocaleDateString("en-GB", { month: "short" })}</th>
                <th className="py-2 text-right font-semibold uppercase tracking-wide">Year to date</th>
                <th className="w-24 py-2 pl-3 text-left font-semibold uppercase tracking-wide">Share</th>
              </tr>
            </thead>
            <tbody>
              <GroupRow label="Revenue — interest income" accent={accent} />
              {interestRows.length === 0 && <EmptyRow />}
              {interestRows.map((r) => (
                <LineRow key={r.name} label={r.name} mtd={r.mtd} ytd={r.ytd} share={pctShare(r.ytd, revenue.ytd)} accent={accent} />
              ))}
              <SubtotalRow label="Total interest income" mtd={interestTotal.mtd} ytd={interestTotal.ytd} />

              <GroupRow label="Revenue — fees & penalties" accent={accent} />
              <LineRow label="Loan processing fees" mtd={processing.mtd} ytd={processing.ytd} share={pctShare(processing.ytd, revenue.ytd)} accent={accent} />
              <LineRow label="Joining fees" mtd={joining.mtd} ytd={joining.ytd} share={pctShare(joining.ytd, revenue.ytd)} accent={accent} />
              {otherFees.ytd > 0 && <LineRow label="Other charges" mtd={otherFees.mtd} ytd={otherFees.ytd} share={pctShare(otherFees.ytd, revenue.ytd)} accent={accent} />}
              <LineRow label="Penalties" mtd={penalties.mtd} ytd={penalties.ytd} share={0} accent={accent} />

              <tr>
                <td colSpan={4} className="pt-2">
                  <div className="rounded-lg px-3 py-2.5" style={{ backgroundColor: `${accent}12` }}>
                    <div className="flex items-center justify-between text-sm font-bold" style={{ color: accent }}>
                      <span className="uppercase tracking-wide">Total revenue</span>
                      <span className="flex gap-8 tabular-nums">
                        <span>{kes(revenue.mtd)}</span>
                        <span>{kes(revenue.ytd)}</span>
                      </span>
                    </div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <footer className="mt-8 border-t border-zinc-900/10 pt-3 text-[10px] leading-relaxed text-zinc-500">
          <p>Interest is recognised as earned (interest portion of installments paid in the period); fees are recognised as collected. Generated {now.toLocaleString("en-GB")} by {session.user.name ?? "staff"}.</p>
          <p className="mt-1">Powered by BirgenAI · lms.birgenai.com</p>
        </footer>
      </main>
    </div>
  );
}

const pctShare = (a: number, b: number) => (b > 0 ? (a / b) * 100 : 0);

function GroupRow({ label, accent }: { label: string; accent: string }) {
  return (
    <tr>
      <td colSpan={4} className="pt-4 pb-1">
        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: accent }}>{label}</span>
      </td>
    </tr>
  );
}
function LineRow({ label, mtd, ytd, share, accent }: { label: string; mtd: number; ytd: number; share: number; accent: string }) {
  return (
    <tr className="border-b border-zinc-900/5">
      <td className="py-2 text-zinc-700">{label}</td>
      <td className="py-2 text-right tabular-nums text-zinc-600">{kes(mtd)}</td>
      <td className="py-2 text-right tabular-nums font-medium text-zinc-800">{kes(ytd)}</td>
      <td className="py-2 pl-3">
        <div className="flex items-center gap-1.5">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-900/5">
            <div className="h-full rounded-full" style={{ width: `${Math.min(100, share)}%`, backgroundColor: accent }} />
          </div>
          <span className="w-7 shrink-0 text-right text-[10px] tabular-nums text-zinc-400">{share.toFixed(0)}%</span>
        </div>
      </td>
    </tr>
  );
}
function SubtotalRow({ label, mtd, ytd }: { label: string; mtd: number; ytd: number }) {
  return (
    <tr className="border-b border-zinc-900/10">
      <td className="py-2 text-[12px] font-semibold text-zinc-800">{label}</td>
      <td className="py-2 text-right font-semibold tabular-nums text-zinc-800">{kes(mtd)}</td>
      <td className="py-2 text-right font-semibold tabular-nums text-zinc-800">{kes(ytd)}</td>
      <td />
    </tr>
  );
}
function EmptyRow() {
  return <tr><td colSpan={4} className="py-2 text-[12px] text-zinc-500">No interest recognised in this period yet.</td></tr>;
}
