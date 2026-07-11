// GET /api/console/collections/queue — the arrears work queue (collections.view).
// Resolves any lapsed promises first so the queue never shows a PENDING promise
// whose date quietly passed — the nightly cron is the backstop, not the truth.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { collectionsQueue } from "@/lib/collections/queue";
import { resolveDuePromises } from "@/lib/collections/ptp";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  const denied = await requireRight(session, "collections.view");
  if (denied) return denied;
  const orgId = session!.user!.orgId!;

  await resolveDuePromises(orgId).catch(() => {}); // best-effort; cron is the backstop
  const { rows, summary } = await collectionsQueue(orgId);
  return NextResponse.json({ success: true, rows, summary });
}
