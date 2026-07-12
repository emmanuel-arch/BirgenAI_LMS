// GET /api/console/borrowers — the org's borrower book (staff).
// ?q= filters by phone / national ID / name. Includes loan + application
// aggregates (the native Customer-360 list view).
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { prisma } from "@/lib/prisma";
import { originStamp, resolveScope, borrowerScopeWhere } from "@/lib/rbac/scope";
import { portraitsFor } from "@/lib/kyc/avatars";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "borrowers.view");
  if (denied) return denied;
  const orgId = session.user.orgId;

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  // Phones are stored as 2547XXXXXXXX; searches arrive as 07XX…, +2547…, etc —
  // match on the last 9 digits so every format finds the same borrower.
  const digits = q.replace(/\D/g, "");
  const phoneNeedle = digits.length >= 9 ? digits.slice(-9) : digits;
  // WHOSE borrowers. Enforced in the QUERY, never in the page: a list that filters on
  // render still ships every row in the HTML (the bug the billing work already caught).
  const scope = await resolveScope(session);

  const borrowers = await prisma.borrower.findMany({
    where: {
      orgId,
      ...borrowerScopeWhere(scope),
      ...(q
        ? {
            OR: [
              ...(phoneNeedle ? [{ phone: { contains: phoneNeedle } }] : []),
              { nationalId: { contains: q } },
              { firstName: { contains: q, mode: "insensitive" as const } },
              { otherName: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      loans: { select: { status: true, loanAmount: true, balance: true } },
      applications: { select: { status: true }, take: 20, orderBy: { createdAt: "desc" } },
      consents: { select: { version: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  // The face beside the name. One batch signature for the whole page (lib/kyc/avatars).
  const portraits = await portraitsFor(borrowers.map((b) => b.id));

  return NextResponse.json({
    success: true,
    borrowers: borrowers.map((b) => {
      const active = b.loans.filter((l) => l.status === "ACTIVE" || l.status === "PENDING_DISBURSEMENT");
      const cleared = b.loans.filter((l) => l.status === "CLEARED");
      return {
        id: b.id,
        portraitUrl: portraits[b.id] ?? null,
        name: `${b.firstName ?? ""} ${b.otherName ?? ""}`.trim() || null,
        phone: b.phone,
        nationalId: b.nationalId,
        kycStatus: b.kycStatus,
        creditScore: b.creditScore,
        riskBand: b.riskBand,
        locationType: b.locationType,
        locationAddress: b.locationAddress,
        hasGeo: b.lat != null && b.lng != null,
        createdAt: b.createdAt,
        loansCount: b.loans.length,
        activeLoans: active.length,
        clearedLoans: cleared.length,
        olb: active.reduce((a, l) => a + Number(l.balance), 0),
        totalBorrowed: b.loans.reduce((a, l) => a + Number(l.loanAmount), 0),
        applications: b.applications.length,
        graduated: cleared.length >= 5 && active.length === 0,
        lastConsent: b.consents[0]?.version ?? null,
      };
    }),
  });
}

// POST — register a walk-in borrower from the console (borrowers.create).
// The officer-side twin of the funnel's self-onboarding: identity now, KYC and
// scoring follow through the normal machinery (the /verify wizard and the
// application pipeline treat a console-created borrower like any other).
export async function POST(req: NextRequest) {
  const session = await auth();
  const denied = await requireRight(session, "borrowers.create");
  if (denied) return denied;
  const orgId = session!.user!.orgId!;

  let body: {
    name?: string; phone?: string; nationalId?: string; email?: string;
    locationType?: string; locationAddress?: string; lat?: number; lng?: number;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const name = (body.name ?? "").trim();
  const digits = (body.phone ?? "").replace(/\D/g, "");
  if (name.length < 3) return NextResponse.json({ success: false, message: "Enter the borrower's full name." }, { status: 400 });
  if (digits.length < 9) return NextResponse.json({ success: false, message: "Enter a valid phone number." }, { status: 400 });
  const phone = `254${digits.slice(-9)}`;

  // One borrower per phone per org — the phone IS the identity key everywhere else.
  const dup = await prisma.borrower.findFirst({ where: { orgId, phone: { contains: digits.slice(-9) } }, select: { id: true } });
  if (dup) {
    return NextResponse.json({ success: false, message: "A borrower with that phone already exists.", borrowerId: dup.id }, { status: 409 });
  }

  const [first, ...rest] = name.split(/\s+/);
  const hasGeo = Number.isFinite(Number(body.lat)) && Number.isFinite(Number(body.lng));

  // The officer who registers a walk-in OWNS them: this stamp is what later lets an
  // OWN-scoped officer see their own book and nobody else's (src/lib/rbac/scope.ts).
  const me = await prisma.staffUser.findFirst({
    where: { id: session!.user!.id, orgId },
    select: { id: true, branchId: true },
  });
  const origin = await originStamp(orgId, me);

  const borrower = await prisma.borrower.create({
    data: {
      orgId,
      createdById: origin.staffId,
      branchId: origin.branchId,
      phone,
      firstName: first,
      otherName: rest.join(" ") || null,
      nationalId: body.nationalId?.trim() || null,
      email: body.email?.trim() || null,
      locationType: body.locationType === "business" || body.locationType === "home" ? body.locationType : null,
      locationAddress: body.locationAddress?.trim() || null,
      lat: hasGeo ? Number(body.lat) : null,
      lng: hasGeo ? Number(body.lng) : null,
    },
  });

  await prisma.auditLog.create({
    data: {
      orgId, actorId: session!.user!.id, actorType: "staff", action: "borrower.create",
      entity: "Borrower", entityId: borrower.id, meta: { channel: "console", phone },
    },
  }).catch(() => {});

  return NextResponse.json({ success: true, borrowerId: borrower.id });
}
