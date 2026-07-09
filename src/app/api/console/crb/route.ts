// POST /api/console/crb — run a credit-bureau check on a borrower.
// Body: { borrowerId }. Simulation-first (see src/lib/crb/provider.ts); stores an
// auditable KycCheck(kind=CRB) with the full report and meters a `crb` usage event.
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runCrbCheck } from "@/lib/crb/provider";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const orgId = session.user.orgId;

  let body: { borrowerId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }
  if (!body.borrowerId) return NextResponse.json({ success: false, message: "A borrower is required." }, { status: 400 });

  const borrower = await prisma.borrower.findFirst({
    where: { id: body.borrowerId, orgId },
    select: { id: true, phone: true, nationalId: true, firstName: true, otherName: true },
  });
  if (!borrower) return NextResponse.json({ success: false, message: "Borrower not found." }, { status: 404 });

  const report = await runCrbCheck(orgId, {
    nationalId: borrower.nationalId, phone: borrower.phone,
    name: `${borrower.firstName ?? ""} ${borrower.otherName ?? ""}`.trim(),
  });

  await prisma.kycCheck.create({
    data: {
      orgId, borrowerId: borrower.id, kind: "CRB",
      passed: report.verdict !== "ADVERSE", score: report.score,
      provider: report.mode === "live" ? report.bureau : "simulation",
      payload: report as unknown as Prisma.InputJsonValue,
    },
  });
  prisma.usageEvent.create({ data: { orgId, kind: "crb", meta: { bureau: report.bureau, mode: report.mode, verdict: report.verdict } } }).catch(() => {});

  return NextResponse.json({ success: true, report });
}
