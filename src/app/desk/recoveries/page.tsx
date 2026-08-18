// ─────────────────────────────────────────────────────────────────────────────
// RECOVERIES — the money feed. Every shilling, attributed, newest first.
//
// This is the only screen in ConnectDesk that shows CASH rather than activity or
// intent, and it is deliberately the plainest. A payment has an amount, a time,
// an M-Pesa code, a customer and an agent; there is nothing to interpret and
// nothing to model. The value is that all five appear together, which they do
// nowhere in Micromart's current systems.
// ─────────────────────────────────────────────────────────────────────────────
import Link from "next/link";
import { collectBoxOrg, CollectBoxUnavailable } from "@/lib/collectbox/client";
import { listRecoveries } from "@/lib/collectbox/promises";
import { getDailyTrend, getFloorPulse } from "@/lib/collectbox/agents";
import RecoveryFeed from "@/components/desk/RecoveryFeed";
import { Broken } from "@/components/suite/kit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function RecoveriesPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : (sp[k] as string | undefined));
  const days = Math.min(Math.max(Number(one("days") ?? 2) || 2, 1), 30);
  const agentId = one("agent") ? Number(one("agent")) : undefined;

  try {
    const org = collectBoxOrg("micromart");
    const [rows, trend, pulse] = await Promise.all([
      listRecoveries(org, { days, agentId, limit: 200 }),
      getDailyTrend(org, 30),
      getFloorPulse(org),
    ]);

    return (
      <RecoveryFeed
        days={days}
        rows={rows.map((r) => ({
          id: r.id, loanId: r.loanId, name: r.name, phone: r.phone,
          amount: r.amount, paidAt: r.paidAt?.toISOString() ?? null,
          mpesaCode: r.mpesaCode, agentName: r.agentName,
          band: r.band ? { short: r.band.short, name: r.band.name, accent: r.band.accent, commission: r.band.commission } : null,
          commission: r.commission, olb: r.olb, branch: r.branch,
        }))}
        trend={trend.map((t) => ({ day: t.day, recovered: t.recovered, payments: t.payments }))}
        pulse={pulse.map((p) => ({ hour: p.hour, recovered: p.recovered, payments: p.payments }))}
      />
    );
  } catch (e) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <Broken
          title="The money feed could not be read"
          detail={e instanceof CollectBoxUnavailable ? e.message : e instanceof Error ? e.message : "Unknown error."}
        />
      </div>
    );
  }
}
