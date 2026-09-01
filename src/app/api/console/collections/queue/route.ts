// GET /api/console/collections/queue — the arrears work queue (collections.view).
// Resolves any lapsed promises first so the queue never shows a PENDING promise
// whose date quietly passed — the nightly cron is the backstop, not the truth.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { collectionsQueue } from "@/lib/collections/queue";
import { resolveDuePromises } from "@/lib/collections/ptp";
import { collectionsQueueLive } from "@/lib/collections/queue-live";
import { resolveOrg } from "@/lib/tenancy";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  const denied = await requireRight(session, "collections.view");
  if (denied) return denied;
  const orgId = session!.user!.orgId!;

  await resolveDuePromises(orgId).catch(() => {}); // best-effort; cron is the backstop

  // ── A BRIDGED LENDER'S ARREARS ARE NOT IN OUR TABLES ────────────────────
  // collectionsQueue reads loans with OVERDUE instalments from Postgres, and a
  // bridged lender has none there — so this returned an EMPTY QUEUE while 47 of
  // Micromart's customers were behind. An empty queue does not read as "we
  // cannot see this book"; it reads as "nobody is late".
  if (session!.user!.orgSlug) {
    const org = await resolveOrg(session!.user!.orgSlug!);
    if (org?.mode === "BRIDGED" && org.bridgedReady && org.registry && org.entityId) {
      try {
        const live = await collectionsQueueLive(org, orgId);
        return NextResponse.json({ success: true, source: "servicesuite", ...live });
      } catch (err) {
        // Say so rather than falling through to a local query that will return
        // nothing — the silent empty queue is the failure being fixed here.
        return NextResponse.json(
          {
            success: false,
            source: "servicesuite",
            message: `Could not read ${org.name}'s arrears: ${err instanceof Error ? err.message : "unknown error"}`,
          },
          { status: 502 },
        );
      }
    }
  }

  const { rows, summary } = await collectionsQueue(orgId);
  return NextResponse.json({ success: true, source: "local", rows, summary });
}
