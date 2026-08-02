// The Alerts app's feed.
//
// Ungated like Support and for the same reason: "your float won't cover what's
// approved" is not an upsell, it is the platform doing its job. Every signal is
// rights-checked and scope-fenced inside signalsFor — an officer is told about
// their own arrears, never the lender's.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRights } from "@/lib/rbac/authz";
import { resolveScope } from "@/lib/rbac/scope";
import { entitlementsFor } from "@/lib/billing/entitlements";
import { signalsFor, badgeCount } from "@/lib/riri/signals";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const orgId = session.user.orgId;

  const [rights, scope, ent] = await Promise.all([
    getRights(session),
    resolveScope(session),
    entitlementsFor(orgId),
  ]);

  try {
    const signals = await signalsFor({ orgId, scope, rights, features: new Set(ent.features) });
    return NextResponse.json({
      success: true,
      signals,
      badge: badgeCount(signals),
      scope: scope.kind,
      at: new Date().toISOString(),
    });
  } catch (e) {
    // A tray that cannot render must not take the dock with it.
    console.error("[riri:signals]", e);
    return NextResponse.json({ success: true, signals: [], badge: 0, scope: scope.kind, at: new Date().toISOString() });
  }
}
