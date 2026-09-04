// ─────────────────────────────────────────────────────────────────────────────
// THE CUSTOMER STATEMENT, READ LIVE FROM THE LENDER'S BOOK.
//
// The sibling page renders this from our Postgres for a NATIVE lender. This one
// renders the same sheet for a customer whose entire money history lives in the
// lender's ServiceSuite — which, for Micromart, is every customer they have.
//
// ── WHY THIS PAGE WAS EMPTY, AND WHAT THAT COST ─────────────────────────────
// It used to take the live path ONLY for a `ss:<id>` ref. But the moment an
// officer opens a customer, the resolve step gives them a Postgres uuid, and
// every link from Customer 360 carries that uuid — so the statement fell through
// to the native branch and read OUR tables, where a resolved customer has no
// disbursement, no receipt and no savings row. The page rendered perfectly and
// said, in effect, "this customer has never paid you anything" about somebody
// whose ledger three tabs away showed twenty-five entries. Now the live book is
// consulted for BOTH kinds of id, and the sheet is the lender's own.
//
// ── IT IS A DOCUMENT, NOT A SCREEN ──────────────────────────────────────────
// This is the thing a customer is handed across a desk or sent on WhatsApp, so
// it is laid out as paper: the lender's letterhead, the parties, the totals, the
// loans, then every entry. The console furniture — the live badge, the back
// link, the download button — is marked no-print and disappears from the PDF.
//
// DIRECTION IS FROM THE CUSTOMER'S SIDE, which is their convention and worth
// stating on the sheet rather than leaving to be inferred: a loan repayment is
// money OUT, because it left the customer, even though it arrived at the lender.
// ─────────────────────────────────────────────────────────────────────────────
import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, Radio } from "lucide-react";
import { DocumentSheet, Letterhead, DocumentFooter, DocStat, type Lender } from "@/components/print/Document";
import type { LiveStatement as Statement } from "@/lib/lms/servicesuite-statement";

const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const stamp = (iso: string) =>
  iso
    ? new Date(iso).toLocaleString("en-GB", {
        day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
      })
    : "—";

