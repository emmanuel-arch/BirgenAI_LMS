// ─────────────────────────────────────────────────────────────────────────────
// THE LOAN PROFILE — one loan, whole.
//
// ── THE HOLE THIS FILLS ─────────────────────────────────────────────────────
// The console had a page about a PERSON (Customer 360) and a page about the
// BOOK (the loans list), and nothing in between. So an officer working the
// arrears queue clicked a row that said "KES 5,650, 10 days late" and landed on
// a customer with four loans, three of them cleared, and had to work out for
// themselves which of the four the row had been about. The one screen every
// collections call actually needs — this loan, its schedule, its arrears, its
// money — did not exist.
//
// ── WHAT AN OFFICER ON THE PHONE IS ASKING ──────────────────────────────────
// In order, and that is the order the page is in:
//
//   1. WHO and WHICH LOAN — the face, the product, the reference, the status.
//   2. WHAT IS OWED — balance, arrears, days late, what the next instalment is.
//   3. WHY — the schedule, instalment by instalment, with the late ones marked.
//   4. WHAT THEY HAVE ACTUALLY SENT — the ledger rows this loan is named on.
//
// ── ARREARS IS THEIR NUMBER ─────────────────────────────────────────────────
// Read from Transactions.dbo.LoansInArrears, the register the lender's own PAR
// reports come from — never derived here. A console that quietly disagrees with
// the system of record turns every other figure on the screen into a question,
// and this is the screen where the figure gets read out loud to the customer.
// ─────────────────────────────────────────────────────────────────────────────
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, ArrowDownLeft, ArrowUpRight, Building2, CalendarClock, FileText,
  Landmark, Radio, TriangleAlert, User,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveScope, loanScopeWhere } from "@/lib/rbac/scope";
import { resolveOrg } from "@/lib/tenancy";
import { getLoanLive, type LiveLoanFile, type InstallmentStatus } from "@/lib/lms/servicesuite-loan";
import { BorrowerAvatar } from "@/components/kyc/BorrowerAvatar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
const num = (v: unknown) => Number(v ?? 0);
const day = (v: string | Date | null | undefined) =>
  v ? new Date(v).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const stamp = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

