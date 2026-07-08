// GET /api/console/applications — the org's application queue (staff).
// ?scope=live (default: SUBMITTED/AI_PRESCREEN/OFFICER_REVIEW/REFERRED) | all
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const LIVE = ["SUBMITTED", "AI_PRESCREEN", "OFFICER_REVIEW", "REFERRED"] as const;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });

  const scope = req.nextUrl.searchParams.get("scope") ?? "live";
  const apps = await prisma.loanApplication.findMany({
    where: {
      orgId: session.user.orgId,
      ...(scope === "live" ? { status: { in: LIVE as unknown as never } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true, createdAt: true, status: true, stageTitle: true, currentStageId: true,
      borrowerName: true, phone: true, amountRequested: true,
      productName: true, productId: true, productRef: true,
      score: true, pd: true, decision: true, reasonCodes: true, graduated: true,
      postedToServiceSuite: true, serviceSuiteLoanId: true,
      loan: { select: { id: true, status: true } },
    },
  });

  return NextResponse.json({
    success: true,
    applications: apps.map((a) => ({
      ...a,
      amountRequested: Number(a.amountRequested),
      pd: a.pd != null ? Number(a.pd) : null,
    })),
  });
}
