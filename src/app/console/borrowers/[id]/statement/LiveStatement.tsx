// ─────────────────────────────────────────────────────────────────────────────
// THE CUSTOMER STATEMENT, READ LIVE FROM THE LENDER'S BOOK.
//
// The sibling page renders this from our Postgres for a NATIVE lender. This one
// renders the same sheet for a BRIDGED lender's customer, whose entire money
// history lives in their ServiceSuite and has never been through our funnel.
//
// It is modelled on ServiceSuite's own `sp_GetCustomerStatement` — the running
// loan, the transaction ledger, the borrower's office — with two deliberate
// departures, both explained in lib/lms/servicesuite-statement.ts: it returns
// numbers rather than pre-formatted currency strings, and it shows EVERY
// approved loan rather than their TOP 1, because "five cleared before this one"
// is the most informative thing on a page about repayment behaviour.
//
// DIRECTION IS FROM THE CUSTOMER'S SIDE, which is their convention and worth
// stating on the screen rather than leaving to be inferred: a loan repayment is
// money OUT, because it left the customer, even though it arrived at the lender.
// ─────────────────────────────────────────────────────────────────────────────
import Link from "next/link";
import { ArrowLeft, Radio, TrendingDown, TrendingUp } from "lucide-react";
import { PrintButton } from "@/components/print/PrintButton";
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

export function LiveStatementView({ statement, lender }: { statement: Statement; lender: string }) {
  const { borrower, loans, transactions, totals, truncated } = statement;
  const running = loans.filter((l) => l.status === "ACTIVE");
  const cleared = loans.filter((l) => l.status === "CLEARED");

  return (
    <main className="mx-auto max-w-5xl px-4 sm:px-6 py-8">
      <div className="flex items-center justify-between gap-3 print:hidden">
        <Link
          href="/console/borrowers"
          className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[color:var(--ink-muted)] hover:underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Borrowers
        </Link>
        <PrintButton />
      </div>

      <header className="mt-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-[color:var(--ink)]">{borrower.name ?? "Customer"}</h1>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
            <Radio className="h-3 w-3" /> Live · {lender} · entity {borrower.entityId}
          </span>
        </div>
        <p className="t-meta mt-1 text-[12px] text-[color:var(--ink-muted)]">
          Account {borrower.accountNo ?? "—"}
          {borrower.nationalId ? ` · ID ${borrower.nationalId}` : ""}
          {borrower.phone ? ` · ${borrower.phone}` : ""}
          {borrower.office ? ` · ${borrower.office}` : ""}
        </p>
      </header>

      {/* ── What the relationship adds up to ─────────────────────────────────
          Totals are over the WHOLE ledger, not the rows below. A customer with
          four years of history would otherwise have their repayments understated
          by whatever the page happens to show, which is the least forgivable
          arithmetic on this screen. */}
      <section className="mt-5 grid gap-3 sm:grid-cols-3">
        <Tile
          icon={TrendingUp}
          label="Money in"
          hint="Disbursements to the customer"
          value={kes(totals.moneyIn)}
          tone="text-sky-700"
        />
        <Tile
          icon={TrendingDown}
          label="Money out"
          hint="Repayments, savings and charges"
          value={kes(totals.moneyOut)}
          tone="text-emerald-700"
        />
        <Tile
          label="History"
          hint={`${day(totals.firstAt)} → ${day(totals.lastAt)}`}
          value={`${totals.count.toLocaleString()} entries`}
          tone="text-[color:var(--ink)]"
        />
      </section>

      {/* ── The loans, newest first ───────────────────────────────────────── */}
      <section className="mt-6">
        <h2 className="text-[13px] font-semibold text-[color:var(--ink)]">
          Loans · {running.length} running, {cleared.length} cleared
        </h2>
        <div className="glass mt-2 overflow-x-auto">
          <table className="data-table text-sm">
            <thead>
              <tr>
                <th>Loan</th>
                <th>Product</th>
                <th>Taken</th>
                <th className="num">Principal</th>
                <th className="num">Balance</th>
                <th className="num">Arrears</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loans.map((l) => (
                <tr key={l.loanId}>
                  <td className="t-num">#{l.loanId}</td>
                  <td>
                    {l.product ?? "—"}
                    {l.installments ? (
                      <span className="block text-[11px] text-[color:var(--ink-muted)]">{l.installments}</span>
                    ) : null}
                  </td>
                  <td className="t-num text-[11px] text-[color:var(--ink-muted)]">{l.borrowDate ?? "—"}</td>
                  <td className="num">{kes(l.principal)}</td>
                  <td className="num font-semibold text-[color:var(--ink)]">{kes(l.balance)}</td>
                  <td className="num">
                    {l.arrears > 0 ? (
                      <span className="font-semibold text-red-600">
                        {kes(l.arrears)}
                        {l.daysInArrears ? (
                          <span className="block text-[10px] font-normal text-red-500">{l.daysInArrears}d late</span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-[color:var(--ink-muted)]">—</span>
                    )}
                  </td>
                  <td>
                    <span
                      className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${
                        l.status === "ACTIVE" ? "bg-emerald-100 text-emerald-700" : "bg-ash-900/5 text-ash-500"
                      }`}
                    >
                      {l.status.toLowerCase()}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── The ledger ───────────────────────────────────────────────────── */}
      <section className="mt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[13px] font-semibold text-[color:var(--ink)]">Statement</h2>
          <p className="t-meta text-[11px] text-[color:var(--ink-muted)]">
            {/* Their convention, said out loud rather than left to be guessed. */}
            Direction is from the customer&rsquo;s side — a repayment is money out.
          </p>
        </div>

        <div className="glass mt-2 overflow-x-auto">
          <table className="data-table text-sm">
            <thead>
              <tr>
                <th>When</th>
                <th>Narration</th>
                <th>Reference</th>
                <th>Loan</th>
                <th className="num">In</th>
                <th className="num">Out</th>
                <th className="num">Loan balance</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => (
                <tr key={t.id}>
                  <td className="t-num whitespace-nowrap text-[11px] text-[color:var(--ink-muted)]">{stamp(t.at)}</td>
                  <td>{t.narration ?? "—"}</td>
                  <td className="t-num text-[11px]">{t.reference ?? "—"}</td>
                  <td className="t-num text-[11px] text-[color:var(--ink-muted)]">{t.loanId ? `#${t.loanId}` : "—"}</td>
                  <td className="num text-sky-700">{t.direction === "in" ? kes(t.amount) : ""}</td>
                  <td className="num text-emerald-700">{t.direction === "out" ? kes(t.amount) : ""}</td>
                  <td className="num text-[color:var(--ink-muted)]">{t.loanBalance != null ? kes(t.loanBalance) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {truncated && (
          <p className="t-meta mt-2 px-1 text-[11px] text-[color:var(--ink-muted)]">
            Showing the most recent {transactions.length.toLocaleString()} of {totals.count.toLocaleString()} entries.
            The totals above cover all of them.
          </p>
        )}
      </section>
    </main>
  );
}

function Tile({
  icon: Icon,
  label,
  hint,
  value,
  tone,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  hint: string;
  value: string;
  tone: string;
}) {
  return (
    <div className="glass p-4">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[color:var(--ink-muted)]">
        {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
        {label}
      </p>
      <p className={`mt-1 text-lg font-semibold ${tone}`}>{value}</p>
      <p className="t-meta mt-0.5 text-[11px] text-[color:var(--ink-muted)]">{hint}</p>
    </div>
  );
}
