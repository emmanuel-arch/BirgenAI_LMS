// POST /api/console/intelligence/run — score the book on demand.
//
// The nightly cron makes the trend; this button makes a point on it right now —
// after a collections push, before a board call. Same engine, same recording,
// marked "manual" so the trend can say which points a human asked for.
//
// View-level right on purpose (the same line the tuning preview holds): a run
// creates only its own recording — it cannot touch a loan, a balance or the
// policy. What IS gated hard is the feature: no portfolio-scan, no scan.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { requireFeature } from "@/lib/billing/entitlements";
import { runPortfolio } from "@/lib/intelligence/portfolio";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "intelligence.view");
  if (denied) return denied;
  const gated = await requireFeature(session.user.orgId, "portfolio-scan");
  if (gated) return gated;

  try {
    const result = await runPortfolio(session.user.orgId, "manual");
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err instanceof Error ? err.message : "The scan failed." },
      { status: 500 },
    );
  }
}
