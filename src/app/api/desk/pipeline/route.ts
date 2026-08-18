// POST /api/desk/pipeline — pull the Fintech book onto the collections floor.
//
// This is the one route that acts on many cases at once, so it is the one route
// where "run it and see" is not an acceptable design. Two things protect it:
//
//   · `dryRun` composes every statement and returns them WITHOUT recording
//     anything at all. Nothing is written to either database.
//   · the real run is still governed by COLLECTBOX_POSTING_ENABLED like every
//     other write. Disarmed, it records the intent here and stores each
//     composed statement; armed, it executes them.
//
// The INSERT itself carries a NOT EXISTS guard, so a second run is a no-op
// rather than a duplicate queue position. That makes this safe to demonstrate
// twice, which — for a screen whose whole job is to be demonstrated — matters.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasRight } from "@/lib/rbac/authz";
import { collectBoxOrg, CollectBoxUnavailable } from "@/lib/collectbox/client";
import { projectFintechPipeline, allocateProjection } from "@/lib/collectbox/pipeline";
import { pullToFloor, isMirrorArmed } from "@/lib/collectbox/write";
import { deskContext, isResponse } from "@/lib/desk/action";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const ctx = await deskContext();
  if (isResponse(ctx)) return ctx;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const entityId = Number(body.entityId) || 3005;
  const dryRun = body.dryRun === true;

  try {
    const projection = await projectFintechPipeline(ctx.org, entityId);
    if (projection.rows.length === 0) {
      return NextResponse.json({
        success: true, pulled: 0,
        message: `Entity ${entityId} has no open loans carrying a balance right now, so there is nothing to pull.`,
      });
    }

    const allocation = await allocateProjection(ctx.org, projection);
    if (allocation.length === 0) {
      return NextResponse.json(
        { success: false, message: "No agents are available on the floor to carry these cases." },
        { status: 409 },
      );
    }

    // Which agent each case went to, from the same allocation the screen showed.
    const seatOf = new Map<number, { id: number; name: string }>();
    for (const a of allocation) {
      for (const loanId of a.cases) {
        seatOf.set(loanId, { id: a.agentId, name: a.agentName });
      }
    }

    if (dryRun) {
      // Compose only. Nothing is recorded in either database.
      const sample = projection.rows.slice(0, 5).map((r) => {
        const seat = seatOf.get(r.loanId) ?? { id: allocation[0].agentId, name: allocation[0].agentName };
        return `-- ${r.name} · loan ${r.loanId} · ${r.category.name} · ${r.dpd}d → ${seat.name}\n`
          + `INSERT INTO CollectBox.dbo.CollectionTracker (LoanId, DaysInArears, Loantype, AgentAssigned, AmountDue, Installment) `
          + `VALUES (${r.loanId}, ${Math.max(0, r.dpd)}, ${r.category.id}, ${seat.id}, ${r.olb.toFixed(2)}, 1);`;
      });
      return NextResponse.json({
        success: true,
        pulled: 0,
        message: `Preview only — ${projection.rows.length} statements composed across ${allocation.length} agents. Nothing was written to either database.`,
        sample,
      });
    }

    let pulled = 0;
    const failures: string[] = [];
    const sample: string[] = [];

    for (const r of projection.rows) {
      const seat = seatOf.get(r.loanId) ?? { id: allocation[0].agentId, name: allocation[0].agentName };
      try {
        const res = await pullToFloor({
          org: ctx.org, orgId: ctx.orgId, actor: ctx.actor,
          entityId, loanId: r.loanId, borrowerId: r.borrowerId,
          name: r.name, phone: r.phone,
          categoryId: r.category.id, dpd: r.dpd,
          amountDue: r.olb, instalment: 1,
          assignToAgentId: seat.id, assignToAgentName: seat.name,
        });
        if (res.mirrorState === "FAILED") failures.push(`${r.name}: ${res.mirrorError ?? "mirror failed"}`);
        else pulled += 1;
        if (sample.length < 5 && res.shadowSql) sample.push(`-- ${r.name} → ${seat.name}\n${res.shadowSql}`);
      } catch (e) {
        failures.push(`${r.name}: ${e instanceof Error ? e.message : "failed"}`);
      }
    }

    const armed = isMirrorArmed();
    return NextResponse.json({
      success: failures.length === 0,
      pulled,
      message: armed
        ? `${pulled} Fintech cases written into CollectBox and assigned across ${allocation.length} agents.${failures.length ? ` ${failures.length} failed.` : ""}`
        : `${pulled} Fintech cases recorded and assigned across ${allocation.length} agents. Each CollectBox statement was composed and stored for review — Micromart's production database was not written to.`,
      sample,
      failures: failures.slice(0, 10),
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, message: e instanceof CollectBoxUnavailable ? e.message : e instanceof Error ? e.message : "Failed." },
      { status: 500 },
    );
  }
}
