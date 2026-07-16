// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMER STATEMENT — the borrower's whole money relationship with this lender, on
// one sheet. The loan statement answers "how is THIS loan going?"; this answers "what
// has passed between us, ever?" — every shilling the lender paid out to them, every
// shilling they paid back, every fee, and their savings passbook.
//
// Two directions, kept honest:
//   • MONEY OUT (lender → customer): disbursements that actually left the float.
//   • MONEY IN (customer → lender): repayments (paybill + STK) and charges paid.
// And the SAVINGS passbook — deposits that outran a loan balance, with the running
// total frozen at each entry.
// ─────────────────────────────────────────────────────────────────────────────
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, PiggyBank } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveScope, borrowerScopeWhere } from "@/lib/rbac/scope";
import { PrintButton } from "@/components/print/PrintButton";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
const num = (d: unknown) => Number(d ?? 0);
const d = (v: Date | null | undefined) => (v ? new Date(v).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");

const DISBURSED_STATES = ["SENT", "CONFIRMED", "MANUAL_CONFIRMED"] as const;

export default async function CustomerStatement({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.orgId) redirect("/login");
  const orgId = session.user.orgId;
  const { id } = await params;

  const scope = await resolveScope(session);
  const b = await prisma.borrower.findFirst({
    where: { id, orgId, ...borrowerScopeWhere(scope) },
    include: { loans: { select: { id: true } } },
  });
  if (!b) redirect("/console/borrowers");
  const loanIds = b.loans.map((l) => l.id);

  const [org, disbursements, receipts, stk, charges, savingsAcct, savingsTx] = await Promise.all([
    prisma.org.findUnique({ where: { id: orgId }, select: { name: true, slug: true, accent: true, logoUrl: true } }),
    loanIds.length
      ? prisma.disbursement.findMany({ where: { orgId, loanId: { in: loanIds }, state: { in: DISBURSED_STATES as unknown as never } }, orderBy: { updatedAt: "asc" } })
      : Promise.resolve([]),
    loanIds.length
      ? prisma.c2BReceipt.findMany({ where: { orgId, allocatedLoanId: { in: loanIds } }, orderBy: { createdAt: "asc" } })
      : Promise.resolve([]),
    prisma.paymentIntent.findMany({ where: { orgId, borrowerId: id, state: "SUCCESS", purpose: { in: ["INSTALLMENT", "CUSTOM"] } }, orderBy: { updatedAt: "asc" } }),
    prisma.paymentIntent.findMany({ where: { orgId, borrowerId: id, state: "SUCCESS", purpose: "CHARGE" }, orderBy: { updatedAt: "asc" }, include: { charge: { select: { name: true } } } }),
    prisma.savingsAccount.findUnique({ where: { borrowerId: id }, select: { balance: true } }),
    prisma.savingsTransaction.findMany({ where: { orgId, borrowerId: id }, orderBy: { createdAt: "asc" } }),
  ]);

  const name = `${b.firstName ?? "Borrower"}${b.otherName ? " " + b.otherName : ""}`.trim();
  const ref = b.id.slice(0, 8).toUpperCase();

  // One chronological ledger across every money movement.
  type Entry = { at: Date; desc: string; channel: string; out: number; in: number };
  const ledger: Entry[] = [
    ...disbursements.map((x) => ({ at: x.updatedAt, desc: x.payeeName ? `Disbursement → ${x.payeeName}` : "Loan disbursement", channel: x.receiptRef ?? x.b2cRef ?? x.state, out: num(x.amount), in: 0 })),
    ...receipts.map((r) => ({ at: r.createdAt, desc: "Repayment", channel: `Paybill · ${r.transId}`, out: 0, in: num(r.amount) })),
    ...stk.map((p) => ({ at: p.updatedAt, desc: p.purpose === "CUSTOM" ? "Payment" : "Repayment", channel: `STK · ${p.mpesaReceipt ?? "—"}`, out: 0, in: num(p.amount) })),
    ...charges.map((c) => ({ at: c.updatedAt, desc: c.charge?.name ?? c.reference ?? "Fee", channel: `Charge · ${c.mpesaReceipt ?? "—"}`, out: 0, in: num(c.amount) })),
  ].sort((a, e) => a.at.getTime() - e.at.getTime());

  const totalOut = ledger.reduce((s, e) => s + e.out, 0);
  const totalIn = ledger.reduce((s, e) => s + e.in, 0);
  const chargesPaid = charges.reduce((s, c) => s + num(c.amount), 0);
  const savingsBalance = num(savingsAcct?.balance ?? 0);

  return (
    <div className="min-h-screen rounded-2xl bg-white text-zinc-900 print-doc">
      <div className="no-print sticky top-0 z-10 rounded-t-2xl border-b border-zinc-900/10 bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 h-14 flex items-center justify-between">
          <Link href={`/console/borrowers/${b.id}`} className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800">
            <ArrowLeft className="h-4 w-4" /> {name}
          </Link>
          <PrintButton label="Download statement" />
        </div>
      </div>

      <main className="mx-auto max-w-3xl px-4 sm:px-6 py-8 print-exact">
        {/* Letterhead */}
        <header className="flex items-start justify-between gap-4 border-b-2 pb-4" style={{ borderColor: org?.accent ?? "#000" }}>
          {org?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={org.logoUrl} alt={`${org.name} logo`} className="h-12 max-w-[220px] object-contain object-left" />
          ) : (
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl text-lg font-bold text-white" style={{ backgroundColor: org?.accent ?? "#000" }}>{org?.name.slice(0, 1)}</div>
              <p className="text-base font-bold leading-tight">{org?.name}</p>
            </div>
          )}
          <div className="text-right">
            <h1 className="text-lg font-bold tracking-tight">CUSTOMER STATEMENT</h1>
            <p className="text-[11px] text-zinc-500">Ref {ref} · issued {d(new Date())}</p>
          </div>
        </header>

        {/* Parties */}
        <section className="mt-5 grid grid-cols-2 gap-6 text-[12px] print-break">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-zinc-500">Customer</p>
            <p className="mt-1 font-semibold text-sm">{name}</p>
            <p className="text-zinc-600">{b.phone}</p>
            {b.nationalId && <p className="text-zinc-600">ID {b.nationalId}</p>}
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-zinc-500">Relationship</p>
            <p className="mt-1 text-zinc-600">{b.loans.length} loan{b.loans.length === 1 ? "" : "s"} on record</p>
            <p className="text-zinc-600">Customer since {d(b.createdAt)}</p>
          </div>
        </section>

        {/* Summary */}
        <section className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-2 print-break">
          {[
            { l: "Disbursed to them", v: kes(totalOut) },
            { l: "Repaid by them", v: kes(totalIn - chargesPaid) },
            { l: "Charges paid", v: kes(chargesPaid) },
            { l: "Savings balance", v: kes(savingsBalance), accent: true },
          ].map((t) => (
            <div key={t.l} className="rounded-lg border border-zinc-900/10 px-2.5 py-2">
              <p className="text-[9px] uppercase tracking-wide text-zinc-500">{t.l}</p>
              <p className="text-sm font-bold text-zinc-800" style={t.accent ? { color: org?.accent } : undefined}>{t.v}</p>
            </div>
          ))}
        </section>

        {/* Ledger */}
        <section className="mt-6 print-break">
          <h2 className="text-[11px] uppercase tracking-widest text-zinc-500">Money movement</h2>
          {ledger.length === 0 ? (
            <p className="mt-2 text-[12px] text-zinc-500">No money has moved between you and this customer yet.</p>
          ) : (
            <table className="mt-2 w-full text-[11px]">
              <thead>
                <tr className="border-y border-zinc-900/10 text-zinc-500">
                  <th className="py-1.5 text-left font-medium">Date</th>
                  <th className="py-1.5 text-left font-medium">Description</th>
                  <th className="py-1.5 text-left font-medium">Channel</th>
                  <th className="py-1.5 text-right font-medium">To customer</th>
                  <th className="py-1.5 text-right font-medium">From customer</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((e, i) => (
                  <tr key={i} className="border-b border-zinc-900/5">
                    <td className="py-1.5">{d(e.at)}</td>
                    <td className="py-1.5 font-medium text-zinc-700">{e.desc}</td>
                    <td className="py-1.5 font-mono text-[10px] text-zinc-500">{e.channel}</td>
                    <td className="py-1.5 text-right tabular-nums text-zinc-500">{e.out > 0 ? kes(e.out) : "—"}</td>
                    <td className="py-1.5 text-right tabular-nums">{e.in > 0 ? kes(e.in) : "—"}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-zinc-900/20 font-bold">
                  <td className="py-1.5" colSpan={3}>Total</td>
                  <td className="py-1.5 text-right tabular-nums">{kes(totalOut)}</td>
                  <td className="py-1.5 text-right tabular-nums">{kes(totalIn)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </section>

        {/* Savings passbook */}
        <section className="mt-6 print-break">
          <h2 className="text-[11px] uppercase tracking-widest text-zinc-500 flex items-center gap-1.5"><PiggyBank className="h-3.5 w-3.5" /> Savings passbook</h2>
          {savingsTx.length === 0 ? (
            <p className="mt-2 text-[12px] text-zinc-500">
              No savings yet. A deposit that arrives while the customer carries no outstanding loan balance is credited here.
            </p>
          ) : (
            <table className="mt-2 w-full text-[11px]">
              <thead>
                <tr className="border-y border-zinc-900/10 text-zinc-500">
                  <th className="py-1.5 text-left font-medium">Date</th>
                  <th className="py-1.5 text-left font-medium">Entry</th>
                  <th className="py-1.5 text-right font-medium">In</th>
                  <th className="py-1.5 text-right font-medium">Out</th>
                  <th className="py-1.5 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                {savingsTx.map((t) => (
                  <tr key={t.id} className="border-b border-zinc-900/5">
                    <td className="py-1.5">{d(t.createdAt)}</td>
                    <td className="py-1.5 text-zinc-600">{t.source.replace(/_/g, " ")}{t.ref ? ` · ${t.ref}` : ""}</td>
                    <td className="py-1.5 text-right tabular-nums">{t.direction === "CREDIT" ? kes(num(t.amount)) : "—"}</td>
                    <td className="py-1.5 text-right tabular-nums text-zinc-500">{t.direction === "DEBIT" ? kes(num(t.amount)) : "—"}</td>
                    <td className="py-1.5 text-right tabular-nums font-semibold">{kes(num(t.balanceAfter))}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-zinc-900/20 font-bold">
                  <td className="py-1.5" colSpan={4}>Savings balance</td>
                  <td className="py-1.5 text-right tabular-nums" style={{ color: org?.accent }}>{kes(savingsBalance)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </section>

        <footer className="mt-8 border-t border-zinc-900/10 pt-3 text-[10px] leading-relaxed text-zinc-500">
          <p>
            This statement was generated on {new Date().toLocaleString("en-GB")} by {session.user.name ?? "staff"} for {org?.name}.
            It reflects every recorded money movement with this customer at the moment of issue. Verify against reference <span className="font-mono font-semibold">{ref}</span>.
          </p>
          <p className="mt-1">Powered by BirgenAI · lms.birgenai.com</p>
        </footer>
      </main>
    </div>
  );
}
