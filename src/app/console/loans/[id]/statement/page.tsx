import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PrintButton } from "@/components/print/PrintButton";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
const num = (d: unknown) => Number(d ?? 0);
const d = (v: Date | null | undefined) => (v ? new Date(v).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");

const INST_TONE: Record<string, string> = {
  PAID: "text-emerald-700", OVERDUE: "text-rose-700", DUE: "text-amber-700", PARTIAL: "text-amber-700", UPCOMING: "text-zinc-500",
};

export default async function LoanStatement({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.orgId) redirect("/login");
  const orgId = session.user.orgId;
  const { id } = await params;

  const loan = await prisma.loan.findFirst({
    where: { id, orgId },
    include: {
      borrower: { select: { id: true, firstName: true, otherName: true, phone: true, nationalId: true } },
      product: { select: { name: true, interestRate: true, interestMethod: true } },
      installments: { orderBy: { seq: "asc" } },
      disbursement: true,
    },
  });
  if (!loan) redirect("/console/borrowers");

  const [org, receipts, stk] = await Promise.all([
    prisma.org.findUnique({ where: { id: orgId }, select: { name: true, slug: true, accent: true } }),
    prisma.c2BReceipt.findMany({ where: { orgId, allocatedLoanId: loan.id }, orderBy: { createdAt: "asc" } }),
    prisma.paymentIntent.findMany({ where: { orgId, loanId: loan.id, state: "SUCCESS" }, orderBy: { createdAt: "asc" } }),
  ]);

  const payments = [
    ...receipts.map((r) => ({ at: r.createdAt, ref: r.transId, amount: num(r.amount), channel: "Paybill (C2B)" })),
    ...stk.map((p) => ({ at: p.updatedAt, ref: p.mpesaReceipt ?? "—", amount: num(p.amount), channel: "STK push" })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  const name = `${loan.borrower.firstName ?? "Borrower"}${loan.borrower.otherName ? " " + loan.borrower.otherName : ""}`.trim();
  const ref = loan.id.slice(0, 8).toUpperCase();
  const paidToDate = loan.installments.reduce((s, i) => s + num(i.amountPaid), 0);
  const penalties = loan.installments.reduce((s, i) => s + num(i.penalty), 0);
  const totalDue = loan.installments.reduce((s, i) => s + num(i.amountDue), 0);

  return (
    <div className="min-h-screen bg-white text-zinc-900 print-doc">
      {/* Screen-only chrome */}
      <div className="no-print border-b border-zinc-900/10 bg-white/80 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 h-14 flex items-center justify-between">
          <Link href={`/console/borrowers/${loan.borrower.id}`} className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800">
            <ArrowLeft className="h-4 w-4" /> {name}
          </Link>
          <PrintButton label="Download statement" />
        </div>
      </div>

      <main className="mx-auto max-w-3xl px-4 sm:px-6 py-8 print-exact">
        {/* Letterhead */}
        <header className="flex items-start justify-between gap-4 border-b-2 pb-4" style={{ borderColor: org?.accent ?? "#000" }}>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl text-lg font-bold text-white" style={{ backgroundColor: org?.accent ?? "#000" }}>
              {org?.name.slice(0, 1)}
            </div>
            <div>
              <p className="text-base font-bold leading-tight">{org?.name}</p>
              <p className="text-[11px] text-zinc-500 leading-tight">{org?.slug}.birgenai.com</p>
            </div>
          </div>
          <div className="text-right">
            <h1 className="text-lg font-bold tracking-tight">LOAN STATEMENT</h1>
            <p className="text-[11px] text-zinc-500">Ref {ref} · issued {d(new Date())}</p>
          </div>
        </header>

        {/* Parties */}
        <section className="mt-5 grid grid-cols-2 gap-6 text-[12px] print-break">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-zinc-500">Borrower</p>
            <p className="mt-1 font-semibold text-sm">{name}</p>
            <p className="text-zinc-600">{loan.borrower.phone}</p>
            {loan.borrower.nationalId && <p className="text-zinc-600">ID {loan.borrower.nationalId}</p>}
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-zinc-500">Loan</p>
            <p className="mt-1 font-semibold text-sm">{loan.product.name}</p>
            <p className="text-zinc-600">Status {loan.status} · disbursed {d(loan.disbursedAt)}</p>
            <p className="text-zinc-600">
              {num(loan.product.interestRate)}% {loan.product.interestMethod} · expected clear {d(loan.expectedClearDate)}
            </p>
          </div>
        </section>

        {/* Summary */}
        <section className="mt-5 grid grid-cols-2 sm:grid-cols-5 gap-2 print-break">
          {[
            { l: "Principal", v: kes(num(loan.principal)) },
            { l: "Interest", v: kes(num(loan.interest)) },
            { l: "Total repayable", v: kes(num(loan.loanAmount)) },
            { l: "Paid to date", v: kes(paidToDate) },
            { l: "Balance", v: kes(num(loan.balance)) },
          ].map((t, i) => (
            <div key={t.l} className="rounded-lg border border-zinc-900/10 px-2.5 py-2">
              <p className="text-[9px] uppercase tracking-wide text-zinc-500">{t.l}</p>
              <p className={`text-sm font-bold ${i === 4 ? "" : "text-zinc-800"}`} style={i === 4 ? { color: org?.accent } : undefined}>{t.v}</p>
            </div>
          ))}
        </section>

        {/* Schedule */}
        <section className="mt-6 print-break">
          <h2 className="text-[11px] uppercase tracking-widest text-zinc-500">Repayment schedule</h2>
          <table className="mt-2 w-full text-[11px]">
            <thead>
              <tr className="border-y border-zinc-900/10 text-zinc-500">
                <th className="py-1.5 text-left font-medium">#</th>
                <th className="py-1.5 text-left font-medium">Due date</th>
                <th className="py-1.5 text-right font-medium">Amount due</th>
                <th className="py-1.5 text-right font-medium">Penalty</th>
                <th className="py-1.5 text-right font-medium">Paid</th>
                <th className="py-1.5 text-right font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {loan.installments.map((i) => (
                <tr key={i.id} className="border-b border-zinc-900/5">
                  <td className="py-1.5 text-zinc-500">{i.seq}</td>
                  <td className="py-1.5">{d(i.dueDate)}</td>
                  <td className="py-1.5 text-right tabular-nums">{kes(num(i.amountDue))}</td>
                  <td className="py-1.5 text-right tabular-nums text-zinc-500">{num(i.penalty) > 0 ? kes(num(i.penalty)) : "—"}</td>
                  <td className="py-1.5 text-right tabular-nums">{kes(num(i.amountPaid))}</td>
                  <td className={`py-1.5 text-right font-semibold ${INST_TONE[i.status] ?? "text-zinc-500"}`}>{i.status}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-zinc-900/20 font-bold">
                <td className="py-1.5" colSpan={2}>Total</td>
                <td className="py-1.5 text-right tabular-nums">{kes(totalDue)}</td>
                <td className="py-1.5 text-right tabular-nums">{penalties > 0 ? kes(penalties) : "—"}</td>
                <td className="py-1.5 text-right tabular-nums">{kes(paidToDate)}</td>
                <td className="py-1.5 text-right" />
              </tr>
            </tbody>
          </table>
        </section>

        {/* Payments received */}
        <section className="mt-6 print-break">
          <h2 className="text-[11px] uppercase tracking-widest text-zinc-500">Payments received</h2>
          {payments.length === 0 ? (
            <p className="mt-2 text-[12px] text-zinc-500">No payments recorded against this loan yet.</p>
          ) : (
            <table className="mt-2 w-full text-[11px]">
              <thead>
                <tr className="border-y border-zinc-900/10 text-zinc-500">
                  <th className="py-1.5 text-left font-medium">Date</th>
                  <th className="py-1.5 text-left font-medium">Receipt</th>
                  <th className="py-1.5 text-left font-medium">Channel</th>
                  <th className="py-1.5 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p, i) => (
                  <tr key={i} className="border-b border-zinc-900/5">
                    <td className="py-1.5">{d(p.at)}</td>
                    <td className="py-1.5 font-mono text-[10px]">{p.ref}</td>
                    <td className="py-1.5 text-zinc-600">{p.channel}</td>
                    <td className="py-1.5 text-right tabular-nums">{kes(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Disbursement */}
        {loan.disbursement && (
          <section className="mt-6 text-[12px] print-break">
            <h2 className="text-[11px] uppercase tracking-widest text-zinc-500">Disbursement</h2>
            <p className="mt-1.5 text-zinc-700">
              {kes(num(loan.disbursement.amount))} to {loan.disbursement.phone} · {loan.disbursement.state}
              {loan.disbursement.receiptRef ? ` · ref ${loan.disbursement.receiptRef}` : ""} · {d(loan.disbursement.updatedAt)}
            </p>
          </section>
        )}

        <footer className="mt-8 border-t border-zinc-900/10 pt-3 text-[10px] leading-relaxed text-zinc-500">
          <p>
            This statement was generated on {new Date().toLocaleString("en-GB")} by {session.user.name ?? "staff"} for {org?.name}.
            It reflects the loan book at the moment of issue. Verify against reference <span className="font-mono font-semibold">{ref}</span>.
          </p>
          <p className="mt-1">Powered by BirgenAI · lms.birgenai.com</p>
        </footer>
      </main>
    </div>
  );
}
