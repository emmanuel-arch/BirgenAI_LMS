// ─────────────────────────────────────────────────────────────────────────────
// THE CONFIG ENDPOINT — one route for every tenant definition namespace.
//
//   GET → { value, version, updatedAt, isDefault, history }
//   PUT → publish a new version; 422 with per-field issues if it would not hold.
//
// This single file replaces what the reference system spends seven controller
// actions and seven bespoke MERGE statements on, and unlike those it validates
// before it writes.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { read, publish, history, isNamespace } from "@/lib/config/store";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ namespace: string }> }) {
  const { namespace } = await ctx.params;
  if (!isNamespace(namespace)) {
    return NextResponse.json({ success: false, message: "Unknown settings namespace." }, { status: 404 });
  }

  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "settings.view");
  if (denied) return denied;

  const [doc, revisions] = await Promise.all([
    read(session.user.orgId, namespace),
    history(session.user.orgId, namespace),
  ]);
  return NextResponse.json({ success: true, ...doc, history: revisions });
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ namespace: string }> }) {
  const { namespace } = await ctx.params;
  if (!isNamespace(namespace)) {
    return NextResponse.json({ success: false, message: "Unknown settings namespace." }, { status: 404 });
  }

  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "settings.manage");
  if (denied) return denied;

  let body: { value?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 });
  }
  if (!body.value || typeof body.value !== "object") {
    return NextResponse.json({ success: false, message: "Provide the settings document." }, { status: 400 });
  }

  const result = await publish(session.user.orgId, namespace, body.value, session.user.id);
  if (!result.ok) {
    // 422, not 400: the request was well-formed, the CONFIGURATION is not — and the
    // client needs the per-field issues to point at the right controls.
    return NextResponse.json(
      { success: false, message: "These settings would not hold together.", issues: result.issues },
      { status: 422 },
    );
  }

  return NextResponse.json({ success: true, version: result.version, value: result.value });
}
