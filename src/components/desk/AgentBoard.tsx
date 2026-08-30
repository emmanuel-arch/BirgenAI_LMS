"use client";

import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Link2, Link2Off } from "lucide-react";
import { Card, CardHead, PageHead, Stat, Tag, KES, N, PCT, ago, Empty } from "@/components/suite/kit";

type Row = {
  agentId: number; name: string; role: string; email: string; phone: string;
  extension: string | null;
  lms: { userId: number; name: string } | null;
  linkedBy: string | null;
  recovered: number; payments: number; loansPaying: number;
  assigned: number; assignedOlb: number;
  calls: number; contacts: number; contactRate: number;
  promises: number; promisedValue: number;
  commission: number; recoveryRate: number;
  lastActivityAt: string | null;
};

const WINDOWS = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "mtd", label: "Month to date" },
  { key: "30d", label: "30 days" },
] as const;

export default function AgentBoard({
  window: win, windowLabel, rows, roster,
}: {
  window: string;
  windowLabel: string;
  rows: Row[];
  roster: { total: number; linked: number; byMethod: Record<string, number>; extensions: number; extensionsMapped: number };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const set = (w: string) => {
    const next = new URLSearchParams(sp.toString());
    next.set("window", w);
    router.push(`${pathname}?${next.toString()}`);
  };

  const totalRecovered = rows.reduce((s, r) => s + r.recovered, 0);
  const totalCommission = rows.reduce((s, r) => s + r.commission, 0);
  const totalCalls = rows.reduce((s, r) => s + r.calls, 0);
  const totalContacts = rows.reduce((s, r) => s + r.contacts, 0);
  const top = rows[0]?.recovered || 1;

  return (
    <div className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6">
      <PageHead
        eyebrow="ConnectDesk"
        title="Agents"
        sub="Ranked by cash recovered. Recovered, promised and contacted are three different quantities and are never added together."
        right={
          <div className="flex rounded-lg bg-ash-900/[0.045] p-0.5">
            {WINDOWS.map((w) => (
              <button
                key={w.key}
                type="button"
                onClick={() => set(w.key)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                  win === w.key ? "bg-paper text-ash-800 shadow-sm" : "text-ash-500 hover:text-ash-700"
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={`Recovered · ${windowLabel}`} value={KES(totalRecovered)} unit="KES" foot={`${rows.length} agents contributing`} />
        <Stat label="Commission earned" value={KES(totalCommission)} unit="KES" foot="weighted by band, not a flat rate" />
        <Stat
          label="Contact rate"
          value={totalCalls > 0 ? PCT((totalContacts / totalCalls) * 100, 0) : "—"}
          foot={totalCalls > 0 ? `${N(totalContacts)} of ${N(totalCalls)} dials reached a human` : "no dispositions logged in this window"}
        />
        <Stat
          label="Identities linked"
          value={`${roster.linked}/${roster.total}`}
          foot={
            Object.keys(roster.byMethod).length
              ? `matched by ${Object.entries(roster.byMethod).map(([k, v]) => `${k} ${v}`).join(", ")}`
              : "no agent matched to a lending-system identity"
          }
        />
      </div>

      <Card className="mt-3" pad={false}>
        <div className="p-4 pb-2">
          <CardHead
            title={`The floor · ${windowLabel}`}
            sub="Every figure read from CollectBox. The identity column shows how each agent was matched to the lending system — never silently."
          />
        </div>
        {rows.length === 0 ? (
          <div className="p-4"><Empty title="No agent activity in this window" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] text-left">
              <thead>
                <tr className="border-y border-ash-900/[0.07] text-[9.5px] font-bold uppercase tracking-[0.1em] text-ash-400">
                  <th className="px-4 py-2">Agent</th>
                  <th className="px-3 py-2">Identity</th>
                  <th className="px-3 py-2 text-right">Recovered</th>
                  <th className="px-3 py-2 text-right">Pmts</th>
                  <th className="px-3 py-2 text-right">Book held</th>
                  <th className="px-3 py-2 text-right">Recovery</th>
                  <th className="px-3 py-2 text-right">Calls</th>
                  <th className="px-3 py-2 text-right">Contact</th>
                  <th className="px-3 py-2 text-right">Comm.</th>
                  <th className="px-3 py-2 text-right">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.agentId} className="border-b border-ash-900/[0.045] last:border-0 hover:bg-ash-900/[0.022]">
                    <td className="px-4 py-2">
                      <span className="flex items-start gap-2">
                        <span className="w-5 shrink-0 pt-0.5 text-right text-[10px] font-bold tabular-nums text-ash-300">{i + 1}</span>
                        <span className="min-w-0">
                          <Link href={`/desk/queue?agent=${r.agentId}`} className="block truncate text-[12.5px] font-semibold text-ash-800 hover:text-[color:var(--accent)]">
                            {r.name}
                          </Link>
                          <span className="block truncate text-[10px] text-ash-400">
                            {r.role}{r.extension ? ` · ext ${r.extension}` : ""}
                          </span>
                          <span className="mt-1 block h-1 w-28 overflow-hidden rounded-full bg-ash-900/[0.06]">
                            <span className="block h-full rounded-full" style={{ width: `${(r.recovered / top) * 100}%`, backgroundColor: "var(--accent)" }} />
                          </span>
                        </span>
                      </span>
                    </td>

                    <td className="px-3 py-2">
                      {r.lms ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700" title={`Matched by ${r.linkedBy}`}>
                          <Link2 className="h-2.5 w-2.5" /> LMS #{r.lms.userId}
                          <span className="font-normal text-emerald-700/60">{r.linkedBy}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-md bg-ash-900/[0.05] px-1.5 py-0.5 text-[10px] font-semibold text-ash-400" title="No CollectionAgents row links this agent to a lending-system identity">
                          <Link2Off className="h-2.5 w-2.5" /> unlinked
                        </span>
                      )}
                    </td>

                    <td className="px-3 py-2 text-right text-[12.5px] font-semibold tabular-nums text-ash-800">{KES(r.recovered)}</td>
                    <td className="px-3 py-2 text-right text-[11.5px] tabular-nums text-ash-500">{N(r.payments)}</td>
                    <td className="px-3 py-2 text-right">
                      <span className="block text-[11.5px] tabular-nums text-ash-600">{N(r.assigned)}</span>
                      <span className="block text-[10px] tabular-nums text-ash-400">{KES(r.assignedOlb, { compact: true })}</span>
                    </td>
                    <td className="px-3 py-2 text-right text-[11.5px] tabular-nums text-ash-500">
                      {r.assignedOlb > 0 ? PCT(r.recoveryRate, 2) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right text-[11.5px] tabular-nums text-ash-500">{r.calls > 0 ? N(r.calls) : "—"}</td>
                    <td className="px-3 py-2 text-right text-[11.5px] tabular-nums text-ash-500">
                      {r.calls > 0 ? PCT(r.contactRate, 0) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right text-[11.5px] tabular-nums text-ash-500">
                      {r.commission > 0 ? KES(r.commission) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right text-[10.5px] tabular-nums text-ash-400">{ago(r.lastActivityAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="mt-3 text-[10.5px] leading-relaxed text-ash-400">
        {roster.extensionsMapped} of {roster.extensions} PBX extensions are mapped to an agent.
        {" "}Identity linking uses <code className="rounded bg-ash-900/[0.05] px-1">Serviceconnect.CollectionAgents</code> — the only
        table carrying both a lending-system staff id and a CollectBox agent id. Where its <code className="rounded bg-ash-900/[0.05] px-1">CollectBoxRef</code>
        {" "}is zero, the match falls back to phone and then email, and the method is shown on every row rather than assumed.
      </p>
    </div>
  );
}
