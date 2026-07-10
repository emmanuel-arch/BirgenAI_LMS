// GET/POST /api/cron/reconcile — nightly money-vs-book referee (CRON_SECRET).
//
// Re-derives every reconciliation check for every active org and syncs the
// exceptions table: new mismatches open, persisting ones bump lastSeenAt,
// vanished ones close as self-healed, and "resolved" ones that reappear are
// reopened. The payment webhooks raise the urgent cases the moment they
// happen; this job is the backstop that catches what events missed — a crashed
// webhook, a manual database edit, a disbursement whose callback never came.
//
// Per-org try/catch: one lender's bad ledger must not hide another's.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runAsPlatform } from "@/lib/db/context";
import { reconcileOrg } from "@/lib/finance/reconcile";

export const runtime = "nodejs";
export const maxDuration = 300;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  return !!token && token === secret;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });

  try {
    const orgs = await runAsPlatform(() =>
      prisma.org.findMany({ where: { status: "ACTIVE" }, select: { id: true, slug: true } }),
    );

    const stats = { orgs: 0, opened: 0, reopened: 0, selfHealed: 0, stillOpen: 0, errors: 0 };
    for (const org of orgs) {
      stats.orgs++;
      try {
        const r = await reconcileOrg(org.id);
        stats.opened += r.opened;
        stats.reopened += r.reopened;
        stats.selfHealed += r.selfHealed;
        stats.stillOpen += r.stillOpen;
      } catch (err) {
        stats.errors++;
        console.error(`[cron/reconcile] org ${org.slug} failed:`, err);
      }
    }

    return NextResponse.json({ success: true, ranAt: new Date().toISOString(), ...stats });
  } catch (err) {
    return NextResponse.json(
      { success: false, message: err instanceof Error ? err.message : "Reconcile run failed." },
      { status: 500 },
    );
  }
}

export const POST = GET;
