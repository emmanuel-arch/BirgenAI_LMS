// POST /api/desk/escalate — hand a case to field recovery, legal or a supervisor.
//
// Field escalation has a real counterpart on their side (a TaskScheduler row of
// action 3); legal and supervisor do not, so those are recorded here only. The
// difference is visible on the timeline rather than smoothed over.
import { NextRequest, NextResponse } from "next/server";
import { escalate } from "@/lib/collectbox/write";
import { deskContext, readSubject, isResponse, actionResult } from "@/lib/desk/action";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const ctx = await deskContext();
  if (isResponse(ctx)) return ctx;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const subject = readSubject(body);
  if (isResponse(subject)) return subject;

  const to = body.to;
  if (to !== "field" && to !== "legal" && to !== "supervisor") {
    return NextResponse.json({ success: false, message: "Escalate to field, legal or supervisor." }, { status: 400 });
  }
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 2000) : "";
  if (!reason) {
    return NextResponse.json({ success: false, message: "An escalation without a reason cannot be acted on by whoever receives it." }, { status: 400 });
  }

  try {
    const res = await escalate({ org: ctx.org, orgId: ctx.orgId, actor: ctx.actor, subject, to, reason });
    return actionResult(res);
  } catch (e) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : "Failed." }, { status: 500 });
  }
}
