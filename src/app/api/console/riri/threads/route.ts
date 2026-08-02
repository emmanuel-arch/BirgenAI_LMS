// Saved conversations — the list, and the nuclear option.
//
// Ungated on purpose, exactly like Support. Your own conversation history is not a
// premium feature and metering "show me what I asked you yesterday" would be a tax
// on using the product. It IS scoped hard: `staffId` from the session, never from
// the body, so a crafted id reads nobody else's thread. RLS fences the org on top.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listThreads, clearAll, available } from "@/lib/riri/threads";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const orgId = session.user.orgId;
  const staffId = session.user.id;
  if (!staffId) return NextResponse.json({ success: true, threads: [], available: false });

  const on = await available(orgId);
  if (!on) {
    // Not an error. History has not been switched on for this deployment yet, and
    // the app says so rather than showing an empty list that looks like data loss.
    return NextResponse.json({ success: true, threads: [], available: false });
  }

  const threads = await listThreads(orgId, staffId);
  return NextResponse.json({ success: true, threads, available: true });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const staffId = session.user.id;
  if (!staffId) return NextResponse.json({ success: false, message: "No staff identity." }, { status: 400 });

  // Deleting everything is one click away in Settings, so it asks for the word.
  // Not a modal we can regret shipping — an explicit token in the request.
  const url = new URL(req.url);
  if (url.searchParams.get("confirm") !== "all") {
    return NextResponse.json({ success: false, message: "Add ?confirm=all to clear every conversation." }, { status: 400 });
  }

  const removed = await clearAll(session.user.orgId, staffId);
  return NextResponse.json({ success: true, removed });
}
