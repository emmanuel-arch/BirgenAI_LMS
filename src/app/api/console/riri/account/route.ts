// Riri's Account panel — who she thinks you are, what you have used, what she remembers.
//
// GET    → { actor, usage, memories, llm }
// DELETE → forget one note (?id=) or everything (no id). Own notes only: the staffId is
//          the session's, never the client's, so nobody reads or erases a colleague's.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRights } from "@/lib/rbac/authz";
import { actorContext } from "@/lib/riri/context";
import { ririUsageThisMonth, ririMemories, forgetMemories } from "@/lib/riri/account";
import { isLlmConfigured } from "@/lib/riri/gemini";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const orgId = session.user.orgId;
  const staffId = session.user.id ?? null;

  const rights = await getRights(session);
  const [actor, usage, memories] = await Promise.all([
    actorContext(orgId, staffId, rights, { name: session.user.name, role: session.user.role }),
    staffId ? ririUsageThisMonth(orgId, staffId) : Promise.resolve(null),
    staffId ? ririMemories(orgId, staffId) : Promise.resolve([]),
  ]);

  return NextResponse.json({
    success: true,
    actor: {
      name: actor.name,
      role: actor.role,
      branch: actor.branch,
      isPlatformAdmin: actor.isPlatformAdmin,
    },
    usage,
    memories: memories.map((m) => ({
      id: m.id, kind: m.kind, body: m.body,
      createdAt: m.createdAt.toISOString(),
      expiresAt: m.expiresAt?.toISOString() ?? null,
    })),
    // "Configured" as in a key exists — the dock says simulated honestly either way.
    llm: isLlmConfigured() ? "live" : "simulation",
  });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const staffId = session.user.id;
  if (!staffId) return NextResponse.json({ success: false, message: "No account." }, { status: 400 });

  const id = new URL(req.url).searchParams.get("id") ?? undefined;
  const count = await forgetMemories(session.user.orgId, staffId, id);
  return NextResponse.json({
    success: true,
    forgotten: count,
    message: count === 0 ? "Nothing to forget." : id ? "Forgotten." : `Forgot ${count} note(s). We start fresh.`,
  });
}
