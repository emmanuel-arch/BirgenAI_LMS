// ─────────────────────────────────────────────────────────────────────────────
// THE LIVE FLOOR — ConnectDesk's front page.
//
// One screen that answers the four questions a collections manager actually
// opens a system to ask, in the order they ask them:
//
//   1. How much came in today, and is that normal?
//   2. Where is the book sitting — which bands hold the money?
//   3. Who is working, and what are they producing?
//   4. What is happening right now?
//
// Every figure is read live from Micromart's CollectBox and Serviceconnect at
// request time. Nothing is cached, nothing is seeded, and the freshness stamps
// are on screen so a reader can check that for themselves rather than take it on
// trust.
// ─────────────────────────────────────────────────────────────────────────────
import Link from "next/link";
import { collectBoxOrg, CollectBoxUnavailable } from "@/lib/collectbox/client";
import { getFloorSummary } from "@/lib/collectbox/floor";
import { getLeaderboard, getFloorPulse, getDailyTrend } from "@/lib/collectbox/agents";
import { getActivityFeed } from "@/lib/interactions/timeline";
import { auth } from "@/lib/auth";
import FloorBoard from "@/components/desk/FloorBoard";
import { Broken } from "@/components/suite/kit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DeskFloorPage() {
  const session = await auth();
  const orgId = session?.user?.orgId;

  let data: Awaited<ReturnType<typeof load>> | null = null;
  let error: string | null = null;
  try {
    data = await load(orgId);
  } catch (e) {
    error = e instanceof CollectBoxUnavailable
      ? e.message
      : e instanceof Error
        ? e.message
        : "The collections floor could not be reached.";
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <Broken
          title="The collections floor is not reachable"
          detail={`${error} — ConnectDesk reads Micromart's CollectBox through the same SQL Server connection the lending bridge uses, so this usually means the server or the Tailscale link is down rather than anything in this application.`}
        />
      </div>
    );
  }

  return <FloorBoard {...data} />;
}

async function load(orgId: string | undefined) {
  const org = collectBoxOrg("micromart");

  // Five independent reads, issued together. The page renders in the time of the
  // slowest rather than the sum of all five.
  const [floor, board, pulse, trend, feed] = await Promise.all([
    getFloorSummary(org),
    getLeaderboard(org, "today"),
    getFloorPulse(org),
    getDailyTrend(org, 30),
    getActivityFeed(org, { limit: 14, orgId }),
  ]);

  return {
    bands: floor.bands.map((b) => ({
      id: b.category.id,
      name: b.category.name,
      short: b.category.short,
      accent: b.category.accent,
      commission: b.category.commission,
      loans: b.loans,
      olb: b.olb,
      assigned: b.assigned,
      actioned: b.actioned,
      promises: b.promises,
      recoveredToday: b.recoveredToday,
    })),
    totals: floor.totals,
    trackerLastWrite: floor.trackerLastWrite?.toISOString() ?? null,
    lastPaymentAt: floor.lastPaymentAt?.toISOString() ?? null,
    agents: board.slice(0, 12).map((a) => ({
      agentId: a.agentId,
      name: a.name,
      recovered: a.recovered,
      payments: a.payments,
      assigned: a.assigned,
      assignedOlb: a.assignedOlb,
      commission: a.commission,
      calls: a.calls,
      contactRate: a.contactRate,
      lastActivityAt: a.lastActivityAt?.toISOString() ?? null,
    })),
    pulse: pulse.map((p) => ({ hour: p.hour, recovered: p.recovered, payments: p.payments, agents: p.agents })),
    trend: trend.map((t) => ({ day: t.day, recovered: t.recovered, payments: t.payments })),
    feed: feed.map((f) => ({
      id: f.id,
      at: f.at.toISOString(),
      system: f.system,
      kind: f.kind,
      headline: f.headline,
      detail: f.detail,
      subject: f.subjectLabel,
      actor: f.actor?.name ?? null,
      amount: f.amount ?? null,
      tone: f.tone,
      tags: f.tags,
      loanId: f.subject.loanId,
    })),
  };
}
