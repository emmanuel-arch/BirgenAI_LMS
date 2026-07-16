// GET /api/console/borrowers/[id]/profile — the whole customer on one card.
//
// The Customer-360 shows their RISK and their MONEY up top; this is the reference
// side — who they are (KYC, demographics), where they sit in the book (branch,
// officer), who currently stands behind them (guarantor), and the headline credit
// numbers — so an officer answering "tell me about this person" has one place to read.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { prisma } from "@/lib/prisma";
import { resolveScope, canSeeBorrower } from "@/lib/rbac/scope";

export const runtime = "nodejs";

function ageFrom(dob: Date | null): number | null {
  if (!dob) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age >= 0 && age < 130 ? age : null;
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const denied = await requireRight(session, "borrowers.view");
  if (denied) return denied;
  const orgId = session!.user!.orgId!;
  const { id } = await ctx.params;

  const scope = await resolveScope(session!);
  if (!(await canSeeBorrower(scope, id))) {
    return NextResponse.json({ success: false, message: "Borrower not found." }, { status: 404 });
  }

  const b = await prisma.borrower.findFirst({ where: { id, orgId } });
  if (!b) return NextResponse.json({ success: false, message: "Borrower not found." }, { status: 404 });

  const [branch, officer, kyc, guarantor, clearedCount, activeCount] = await Promise.all([
    b.branchId ? prisma.branch.findFirst({ where: { id: b.branchId, orgId }, select: { name: true, code: true } }) : null,
    b.createdById ? prisma.staffUser.findFirst({ where: { id: b.createdById, orgId }, select: { firstName: true, otherName: true, email: true } }) : null,
    prisma.kycSession.findFirst({ where: { orgId, OR: [{ borrowerId: id }, { phone: b.phone }] }, orderBy: { createdAt: "desc" }, select: { status: true, provider: true, livenessPassed: true, faceMatchScore: true, iprsMatched: true, iprsName: true, idQualityScore: true, createdAt: true } }),
    // The guarantor standing behind a live agreement, if any.
    prisma.guarantor.findFirst({ where: { orgId, borrowerId: id, status: { in: ["INVITED", "CONSENTED"] } }, orderBy: { createdAt: "desc" }, select: { fullName: true, phone: true, relationship: true, status: true, amountGuaranteed: true } }),
    prisma.loan.count({ where: { orgId, borrowerId: id, status: "CLEARED" } }),
    prisma.loan.count({ where: { orgId, borrowerId: id, status: { in: ["ACTIVE", "PENDING_DISBURSEMENT"] } } }),
  ]);

  const nok = (b.nextOfKin as { name?: string; relationship?: string; phone?: string } | null) ?? null;

  return NextResponse.json({
    success: true,
    profile: {
      name: `${b.firstName ?? ""}${b.otherName ? " " + b.otherName : ""}`.trim() || "Borrower",
      phone: b.phone,
      email: b.email,
      nationalId: b.nationalId,
      age: ageFrom(b.dob),
      dob: b.dob,
      gender: b.gender,
      language: b.language,
      address: b.locationAddress ?? b.homeAddress ?? null,
      branch: branch ? `${branch.name}${branch.code ? ` (${branch.code})` : ""}` : null,
      officer: officer ? `${officer.firstName ?? ""} ${officer.otherName ?? ""}`.trim() || officer.email : null,
      kyc: kyc ? {
        status: kyc.status, provider: kyc.provider, livenessPassed: kyc.livenessPassed,
        faceMatchScore: kyc.faceMatchScore, iprsMatched: kyc.iprsMatched, iprsName: kyc.iprsName,
        idQualityScore: kyc.idQualityScore, verifiedAt: kyc.createdAt,
      } : { status: b.kycStatus },
      guarantor: guarantor ? {
        name: guarantor.fullName, phone: guarantor.phone, relationship: guarantor.relationship,
        status: guarantor.status, amount: guarantor.amountGuaranteed != null ? Number(guarantor.amountGuaranteed) : null,
      } : null,
      nextOfKin: nok,
      creditScore: b.creditScore,
      behaviouralScore: b.behaviouralScore,
      riskBand: b.riskBand,
      loanLimit: b.loanLimit != null ? Number(b.loanLimit) : null,
      graduationCount: b.graduationCount,
      clearedLoans: clearedCount,
      activeLoans: activeCount,
      customerSince: b.createdAt,
    },
  });
}
