"use client";

import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { Card, CardHead, PageHead, Chip, Tag, Stat, KES, N, PCT, ago, shortDate, Empty } from "@/components/suite/kit";

type Row = {
  id: number; loanId: number; name: string; phone: string;
  amount: number; paid: number; dueAt: string | null; takenAt: string | null;
  agentName: string | null;
  state: { key: string; label: string; accent: string };
  band: { short: string; name: string; accent: string } | null;
  olb: number; recoveredSince: number;
};

const FILTERS = [
  { key: "all", label: "Everything" },
  { key: "open", label: "Still to fall due" },
  { key: "due-today", label: "Due today" },
  { key: "overdue", label: "Date has passed" },
] as const;

export default function PromiseBoard({
  filter, stats, rows, lastTakenAt, totalOnRecord,
}: {
  filter: string;
  stats: {
    open: number; openValue: number; dueToday: number; dueTodayValue: number;
    overdue: number; overdueValue: number; takenThisMonth: number; takenThisMonthValue: number;
    keepRate: number; keepSample: number;
  };
  rows: Row[];
  lastTakenAt: string | null;
  totalOnRecord: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const set = (f: string) => {
    const next = new URLSearchParams(sp.toString());
    if (f === "all") next.delete("filter"); else next.set("filter", f);
    router.push(`${pathname}?${next.toString()}`);
  };

  // Has the floor stopped recording promises? Anything older than 90 days is a
  // process finding, not an empty state.
  const stale = lastTakenAt ? Date.now() - new Date(lastTakenAt).getTime() > 90 * 86400000 : false;

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
      <PageHead
        eyebrow="ConnectDesk"
        title="Promise board"
        sub="What customers committed to, and whether the money arrived. State is computed from the payments ledger and the calendar — never read from a status column that nobody updates."
      />

      {stale && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] px-4 py-3">
          <AlertTriangle className="mt-px h-4 w-4 shrink-0 text-amber-600" />
          <div className="min-w-0">
            <p className="text-[12.5px] font-semibold text-amber-900">
              No promise has been recorded on this floor since {shortDate(lastTakenAt)}
            </p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-amber-800/85">
              {N(totalOnRecord)} promises are on record and the table is intact — but the last one was taken{" "}
              {ago(lastTakenAt)}, while calls and payments have kept flowing the whole time. The floor is working the
              book and not capturing what customers commit to, so none of it can be chased, forecast or scored.
              Every promise taken through ConnectDesk from here lands in this table again.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Still to fall due" value={N(stats.open)} foot={`KES ${KES(stats.openValue)} committed`} />
        <Stat label="Due today" value={N(stats.dueToday)} foot={`KES ${KES(stats.dueTodayValue)} expected`} />
        <Stat label="Date passed · 90 days" value={N(stats.overdue)} foot={`KES ${KES(stats.overdueValue)} promised`} />
        <Stat
          label="Keep rate"
          value={stats.keepSample > 0 ? PCT(stats.keepRate, 0) : "—"}
          foot={
            stats.keepSample > 0
              ? `of ${N(stats.keepSample)} promises whose date has passed, money arrived within a week`
              : "no promises have lapsed in the last 90 days to measure"
          }
        />
      </div>

      <div className="mt-4 mb-3 flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => set(f.key)}
            className={`rounded-lg border px-2.5 py-1 text-[11.5px] font-semibold transition-colors ${
              filter === f.key
                ? "border-transparent bg-invert text-invert-fg"
                : "border-ash-900/10 bg-paper text-ash-600 hover:bg-ash-900/[0.03]"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <Card pad={false}>
        {rows.length === 0 ? (
          <div className="p-6"><Empty title="No promises match" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left">
              <thead>
                <tr className="border-b border-ash-900/[0.07] text-[9.5px] font-bold uppercase tracking-[0.1em] text-ash-400">
                  <th className="px-4 py-2">Customer</th>
                  <th className="px-3 py-2">Band</th>
                  <th className="px-3 py-2 text-right">Promised</th>
                  <th className="px-3 py-2 text-right">Arrived</th>
                  <th className="px-3 py-2">Due</th>
                  <th className="px-3 py-2">State</th>
                  <th className="px-3 py-2">Taken by</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-ash-900/[0.045] last:border-0 hover:bg-ash-900/[0.022]">
                    <td className="px-4 py-2">
                      <Link href={`/desk/case/${r.loanId}`} className="block min-w-0">
                        <span className="block truncate text-[12.5px] font-semibold text-ash-800 hover:text-[color:var(--accent)]">{r.name}</span>
                        <span className="block truncate text-[10.5px] tabular-nums text-ash-400">{r.phone} · loan #{r.loanId}</span>
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      {r.band ? <Chip label={r.band.short} accent={r.band.accent} title={r.band.name} /> : <span className="text-ash-300">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right text-[12.5px] font-semibold tabular-nums text-ash-800">{KES(r.amount)}</td>
                    <td className="px-3 py-2 text-right">
                      {r.paid > 0
                        ? <span className="text-[12px] font-semibold tabular-nums text-emerald-700">{KES(r.paid)}</span>
                        : <span className="text-[12px] tabular-nums text-ash-300">—</span>}
                    </td>
                    <td className="px-3 py-2 text-[11.5px] tabular-nums text-ash-500">{shortDate(r.dueAt)}</td>
                    <td className="px-3 py-2">
                      <span
                        className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold text-white"
                        style={{ backgroundColor: r.state.accent }}
                      >
                        {r.state.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 truncate text-[11.5px] text-ash-600">{r.agentName ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="mt-3 text-[10.5px] text-ash-400">
        CollectBox.PromisedToPay, settled against CollectBox.PayedAmount. &ldquo;Arrived&rdquo; counts money that landed on
        the loan, not the promise row&rsquo;s own paid column — which their reconciler fills in only sometimes.
      </p>
    </div>
  );
}
