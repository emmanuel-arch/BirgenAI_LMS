// Oversight — the org's activity trail, read for the audit stream.
//
//   GET → the most recent audit events for this org, with the staff actor
//   resolved to a name/title, and a small summary strip (today's count, distinct
//   actors, the busiest action). Read-only; every filter is applied client-side
//   so the stream stays instant as an officer types.
//
// Gated on compliance.view — oversight is a governance surface, not a per-book
// one, so it is org-wide by right rather than narrowed by data scope.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "compliance.view");
  if (denied) return denied;
  const orgId = session.user.orgId;

  const limit = Math.min(500, Math.max(20, Number(req.nextUrl.searchParams.get("limit")) || 250));

  const [rows, todayCount] = await Promise.all([
    prisma.auditLog.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, actorId: true, actorType: true, action: true, entity: true, entityId: true, meta: true, ip: true, createdAt: true },
    }),
    prisma.auditLog.count({ where: { orgId, createdAt: { gte: startOfToday() } } }),
  ]);

  // Resolve the staff actors in one query — the stream shows a person, not a uuid.
  const staffIds = [...new Set(rows.filter((r) => r.actorType === "staff" && r.actorId).map((r) => r.actorId!))];
  const staff = staffIds.length
    ? await prisma.staffUser.findMany({ where: { id: { in: staffIds }, orgId }, select: { id: true, firstName: true, otherName: true, title: true, avatarSeed: true, email: true } })
    : [];
  const byId = new Map(staff.map((s) => [s.id, s]));

  const events = rows.map((r) => {
    const meta = (r.meta ?? {}) as Record<string, unknown>;
    const s = r.actorId ? byId.get(r.actorId) : undefined;
    const name =
      (s ? [s.firstName, s.otherName].filter(Boolean).join(" ") : null) ||
      (typeof meta.user === "string" ? meta.user : null) ||
      (r.actorType === "system" ? "System" : r.actorType === "platform" ? "Platform" : r.actorType === "borrower" ? "Borrower" : "Unknown");
    // Seed rows carry a teardown tag in `entity`; it is not a real object.
    const entity = r.entity && !r.entity.startsWith("seed:") ? r.entity : null;
    return {
      id: r.id,
      actorName: name,
      actorTitle: s?.title ?? (r.actorType === "staff" ? "Staff" : r.actorType),
      actorType: r.actorType,
      avatarSeed: s?.avatarSeed ?? (typeof meta.email === "string" ? meta.email : name),
      action: r.action,
      entity,
      entityId: entity ? r.entityId : null,
      device: typeof meta.device === "string" ? meta.device : null,
      location: typeof meta.location === "string" ? meta.location : null,
      ip: r.ip ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  });

  // The busiest action, for the summary strip.
  const counts = new Map<string, number>();
  for (const e of events) counts.set(e.action, (counts.get(e.action) ?? 0) + 1);
  const topAction = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return NextResponse.json({
    success: true,
    events,
    summary: {
      shown: events.length,
      today: todayCount,
      actors: new Set(events.map((e) => e.actorName)).size,
      topAction,
    },
  });
}
