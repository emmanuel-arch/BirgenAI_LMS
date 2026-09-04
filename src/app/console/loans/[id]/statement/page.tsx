// ─────────────────────────────────────────────────────────────────────────────
// THE LOAN STATEMENT — one loan, on paper.
//
// The customer statement answers "what has passed between us, ever?". This
// answers "how is THIS loan going?", which is the sheet a customer asks for when
// they are querying an instalment, and the one an officer prints before a
// restructure conversation.
//
// ── TWO BOOKS, ONE SHEET ────────────────────────────────────────────────────
// A `ss:<id>` ref is read straight from the lender's own ServiceSuite — the
// schedule, the arrears register, and the ledger rows this loan is named on. An
// LMS uuid is our own loan. Same letterhead, same layout, same footer; only the
// source differs, and the live sheet says so on screen (never on the paper — a
// customer holding a statement does not need to be told where their lender keeps
// its records).
//
// ARREARS IS THE LENDER'S OWN FIGURE, from Transactions.dbo.LoansInArrears. A
// statement that disagreed with their PAR report would be the single most
// damaging document this console could produce.
// ─────────────────────────────────────────────────────────────────────────────
import { redirect } from "next/navigation";
import Link from "next/link";
import { Radio } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveScope, loanScopeWhere } from "@/lib/rbac/scope";
import { resolveOrg } from "@/lib/tenancy";
import { getLoanLive, type LiveLoanFile } from "@/lib/lms/servicesuite-loan";
import { DocumentSheet, Letterhead, DocumentFooter, DocStat, type Lender } from "@/components/print/Document";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
const num = (d: unknown) => Number(d ?? 0);
const day = (v: Date | string | null | undefined) =>
  v ? new Date(v).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const stamp = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

const INST_INK: Record<string, string> = {
  PAID: "text-emerald-700", OVERDUE: "text-rose-700", DUE: "text-amber-700", PARTIAL: "text-amber-700", UPCOMING: "text-ash-500",
};

