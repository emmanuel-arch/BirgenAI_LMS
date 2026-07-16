// Field Ops — the worklist of customers with no location on file.
//
// A borrower with no business/home pin never appears on a route and, once the
// location gate is on, cannot be disbursed to. This is the list of exactly those
// customers on MY book — so a field officer can pick them up on the next visit and
// drop the pin from Customer 360. Scope-fenced like every field surface.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { prisma } from "@/lib/prisma";
import { requireFeature } from "@/lib/billing/entitlements";
import { resolveScope, borrowerScopeWhere } from "@/lib/rbac/scope";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "field.view");
  if (denied) return denied;
  const orgId = session.user.orgId;
  const gate = await requireFeature(orgId, "route-planner");
  if (gate) return gate;

  const scope = await resolveScope(session);
  const borrowers = await prisma.borrower.findMany({
    // No primary pin AND no home pin — genuinely invisible to routes.
    where: { orgId, ...borrowerScopeWhere(scope), lat: null, homeLat: null },
    select: {
      id: true, firstName: true, otherName: true, phone: true, kycStatus: true, createdAt: true,
      loans: { where: { status: "ACTIVE" }, select: { balance: true } },
    },
    take: 500,
  });

  const customers = borrowers.map((b) => ({
    id: b.id,
    name: [b.firstName, b.otherName].filter(Boolean).join(" ") || b.phone,
    phone: b.phone,
    verified: b.kycStatus === "VERIFIED",
    activeLoans: b.loans.length,
    olb: b.loans.reduce((s, l) => s + Number(l.balance), 0),
    since: b.createdAt.toISOString(),
  }));
  // Those with money already out — a live loan you can't visit — rise to the top,
  // then the biggest exposure, then oldest on the book.
  customers.sort((a, b) =>
    (b.activeLoans - a.activeLoans) || (b.olb - a.olb) || (a.since < b.since ? -1 : 1));

  return NextResponse.json({ success: true, count: customers.length, customers });
}
