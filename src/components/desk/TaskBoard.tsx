"use client";

import Link from "next/link";
import { AlertTriangle, PhoneCall, MapPin, Users } from "lucide-react";
import { Card, CardHead, PageHead, Chip, Tag, Stat, KES, N, PCT, ago, shortDate, Empty } from "@/components/suite/kit";

type Row = {
  id: number; loanId: number; name: string; phone: string;
  action: number; actionName: string;
  dueAt: string | null; createdAt: string | null;
  note: string; open: boolean; overdue: boolean;
  agentName: string | null; olb: number;
  band: { short: string; name: string; accent: string } | null;
};

const ICON: Record<number, typeof PhoneCall> = { 1: PhoneCall, 2: Users, 3: MapPin };

export default function TaskBoard({
  rows, stats,
}: {
  rows: Row[];
  stats: { total: number; open: number; overdue: number; lastCreatedAt: string | null };
}) {
  const stale = stats.lastCreatedAt ? Date.now() - new Date(stats.lastCreatedAt).getTime() > 90 * 86400000 : false;
  const overduePct = stats.open > 0 ? (stats.overdue / stats.open) * 100 : 0;

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
      <PageHead
        eyebrow="ConnectDesk"
        title="Callbacks & field visits"
        sub="What was promised to be done, and when it was due. Scheduled from a case file; mirrored into CollectBox's own task table."
      />

      {stale && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] px-4 py-3">
          <AlertTriangle className="mt-px h-4 w-4 shrink-0 text-amber-600" />
          <div className="min-w-0">
            <p className="text-[12.5px] font-semibold text-amber-900">
              {N(stats.open)} tasks are still open and the newest was created {ago(stats.lastCreatedAt)}
            </p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-amber-800/85">
              This is not a backlog — it is a feature that was used and then stopped. {PCT(overduePct, 0)} of the open
              tasks are already past their date. Nothing closes them, so the list has quietly become unusable, which is
              exactly why nobody uses it. A callback with no owner and no closing state is a callback that never happens.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Open tasks" value={N(stats.open)} foot={`of ${N(stats.total)} ever created`} />
        <Stat label="Past their date" value={N(stats.overdue)} foot={`${PCT(overduePct, 0)} of everything open`} tone="up-bad" />
        <Stat label="Newest task" value={shortDate(stats.lastCreatedAt)} foot={ago(stats.lastCreatedAt)} />
        <Stat label="Shown here" value={N(rows.length)} foot="most recent open tasks" />
      </div>

      <Card className="mt-3" pad={false}>
        <div className="p-4 pb-2">
          <CardHead title="Open tasks" sub="Newest first." />
        </div>
        {rows.length === 0 ? (
          <div className="p-4"><Empty title="No open tasks" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[940px] text-left">
              <thead>
                <tr className="border-y border-zinc-900/[0.07] text-[9.5px] font-bold uppercase tracking-[0.1em] text-zinc-400">
                  <th className="px-4 py-2">Task</th>
                  <th className="px-3 py-2">Customer</th>
                  <th className="px-3 py-2">Band</th>
                  <th className="px-3 py-2 text-right">Balance</th>
                  <th className="px-3 py-2">Due</th>
                  <th className="px-3 py-2">Raised by</th>
                  <th className="px-3 py-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const Icon = ICON[r.action] ?? PhoneCall;
                  return (
                    <tr key={r.id} className="border-b border-zinc-900/[0.045] last:border-0 hover:bg-zinc-900/[0.022]">
                      <td className="px-4 py-2">
                        <span className="flex items-center gap-1.5 text-[12px] font-medium text-zinc-700">
                          <Icon className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                          {r.actionName}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <Link href={`/desk/case/${r.loanId}`} className="block min-w-0">
                          <span className="block truncate text-[12px] font-semibold text-zinc-800 hover:text-[color:var(--accent)]">{r.name}</span>
                          <span className="block truncate text-[10px] tabular-nums text-zinc-400">{r.phone || `loan #${r.loanId}`}</span>
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        {r.band ? <Chip label={r.band.short} accent={r.band.accent} title={r.band.name} /> : <span className="text-zinc-300">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right text-[11.5px] tabular-nums text-zinc-600">{r.olb > 0 ? KES(r.olb) : "—"}</td>
                      <td className="px-3 py-2">
                        <span className="block text-[11.5px] tabular-nums text-zinc-600">{shortDate(r.dueAt)}</span>
                        {r.overdue && <Tag tone="bad">Overdue</Tag>}
                      </td>
                      <td className="px-3 py-2 truncate text-[11.5px] text-zinc-600">{r.agentName ?? "—"}</td>
                      <td className="max-w-[240px] px-3 py-2">
                        <span className="block truncate text-[11px] italic text-zinc-500">{r.note || "—"}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