export default async function LoanStatement({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.orgId) redirect("/login");
  const orgId = session.user.orgId;
  const { id: rawId } = await params;
  const id = decodeURIComponent(rawId);
  const issuedBy = session.user.name ?? session.user.email ?? "staff";

  const [brand, org] = await Promise.all([
    prisma.org.findUnique({ where: { id: orgId }, select: { name: true, accent: true, logoUrl: true } }),
    session.user.orgSlug ? resolveOrg(session.user.orgSlug) : null,
  ]);
  const lender: Lender = {
    name: brand?.name ?? org?.name ?? "Lender",
    accent: brand?.accent ?? null,
    logoUrl: brand?.logoUrl ?? null,
  };

  // ── THE LENDER'S OWN LOAN ─────────────────────────────────────────────────
  if (id.startsWith("ss:")) {
    const bridged = !!(org?.bridgedReady && org.registry && org.entityId);
    if (!bridged) return <Problem title="Not available" detail="This lender’s system is not connected, so their loan statements cannot be read." />;
    const loanId = Number(id.slice(3));
    if (!Number.isInteger(loanId) || loanId <= 0) return <Problem title="Unknown loan" detail={`${id} is not a loan reference we recognise.`} />;
    let file: LiveLoanFile | null = null;
    try {
      file = await getLoanLive(org!.registry!, org!.entityId, loanId);
    } catch (err) {
      return <Problem title={`Could not read ${lender.name}’s book`} detail={err instanceof Error ? err.message : "The lender’s system did not answer."} />;
    }
    if (!file) return <Problem title="Not this lender’s loan" detail={`No loan ${loanId} in entity ${org!.entityId}.`} />;
    return <LiveLoanStatement file={file} lender={lender} issuedBy={issuedBy} />;
  }

  const scope = await resolveScope(session);
  const loan = await prisma.loan.findFirst({
    where: { id, orgId, ...loanScopeWhere(scope) },
    include: {
      borrower: { select: { id: true, firstName: true, otherName: true, phone: true, nationalId: true } },
      product: { select: { name: true, interestRate: true, interestMethod: true } },
      installments: { orderBy: { seq: "asc" } },
      disbursement: true,
    },
  });
  if (!loan) redirect("/console/loans");

  const [receipts, stk] = await Promise.all([
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
    <DocumentSheet backHref={`/console/loans/${loan.id}`} backLabel={name} downloadLabel="Download statement">
      <Letterhead lender={lender} title="LOAN STATEMENT" reference={ref} />

      {/* Parties */}
      <section className="mt-5 grid grid-cols-2 gap-6 text-[12px] print-break">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-ash-500">Borrower</p>
          <p className="mt-1 text-sm font-semibold">{name}</p>
          <p className="text-ash-600">{loan.borrower.phone}</p>
          {loan.borrower.nationalId && <p className="text-ash-600">ID {loan.borrower.nationalId}</p>}
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-widest text-ash-500">Loan</p>
          <p className="mt-1 text-sm font-semibold">{loan.product.name}</p>
          <p className="text-ash-600">Status {loan.status} · disbursed {day(loan.disbursedAt)}</p>
          <p className="text-ash-600">
            {num(loan.product.interestRate)}% {loan.product.interestMethod} · expected clear {day(loan.expectedClearDate)}
          </p>
        </div>
      </section>

      {/* Summary */}
      <section className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-5 print-break">
        <DocStat label="Principal" value={kes(num(loan.principal))} />
        <DocStat label="Interest" value={kes(num(loan.interest))} />
        <DocStat label="Total repayable" value={kes(num(loan.loanAmount))} />
        <DocStat label="Paid to date" value={kes(paidToDate)} />
        <DocStat label="Balance" value={kes(num(loan.balance))} accent={lender.accent} />
      </section>

      {/* Schedule */}
      <section className="mt-6 print-break">
        <h2 className="text-[11px] uppercase tracking-widest text-ash-500">Repayment schedule</h2>
        <table className="mt-2 w-full text-[11px]">
          <thead>
            <tr className="border-y border-ash-900/10 text-ash-500">
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
              <tr key={i.id} className="border-b border-ash-900/5">
                <td className="py-1.5 text-ash-500">{i.seq}</td>
                <td className="py-1.5">{day(i.dueDate)}</td>
                <td className="py-1.5 text-right tabular-nums">{kes(num(i.amountDue))}</td>
                <td className="py-1.5 text-right tabular-nums text-ash-500">{num(i.penalty) > 0 ? kes(num(i.penalty)) : "—"}</td>
                <td className="py-1.5 text-right tabular-nums">{kes(num(i.amountPaid))}</td>
                <td className={`py-1.5 text-right font-semibold ${INST_INK[i.status] ?? "text-ash-500"}`}>{i.status}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-ash-900/20 font-bold">
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
        <h2 className="text-[11px] uppercase tracking-widest text-ash-500">Payments received</h2>
        {payments.length === 0 ? (
          <p className="mt-2 text-[12px] text-ash-500">No payments recorded against this loan yet.</p>
        ) : (
          <table className="mt-2 w-full text-[11px]">
            <thead>
              <tr className="border-y border-ash-900/10 text-ash-500">
                <th className="py-1.5 text-left font-medium">Date</th>
                <th className="py-1.5 text-left font-medium">Receipt</th>
                <th className="py-1.5 text-left font-medium">Channel</th>
                <th className="py-1.5 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p, i) => (
                <tr key={i} className="border-b border-ash-900/5">
                  <td className="py-1.5">{day(p.at)}</td>
                  <td className="py-1.5 font-mono text-[10px]">{p.ref}</td>
                  <td className="py-1.5 text-ash-600">{p.channel}</td>
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
          <h2 className="text-[11px] uppercase tracking-widest text-ash-500">Disbursement</h2>
          <p className="mt-1.5 text-ash-700">
            {kes(num(loan.disbursement.amount))} to {loan.disbursement.phone} · {loan.disbursement.state}
            {loan.disbursement.receiptRef ? ` · ref ${loan.disbursement.receiptRef}` : ""} · {day(loan.disbursement.updatedAt)}
          </p>
        </section>
      )}

      <DocumentFooter lender={lender} by={issuedBy} reference={ref} note="It reflects the loan book at the moment of issue." />
    </DocumentSheet>
  );
}

// ── The lender's own loan, on the same paper ─────────────────────────────────

function LiveLoanStatement({ file, lender, issuedBy }: { file: LiveLoanFile; lender: Lender; issuedBy: string }) {
  const { loan, borrower, schedule, ledger, totals } = file;
  const ref = String(loan.loanId);
  const behind = loan.arrears > 0;

  return (
    <DocumentSheet
      backHref={`/console/loans/${encodeURIComponent(loan.ref)}`}
      backLabel={borrower.name ?? "Loan"}
      downloadLabel="Download statement"
    >
      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
          <Radio className="h-3 w-3" /> Live · {lender.name} · entity {loan.entityId}
        </span>
        <span className="text-[11px] text-ash-500">
          Schedule, arrears and ledger read from the lender&rsquo;s own book at this moment.
        </span>
      </div>

      <Letterhead lender={lender} title="LOAN STATEMENT" reference={ref} extra={loan.term ? `${loan.product ?? "Loan"} · ${loan.term}` : undefined} />

      {/* Parties */}
      <section className="mt-5 grid grid-cols-2 gap-6 text-[12px] print-break">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-ash-500">Borrower</p>
          <p className="mt-1 text-sm font-semibold">{borrower.name ?? `Customer ${borrower.serviceSuiteId}`}</p>
          {borrower.phone && <p className="text-ash-600">{borrower.phone}</p>}
          {borrower.nationalId && <p className="text-ash-600">ID {borrower.nationalId}</p>}
          {borrower.accountNo && <p className="text-ash-600">A/C {borrower.accountNo}</p>}
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-widest text-ash-500">Loan</p>
          <p className="mt-1 text-sm font-semibold">{loan.product ?? "Loan"} · #{loan.loanId}</p>
          <p className="text-ash-600">
            {behind ? "IN ARREARS" : loan.status} · taken {day(loan.borrowDate)}
            {loan.disbursedAt ? ` · disbursed ${day(loan.disbursedAt)}` : ""}
          </p>
          <p className="text-ash-600">
            {loan.term ? `${loan.term} · ` : ""}expected clear {day(loan.expectedClearDate)}
            {loan.clearedAt ? ` · cleared ${day(loan.clearedAt)}` : ""}
          </p>
          {borrower.office && <p className="text-ash-600">{borrower.office}</p>}
        </div>
      </section>

      {/* Summary */}
      <section className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-5 print-break">
        <DocStat label="Principal" value={kes(loan.principal)} />
        <DocStat label="Interest" value={kes(loan.interest)} />
        <DocStat label="Total repayable" value={kes(loan.loanAmount)} />
        <DocStat label="Paid to date" value={kes(totals.paid)} sub={`${totals.settled}/${totals.count} instalments`} />
        <DocStat label="Balance" value={kes(loan.balance)} accent={lender.accent} />
      </section>

      {behind && (
        <p className="mt-3 rounded-lg border border-rose-600/20 bg-rose-500/[0.06] px-3 py-2 text-[11px] text-rose-800 print-break">
          <strong className="font-bold">{kes(loan.arrears)} in arrears, {loan.daysInArrears} days past due.</strong>{" "}
          This figure is the lender&rsquo;s own arrears register, not a calculation made for this document.
          {loan.firstMissedAt ? ` First missed ${day(loan.firstMissedAt)}.` : ""}
        </p>
      )}

      {/* Schedule */}
      <section className="mt-6 print-break">
        <h2 className="text-[11px] uppercase tracking-widest text-ash-500">Repayment schedule</h2>
        {schedule.length === 0 ? (
          <p className="mt-2 text-[12px] text-ash-500">No schedule has been written for this loan.</p>
        ) : (
          <table className="mt-2 w-full text-[11px]">
            <thead>
              <tr className="border-y border-ash-900/10 text-ash-500">
                <th className="py-1.5 text-left font-medium">#</th>
                <th className="py-1.5 text-left font-medium">Due date</th>
                <th className="py-1.5 text-right font-medium">Instalment</th>
                <th className="py-1.5 text-right font-medium">Paid</th>
                <th className="py-1.5 text-right font-medium">Outstanding</th>
                <th className="py-1.5 text-left font-medium">Settled</th>
                <th className="py-1.5 text-right font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {schedule.map((s) => (
                <tr key={s.seq} className="border-b border-ash-900/5">
                  <td className="py-1.5 text-ash-500">{s.seq}</td>
                  <td className="py-1.5">{day(s.dueDate)}</td>
                  <td className="py-1.5 text-right tabular-nums">{kes(s.due)}</td>
                  <td className="py-1.5 text-right tabular-nums">{s.paid > 0 ? kes(s.paid) : "—"}</td>
                  <td className="py-1.5 text-right tabular-nums">{s.outstanding > 0 ? kes(s.outstanding) : "—"}</td>
                  <td className="py-1.5 text-ash-500">{s.paidAt ? day(s.paidAt) : "—"}</td>
                  <td className={`py-1.5 text-right font-semibold ${INST_INK[s.status] ?? "text-ash-500"}`}>{s.status}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-ash-900/20 font-bold">
                <td className="py-1.5" colSpan={2}>Total</td>
                <td className="py-1.5 text-right tabular-nums">{kes(totals.scheduled)}</td>
                <td className="py-1.5 text-right tabular-nums">{kes(totals.paid)}</td>
                <td className="py-1.5 text-right tabular-nums">{kes(totals.outstanding)}</td>
                <td colSpan={2} />
              </tr>
            </tbody>
          </table>
        )}
      </section>

      {/* The money that actually moved */}
      <section className="mt-6 print-break">
        <h2 className="text-[11px] uppercase tracking-widest text-ash-500">Money against this loan</h2>
        <p className="mt-0.5 text-[10px] text-ash-500">
          Newest first. Direction is from the customer&rsquo;s side — &ldquo;in&rdquo; is money reaching them, so a
          repayment is out.
        </p>
        {ledger.length === 0 ? (
          <p className="mt-2 text-[12px] text-ash-500">Nothing has been posted against this loan yet.</p>
        ) : (
          <table className="mt-2 w-full text-[11px]">
            <thead>
              <tr className="border-y border-ash-900/10 text-ash-500">
                <th className="py-1.5 text-left font-medium">When</th>
                <th className="py-1.5 text-left font-medium">What</th>
                <th className="py-1.5 text-left font-medium">Reference</th>
                <th className="py-1.5 text-right font-medium">In</th>
                <th className="py-1.5 text-right font-medium">Out</th>
                <th className="py-1.5 text-right font-medium">Balance after</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((t) => (
                <tr key={t.id} className="border-b border-ash-900/5">
                  <td className="whitespace-nowrap py-1.5 text-ash-600">{stamp(t.at)}</td>
                  <td className="py-1.5 font-medium text-ash-700">{t.narration ?? (t.direction === "in" ? "Disbursement" : "Repayment")}</td>
                  <td className="py-1.5 font-mono text-[10px] text-ash-500">{t.reference ?? "—"}</td>
                  <td className="py-1.5 text-right tabular-nums text-sky-700">{t.direction === "in" ? kes(t.amount) : ""}</td>
                  <td className="py-1.5 text-right tabular-nums text-emerald-700">{t.direction === "out" ? kes(t.amount) : ""}</td>
                  <td className="py-1.5 text-right tabular-nums text-ash-500">{t.loanBalance != null ? kes(t.loanBalance) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <DocumentFooter
        lender={lender}
        by={issuedBy}
        reference={ref}
        note="It reflects this loan as it stands in the lender’s own system at the moment of issue."
      />
    </DocumentSheet>
  );
}

function Problem({ title, detail }: { title: string; detail: string }) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6">
      <h1 className="text-lg font-semibold text-[color:var(--ink)]">{title}</h1>
      <p className="t-meta mx-auto mt-2 max-w-[52ch] text-[13px] text-[color:var(--ink-muted)]">{detail}</p>
      <Link href="/console/loans" className="mt-5 inline-block text-[12px] font-semibold hover:underline" style={{ color: "var(--brand)" }}>
        Back to the loan book
      </Link>
    </main>
  );
}
