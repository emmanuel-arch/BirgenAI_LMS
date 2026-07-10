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
import { requireRight } from "@/lib/rbac/authz";
import { prisma } from "@/lib/prisma";
import { bookLoanFromApplication } from "@/lib/lending/book";
import { issueOtp, verifyOtp } from "@/lib/otp";

export const runtime = "nodejs";

const LIVE = ["SUBMITTED", "AI_PRESCREEN", "OFFICER_REVIEW", "REFERRED"];
const STAGE_OFFICER = "virtual:officer";
const STAGE_FINAL = "virtual:final";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "applications.decide");
  if (denied) return denied;
  const { id } = await ctx.params;

  let body: { action?: string; note?: string; otp?: string };
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

  // ── Approve: advance the product's workflow (or the virtual two-tier default) ─
  // Resolve the stage chain: product.newWorkflowId (repeatWorkflowId for repeat
  // borrowers) → org workflow stages ordered by `order`; no workflow → virtual.
  type StageDef = { id: string; title: string; accessTier: number; canFinalize: boolean; otpRequired: boolean; maxAmount: number | null };
  let chain: StageDef[] = [
    { id: STAGE_OFFICER, title: "Officer Review", accessTier: 1, canFinalize: false, otpRequired: false, maxAmount: null },
    { id: STAGE_FINAL, title: "Final Approval", accessTier: 3, canFinalize: true, otpRequired: true, maxAmount: null },
  ];
  if (app.productId) {
    const product = await prisma.product.findUnique({
      where: { id: app.productId },
      select: { newWorkflowId: true, repeatWorkflowId: true },
    });
    const isRepeat = app.graduated || app.priorLoanCount > 0;
    const workflowId = (isRepeat ? product?.repeatWorkflowId : product?.newWorkflowId) ?? product?.newWorkflowId;
    if (workflowId) {
      const stages = await prisma.workflowStage.findMany({
        where: { workflowId, workflow: { orgId: app.orgId } },
        orderBy: { order: "asc" },
      });
      if (stages.length > 0) {
        chain = stages.map((s) => ({
          id: s.id, title: s.title, accessTier: s.accessTier, canFinalize: s.canFinalize,
          otpRequired: s.otpRequired, maxAmount: s.maxAmount != null ? Number(s.maxAmount) : null,
        }));
      }
    }
  }

  // Locate the current stage; unknown/stale ids (workflow was edited) restart at stage 1.
  const idx = Math.max(0, chain.findIndex((s) => s.id === (app.currentStageId ?? chain[0].id)));
  const stageDef = chain[idx];
  const stage = stageDef.id;

  const tierOk =
    (stageDef.accessTier === 1 && tiers.initiator) ||
    (stageDef.accessTier === 2 && tiers.authorizer) ||
    (stageDef.accessTier === 3 && tiers.validator);
  if (!tierOk) {
    const need = stageDef.accessTier === 1 ? "Initiator" : stageDef.accessTier === 2 ? "Authorizer" : "Validator";
    return NextResponse.json({ success: false, message: `"${stageDef.title}" requires the ${need} tier.` }, { status: 403 });
  }

  // Per-stage finalize amount cap (ServiceSuite finalizeamount parity).
  if (stageDef.canFinalize && stageDef.maxAmount != null && Number(app.amountRequested) > stageDef.maxAmount) {
    return NextResponse.json(
      { success: false, message: `This stage can finalize up to KES ${stageDef.maxAmount.toLocaleString()} — the application asks for more.` },
      { status: 403 },
    );
  }

  // Per-stage OTP (always on for finalize in the virtual default).
  if (stageDef.otpRequired) {
    const otpPurpose = `application:${app.id}:${stage}`;
    if (!body.otp) {
      const { delivered } = await issueOtp(app.orgId, session.user.id, otpPurpose);
      return NextResponse.json({
        success: true,
        otpRequired: true,
        message: delivered
          ? "An approval code has been sent to your email — enter it to continue."
          : "Could not deliver the code (check the org's email/SMS setup).",
      });
    }
    if (!(await verifyOtp(app.orgId, session.user.id, otpPurpose, body.otp))) {
      return NextResponse.json({ success: false, message: "Invalid or expired approval code." }, { status: 403 });
    }
  }

  // Non-final stage: advance to the next one.
  if (!stageDef.canFinalize) {
    const next = chain[idx + 1];
    if (!next) {
      return NextResponse.json({ success: false, message: "Workflow has no next stage — mark the last stage as finalizing." }, { status: 500 });
    }
    await prisma.loanApplication.update({
      where: { id: app.id },
      data: { currentStageId: next.id, status: "OFFICER_REVIEW", stageTitle: next.title },
    });
    await audit("application.approve", { stage, stageTitle: stageDef.title, next: next.id, note: body.note ?? null });
    return NextResponse.json({ success: true, status: "OFFICER_REVIEW", stageTitle: next.title });
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
      // The commonest failure here is now the consent gate — no signed agreement.
      // Say so plainly; the offer panel above the button is where it gets fixed.
      const message = err instanceof Error ? err.message : "Could not book the loan.";
      return NextResponse.json({ success: false, message, ...(/offer/i.test(message) ? { needsOffer: true } : {}) }, { status: 400 });
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
