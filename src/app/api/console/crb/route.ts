// POST /api/console/crb — run a credit-bureau check on a borrower.
// Body: { borrowerId, loanAmount?, reason?, force? }.
//
// Live-first when Metropol is configured (src/lib/crb/metropol.ts), otherwise a
// labelled simulation. A recent pull is REUSED (default 6h) so we never pay for a
// second bureau hit — and never trip Metropol's E409 "duplicate within 60s" —
// unless `force:true`. Every pull is stored as an auditable KycCheck(kind=CRB)
// and meters one `crb` usage event.
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { prisma } from "@/lib/prisma";
import { requireFeature } from "@/lib/billing/entitlements";
import { meter } from "@/lib/billing/meter";
import { runCrbCheck, MetropolError, type CrbReport } from "@/lib/crb/provider";
import { REPORT_REASON } from "@/lib/crb/metropol";

export const runtime = "nodejs";

const REUSE_WINDOW_MS = 6 * 60 * 60 * 1000; // a bureau file is fresh for 6 hours

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "borrowers.view");
  if (denied) return denied;
  const orgId = session.user.orgId;

  let body: { borrowerId?: string; loanAmount?: number; reason?: number; force?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }
  if (!body.borrowerId) return NextResponse.json({ success: false, message: "A borrower is required." }, { status: 400 });

  const borrower = await prisma.borrower.findFirst({
    where: { id: body.borrowerId, orgId },
    select: { id: true, phone: true, nationalId: true, firstName: true, otherName: true },
  });
  if (!borrower) return NextResponse.json({ success: false, message: "Borrower not found." }, { status: 404 });

  // Reuse a recent pull unless explicitly forced — cheaper, and dodges E409.
  if (!body.force) {
    const recent = await prisma.kycCheck.findFirst({
      where: { orgId, borrowerId: borrower.id, kind: "CRB", createdAt: { gte: new Date(Date.now() - REUSE_WINDOW_MS) } },
      orderBy: { createdAt: "desc" },
      select: { payload: true, createdAt: true },
    });
    if (recent?.payload) {
      return NextResponse.json({ success: true, report: recent.payload, reused: true, checkedAt: recent.createdAt });
    }
  }

  // A live bureau pull bills us. Gate BEFORE the call, never after.
  const gated = await requireFeature(orgId, "crb");
  if (gated) return gated;

  const reason = Object.values(REPORT_REASON).includes(body.reason as never)
    ? (body.reason as (typeof REPORT_REASON)[keyof typeof REPORT_REASON])
    : REPORT_REASON.VERIFY_DETAILS; // an on-demand 360 pull is "verify details"

  let report: CrbReport;
  try {
    report = await runCrbCheck(orgId, {
      nationalId: borrower.nationalId, phone: borrower.phone,
      name: `${borrower.firstName ?? ""} ${borrower.otherName ?? ""}`.trim(),
    }, { loanAmount: body.loanAmount, reason });
  } catch (err) {
    if (err instanceof MetropolError) {
      // A duplicate/transient live failure: fall back to the most recent stored
      // pull if we have one, so the officer still sees a file.
      const last = await prisma.kycCheck.findFirst({
        where: { orgId, borrowerId: borrower.id, kind: "CRB" },
        orderBy: { createdAt: "desc" }, select: { payload: true, createdAt: true },
      });
      if (last?.payload) return NextResponse.json({ success: true, report: last.payload, reused: true, checkedAt: last.createdAt, note: err.message });
      return NextResponse.json({ success: false, message: err.message, apiCode: err.apiCode }, { status: err.retryable ? 429 : 502 });
    }
    return NextResponse.json({ success: false, message: "Could not complete the bureau check." }, { status: 502 });
  }

  await prisma.kycCheck.create({
    data: {
      orgId, borrowerId: borrower.id, kind: "CRB",
      passed: report.verdict !== "ADVERSE", score: report.score,
      provider: report.mode === "live" ? report.bureau : "simulation",
      payload: report as unknown as Prisma.InputJsonValue,
    },
  });
  void meter(orgId, "crb", 1, { bureau: report.bureau, verdict: report.verdict, mode: report.mode });

  return NextResponse.json({ success: true, report });
}
