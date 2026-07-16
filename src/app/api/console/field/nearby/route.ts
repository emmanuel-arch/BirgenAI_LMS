// Field Ops — the officer's radius.
//
//   GET  ?lat=&lng= → every borrower on MY book with a consented location pin,
//        sorted by distance from where I am standing, plus the ones WITHOUT a
//        pin (they surface as tasks — capture it on the next visit, never spy).
//   POST { lat, lng } → check in: update my own base position (StaffUser.lat/lng),
//        which is what nearest-agent dispatch allocates against.
//
// The scope fence holds here like everywhere: an officer sees their own book.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { prisma } from "@/lib/prisma";
import { requireFeature } from "@/lib/billing/entitlements";
import { resolveScope, borrowerScopeWhere } from "@/lib/rbac/scope";
import { haversineKm } from "@/lib/field/allocate";
import { portraitsFor } from "@/lib/kyc/avatars";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "field.view");
  if (denied) return denied;
  const orgId = session.user.orgId;
  const gate = await requireFeature(orgId, "route-planner");
  if (gate) return gate;

  const lat = Number(req.nextUrl.searchParams.get("lat"));
  const lng = Number(req.nextUrl.searchParams.get("lng"));
  const here = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;

  const scope = await resolveScope(session);
  const [borrowers, me] = await Promise.all([
    prisma.borrower.findMany({
      where: { orgId, ...borrowerScopeWhere(scope) },
      select: {
        id: true, firstName: true, otherName: true, phone: true, kycStatus: true,
        lat: true, lng: true, locationType: true, locationAddress: true,
        homeLat: true, homeLng: true, homeAddress: true,
        loans: { where: { status: "ACTIVE" }, select: { balance: true } },
      },
      take: 300,
    }),
    prisma.staffUser.findFirst({
      where: { id: session.user.id, orgId },
      select: { id: true, isFieldAgent: true, lat: true, lng: true },
    }),
  ]);

  const pinned = borrowers.filter((b) => b.lat != null && b.lng != null);
  const unpinned = borrowers.filter((b) => b.lat == null || b.lng == null);
  const portraits = await portraitsFor(pinned.map((b) => b.id));

  return NextResponse.json({
    success: true,
    me: me ? { id: me.id, isFieldAgent: me.isFieldAgent, lat: me.lat, lng: me.lng } : null,
    customers: pinned
      .map((b) => ({
        id: b.id,
        name: [b.firstName, b.otherName].filter(Boolean).join(" ") || b.phone,
        phone: b.phone,
        verified: b.kycStatus === "VERIFIED",
        portraitUrl: portraits[b.id] ?? null,
        lat: b.lat!, lng: b.lng!,
        locationType: b.locationType,
        address: b.locationAddress,
        homeLat: b.homeLat, homeLng: b.homeLng, homeAddress: b.homeAddress,
        olb: b.loans.reduce((s, l) => s + Number(l.balance), 0),
        activeLoans: b.loans.length,
        distanceKm: here ? Number(haversineKm(here, { lat: b.lat!, lng: b.lng! }).toFixed(2)) : null,
      }))
      .sort((a, b2) => (a.distanceKm ?? Infinity) - (b2.distanceKm ?? Infinity)),
    // The alerts: customers whose location was never captured. A task for the
    // next touchpoint — the fix is asking at the counter, not tracking a phone.
    unpinned: unpinned.map((b) => ({
      id: b.id,
      name: [b.firstName, b.otherName].filter(Boolean).join(" ") || b.phone,
      phone: b.phone,
      activeLoans: b.loans.length,
      olb: b.loans.reduce((s, l) => s + Number(l.balance), 0),
    })).sort((a, b2) => b2.olb - a.olb),
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "field.view");
  if (denied) return denied;

  let body: { lat?: number; lng?: number };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }
  const lat = Number(body.lat), lng = Number(body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ success: false, message: "A location is required to check in." }, { status: 400 });
  }

  await prisma.staffUser.update({ where: { id: session.user.id }, data: { lat, lng } });
  await prisma.auditLog.create({
    data: {
      orgId: session.user.orgId, actorId: session.user.id, actorType: "staff",
      action: "field.check-in", entity: "StaffUser", entityId: session.user.id,
      meta: { lat: Number(lat.toFixed(5)), lng: Number(lng.toFixed(5)) },
    },
  }).catch(() => {});

  return NextResponse.json({ success: true });
}
