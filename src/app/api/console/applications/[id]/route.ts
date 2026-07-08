// POST /api/console/applications/[id] — action an application (staff).
// Body: { action: "approve" | "decline", note? }
//
// Approval walks a two-tier virtual workflow (ServiceSuite default-parity):
//   stage "virtual:officer" — Initiator tier reviews and passes forward
//   stage "virtual:final"   — Validator tier finalizes → BOOKS the loan
//     (native orgs: Loan + schedule + maker-checker Disbursement queue)
// Configurable per-product workflow trees replace the virtual chain when the
// workflow builder ships; the seam is currentStageId.
//
// Adverse actions (decline) are always a HUMAN decision here — the model only
// ever routes to REFERRED (DPA human-in-the-loop).
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { bookLoanFromApplication } from "@/lib/lending/book";

export const runtime = "nodejs";

const LIVE = ["SUBMITTED", "AI_PRESCREEN", "OFFICER_REVIEW", "REFERRED"];
const STAGE_OFFICER = "virtual:officer";
const STAGE_FINAL = "virtual:final";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const { id } = await ctx.params;

  let body: { action?: string; note?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }
  const action = body.action;
  if (action !== "approve" && action !== "decline") {
    return NextResponse.json({ success: false, message: "Unknown action." }, { status: 400 });
  }

  const app = await prisma.loanApplication.findFirst({
    where: { id, orgId: session.user.orgId },
    include: { org: { select: { mode: true, status: true } } },
  });
  if (!app) return NextResponse.json({ success: false, message: "Application not found." }, { status: 404 });
  if (!LIVE.includes(app.status)) {
    return NextResponse.json({ success: false, message: `Application is already ${app.status}.` }, { status: 409 });
  }

  const tiers = session.user.tiers ?? { initiator: false, authorizer: false, validator: false };
  const audit = (a: string, meta: Record<string, unknown>) =>
    prisma.auditLog.create({
      data: { orgId: app.orgId, actorId: session.user!.id, actorType: "staff", action: a, entity: "LoanApplication", entityId: app.id, meta: meta as Prisma.InputJsonValue, ip: req.headers.get("x-forwarded-for") },
    }).catch(() => {});

  // ── Decline: terminal, human decision, note recorded ─────────────────────────
  if (action === "decline") {
    if (!tiers.initiator && !tiers.authorizer && !tiers.validator) {
      return NextResponse.json({ success: false, message: "Your role cannot action applications." }, { status: 403 });
    }
    await prisma.loanApplication.update({
      where: { id: app.id },
      data: { status: "DECLINED", stageTitle: "Declined", decidedAt: new Date() },
    });
    await audit("application.decline", { note: body.note ?? null, stage: app.currentStageId ?? STAGE_OFFICER });
    return NextResponse.json({ success: true, status: "DECLINED" });
  }

  // ── Approve: advance the virtual two-tier workflow ───────────────────────────
  const stage = app.currentStageId ?? STAGE_OFFICER;

  if (stage === STAGE_OFFICER) {
    if (!tiers.initiator) {
      return NextResponse.json({ success: false, message: "Officer review requires the Initiator tier." }, { status: 403 });
    }
    await prisma.loanApplication.update({
      where: { id: app.id },
      data: { currentStageId: STAGE_FINAL, status: "OFFICER_REVIEW", stageTitle: "Final Approval" },
    });
    await audit("application.approve", { stage, next: STAGE_FINAL, note: body.note ?? null });
    return NextResponse.json({ success: true, status: "OFFICER_REVIEW", stageTitle: "Final Approval" });
  }

  // Final stage — validator finalizes.
  if (!tiers.validator) {
    return NextResponse.json({ success: false, message: "Final approval requires the Validator tier." }, { status: 403 });
  }

  if (app.org.mode === "NATIVE") {
    // Live lending gates on platform activation.
    if (app.org.status !== "ACTIVE") {
      return NextResponse.json({ success: false, message: "Your organization is pending BirgenAI activation — booking is disabled until then." }, { status: 403 });
    }
    try {
      const booked = await bookLoanFromApplication(app.id, session.user.id);
      await audit("application.finalize", { stage, note: body.note ?? null, loanId: booked.loanId });
      return NextResponse.json({ success: true, status: "APPROVED", booked });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not book the loan.";
      return NextResponse.json({ success: false, message }, { status: 400 });
    }
  }

  // BRIDGED orgs: the book lives in ServiceSuite — mark approved here; the loan
  // itself is approved inside the lender's ServiceSuite workflow.
  await prisma.loanApplication.update({
    where: { id: app.id },
    data: { status: "APPROVED", stageTitle: "Approved (lender's ServiceSuite workflow)", decidedAt: new Date() },
  });
  await audit("application.finalize", { stage, note: body.note ?? null, bridged: true });
  return NextResponse.json({ success: true, status: "APPROVED" });
}
