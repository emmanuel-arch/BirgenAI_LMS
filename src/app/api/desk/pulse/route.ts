// The floor's heartbeat — two aggregates, polled every thirty seconds.
//
// Deliberately the cheapest query in the system: one scan of PayedAmount over a
// one-hour window plus a same-day sum. It is called from every page of
// ConnectDesk, so it has to cost nothing, and it is the only thing on screen
// that proves the data is live rather than rendered once and cached.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasRight } from "@/lib/rbac/authz";
import { collectBoxOrg } from "@/lib/collectbox/client";
import { getLiveActivity } from "@/lib/collectbox/agents";
import { CB, cbOne, num } from "@/lib/collectbox/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ ok: false }, { status: 401 });
  if (!(await hasRight(session, "collections.view")) && !(await hasRight(session, "collections.manage"))) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  try {
    const org = collectBoxOrg("micromart");
    const [live, today] = await Promise.all([
      getLiveActivity(org),
      cbOne<{ amt: number }>(
        org,
        `SELECT SUM(CAST(AmountPaid AS decimal(18,2))) AS amt FROM ${CB}.PayedAmount WHERE DatePaid >= CAST(GETDATE() AS date)`,
        [], { timeoutMs: 10000 },
      ),
    ]);

    return NextResponse.json({
      ok: true,
      activeAgents: live.activeAgents,
      eventsLastHour: live.eventsLastHour,
      lastEventAt: live.lastEventAt?.toISOString() ?? null,
      recoveredToday: num(today?.amt),
    });
  } catch (e) {
    // A 503 rather than an empty success: the pulse showing "0 on the floor"
    // when the truth is "we could not ask" is exactly the ambiguity this system
    // exists to remove.
    return NextResponse.json(
      { ok: false, message: e instanceof Error ? e.message : "Floor unreachable" },
      { status: 503 },
    );
  }
}
