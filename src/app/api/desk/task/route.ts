// POST /api/desk/task — schedule a callback, a meeting or a field visit.
import { NextRequest, NextResponse } from "next/server";
import { scheduleTask } from "@/lib/collectbox/write";
import { deskContext, readSubject, isResponse, actionResult } from "@/lib/desk/action";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const ctx = await deskContext();
  if (isResponse(ctx)) return ctx;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const subject = readSubject(body);
  if (isResponse(subject)) return subject;

  const action = Number(body.action);
  if (![1, 2, 3].includes(action)) {
    return NextResponse.json({ success: false, message: "Action must be call (1), meet (2) or field visit (3)." }, { status: 400 });
  }
  const when = typeof body.when === "string" ? new Date(body.when) : null;
  if (!when || Number.isNaN(when.getTime())) {
    // Their own TaskScheduler allows a null date. It should not: a callback with
    // no time is a callback that never happens, and 30,713 of their 48,945 task
    // rows are still open.
    return NextResponse.json({ success: false, message: "A task without a date is a task that never happens." }, { status: 400 });
  }

  try {
    const res = await scheduleTask({
      org: ctx.org, orgId: ctx.orgId, actor: ctx.actor, subject,
      action: action as 1 | 2 | 3, when,
      note: typeof body.note === "string" ? body.note.slice(0, 1000) : undefined,
    });
    return actionResult(res);
  } catch (e) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : "Failed." }, { status: 500 });
  }
}
