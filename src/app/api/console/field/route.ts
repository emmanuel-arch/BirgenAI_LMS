// Field visits & route planning (staff).
//   GET  → visits + field agents (with live open-visit counts) + per-agent routes
//   POST → create a visit { label, lat, lng, kind?, borrowerId?, applicationId?,
//          address? } then AUTO-ALLOCATE the nearest available agent
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rankAgents, routeOrder } from "@/lib/field/allocate";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const orgId = session.user.orgId;

  const [visits, agents] = await Promise.all([
    prisma.fieldVisit.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { agent: { select: { firstName: true, otherName: true } } },
    }),
    prisma.staffUser.findMany({
      where: { orgId, isFieldAgent: true, status: "ACTIVE" },
      select: { id: true, firstName: true, otherName: true, lat: true, lng: true, title: true, avatarSeed: true },
    }),
  ]);

  // Per-agent greedy route over their OPEN stops.
  const openByAgent = new Map<string, { id: string; lat: number; lng: number }[]>();
  for (const v of visits) {
    if (v.agentId && ["ALLOCATED", "EN_ROUTE", "ARRIVED"].includes(v.status)) {
      const arr = openByAgent.get(v.agentId) ?? [];
      arr.push({ id: v.id, lat: v.lat, lng: v.lng });
      openByAgent.set(v.agentId, arr);
    }
  }
  const routes: Record<string, { id: string; order: number; legKm: number }[]> = {};
  for (const a of agents) {
    if (a.lat != null && a.lng != null && openByAgent.has(a.id)) {
      routes[a.id] = routeOrder({ lat: a.lat, lng: a.lng }, openByAgent.get(a.id)!);
    }
  }

  return NextResponse.json({
    success: true,
    agents: agents.map((a) => ({
      id: a.id, name: `${a.firstName}${a.otherName ? " " + a.otherName : ""}`, title: a.title,
      lat: a.lat, lng: a.lng, avatarSeed: a.avatarSeed ?? a.id,
      openVisits: (openByAgent.get(a.id) ?? []).length,
    })),
    routes,
    visits: visits.map((v) => ({
      id: v.id, label: v.label, kind: v.kind, status: v.status, address: v.address,
      lat: v.lat, lng: v.lng, distanceKm: v.distanceKm, outcome: v.outcome,
      agentId: v.agentId, agentName: v.agent ? `${v.agent.firstName}${v.agent.otherName ? " " + v.agent.otherName : ""}` : null,
      createdAt: v.createdAt, visitedAt: v.visitedAt,
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });

  let body: { label?: string; lat?: number; lng?: number; kind?: string; borrowerId?: string; applicationId?: string; address?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const lat = Number(body.lat), lng = Number(body.lng);
  if (!body.label?.trim() || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ success: false, message: "A label and a map location are required." }, { status: 400 });
  }
  const kind = ["BUSINESS_VERIFICATION", "HOME_VERIFICATION", "COLLECTION_VISIT", "KYC_ASSIST"].includes(body.kind ?? "")
    ? (body.kind as "BUSINESS_VERIFICATION")
    : "BUSINESS_VERIFICATION";

  // Rank agents and allocate the nearest (if any are geolocated).
  const ranked = await rankAgents(session.user.orgId, { lat, lng });
  const chosen = ranked[0] ?? null;

  const visit = await prisma.fieldVisit.create({
    data: {
      orgId: session.user.orgId,
      borrowerId: body.borrowerId || null,
      applicationId: body.applicationId || null,
      kind,
      label: body.label.trim(),
      address: body.address?.trim() || null,
      lat, lng,
      status: chosen ? "ALLOCATED" : "QUEUED",
      agentId: chosen?.id ?? null,
      allocatedAt: chosen ? new Date() : null,
      distanceKm: chosen?.distanceKm ?? null,
      createdBy: session.user.id,
    },
  });
  await prisma.auditLog.create({
    data: { orgId: session.user.orgId, actorId: session.user.id, actorType: "staff", action: "field.visit.create", entity: "FieldVisit", entityId: visit.id, meta: { allocatedTo: chosen?.id ?? null, distanceKm: chosen?.distanceKm ?? null } },
  }).catch(() => {});

  return NextResponse.json({
    success: true,
    visit: { id: visit.id, status: visit.status },
    allocation: chosen ? { agentId: chosen.id, agentName: chosen.name, distanceKm: chosen.distanceKm } : null,
    candidates: ranked.slice(0, 3),
  });
}
