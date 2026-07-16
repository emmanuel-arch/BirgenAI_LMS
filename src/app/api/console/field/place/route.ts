// Resolve a borrower into a destination pin — the Route Planner's deep link.
//
//   GET ?borrowerId=&kind=business|home → { label, lat, lng, address }
//
// Customer 360 hands off to the planner BY ID (?to=<id>&place=business), never
// by coordinates, and this is why: the pin is re-read here, inside the same
// scope fence as everything else, so a link pasted into a chat cannot quietly
// send an agent to coordinates someone edited in a URL bar — and an officer
// cannot resolve a borrower who is not on their book.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { prisma } from "@/lib/prisma";
import { requireFeature } from "@/lib/billing/entitlements";
import { resolveScope, borrowerScopeWhere } from "@/lib/rbac/scope";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "field.view");
  if (denied) return denied;
  const orgId = session.user.orgId;
  const gate = await requireFeature(orgId, "route-planner");
  if (gate) return gate;

  const borrowerId = req.nextUrl.searchParams.get("borrowerId") ?? "";
  const kind = req.nextUrl.searchParams.get("kind") === "home" ? "home" : "business";
  if (!borrowerId) return NextResponse.json({ success: false, message: "A borrower is required." }, { status: 400 });

  const scope = await resolveScope(session);
  const b = await prisma.borrower.findFirst({
    where: { id: borrowerId, orgId, ...borrowerScopeWhere(scope) },
    select: {
      firstName: true, otherName: true, phone: true,
      lat: true, lng: true, locationAddress: true,
      homeLat: true, homeLng: true, homeAddress: true,
    },
  });
  if (!b) return NextResponse.json({ success: false, message: "That customer is not on your book." }, { status: 404 });

  const name = [b.firstName, b.otherName].filter(Boolean).join(" ") || b.phone;
  const pin = kind === "home"
    ? { lat: b.homeLat, lng: b.homeLng, address: b.homeAddress, label: `${name} — home` }
    : { lat: b.lat, lng: b.lng, address: b.locationAddress, label: name };

  if (pin.lat == null || pin.lng == null) {
    return NextResponse.json(
      { success: false, message: `${name} has no ${kind} pin on file — capture it while you are with them.`, borrowerId },
      { status: 404 },
    );
  }

  return NextResponse.json({
    success: true,
    place: { label: pin.label, lat: pin.lat, lng: pin.lng, address: pin.address },
  });
}
