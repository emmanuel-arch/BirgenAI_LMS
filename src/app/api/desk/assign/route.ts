// POST /api/desk/assign — move a case between agents.
import { NextRequest, NextResponse } from "next/server";
import { assignCase } from "@/lib/collectbox/write";
import { deskContext, readSubject, isResponse, actionResult } from "@/lib/desk/action";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const ctx = await deskContext();
  if (isResponse(ctx)) return ctx;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const subject = readSubject(body);
  if (isResponse(subject)) return subject;

  const toAgentId = Number(body.toAgentId);
  if (!Number.isInteger(toAgentId) || toAgentId <= 0) {
    return NextResponse.json({ success: false, message: "A destination agent is required." }, { status: 400 });
  }

  try {
    const res = await assignCase({
      org: ctx.org, orgId: ctx.orgId, actor: ctx.actor, subject,
      toAgentId,
      toAgentName: typeof body.toAgentName === "string" ? body.toAgentName.slice(0, 120) : `Agent ${toAgentId}`,
      reason: typeof body.reason === "string" ? body.reason.slice(0, 1000) : undefined,
    });
    return actionResult(res);
  } catch (e) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : "Failed." }, { status: 500 });
  }
}
