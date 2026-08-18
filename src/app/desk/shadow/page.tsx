// ─────────────────────────────────────────────────────────────────────────────
// THE WRITE QUEUE — every statement composed for CollectBox, before it runs.
//
// This screen is the reason the shadow mode is trustworthy rather than merely
// cautious. Everything ConnectDesk would write to Micromart's production
// database is here, in full, as readable SQL with the values inlined, attached
// to the agent who caused it and the case it belongs to.
//
// Arming the mirror is then a review of recorded intent — you can read exactly
// what will run before you let it — rather than an act of faith in a code path
// nobody has looked at.
// ─────────────────────────────────────────────────────────────────────────────
import { auth } from "@/lib/auth";
import { hasRight } from "@/lib/rbac/authz";
import { redirect } from "next/navigation";
import { pendingMirrors, shadowCount, mirrorPosture } from "@/lib/collectbox/write";
import ShadowQueue from "@/components/desk/ShadowQueue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ShadowPage() {
  const session = await auth();
  if (!session?.user?.orgId) redirect("/login?callbackUrl=/desk/shadow");
  if (!(await hasRight(session, "collections.manage"))) redirect("/desk");

  const orgId = session.user.orgId;
  const [rows, counts] = await Promise.all([pendingMirrors(orgId, 200), shadowCount(orgId)]);

  return (
    <ShadowQueue
      posture={mirrorPosture()}
      counts={counts}
      rows={rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        kind: r.kind,
        headline: r.headline,
        actorName: r.actorName,
        subjectName: r.subjectName,
        liveLoanId: r.liveLoanId,
        entityId: r.entityId,
        shadowSql: r.shadowSql,
        state: r.state,
        error: r.error,
      }))}
    />
  );
}
