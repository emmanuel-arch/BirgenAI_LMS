"use client";

import { Headphones, Mic } from "lucide-react";
import { Card, CardHead, PageHead, Stat, Tag, N, ago, shortTime, Empty, Simulated } from "@/components/suite/kit";

type Ext = { id: number; extension: string; mac: string; status: number; userId: number; agentName: string | null; role: string | null };
type Cdr = {
  id: number; callId: string; from: string; to: string; start: string | null;
  duration: string; talk: string; status: string; type: string; hasRecording: boolean;
};

export default function PhoneFloor({ extensions, cdr }: { extensions: Ext[]; cdr: Cdr[] }) {
  const mapped = extensions.filter((e) => e.agentName);
  const newestCdr = cdr[0]?.start ?? null;
  // The CDR table stopped being written in Sept 2023 — say so rather than
  // presenting three-year-old calls as a live trace.
  const cdrStale = newestCdr ? Date.now() - new Date(newestCdr).getTime() > 180 * 86400000 : true;

  return (
    <div className="mx-auto max-w-[1300px] px-4 py-6 sm:px-6">
      <PageHead
        eyebrow="ConnectDesk"
        title="Phone floor"
        sub="The physical seats and the PBX trace behind them. ConnectDesk records what happened on a call; the PBX places it."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Extensions" value={N(extensions.length)} foot={`${N(mapped.length)} mapped to an agent`} />
        <Stat label="Unassigned seats" value={N(extensions.length - mapped.length)} foot="no agent on the handset" />
        <Stat label="CDR rows shown" value={N(cdr.length)} foot={newestCdr ? `newest ${ago(newestCdr)}` : "none"} />
        <Stat label="With a recording" value={N(cdr.filter((c) => c.hasRecording).length)} foot="audio on file" />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <Card>
          <CardHead title="The seats" sub="CollectBox.PBXExtensions, joined to the agent roster." />
          {extensions.length === 0 ? (
            <Empty title="No extensions on record" />
          ) : (
            <div className="grid gap-1.5 sm:grid-cols-2">
              {extensions.map((e) => (
                <div
                  key={e.id}
                  className={`flex items-center gap-2.5 rounded-lg border px-2.5 py-2 ${
                    e.agentName ? "border-zinc-900/[0.08] bg-white" : "border-dashed border-zinc-900/12 bg-zinc-900/[0.02]"
                  }`}
                >
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold tabular-nums ${
                      e.agentName ? "bg-[color:var(--accent)]/12 text-[color:var(--accent)]" : "bg-zinc-900/[0.05] text-zinc-400"
                    }`}
                  >
                    {e.extension || "—"}
                  </span>
                  <span className="min-w-0">
                    <span className={`block truncate text-[12px] font-medium ${e.agentName ? "text-zinc-800" : "text-zinc-400"}`}>
                      {e.agentName ?? "Unassigned"}
                    </span>
                    <span className="block truncate font-mono text-[9.5px] text-zinc-400">{e.mac || "no MAC on file"}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHead
            title="Call detail records"
            sub="The raw PBX trace — who called whom, for how long, and whether it was recorded."
          />
          {cdrStale && (
            <div className="mb-3">
              <Simulated why={`The CDR table's most recent row is from ${newestCdr ? new Date(newestCdr).toLocaleDateString("en-KE", { month: "long", year: "numeric" }) : "an unknown date"}. The PBX stopped writing to CollectBox; agents kept working and kept logging dispositions by hand. Live CDR would restore ring time, talk time, hold time and recordings against every case — the integration exists on their side, it is simply not pointed here.`} />
            </div>
          )}
          {cdr.length === 0 ? (
            <Empty title="No call records" />
          ) : (
            <div className="max-h-[460px] overflow-auto">
              <table className="w-full min-w-[520px] text-left">
                <thead>
                  <tr className="text-[9.5px] font-bold uppercase tracking-[0.1em] text-zinc-400">
                    <th className="sticky top-0 bg-white px-2 pb-1.5">When</th>
                    <th className="sticky top-0 bg-white px-2 pb-1.5">From → to</th>
                    <th className="sticky top-0 bg-white px-2 pb-1.5">Talk</th>
                    <th className="sticky top-0 bg-white px-2 pb-1.5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {cdr.map((c) => (
                    <tr key={c.id} className="border-t border-zinc-900/[0.045]">
                      <td className="px-2 py-1.5 text-[10.5px] tabular-nums text-zinc-500">
                        {c.start ? new Date(c.start).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "2-digit" }) : "—"}
                        <span className="block text-[9.5px] text-zinc-400">{shortTime(c.start)}</span>
                      </td>
                      <td className="px-2 py-1.5">
                        <span className="block truncate text-[11px] tabular-nums text-zinc-700">{c.from || "—"}</span>
                        <span className="block truncate text-[10px] tabular-nums text-zinc-400">→ {c.to || "—"}</span>
                      </td>
                      <td className="px-2 py-1.5 text-[11px] tabular-nums text-zinc-600">{c.talk || c.duration || "—"}</td>
                      <td className="px-2 py-1.5">
                        <span className="flex items-center gap-1">
                          <Tag tone={/answer|connect/i.test(c.status) ? "good" : "neutral"}>{c.status || c.type || "—"}</Tag>
                          {c.hasRecording && <Mic className="h-3 w-3 text-zinc-400" aria-label="recorded" />}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <p className="mt-3 flex items-center gap-1.5 text-[10.5px] text-zinc-400">
        <Headphones className="h-3 w-3" />
        CollectBox.PBXExtensions · CollectBox.callcdr · CollectBox.CallRings · CollectBox.CallAlerts
      </p>
    </div>
  );
}