export function LiveStatementView({
  statement,
  lender,
  backHref,
  issuedBy,
  loanHref,
}: {
  statement: Statement;
  lender: Lender;
  /** Where the back link goes — Customer 360 when we came from it. */
  backHref: string;
  issuedBy: string;
  /** Builds the link to one loan's own file. Omitted when there is no such page. */
  loanHref?: (loanId: number) => string;
}) {
  const { borrower, loans, transactions, totals, truncated } = statement;
  const running = loans.filter((l) => l.status === "ACTIVE");
  const cleared = loans.filter((l) => l.status === "CLEARED");
  const outstanding = running.reduce((s, l) => s + l.balance, 0);
  const arrears = loans.reduce((s, l) => s + (l.arrears || 0), 0);
  const worstDpd = loans.reduce((m, l) => Math.max(m, l.daysInArrears ?? 0), 0);
  const accent = lender.accent ?? "#000";
  const ref = borrower.accountNo ?? String(borrower.serviceSuiteId);

  return (
    <DocumentSheet backHref={backHref} backLabel={borrower.name ?? "Customer"} downloadLabel="Download statement" wide>
      {/* Screen-only: which book answered. It is the most important line on the
          page for a bridged lender and the least appropriate one on the paper —
          a customer holding a statement does not need to be told where their
          lender keeps their records. */}
      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
          <Radio className="h-3 w-3" /> Live · {lender.name} · entity {borrower.entityId}
        </span>
        <span className="text-[11px] text-ash-500">
          Read from the lender&rsquo;s own book just now — every figure below is as it stands at this moment.
        </span>
      </div>

      <Letterhead lender={lender} title="CUSTOMER STATEMENT" reference={ref} />

      {/* Parties */}
      <section className="mt-5 grid grid-cols-2 gap-6 text-[12px] print-break">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-ash-500">Customer</p>
          <p className="mt-1 text-sm font-semibold">{borrower.name ?? "Customer"}</p>
          {borrower.phone && <p className="text-ash-600">{borrower.phone}</p>}
          {borrower.nationalId && <p className="text-ash-600">ID {borrower.nationalId}</p>}
          {borrower.accountNo && <p className="text-ash-600">A/C {borrower.accountNo}</p>}
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-widest text-ash-500">Relationship</p>
          <p className="mt-1 text-ash-600">
            {loans.length} loan{loans.length === 1 ? "" : "s"} on record · {running.length} running, {cleared.length} cleared
          </p>
          <p className="text-ash-600">Banking since {day(totals.firstAt)}</p>
          {borrower.office && <p className="text-ash-600">{borrower.office}</p>}
        </div>
      </section>

      {/* What the relationship adds up to. Totals are over the WHOLE ledger, not
          the rows below — a customer with four years of history would otherwise
          have their repayments understated by whatever the page happens to show,
          which is the least forgivable arithmetic on this sheet. */}
      <section className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-5 print-break">
        <DocStat label="Disbursed to them" value={kes(totals.moneyIn)} />
        <DocStat label="Repaid by them" value={kes(totals.moneyOut)} sub={`${totals.count.toLocaleString()} entries`} />
        <DocStat label="Outstanding" value={kes(outstanding)} accent={accent} />
        <DocStat
          label="In arrears"
          value={arrears > 0 ? kes(arrears) : "—"}
          sub={worstDpd > 0 ? `${worstDpd} days past due` : "nothing behind"}
          tone={arrears > 0 ? "text-rose-700" : undefined}
        />
        <DocStat label="Last movement" value={day(totals.lastAt)} />
      </section>

      {/* The loans, newest first. */}
      <section className="mt-6 print-break">
        <h2 className="text-[11px] uppercase tracking-widest text-ash-500">
          Loans · {running.length} running, {cleared.length} cleared
        </h2>
        <p className="mt-0.5 text-[10px] text-ash-500">
          Arrears is the lender&rsquo;s own register, never our arithmetic — so this sheet and their PAR reports can
          never disagree.
        </p>
        <table className="mt-2 w-full text-[11px]">
          <thead>
            <tr className="border-y border-ash-900/10 text-ash-500">
              <th className="py-1.5 text-left font-medium">Loan</th>
              <th className="py-1.5 text-left font-medium">Taken</th>
              <th className="py-1.5 text-right font-medium">Principal</th>
              <th className="py-1.5 text-right font-medium">Balance</th>
              <th className="py-1.5 text-right font-medium">Arrears</th>
              <th className="py-1.5 text-right font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {loans.map((l) => {
              const behind = (l.daysInArrears ?? 0) > 0;
              const cell = (
                <>
                  <span className="font-medium text-ash-800">{l.product ?? "Loan"}</span>
                  <span className="ml-1 text-[10px] text-ash-500">#{l.loanId}</span>
                  {l.installments && <span className="block text-[10px] text-ash-500">{l.installments}</span>}
                </>
              );
              return (
                <tr key={l.loanId} className="border-b border-ash-900/5">
                  <td className="py-1.5">
                    {loanHref ? (
                      <Link href={loanHref(l.loanId)} className="hover:underline">
                        {cell}
                      </Link>
                    ) : (
                      cell
                    )}
                  </td>
                  <td className="py-1.5">{day(l.borrowDate)}</td>
                  <td className="py-1.5 text-right tabular-nums">{kes(l.principal)}</td>
                  <td className="py-1.5 text-right font-semibold tabular-nums">{kes(l.balance)}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {behind ? (
                      <span className="font-semibold text-rose-700">
                        {kes(l.arrears)} <span className="text-[9px]">{l.daysInArrears}d</span>
                      </span>
                    ) : (
                      <span className="text-ash-400">—</span>
                    )}
                  </td>
                  <td className="py-1.5 text-right">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
                        l.status === "CLEARED"
                          ? "bg-emerald-500/12 text-emerald-700"
                          : behind
                            ? "bg-rose-500/12 text-rose-700"
                            : "bg-sky-500/12 text-sky-700"
                      }`}
                    >
                      {behind && l.status !== "CLEARED" ? "IN ARREARS" : l.status}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* THE LEDGER — the whole point of the sheet. */}
      <section className="mt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[11px] uppercase tracking-widest text-ash-500">
            The ledger · {totals.count.toLocaleString()} entries
          </h2>
          <p className="text-[10px] text-ash-500">
            Newest first. Direction is from the customer&rsquo;s side — &ldquo;in&rdquo; is money reaching them, so a
            repayment is out.
          </p>
        </div>
        {transactions.length === 0 ? (
          <p className="mt-2 text-[12px] text-ash-500">Nothing has moved on this account yet.</p>
        ) : (
          <table className="mt-2 w-full text-[11px]">
            <thead>
              <tr className="border-y border-ash-900/10 text-ash-500">
                <th className="py-1.5 text-left font-medium">When</th>
                <th className="py-1.5 text-left font-medium">What</th>
                <th className="py-1.5 text-left font-medium">Reference</th>
                <th className="py-1.5 text-left font-medium">Loan</th>
                <th className="py-1.5 text-right font-medium">In</th>
                <th className="py-1.5 text-right font-medium">Out</th>
                <th className="py-1.5 text-right font-medium">Balance after</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => (
                <tr key={t.id} className="border-b border-ash-900/5">
                  <td className="whitespace-nowrap py-1.5 text-ash-600">{stamp(t.at)}</td>
                  <td className="py-1.5">
                    <span className="flex items-center gap-1.5">
                      {t.direction === "in" ? (
                        <ArrowDownLeft className="h-3 w-3 shrink-0 text-sky-600" aria-label="to the customer" />
                      ) : (
                        <ArrowUpRight className="h-3 w-3 shrink-0 text-emerald-600" aria-label="from the customer" />
                      )}
                      <span className="font-medium text-ash-700">
                        {t.narration ?? (t.direction === "in" ? "Disbursement" : "Repayment")}
                      </span>
                    </span>
                  </td>
                  <td className="py-1.5 font-mono text-[10px] text-ash-500">{t.reference ?? "—"}</td>
                  <td className="py-1.5 text-[10px] text-ash-500">{t.loanId ? `#${t.loanId}` : "—"}</td>
                  <td className="py-1.5 text-right tabular-nums text-sky-700">
                    {t.direction === "in" ? kes(t.amount) : ""}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-emerald-700">
                    {t.direction === "out" ? kes(t.amount) : ""}
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-ash-500">
                    {t.loanBalance != null ? kes(t.loanBalance) : "—"}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-ash-900/20 font-bold">
                <td className="py-1.5" colSpan={4}>
                  Total across the whole ledger
                </td>
                <td className="py-1.5 text-right tabular-nums">{kes(totals.moneyIn)}</td>
                <td className="py-1.5 text-right tabular-nums">{kes(totals.moneyOut)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        )}
        {truncated && (
          <p className="mt-2 text-[10px] text-ash-500">
            Showing the most recent {transactions.length.toLocaleString()} of {totals.count.toLocaleString()} entries.
            The totals above cover all of them.
          </p>
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
