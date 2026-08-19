"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE JOURNAL.
//
// Paging, the window and the account filter are all in the URL rather than in
// component state. That is not tidiness: it means a supervisor can send a
// colleague the exact view they are looking at, and it means the back button
// works. On a screen whose whole claim is "this is your real ledger", a view you
// cannot link to undercuts the claim.
//
// Every row carries its LOAN. That column is the reason this screen belongs in a
// connected suite rather than in an accounting package — it is the same integer
// the console, the portal and the collections floor use.
// ─────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, ScrollText } from "lucide-react";
import { Card, CardHead, PageHead, Stat, LivePulse, KES, N, shortDate, shortTime, Empty } from "@/components/suite/kit";

type Row = {
  id: number;
  at: string | null;
  amount: number;
  narration: string;
  from: string;
  to: string;
  loanId: number;
  borrowerId: number;
  entityId: number;
};

const ACCENT = "#0f766e";
const WINDOWS = [7, 30, 90, 365];

export default function JournalBoard({
  rows,
  accounts,
  page,
  pageSize,
  matched,
  journalRows,
  windowDays,
  accountId,
  lastEntryAt,
}: {
  rows: Row[];
  accounts: { id: number; name: string; type: string }[];
  page: number;
  pageSize: number;
  matched: number;
  journalRows: number;
  windowDays: number;
  accountId: number | null;
  lastEntryAt: string | null;
}) {
  const router = useRouter();
  const sp = useSearchParams();

  const go = (patch: Record<string, string | number | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "" || v === 0) next.delete(k);
      else next.set(k, String(v));
    }
    router.push(`/books/journal?${next.toString()}`);
  };

  const pages = Math.max(Math.ceil(matched / pageSize), 1);
  const account = accounts.find((a) => a.id === accountId) ?? null;

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
      <PageHead
        eyebrow="Ledgerly"
        title="The journal"
        sub="Every posting Micromart have made, newest first, with both sides named and the loan it belongs to. Three years of double entry that no screen has ever read."
        right={<LivePulse label="Last posting" at={lastEntryAt} />}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Postings in the journal" value={N(journalRows)} accent={ACCENT} foot="Serviceconnect.dbo.Journals" />
        <Stat
          label={`In the last ${windowDays} days`}
          value={N(matched)}
          accent={ACCENT}
          foot={account ? `filtered to ${account.name}` : "every account"}
        />
        <Stat label="Accounts in the chart" value={N(accounts.length)} accent={ACCENT} />
        <Stat label="Page" value={`${N(page)} of ${N(pages)}`} accent={ACCENT} foot={`${pageSize} rows a page`} />
      </div>

      <Card className="mt-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1">
            <span className="mr-1 text-[11px] font-medium text-zinc-400">Window</span>
            {WINDOWS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => go({ days: d === 30 ? null : d, page: null })}
                className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                  windowDays === d ? "bg-zinc-900 text-white" : "text-zinc-500 hover:bg-zinc-900/[0.05]"
                }`}
              >
                {d === 365 ? "1 year" : `${d} days`}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-medium text-zinc-400">Account</span>
            <select
              value={accountId ?? 0}
              onChange={(e) => go({ account: Number(e.target.value) || null, page: null })}
              className="rounded-lg border border-zinc-900/10 bg-white px-2 py-1.5 text-[11.5px] outline-none"
            >
              <option value={0}>Every account</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.type}
                </option>
              ))}
            </select>
          </div>

          <p className="ml-auto text-[11px] text-zinc-400">
            An account is matched on <strong className="font-semibold text-zinc-500">either</strong> side of the posting —
            filtering only on the destination would hide half its activity.
          </p>
        </div>
      </Card>

      <Card className="mt-3" pad={false}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-900/[0.06] px-4 py-3">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold text-zinc-800">
            <ScrollText className="h-4 w-4 text-zinc-400" />
            {account ? account.name : "Every posting"}
          </h2>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => go({ page: page - 1 <= 1 ? null : page - 1 })}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-zinc-600 transition-colors hover:bg-zinc-900/[0.05] disabled:pointer-events-none disabled:text-zinc-300"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Newer
            </button>
            <span className="px-1 text-[11px] tabular-nums text-zinc-400">
              {N(page)} / {N(pages)}
            </span>
            <button
              type="button"
              disabled={page >= pages}
              onClick={() => go({ page: page + 1 })}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-zinc-600 transition-colors hover:bg-zinc-900/[0.05] disabled:pointer-events-none disabled:text-zinc-300"
            >
              Older <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="p-4">
            <Empty
              title="No postings in this window"
              detail="Widen the window, or clear the account filter."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-zinc-900/[0.06] text-[10px] uppercase tracking-wide text-zinc-400">
                  <th className="px-4 py-2 text-left font-bold">Posting</th>
                  <th className="px-3 py-2 text-left font-bold">When</th>
                  <th className="px-3 py-2 text-left font-bold">From</th>
                  <th className="px-3 py-2 text-left font-bold">To</th>
                  <th className="px-3 py-2 text-right font-bold">Amount</th>
                  <th className="px-3 py-2 text-left font-bold">Loan</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-zinc-900/[0.04] last:border-0 hover:bg-zinc-900/[0.02]">
                    <td className="px-4 py-2">
                      <span className="block font-mono text-[11px] text-zinc-500">#{r.id}</span>
                      {r.narration !== "—" && (
                        <span className="block max-w-[220px] truncate text-[10.5px] text-zinc-400">{r.narration}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-zinc-600">
                      {shortDate(r.at)} <span className="text-zinc-400">{shortTime(r.at)}</span>
                    </td>
                    <td className="px-3 py-2 text-zinc-600">{r.from}</td>
                    <td className="px-3 py-2 font-medium text-zinc-800">{r.to}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-zinc-900">{KES(r.amount)}</td>
                    <td className="px-3 py-2">
                      {r.loanId > 0 ? (
                        // The connection, made clickable. This is the same loan id
                        // the collections floor works its cases by.
                        <Link
                          href={`/desk/case/${r.loanId}`}
                          className="font-mono text-[11px] font-semibold text-[color:var(--accent)] hover:underline"
                        >
                          {r.loanId}
                        </Link>
                      ) : (
                        <span className="text-zinc-300">—</span>
                      )}
                      {r.entityId === 3005 && <span className="ml-1.5 text-[10px] text-zinc-400">Fintech</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="mt-3">
        <CardHead title="What this screen will not do" accent={ACCENT} />
        <p className="text-[11.5px] leading-relaxed text-zinc-500">
          It will not show you a balance sheet. The journal has no opening balances and no period closes, so any balance derived
          from it would have no defensible starting point — it would be a number that looks authoritative and cannot be defended.
          Movement over a window is what this data honestly supports, and that is what{" "}
          <Link href="/books" className="font-semibold text-[color:var(--accent)] hover:underline">
            Movement
          </Link>{" "}
          reports.
        </p>
      </Card>
    </div>
  );
}
