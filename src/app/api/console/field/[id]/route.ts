// POST /api/console/field/[id] — act on a field visit.
// Body: { action: "reallocate" | "en_route" | "arrived" | "verify" | "fail" | "cancel", outcome?, notes? }
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rankAgents } from "@/lib/field/allocate";

export const runtime = "nodejs";

const NEXT: Record<string, string> = { en_route: "EN_ROUTE", arrived: "ARRIVED", verify: "VERIFIED", fail: "FAILED", cancel: "CANCELLED" };

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const { id } = await ctx.params;

  let body: { action?: string; outcome?: string; notes?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const visit = await prisma.fieldVisit.findFirst({ where: { id, orgId: session.user.orgId } });
  if (!visit) return NextResponse.json({ success: false, message: "Visit not found." }, { status: 404 });

  if (body.action === "reallocate") {
    const ranked = await rankAgents(session.user.orgId, { lat: visit.lat, lng: visit.lng });
    // Skip the current agent so "reallocate" actually moves it.
    const chosen = ranked.find((c) => c.id !== visit.agentId) ?? ranked[0] ?? null;
    if (!chosen) return NextResponse.json({ success: false, message: "No other field agent is available." }, { status: 409 });
    await prisma.fieldVisit.update({
      where: { id: visit.id },
      data: { agentId: chosen.id, distanceKm: chosen.distanceKm, status: "ALLOCATED", allocatedAt: new Date() },
    });
    return NextResponse.json({ success: true, status: "ALLOCATED", allocation: { agentId: chosen.id, agentName: chosen.name, distanceKm: chosen.distanceKm } });
  }

  const next = NEXT[body.action ?? ""];
  if (!next) return NextResponse.json({ success: false, message: "Unknown action." }, { status: 400 });

  const terminal = ["VERIFIED", "FAILED", "CANCELLED"].includes(next);
  const updated = await prisma.fieldVisit.update({
    where: { id: visit.id },
    data: {
      status: next as never,
      outcome: body.outcome?.trim() || (next === "VERIFIED" ? "Confirmed on the ground" : undefined),
      notes: body.notes?.trim() || undefined,
      visitedAt: terminal ? new Date() : undefined,
    },
  });
  await prisma.auditLog.create({
    data: { orgId: session.user.orgId, actorId: session.user.id, actorType: "staff", action: `field.visit.${body.action}`, entity: "FieldVisit", entityId: visit.id },
  }).catch(() => {});
  return NextResponse.json({ success: true, status: updated.status });
}
