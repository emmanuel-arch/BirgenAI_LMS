"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE BOOKS.
//
// ── WHY THIS IS "MOVEMENT" AND NOT A BALANCE SHEET ───────────────────────────
// The journal has no opening balances, no period locks and no closing entries.
// A balance sheet derived from it would be a number with no defensible starting
// point, which for an accounting screen is worse than no number at all. So this
// reports what MOVED through each account over a window the reader chooses, and
// says on the page that that is what it is.
//
// Accounts are grouped by their own type — INCOME, EXPENSE, LIABILITY, ASSET —
// because that is how Micromart typed them, not how we would have.
// ─────────────────────────────────────────────────────────────────────────────

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Card, CardHead, PageHead, Stat, Tag, BarRow, Columns, KES, N, PCT, ago, shortTime, Empty, TimeAgo } from "@/components/suite/kit";

type Account = {
  id: number; name: string; type: string; entityId: number;
  debits: number; credits: number; net: number; entries: number;
};
type Entry = {
  id: number; at: string | null; amount: number; narration: string;
  from: string; to: string; loanId: number; borrowerId: number; entityId: number;
};

const TYPE_ACCENT: Record<string, string> = {
  INCOME: "#0f766e",
  EXPENSE: "#be123c",
  LIABILITY: "#7c3aed",
  ASSET: "#2a78d6",
};

const TYPE_ORDER = ["INCOME", "ASSET", "LIABILITY", "EXPENSE"];

