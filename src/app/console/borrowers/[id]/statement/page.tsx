// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMER STATEMENT — the borrower's whole money relationship with this lender, on
// one sheet. The loan statement answers "how is THIS loan going?"; this answers "what
// has passed between us, ever?" — every shilling the lender paid out to them, every
// shilling they paid back, every fee, and their savings passbook.
//
// ── THE BUG THIS PAGE EXISTED WITH ──────────────────────────────────────────
// It took the LIVE path only for a `ss:<id>` ref. But an officer never has one:
// the moment they open a customer, the resolve step hands them a Postgres uuid,
// and every link from Customer 360 carries it. So this page fell through to the
// native branch, read OUR tables — where a resolved bridged customer has no
// disbursement, no receipt, no savings row — and rendered a flawless, empty
// statement for somebody whose ledger one tab away showed twenty-five entries.
//
// So the ROUTE no longer decides the source. THE LENDER does: if this org is
// bridged and the customer can be found in their book, the statement is read
// from there, whichever kind of id was in the URL. Our own tables answer only
// for a native lender, or for a customer who genuinely is not in the live book.
//
// Two directions, kept honest on the native path:
//   • MONEY OUT (lender → customer): disbursements that actually left the float.
//   • MONEY IN (customer → lender): repayments (paybill + STK) and charges paid.
// And the SAVINGS passbook — deposits that outran a loan balance, with the running
// total frozen at each entry.
// ─────────────────────────────────────────────────────────────────────────────
import { redirect } from "next/navigation";
import Link from "next/link";
import { PiggyBank } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveScope, borrowerScopeWhere } from "@/lib/rbac/scope";
import { DocumentSheet, Letterhead, DocumentFooter, DocStat, type Lender } from "@/components/print/Document";
import { resolveOrg } from "@/lib/tenancy";
import { getCustomerStatementLive } from "@/lib/lms/servicesuite-statement";
import { findLiveBorrower } from "@/lib/lms/customer360";
import { LiveStatementView } from "./LiveStatement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
const num = (d: unknown) => Number(d ?? 0);
const d = (v: Date | null | undefined) => (v ? new Date(v).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");

const DISBURSED_STATES = ["SENT", "CONFIRMED", "MANUAL_CONFIRMED"] as const;

/** One loan's own file. The statement lists loans; each is a link to its detail. */
const loanHref = (loanId: number) => `/console/loans/${encodeURIComponent(`ss:${loanId}`)}`;

export default async function CustomerStatement({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.orgId) redirect("/login");
  const orgId = session.user.orgId;
  const { id } = await params;
  const issuedBy = session.user.name ?? session.user.email ?? "staff";

  const [brand, liveOrg] = await Promise.all([
    prisma.org.findUnique({ where: { id: orgId }, select: { name: true, accent: true, logoUrl: true } }),
    session.user.orgSlug ? resolveOrg(session.user.orgSlug) : null,
  ]);
  const lender: Lender = {
    name: brand?.name ?? liveOrg?.name ?? "Lender",
    accent: brand?.accent ?? null,
    logoUrl: brand?.logoUrl ?? null,
  };
  const bridged = !!(liveOrg?.bridgedReady && liveOrg.registry && liveOrg.entityId);

  // ── A REF STRAIGHT OFF THE LENDER'S BOOK ─────────────────────────────────
  // A bridged lender's loans list carries `ss:<id>` refs, not LMS uuids, and the
  // statement is reachable from there without paying the resolve step first —
  // browsing costs nothing.
  if (id.startsWith("ss:")) {
    if (!bridged) {
      return <Problem title="Not available" detail="This lender’s system is not connected, so their statements cannot be read." />;
    }
    const ssId = Number(id.slice(3));
    if (!Number.isInteger(ssId) || ssId <= 0) {
      return <Problem title="Unknown customer" detail={`${id} is not a customer reference we recognise.`} />;
    }
    let statement: Awaited<ReturnType<typeof getCustomerStatementLive>> = null;
    try {
      statement = await getCustomerStatementLive(liveOrg!.registry!, liveOrg!.entityId, ssId, { take: 1000 });
    } catch (err) {
      return (
        <Problem
          title={`Could not read ${lender.name}’s book`}
          detail={err instanceof Error ? err.message : "The lender’s system did not answer."}
        />
      );
    }
    if (!statement) {
      // Not a miss to gloss over: ids are only meaningful within an entity, and
      // 3002 and 3005 hold DIFFERENT PEOPLE. Refusing is the safe answer.
      return <Problem title="Not this lender’s customer" detail={`No customer ${ssId} in entity ${liveOrg!.entityId}.`} />;
    }
    return (
      <LiveStatementView
        statement={statement}
        lender={lender}
        backHref="/console/borrowers"
        issuedBy={issuedBy}
        loanHref={loanHref}
      />
    );
  }

  const scope = await resolveScope(session);
  const b = await prisma.borrower.findFirst({
    where: { id, orgId, ...borrowerScopeWhere(scope) },
    include: { loans: { select: { id: true } } },
  });
  if (!b) redirect("/console/borrowers");

  // ── THE FIX: A UUID IS NOT A CLAIM ABOUT WHICH BOOK ANSWERS ──────────────
  // Ask the lender's book for this person by the same rule Customer 360 uses —
  // the stored ServiceSuite id first, the handset second — so the two screens can
  // never be showing different people's money. Best-effort: a live book that does
  // not answer falls through to our own tables rather than taking the statement
  // off the screen.
  if (bridged) {
    const found = await findLiveBorrower(
      liveOrg!.registry!,
      liveOrg!.entityId,
      { serviceSuiteBorrowerId: b.serviceSuiteBorrowerId, phone: b.phone },
    ).catch(() => null);
    if (found) {
      const statement = await getCustomerStatementLive(
        liveOrg!.registry!,
        liveOrg!.entityId,
        found.profile.borrowerId,
        { take: 1000 },
      ).catch(() => null);
      if (statement) {
        return (
          <LiveStatementView
            statement={statement}
            lender={lender}
            backHref={`/console/borrowers/${b.id}`}
            issuedBy={issuedBy}
            loanHref={loanHref}
          />
        );
      }
    }
  }

  const loanIds = b.loans.map((l) => l.id);

  const [disbursements, receipts, stk, charges, savingsAcct, savingsTx] = await Promise.all([
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
    <DocumentSheet backHref={`/console/borrowers/${b.id}`} backLabel={name} downloadLabel="Download statement">
      <Letterhead lender={lender} title="CUSTOMER STATEMENT" reference={ref} />

      {/* Parties */}
      <section className="mt-5 grid grid-cols-2 gap-6 text-[12px] print-break">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-ash-500">Customer</p>
          <p className="mt-1 text-sm font-semibold">{name}</p>
          <p className="text-ash-600">{b.phone}</p>
          {b.nationalId && <p className="text-ash-600">ID {b.nationalId}</p>}
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-widest text-ash-500">Relationship</p>
          <p className="mt-1 text-ash-600">{b.loans.length} loan{b.loans.length === 1 ? "" : "s"} on record</p>
          <p className="text-ash-600">Customer since {d(b.createdAt)}</p>
        </div>
      </section>

      {/* Summary */}
      <section className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4 print-break">
        <DocStat label="Disbursed to them" value={kes(totalOut)} />
        <DocStat label="Repaid by them" value={kes(totalIn - chargesPaid)} />
        <DocStat label="Charges paid" value={kes(chargesPaid)} />
        <DocStat label="Savings balance" value={kes(savingsBalance)} accent={lender.accent} />
      </section>

      {/* Ledger */}
      <section className="mt-6 print-break">
        <h2 className="text-[11px] uppercase tracking-widest text-ash-500">Money movement</h2>
        {ledger.length === 0 ? (
          <p className="mt-2 text-[12px] text-ash-500">No money has moved between you and this customer yet.</p>
        ) : (
          <table className="mt-2 w-full text-[11px]">
            <thead>
              <tr className="border-y border-ash-900/10 text-ash-500">
                <th className="py-1.5 text-left font-medium">Date</th>
                <th className="py-1.5 text-left font-medium">Description</th>
                <th className="py-1.5 text-left font-medium">Channel</th>
                <th className="py-1.5 text-right font-medium">To customer</th>
                <th className="py-1.5 text-right font-medium">From customer</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((e, i) => (
                <tr key={i} className="border-b border-ash-900/5">
                  <td className="py-1.5">{d(e.at)}</td>
                  <td className="py-1.5 font-medium text-ash-700">{e.desc}</td>
                  <td className="py-1.5 font-mono text-[10px] text-ash-500">{e.channel}</td>
                  <td className="py-1.5 text-right tabular-nums text-ash-500">{e.out > 0 ? kes(e.out) : "—"}</td>
                  <td className="py-1.5 text-right tabular-nums">{e.in > 0 ? kes(e.in) : "—"}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-ash-900/20 font-bold">
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
        <h2 className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-ash-500"><PiggyBank className="h-3.5 w-3.5" /> Savings passbook</h2>
        {savingsTx.length === 0 ? (
          <p className="mt-2 text-[12px] text-ash-500">
            No savings yet. A deposit that arrives while the customer carries no outstanding loan balance is credited here.
          </p>
        ) : (
          <table className="mt-2 w-full text-[11px]">
            <thead>
              <tr className="border-y border-ash-900/10 text-ash-500">
                <th className="py-1.5 text-left font-medium">Date</th>
                <th className="py-1.5 text-left font-medium">Entry</th>
                <th className="py-1.5 text-right font-medium">In</th>
                <th className="py-1.5 text-right font-medium">Out</th>
                <th className="py-1.5 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              {savingsTx.map((t) => (
                <tr key={t.id} className="border-b border-ash-900/5">
                  <td className="py-1.5">{d(t.createdAt)}</td>
                  <td className="py-1.5 text-ash-600">{t.source.replace(/_/g, " ")}{t.ref ? ` · ${t.ref}` : ""}</td>
                  <td className="py-1.5 text-right tabular-nums">{t.direction === "CREDIT" ? kes(num(t.amount)) : "—"}</td>
                  <td className="py-1.5 text-right tabular-nums text-ash-500">{t.direction === "DEBIT" ? kes(num(t.amount)) : "—"}</td>
                  <td className="py-1.5 text-right tabular-nums font-semibold">{kes(num(t.balanceAfter))}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-ash-900/20 font-bold">
                <td className="py-1.5" colSpan={4}>Savings balance</td>
                <td className="py-1.5 text-right tabular-nums" style={{ color: lender.accent ?? undefined }}>{kes(savingsBalance)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </section>

      <DocumentFooter
        lender={lender}
        by={issuedBy}
        reference={ref}
        note="It reflects every recorded money movement with this customer at the moment of issue."
      />
    </DocumentSheet>
  );
}


/** Says what went wrong instead of rendering an empty statement, which reads
 *  as "this customer has never paid anything". */
function Problem({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="mx-auto max-w-2xl px-4 sm:px-6 py-16 text-center">
      <h1 className="text-lg font-semibold text-[color:var(--ink)]">{title}</h1>
      <p className="t-meta mx-auto mt-2 max-w-[52ch] text-[13px] text-[color:var(--ink-muted)]">{detail}</p>
      <Link href="/console/borrowers" className="mt-5 inline-block text-[12px] font-semibold hover:underline" style={{ color: "var(--brand)" }}>
        Back to borrowers
      </Link>
    </main>
  );
}
