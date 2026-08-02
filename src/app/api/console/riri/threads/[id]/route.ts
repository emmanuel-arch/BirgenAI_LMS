// One saved conversation: read it, rename it, pin it, delete it.
//
// Every handler passes the session's staffId into the query rather than checking
// ownership after the read. A `findFirst({ id, orgId, staffId })` that misses is
// indistinguishable from a thread that does not exist — which is the correct
// response to somebody probing another person's ids, and it is one query.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { readThread, renameThread, pinThread, deleteThread } from "@/lib/riri/threads";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const session = await auth();
  if (!session?.user?.orgId || !session.user.id) {
    return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  }
  const { id } = await ctx.params;
  const found = await readThread(session.user.orgId, session.user.id, id);
  if (!found) return NextResponse.json({ success: false, message: "Conversation not found." }, { status: 404 });
  return NextResponse.json({ success: true, ...found });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const session = await auth();
  if (!session?.user?.orgId || !session.user.id) {
    return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  }
  const { id } = await ctx.params;
  const orgId = session.user.orgId;
  const staffId = session.user.id;

  let body: { title?: string; pinned?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  if (typeof body.pinned === "boolean") {
    const ok = await pinThread(orgId, staffId, id, body.pinned);
    if (!ok) return NextResponse.json({ success: false, message: "Conversation not found." }, { status: 404 });
  }
  if (typeof body.title === "string") {
    const ok = await renameThread(orgId, staffId, id, body.title);
    if (!ok) return NextResponse.json({ success: false, message: "That title didn't take." }, { status: 400 });
  }
  return NextResponse.json({ success: true });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const session = await auth();
  if (!session?.user?.orgId || !session.user.id) {
    return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  }
  const { id } = await ctx.params;
  const ok = await deleteThread(session.user.orgId, session.user.id, id);
  if (!ok) return NextResponse.json({ success: false, message: "Conversation not found." }, { status: 404 });
  return NextResponse.json({ success: true });
}