export default function BooksBoard({
  days, totals, accounts, recent, daily, lastEntryAt, journalRows, entityIds,
}: {
  days: number;
  totals: {
    income: number; expense: number; entries: number;
    disbursed: number; disbursedCount: number;
    collected: number; collectedCount: number;
  };
  accounts: Account[];
  recent: Entry[];
  daily: { day: string; income: number; entries: number }[];
  lastEntryAt: string | null;
  journalRows: number;
  entityIds: number[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const setDays = (d: number) => {
    const next = new URLSearchParams(sp.toString());
    next.set("days", String(d));
    router.push(`${pathname}?${next.toString()}`);
  };

  const grouped = TYPE_ORDER
    .map((t) => ({ type: t, rows: accounts.filter((a) => a.type === t).sort((a, b) => b.debits + b.credits - (a.debits + a.credits)) }))
    .filter((g) => g.rows.length > 0);

  const maxMove = Math.max(...accounts.map((a) => Math.max(a.debits, a.credits)), 1);
  const netCash = totals.collected - totals.disbursed;

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
      <PageHead
        eyebrow="Ledgerly"
        title="The books"
        sub={<>Read live from Serviceconnect&rsquo;s own journal — {N(journalRows)} double-entry postings across entities {entityIds.join(" and ")}, last written <TimeAgo at={lastEntryAt} />.</>}
        right={
          <div className="flex rounded-lg bg-zinc-900/[0.045] p-0.5">
            {[7, 30, 90, 365].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                  days === d ? "bg-white text-zinc-800 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
                }`}
              >
                {d === 365 ? "1y" : `${d}d`}
              </button>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label={`Income · ${days} days`}
          value={KES(totals.income)}
          unit="KES"
          foot="interest, fees and penalties posted to income accounts"
        />
        <Stat
          label="Disbursed"
          value={KES(totals.disbursed, { compact: true })}
          unit="KES"
          foot={`${N(totals.disbursedCount)} loans booked`}
        />
        <Stat
          label="Collected"
          value={KES(totals.collected, { compact: true })}
          unit="KES"
          foot={`${N(totals.collectedCount)} receipts`}
        />
        <Stat
          label="Net cash movement"
          value={KES(Math.abs(netCash), { compact: true })}
          unit={netCash >= 0 ? "KES in" : "KES out"}
          foot={netCash >= 0 ? "more collected than disbursed" : "more disbursed than collected — the book is growing"}
        />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)]">
        <Card>
          <CardHead
            title="Movement by account"
            sub="What flowed into and out of each account in the window. Grouped by the type Micromart assigned it."
          />
          <div className="space-y-3">
            {grouped.map((g) => (
              <div key={g.type}>
                <p className="mb-1 flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-[0.14em] text-zinc-400">
                  <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: TYPE_ACCENT[g.type] }} />
                  {g.type}
                </p>
                <div className="space-y-0.5">
                  {g.rows.map((a) => (
                    <BarRow
                      key={a.id}
                      label={a.name}
                      chip={a.entityId === 3005 ? <Tag tone="good">3005</Tag> : undefined}
                      value={Math.max(a.debits, a.credits)}
                      max={maxMove}
                      accent={TYPE_ACCENT[a.type] ?? "#71717a"}
                      right={KES(Math.max(a.debits, a.credits), { compact: true })}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 border-t border-zinc-900/[0.06] pt-2.5 text-[10.5px] leading-relaxed text-zinc-400">
            This is MOVEMENT, not a balance sheet. The journal carries no opening balances, no period locks and no
            closing entries, so a balance derived from it would have no defensible starting point. What is shown is
            exactly what the data supports.
          </p>
        </Card>

        <div className="space-y-3">
          <Card>
            <CardHead title="Income, by day" sub="Posted to income-typed accounts." />
            {daily.length > 1 ? (
              <Columns
                data={daily.slice(-45).map((d) => ({ label: d.day.slice(5), value: d.income, sub: `${N(d.entries)} postings` }))}
                height={120}
                accent="#0f766e"
              />
            ) : (
              <Empty title="Not enough days in this window" />
            )}
          </Card>

          <Card>
            <CardHead title="The chart of accounts" sub="Eighteen accounts, four types — Micromart's own." />
            <div className="flex flex-wrap gap-1.5">
              {TYPE_ORDER.map((t) => {
                const n = accounts.filter((a) => a.type === t).length;
                if (n === 0) return null;
                return (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-900/10 px-2 py-1 text-[11px] font-semibold text-zinc-600"
                  >
                    <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: TYPE_ACCENT[t] }} />
                    {t} <span className="tabular-nums text-zinc-400">{n}</span>
                  </span>
                );
              })}
            </div>
            <p className="mt-2.5 text-[10.5px] leading-relaxed text-zinc-500">
              Entity 3005 has its own Processing Fee, CRB Fee and Security Fee accounts, opened on 3 August 2026 — the
              Fintech entity was set up with its own income lines rather than sharing 3002&rsquo;s.
            </p>
          </Card>
        </div>
      </div>

      <Card className="mt-3" pad={false}>
        <div className="p-4 pb-2">
          <CardHead
            title="The journal"
            sub="Newest postings, both sides named. Every row links to the loan it moved against."
          />
        </div>
        {recent.length === 0 ? (
          <div className="p-4"><Empty title="No postings" /></div>
        ) : (
          <div className="max-h-[520px] overflow-auto">
            <table className="w-full min-w-[880px] text-left">
              <thead>
                <tr className="border-y border-zinc-900/[0.07] text-[9.5px] font-bold uppercase tracking-[0.1em] text-zinc-400">
                  <th className="sticky top-0 bg-white px-4 py-2">When</th>
                  <th className="sticky top-0 bg-white px-3 py-2">Narration</th>
                  <th className="sticky top-0 bg-white px-3 py-2">From → to</th>
                  <th className="sticky top-0 bg-white px-3 py-2 text-right">Amount</th>
                  <th className="sticky top-0 bg-white px-3 py-2">Loan</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((e) => (
                  <tr key={e.id} className="border-b border-zinc-900/[0.045] last:border-0 hover:bg-zinc-900/[0.022]">
                    <td className="px-4 py-1.5 text-[10.5px] tabular-nums text-zinc-500">
                      {shortTime(e.at)}
                      <span className="block text-[9.5px] text-zinc-400">{ago(e.at)}</span>
                    </td>
                    <td className="px-3 py-1.5">
                      <span className="block truncate text-[12px] font-medium text-zinc-800">{e.narration}</span>
                      {e.entityId === 3005 && <Tag tone="good">Fintech 3005</Tag>}
                    </td>
                    <td className="px-3 py-1.5">
                      <span className="flex items-center gap-1 text-[11px] text-zinc-600">
                        <span className="truncate">{e.from}</span>
                        <span aria-hidden className="text-zinc-300">→</span>
                        <span className="truncate font-medium">{e.to}</span>
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right text-[12px] font-semibold tabular-nums text-zinc-800">{KES(e.amount)}</td>
                    <td className="px-3 py-1.5">
                      <Link href={`/desk/case/${e.loanId}`} className="text-[11px] tabular-nums text-zinc-500 hover:text-[color:var(--accent)] hover:underline">
                        #{e.loanId}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="mt-3 text-[10.5px] text-zinc-400">
        Serviceconnect.Journals · Serviceconnect.Accounts · Serviceconnect.AccountTypes · Serviceconnect.Loans ·
        CollectBox.PayedAmount
      </p>
    </div>
  );
}