const INST_TONE: Record<InstallmentStatus, string> = {
  PAID: "bg-emerald-500/12 text-emerald-700",
  PARTIAL: "bg-amber-500/12 text-amber-700",
  DUE: "bg-amber-500/12 text-amber-700",
  OVERDUE: "bg-rose-500/12 text-rose-700",
  UPCOMING: "bg-ash-900/[0.06] text-[color:var(--ink-muted)]",
};

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-ash-900/10 bg-paper/60 px-3.5 py-2.5">
      <p className="t-label">{label}</p>
      <p className={`mt-0.5 text-lg font-bold leading-tight tabular-nums ${tone ?? "text-[color:var(--ink)]"}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-[color:var(--ink-faint)]">{sub}</p>}
    </div>
  );
}

function Panel({ title, icon, note, right, children }: {
  title: string; icon?: React.ReactNode; note?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="glass p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="t-section flex items-center gap-2">{icon}{title}</h2>
          {note && <p className="mt-0.5 text-[12px] text-[color:var(--ink-muted)]">{note}</p>}
        </div>
        {right}
      </div>
      <div className="mt-3.5">{children}</div>
    </section>
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

export default async function LoanProfile({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.orgId) redirect("/login");
  const orgId = session.user.orgId;
  const { id: raw } = await params;
  const id = decodeURIComponent(raw);

  const org = session.user.orgSlug ? await resolveOrg(session.user.orgSlug) : null;
  const bridged = !!(org?.bridgedReady && org.registry && org.entityId);

  // ── A LIVE LOAN ───────────────────────────────────────────────────────────
  // `ss:444259` — the ref the loans list and the statement both carry. No
  // resolve step: a loan is read straight from the lender's book, and browsing
  // one costs nothing.
  if (id.startsWith("ss:")) {
    if (!bridged) {
      return <Problem title="Not available" detail="This lender’s system is not connected, so their loans cannot be read." />;
    }
    const loanId = Number(id.slice(3));
    if (!Number.isInteger(loanId) || loanId <= 0) {
      return <Problem title="Unknown loan" detail={`${id} is not a loan reference we recognise.`} />;
    }
    let file: LiveLoanFile | null = null;
    try {
      file = await getLoanLive(org!.registry!, org!.entityId, loanId);
    } catch (err) {
      return <Problem title={`Could not read ${org!.name}’s book`} detail={err instanceof Error ? err.message : "The lender’s system did not answer."} />;
    }
    if (!file) {
      // Ids only mean something within an entity, and 3002 and 3005 hold
      // different people. Refusing is the safe answer.
      return <Problem title="Not this lender’s loan" detail={`No loan ${loanId} in entity ${org!.entityId}.`} />;
    }
    return <LiveLoanProfile file={file} lender={org!.name} />;
  }

  // ── OUR OWN BOOK ──────────────────────────────────────────────────────────
  const scope = await resolveScope(session);
  const loan = await prisma.loan.findFirst({
    where: { id, orgId, ...loanScopeWhere(scope) },
    include: {
      borrower: { select: { id: true, firstName: true, otherName: true, phone: true, nationalId: true, kycStatus: true } },
      product: { select: { name: true, interestRate: true, interestMethod: true } },
      installments: { orderBy: { seq: "asc" } },
      disbursement: true,
    },
  });
  if (!loan) redirect("/console/loans");

  const [receipts, stk] = await Promise.all([
    prisma.c2BReceipt.findMany({ where: { orgId, allocatedLoanId: loan.id }, orderBy: { createdAt: "desc" } }),
    prisma.paymentIntent.findMany({ where: { orgId, loanId: loan.id, state: "SUCCESS" }, orderBy: { createdAt: "desc" } }),
  ]);
  const payments = [
    ...receipts.map((r) => ({ at: r.createdAt, ref: r.transId, amount: num(r.amount), channel: "Paybill (C2B)" })),
    ...stk.map((p) => ({ at: p.updatedAt, ref: p.mpesaReceipt ?? "—", amount: num(p.amount), channel: "STK push" })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  const name = `${loan.borrower.firstName ?? "Borrower"}${loan.borrower.otherName ? " " + loan.borrower.otherName : ""}`.trim();
  const paidToDate = loan.installments.reduce((s, i) => s + num(i.amountPaid), 0);
  const totalDue = loan.installments.reduce((s, i) => s + num(i.amountDue), 0);
  const overdue = loan.installments.filter((i) => i.status === "OVERDUE");
  const behind = overdue.reduce((s, i) => s + Math.max(0, num(i.amountDue) - num(i.amountPaid)), 0);
  const nextDue = loan.installments.find((i) => i.status !== "PAID");

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <Link href="/console/loans" className="inline-flex items-center gap-1.5 text-sm text-[color:var(--ink-muted)] hover:text-[color:var(--ink)]">
        <ArrowLeft className="h-4 w-4" /> Loans
      </Link>

      <div className="glass mt-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
          <div className="flex min-w-0 items-center gap-4">
            <BorrowerAvatar name={name} portraitUrl={null} verified={loan.borrower.kycStatus === "VERIFIED"} tick={false} size="xl" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="t-title truncate">{loan.product.name}</h1>
                <span className="rounded-md bg-ash-900/[0.06] px-1.5 py-0.5 font-mono text-[11px] font-semibold text-[color:var(--ink-muted)]">
                  #{loan.id.slice(0, 8).toUpperCase()}
                </span>
                <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${loan.status === "CLEARED" ? "bg-emerald-500/12 text-emerald-700" : behind > 0 ? "bg-rose-500/12 text-rose-700" : "bg-sky-500/12 text-sky-700"}`}>
                  {behind > 0 && loan.status !== "CLEARED" ? "IN ARREARS" : loan.status.replaceAll("_", " ")}
                </span>
              </div>
              <p className="mt-0.5 t-meta">
                <Link href={`/console/borrowers/${loan.borrower.id}`} className="font-semibold hover:underline" style={{ color: "var(--brand)" }}>
                  {name}
                </Link>
                {` · ${loan.borrower.phone}`}
                {loan.borrower.nationalId ? ` · ID ${loan.borrower.nationalId}` : ""}
              </p>
              <p className="mt-1 text-[12px] text-[color:var(--ink-muted)]">
                {num(loan.product.interestRate)}% {loan.product.interestMethod} · taken {day(loan.borrowDate)} · expected clear {day(loan.expectedClearDate)}
              </p>
            </div>
          </div>
          <div className="grid w-full grid-cols-2 gap-2.5 sm:w-auto sm:shrink-0 sm:grid-cols-3">
            <Stat label="Balance" value={kes(num(loan.balance))} tone="text-[color:var(--brand)]" />
            <Stat label="Principal" value={kes(num(loan.principal))} sub={`+ ${kes(num(loan.interest))} interest`} />
            <Stat label="Paid to date" value={kes(paidToDate)} sub={`of ${kes(totalDue)}`} />
            <Stat label="Behind" value={behind > 0 ? kes(behind) : "—"} sub={overdue.length > 0 ? `${overdue.length} instalment${overdue.length === 1 ? "" : "s"} overdue` : "nothing overdue"} tone={behind > 0 ? "text-rose-600" : undefined} />
            <Stat label="Next due" value={nextDue ? day(nextDue.dueDate) : "—"} sub={nextDue ? kes(Math.max(0, num(nextDue.amountDue) - num(nextDue.amountPaid))) : "fully repaid"} />
            <Stat label="Instalments" value={`${loan.installments.filter((i) => i.status === "PAID").length}/${loan.installments.length}`} sub="settled" />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 border-t border-ash-900/10 pt-3">
          <Link href={`/console/loans/${loan.id}/statement`} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold text-white" style={{ backgroundColor: "var(--brand)" }}>
            <FileText className="h-3.5 w-3.5" /> Loan statement
          </Link>
          <Link href={`/console/borrowers/${loan.borrower.id}`} className="inline-flex items-center gap-1.5 rounded-lg border border-ash-900/12 bg-paper/70 px-3 py-2 text-[12px] font-semibold text-[color:var(--ink-body)] hover:bg-ash-900/[0.04]">
            <User className="h-3.5 w-3.5" /> Customer 360
          </Link>
          <Link href={`/console/borrowers/${loan.borrower.id}/statement`} className="inline-flex items-center gap-1.5 rounded-lg border border-ash-900/12 bg-paper/70 px-3 py-2 text-[12px] font-semibold text-[color:var(--ink-body)] hover:bg-ash-900/[0.04]">
            Full customer statement
          </Link>
        </div>
      </div>

      <div className="mt-4 space-y-4">
        <Panel title="Repayment schedule" icon={<CalendarClock className="h-4 w-4" style={{ color: "var(--brand)" }} />} note={`${loan.installments.length} instalments.`}>
          <div className="-mx-1 overflow-x-auto">
            <table className="data-table w-full min-w-[38rem]">
              <thead>
                <tr>
                  <th className="text-left">#</th>
                  <th className="text-left">Due</th>
                  <th className="text-right">Amount</th>
                  <th className="text-right">Paid</th>
                  <th className="text-right">Outstanding</th>
                  <th className="text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {loan.installments.map((i) => (
                  <tr key={i.id}>
                    <td className="text-[color:var(--ink-faint)]">{i.seq}</td>
                    <td>{day(i.dueDate)}</td>
                    <td className="text-right tabular-nums">{kes(num(i.amountDue))}</td>
                    <td className="text-right tabular-nums">{kes(num(i.amountPaid))}</td>
                    <td className="text-right font-semibold tabular-nums">{kes(Math.max(0, num(i.amountDue) - num(i.amountPaid)))}</td>
                    <td>
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${INST_TONE[i.status as InstallmentStatus] ?? INST_TONE.UPCOMING}`}>{i.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Money against this loan" icon={<Landmark className="h-4 w-4" style={{ color: "var(--brand)" }} />} note="Newest first.">
          {payments.length === 0 && !loan.disbursement ? (
            <p className="t-meta">Nothing has moved on this loan yet.</p>
          ) : (
            <div className="space-y-1.5">
              {loan.disbursement && (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-ash-900/10 bg-paper/60 px-3 py-2 text-[12px]">
                  <span className="flex min-w-0 items-center gap-2">
                    <ArrowDownLeft className="h-3.5 w-3.5 shrink-0 text-sky-600" />
                    <span className="truncate">Disbursement to {loan.disbursement.phone} · {loan.disbursement.state}</span>
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums text-sky-700">{kes(num(loan.disbursement.amount))}</span>
                </div>
              )}
              {payments.map((p, i) => (
                <div key={i} className="flex items-center justify-between gap-3 rounded-lg border border-ash-900/10 bg-paper/60 px-3 py-2 text-[12px]">
                  <span className="flex min-w-0 items-center gap-2">
                    <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                    <span className="truncate">{p.channel} · <span className="font-mono text-[11px]">{p.ref}</span></span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <span className="text-[11px] text-[color:var(--ink-faint)]">{day(p.at)}</span>
                    <span className="font-semibold tabular-nums text-emerald-700">{kes(p.amount)}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </main>
  );
}

// ── The live rendering ───────────────────────────────────────────────────────

function LiveLoanProfile({ file, lender }: { file: LiveLoanFile; lender: string }) {
  const { loan, borrower, schedule, ledger, totals } = file;
  const behind = loan.arrears > 0;
  const statementHref = `/console/loans/${encodeURIComponent(loan.ref)}/statement`;
  const customerHref = `/console/borrowers/resolve/${encodeURIComponent(`ss:${borrower.serviceSuiteId}`)}`;
  const customerStatementHref = `/console/borrowers/${encodeURIComponent(`ss:${borrower.serviceSuiteId}`)}/statement`;

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <Link href="/console/loans" className="inline-flex items-center gap-1.5 text-sm text-[color:var(--ink-muted)] hover:text-[color:var(--ink)]">
        <ArrowLeft className="h-4 w-4" /> Loans
      </Link>

      <div className="glass mt-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
          <div className="flex min-w-0 items-center gap-4">
            <BorrowerAvatar name={borrower.name ?? "Borrower"} portraitUrl={borrower.photoUrl} verified={false} tick={false} size="xl" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="t-title truncate">{loan.product ?? "Loan"}</h1>
                <span className="rounded-md bg-ash-900/[0.06] px-1.5 py-0.5 font-mono text-[11px] font-semibold text-[color:var(--ink-muted)]">
                  #{loan.loanId}
                </span>
                <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${loan.status === "CLEARED" ? "bg-emerald-500/12 text-emerald-700" : behind ? "bg-rose-500/12 text-rose-700" : "bg-sky-500/12 text-sky-700"}`}>
                  {behind ? "IN ARREARS" : loan.status}
                </span>
                {loan.rolledOver && (
                  <span className="rounded-md bg-amber-500/12 px-2 py-0.5 text-[10px] font-bold text-amber-700">ROLLED OVER</span>
                )}
              </div>
              <p className="mt-0.5 t-meta">
                <Link href={customerHref} className="font-semibold hover:underline" style={{ color: "var(--brand)" }}>
                  {borrower.name ?? `Customer ${borrower.serviceSuiteId}`}
                </Link>
                {borrower.phone ? ` · ${borrower.phone}` : ""}
                {borrower.nationalId ? ` · ID ${borrower.nationalId}` : ""}
                {borrower.accountNo ? ` · A/C ${borrower.accountNo}` : ""}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[color:var(--ink-muted)]">
                <span>{loan.term ? `${loan.term} · ` : ""}taken {day(loan.borrowDate)}</span>
                <span>expected clear {day(loan.expectedClearDate)}</span>
                {borrower.office && (
                  <span className="flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5 text-[color:var(--ink-faint)]" />
                    <span className="font-semibold text-[color:var(--ink)]">{borrower.office}</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="grid w-full grid-cols-2 gap-2.5 sm:w-auto sm:shrink-0 sm:grid-cols-3">
            <Stat label="Balance" value={kes(loan.balance)} tone="text-[color:var(--brand)]" />
            <Stat label="Principal" value={kes(loan.principal)} sub={`+ ${kes(loan.interest)} interest`} />
            <Stat label="Repayable" value={kes(loan.loanAmount)} sub={`${kes(loan.amountDisbursed)} disbursed`} />
            <Stat
              label="In arrears"
              value={behind ? kes(loan.arrears) : "—"}
              sub={loan.daysInArrears ? `${loan.daysInArrears} days past due` : "nothing behind"}
              tone={behind ? "text-rose-600" : undefined}
            />
            <Stat
              label="Next due"
              value={totals.nextDue ? day(totals.nextDue.date) : "—"}
              sub={totals.nextDue ? kes(totals.nextDue.amount) : "fully repaid"}
            />
            <Stat label="Instalments" value={`${totals.settled}/${totals.count}`} sub={`${kes(totals.paid)} paid`} />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-ash-900/10 pt-3">
          <Link href={statementHref} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold text-white" style={{ backgroundColor: "var(--brand)" }}>
            <FileText className="h-3.5 w-3.5" /> Loan statement
          </Link>
          <Link href={customerHref} className="inline-flex items-center gap-1.5 rounded-lg border border-ash-900/12 bg-paper/70 px-3 py-2 text-[12px] font-semibold text-[color:var(--ink-body)] hover:bg-ash-900/[0.04]">
            <User className="h-3.5 w-3.5" /> Customer 360
          </Link>
          <Link href={customerStatementHref} className="inline-flex items-center gap-1.5 rounded-lg border border-ash-900/12 bg-paper/70 px-3 py-2 text-[12px] font-semibold text-[color:var(--ink-body)] hover:bg-ash-900/[0.04]">
            Full customer statement
          </Link>
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
            <Radio className="h-3 w-3" /> Live · {lender} · entity {loan.entityId}
          </span>
        </div>
      </div>

      {behind && (
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-rose-600/20 bg-rose-500/[0.05] px-4 py-3 text-[13px]">
          <TriangleAlert className="h-4 w-4 shrink-0 text-rose-600" />
          <span className="font-semibold text-rose-700">
            {kes(loan.arrears)} behind, {loan.daysInArrears} days past due
          </span>
          <span className="text-[color:var(--ink-muted)]">
            Straight from {lender}&rsquo;s own arrears register — never our arithmetic, so this page and their PAR
            reports can never disagree.
            {loan.firstMissedAt ? ` First missed ${day(loan.firstMissedAt)}.` : ""}
          </span>
        </div>
      )}

      <div className="mt-4 space-y-4">
        <Panel
          title="Repayment schedule"
          icon={<CalendarClock className="h-4 w-4" style={{ color: "var(--brand)" }} />}
          note={`${totals.count} instalments · ${kes(totals.paid)} paid of ${kes(totals.scheduled)}.`}
        >
          {schedule.length === 0 ? (
            <p className="t-meta">No schedule has been written for this loan yet.</p>
          ) : (
            <div className="-mx-1 overflow-x-auto">
              <table className="data-table w-full min-w-[40rem]">
                <thead>
                  <tr>
                    <th className="text-left">#</th>
                    <th className="text-left">Due</th>
                    <th className="text-right">Instalment</th>
                    <th className="text-right">Paid</th>
                    <th className="text-right">Outstanding</th>
                    <th className="text-left">Settled</th>
                    <th className="text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {schedule.map((s) => (
                    <tr key={s.seq}>
                      <td className="text-[color:var(--ink-faint)]">{s.seq}</td>
                      <td>{day(s.dueDate)}</td>
                      <td className="text-right tabular-nums">{kes(s.due)}</td>
                      <td className="text-right tabular-nums">{s.paid > 0 ? kes(s.paid) : "—"}</td>
                      <td className="text-right font-semibold tabular-nums">{s.outstanding > 0 ? kes(s.outstanding) : "—"}</td>
                      <td className="text-[11px] text-[color:var(--ink-muted)]">{s.paidAt ? day(s.paidAt) : "—"}</td>
                      <td>
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${INST_TONE[s.status]}`}>{s.status}</span>
                        {s.penalised && <span className="ml-1 text-[10px] font-semibold text-amber-700">penalty</span>}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-ash-900/20 font-bold">
                    <td colSpan={2}>Total</td>
                    <td className="text-right tabular-nums">{kes(totals.scheduled)}</td>
                    <td className="text-right tabular-nums">{kes(totals.paid)}</td>
                    <td className="text-right tabular-nums">{kes(totals.outstanding)}</td>
                    <td colSpan={2} />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel
          title="Money against this loan"
          icon={<Landmark className="h-4 w-4" style={{ color: "var(--brand)" }} />}
          note='Newest first. "In" is money reaching the customer, so a repayment is out — the lender&rsquo;s own convention.'
          right={
            <Link href={customerStatementHref} className="text-[12px] font-semibold hover:underline" style={{ color: "var(--brand)" }}>
              Full statement →
            </Link>
          }
        >
          {ledger.length === 0 ? (
            <p className="t-meta">Nothing has been posted against this loan yet.</p>
          ) : (
            <div className="-mx-1 overflow-x-auto">
              <table className="data-table w-full min-w-[36rem]">
                <thead>
                  <tr>
                    <th className="text-left">When</th>
                    <th className="text-left">What</th>
                    <th className="text-left">Reference</th>
                    <th className="text-right">Amount</th>
                    <th className="text-right">Balance after</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((t) => (
                    <tr key={t.id}>
                      <td className="whitespace-nowrap text-[11px] text-[color:var(--ink-muted)]">{stamp(t.at)}</td>
                      <td>
                        <span className="flex items-center gap-1.5">
                          {t.direction === "in"
                            ? <ArrowDownLeft className="h-3.5 w-3.5 shrink-0 text-sky-600" aria-label="to the customer" />
                            : <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-label="from the customer" />}
                          <span className="truncate">{t.narration ?? (t.direction === "in" ? "Disbursement" : "Repayment")}</span>
                        </span>
                      </td>
                      <td className="text-[11px] text-[color:var(--ink-faint)]">{t.reference ?? "—"}</td>
                      <td className={`text-right font-semibold tabular-nums ${t.direction === "in" ? "text-sky-700" : "text-emerald-700"}`}>
                        {t.direction === "in" ? "+" : "−"}{kes(t.amount)}
                      </td>
                      <td className="text-right tabular-nums text-[color:var(--ink-muted)]">
                        {t.loanBalance != null ? kes(t.loanBalance) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </main>
  );
}
