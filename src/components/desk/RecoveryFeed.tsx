"use client";

import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Card, CardHead, PageHead, Chip, Stat, Columns, KES, N, ago, shortTime, Empty } from "@/components/suite/kit";

type Row = {
  id: number; loanId: number; name: string; phone: string; amount: number;
  paidAt: string | null; mpesaCode: string; agentName: string | null;
  band: { short: string; name: string; accent: string; commission: number } | null;
  commission: number; olb: number; branch: string;
};

export default function RecoveryFeed({
  days, rows, trend, pulse,
}: {
  days: number;
  rows: Row[];
  trend: { day: string; recovered: number; payments: number }[];
  pulse: { hour: number; recovered: number; payments: number }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const setDays = (d: number) => {
    const next = new URLSearchParams(sp.toString());
    next.set("days", String(d));
    router.push(`${pathname}?${next.toString()}`);
  };

  const total = rows.reduce((s, r) => s + r.amount, 0);
  const commission = rows.reduce((s, r) => s + r.commission, 0);
  const agents = new Set(rows.map((r) => r.agentName).filter(Boolean)).size;
  const workingHours = pulse.filter((p) => p.hour >= 6 && p.hour <= 22);

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
      <PageHead
        eyebrow="ConnectDesk"
        title="Recoveries"
        sub="Every payment attributed to the agent who earned it, with the M-Pesa reference it arrived on. Read from CollectBox, never written."
        right={
          <div className="flex rounded-lg bg-zinc-900/[0.045] p-0.5">
            {[1, 2, 7, 30].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                  days === d ? "bg-white text-zinc-800 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
                }`}
              >
                {d === 1 ? "24h" : `${d}d`}
              </button>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={`Recovered · ${days === 1 ? "24 hours" : `${days} days`}`} value={KES(total)} unit="KES" foot={`${N(rows.length)} payments shown`} />
        <Stat label="Commission earned" value={KES(commission)} unit="KES" foot="weighted by the band each shilling came from" />
        <Stat label="Agents contributing" value={String(agents)} foot="distinct agents in this window" />
        <Stat
          label="Average payment"
          value={rows.length ? KES(total / rows.length) : "—"}
          unit="KES"
          foot={rows[0]?.paidAt ? `most recent ${ago(rows[0].paidAt)}` : undefined}
        />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHead title="Today, by hour" sub="When the money actually arrives." />
          {workingHours.some((h) => h.recovered > 0) ? (
            <Columns
              data={workingHours.map((h) => ({ label: `${h.hour}h`, value: h.recovered, sub: `${N(h.payments)} payments` }))}
              height={110}
            />
          ) : (
            <Empty title="Nothing recovered yet today" detail="The first payments usually land after 08:00." />
          )}
        </Card>
        <Card>
          <CardHead title="Thirty days" sub="Daily totals. The weekly rhythm is the roster showing through." />
          <Columns
            data={trend.map((t) => ({ label: t.day.slice(5), value: t.recovered, sub: `${N(t.payments)} payments` }))}
            height={110}
            accent="#0d9488"
          />
        </Card>
      </div>

      <Card className="mt-3" pad={false}>
        <div className="p-4 pb-2">
          <CardHead title="The feed" sub="Newest first. Every row is a real receipt on Micromart's ledger." />
        </div>
        {rows.length === 0 ? (
          <div className="p-4"><Empty title="No payments in this window" /></div>
        ) : (
          <div className="max-h-[620px] overflow-auto">
            <table className="w-full min-w-[900px] text-left">
              <thead>
                <tr className="border-y border-zinc-900/[0.07] bg-white text-[9.5px] font-bold uppercase tracking-[0.1em] text-zinc-400">
                  <th className="sticky top-0 bg-white px-4 py-2">Time</th>
                  <th className="sticky top-0 bg-white px-3 py-2">Customer</th>
                  <th className="sticky top-0 bg-white px-3 py-2 text-right">Amount</th>
                  <th className="sticky top-0 bg-white px-3 py-2">M-Pesa</th>
                  <th className="sticky top-0 bg-white px-3 py-2">Band</th>
                  <th className="sticky top-0 bg-white px-3 py-2">Recovered by</th>
                  <th className="sticky top-0 bg-white px-3 py-2 text-right">Comm.</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-zinc-900/[0.045] last:border-0 hover:bg-zinc-900/[0.022]">
                    <td className="px-4 py-1.5 text-[11px] tabular-nums text-zinc-500">
                      {shortTime(r.paidAt)}
                      <span className="block text-[9.5px] text-zinc-400">{ago(r.paidAt)}</span>
                    </td>
                    <td className="px-3 py-1.5">
                      <Link href={`/desk/case/${r.loanId}`} className="block min-w-0">
                        <span className="block truncate text-[12px] font-medium text-zinc-800 hover:text-[color:var(--accent)]">{r.name}</span>
                        <span className="block truncate text-[10px] text-zinc-400">{r.branch}</span>
                      </Link>
                    </td>
                    <td className="px-3 py-1.5 text-right text-[12.5px] font-semibold tabular-nums text-emerald-700">{KES(r.amount)}</td>
                    <td className="px-3 py-1.5">
                      <span className="rounded bg-zinc-900/[0.05] px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-zinc-600">
                        {r.mpesaCode || "—"}
                      </span>
                    </td>
                    <td className="px-3 py-1.5">
                      {r.band ? <Chip label={r.band.short} accent={r.band.accent} title={`${r.band.name} · ${r.band.commission}%`} /> : <span className="text-zinc-300">—</span>}
                    </td>
                    <td className="px-3 py-1.5 truncate text-[11.5px] text-zinc-600">{r.agentName ?? "—"}</td>
                    <td className="px-3 py-1.5 text-right text-[11px] tabular-nums text-zinc-500">
                      {r.commission > 0 ? KES(r.commission) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
