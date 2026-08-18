// POST /api/desk/note — add a note to a case.
//
// Deliberately NOT mirrored into CollectBox: their notes live on call rows, and
// inventing a call to carry one would corrupt every contact-rate figure computed
// from that table. The note is ours, and the timeline labels it as such.
import { NextRequest, NextResponse } from "next/server";
import { addNote } from "@/lib/collectbox/write";
import { deskContext, readSubject, isResponse, actionResult } from "@/lib/desk/action";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const ctx = await deskContext();
  if (isResponse(ctx)) return ctx;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const subject = readSubject(body);
  if (isResponse(subject)) return subject;

  const note = typeof body.note === "string" ? body.note.trim().slice(0, 4000) : "";
  if (!note) return NextResponse.json({ success: false, message: "The note is empty." }, { status: 400 });

  try {
    const res = await addNote({ org: ctx.org, orgId: ctx.orgId, actor: ctx.actor, subject, note });
    return actionResult(res);
  } catch (e) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : "Failed." }, { status: 500 });
  }
}
