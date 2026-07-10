// GET /api/console/borrowers — the org's borrower book (staff).
// ?q= filters by phone / national ID / name. Includes loan + application
// aggregates (the native Customer-360 list view).
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { prisma } from "@/lib/prisma";

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
  const borrowers = await prisma.borrower.findMany({
    where: {
      orgId,
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

  return NextResponse.json({
    success: true,
    borrowers: borrowers.map((b) => {
      const active = b.loans.filter((l) => l.status === "ACTIVE" || l.status === "PENDING_DISBURSEMENT");
      const cleared = b.loans.filter((l) => l.status === "CLEARED");
      return {
        id: b.id,
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
