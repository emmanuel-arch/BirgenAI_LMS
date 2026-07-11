// ─────────────────────────────────────────────────────────────────────────────
// Auto-scheduled field verification (blueprint §5.1: an SME application with a
// business location gets a relationship officer dispatched WITHOUT anyone
// remembering to click "dispatch"). The same allocation the console's field
// board uses — nearest geolocated agent — created at apply time.
//
// Entitlement-honest: auto-allocation IS the route planner, so orgs whose plan
// lacks the feature get nothing scheduled (the same integrity rule that gates
// POST /api/console/field). Best-effort by design: a scheduling hiccup must
// never sink an application.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";
import { hasFeature } from "@/lib/billing/entitlements";
import { rankAgents } from "./allocate";

export async function autoScheduleVerification(args: {
  orgId: string;
  borrowerId: string;
  applicationId: string;
  lat: number;
  lng: number;
  label: string;
  address?: string | null;
}): Promise<{ scheduled: boolean; agentName?: string }> {
  try {
    if (!(await hasFeature(args.orgId, "route-planner"))) return { scheduled: false };

    // One open verification per application — a retried apply must not queue two.
    const open = await prisma.fieldVisit.findFirst({
      where: { orgId: args.orgId, applicationId: args.applicationId, status: { in: ["QUEUED", "ALLOCATED", "EN_ROUTE"] } },
      select: { id: true },
    });
    if (open) return { scheduled: false };

    const ranked = await rankAgents(args.orgId, { lat: args.lat, lng: args.lng });
    const chosen = ranked[0] ?? null;

    const visit = await prisma.fieldVisit.create({
      data: {
        orgId: args.orgId,
        borrowerId: args.borrowerId,
        applicationId: args.applicationId,
        kind: "BUSINESS_VERIFICATION",
        label: args.label,
        address: args.address ?? null,
        lat: args.lat,
        lng: args.lng,
        status: chosen ? "ALLOCATED" : "QUEUED",
        agentId: chosen?.id ?? null,
        allocatedAt: chosen ? new Date() : null,
        distanceKm: chosen?.distanceKm ?? null,
        createdBy: "system:apply",
      },
    });
    await prisma.auditLog.create({
      data: {
        orgId: args.orgId, actorType: "system", action: "field.visit.auto",
        entity: "FieldVisit", entityId: visit.id,
        meta: { applicationId: args.applicationId, allocatedTo: chosen?.id ?? null, distanceKm: chosen?.distanceKm ?? null },
      },
    }).catch(() => {});

    return { scheduled: true, agentName: chosen?.name };
  } catch {
    return { scheduled: false };
  }
}
