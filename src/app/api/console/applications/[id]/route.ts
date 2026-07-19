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
import { isPostingEnabled, ensureBorrower, postLoan } from "@/lib/lms/servicesuite";
import { getPostingOrg, getEntityId } from "@/lib/enterprise/connections";
import { issueOtp, verifyOtp } from "@/lib/otp";
import { signedUrl } from "@/lib/storage/provider";
import { PORTRAIT_TTL_SEC } from "@/lib/kyc/avatars";
import { buildSchedule } from "@/lib/lending/schedule";
import { computeApprovedLimit } from "@/lib/lending/limits";

export const runtime = "nodejs";

const LIVE = ["SUBMITTED", "AI_PRESCREEN", "OFFICER_REVIEW", "REFERRED"];
const STAGE_OFFICER = "virtual:officer";
const STAGE_FINAL = "virtual:final";

// GET — the full dossier behind one application, for the decision page. Everything an
// officer needs to APPROVE, REDUCE or REJECT on one screen: who they are (photo + ID),
// what the model thinks (PD, reasons), what they qualify for (the limit engine's verdict
// on the amount), the schedule they'd repay, and the gates still open (location, KYC).
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "applications.view");
  if (denied) return denied;
  const orgId = session.user.orgId;
  const { id } = await ctx.params;

  const app = await prisma.loanApplication.findFirst({
    where: { id, orgId },
    include: {
      borrower: { select: { id: true, firstName: true, otherName: true, phone: true, nationalId: true, kycStatus: true, lat: true, lng: true, homeLat: true, portraitKey: true, idFrontKey: true, creditScore: true, behaviouralScore: true, riskBand: true } },
      product: { select: { id: true, name: true, interestRate: true, interestMethod: true, repaymentPeriod: true, repaymentPeriodUnit: true, gracePeriodDays: true, minPrincipal: true, maxPrincipal: true, minLoanLimit: true, guarantorRequired: true, securityRequired: true } },
      guarantors: { orderBy: { createdAt: "desc" }, take: 1, select: { fullName: true, phone: true, relationship: true, status: true } },
      loan: { select: { id: true, status: true } },
    },
  });
  if (!app) return NextResponse.json({ success: false, message: "Application not found." }, { status: 404 });

  const b = app.borrower;
  const [kyc, portraitUrl, idFrontUrl] = await Promise.all([
    prisma.kycSession.findFirst({ where: { orgId, OR: [{ borrowerId: b.id }, { phone: b.phone }] }, orderBy: { createdAt: "desc" }, select: { livenessScore: true, livenessPassed: true, faceMatchScore: true, iprsMatched: true, idQualityScore: true, status: true } }),
    b.portraitKey ? signedUrl(b.portraitKey, PORTRAIT_TTL_SEC).catch(() => null) : Promise.resolve(null),
    b.idFrontKey ? signedUrl(b.idFrontKey, PORTRAIT_TTL_SEC).catch(() => null) : Promise.resolve(null),
  ]);

  const amount = Number(app.amountRequested);
  const rate = Number(app.product?.interestRate ?? 0);
  const count = app.product?.repaymentPeriod ?? 0;
  const unit = app.product?.repaymentPeriodUnit ?? "week";

  // Recompute the limit against the stored features + this product, so the page can
  // recommend a number. The stored approvedLimit is the record; this makes the
  // "increase / reduce" call and shows the affordable installment.
  const features = (app.featuresSnapshot ?? null) as { avgMonthlyNet?: number } | null;
  const book = await prisma.loan.findMany({ where: { orgId, borrowerId: b.id }, select: { status: true, loanAmount: true } });
  const cleared = book.filter((l) => l.status === "CLEARED");
  const limit = computeApprovedLimit({
    pd: app.pd != null ? Number(app.pd) : 0.15,
    decision: app.decision ?? "REVIEW",
    avgMonthlyNet: features?.avgMonthlyNet ?? null,
    priorLoanCount: cleared.length,
    graduated: app.graduated,
    largestCleared: cleared.reduce((m, l) => Math.max(m, Number(l.loanAmount)), 0) || null,
    productMin: Number(app.product?.minPrincipal ?? 0),
    productMax: Number(app.product?.maxPrincipal ?? 0),
    productRate: rate,
    repaymentPeriod: count,
    repaymentPeriodUnit: unit,
    minLoanLimit: app.product?.minLoanLimit != null ? Number(app.product.minLoanLimit) : null,
  });

  let verdict: "increase" | "reduce" | "ok" | "declined" = "ok";
  if (limit.approvedLimit === 0) verdict = "declined";
  else if (amount > limit.approvedLimit) verdict = "reduce";
  else if (amount < limit.approvedLimit * 0.85) verdict = "increase";

  // The schedule they'd repay if booked at the requested amount.
  let schedule: { seq: number; dueDate: string; amountDue: number }[] = [];
  let interest = 0, loanAmount = amount;
  if (count > 0 && amount > 0) {
    const s = buildSchedule({ principal: amount, rate, count, unit, method: (app.product?.interestMethod as "flat" | "reducing") ?? "flat", graceDays: app.product?.gracePeriodDays ?? 0 });
    schedule = s.rows.map((r) => ({ seq: r.seq, dueDate: r.dueDate.toISOString(), amountDue: r.amountDue }));
    interest = s.interest; loanAmount = s.loanAmount;
  }

  const locationPinned = b.lat != null || b.homeLat != null;

  return NextResponse.json({
    success: true,
    application: {
      id: app.id, status: app.status, stageTitle: app.stageTitle, currentStageId: app.currentStageId,
      amountRequested: amount, createdAt: app.createdAt, fusionEngine: app.fusionEngine,
      score: app.score, pd: app.pd != null ? Number(app.pd) : null, decision: app.decision,
      reasonCodes: app.reasonCodes ?? [], graduated: app.graduated, priorLoanCount: app.priorLoanCount,
      approvedLimitAtApply: app.approvedLimit != null ? Number(app.approvedLimit) : null,
      loan: app.loan,
    },
    borrower: {
      id: b.id, name: `${b.firstName ?? ""}${b.otherName ? " " + b.otherName : ""}`.trim() || "Applicant",
      phone: b.phone, nationalId: b.nationalId, kycStatus: b.kycStatus, verified: b.kycStatus === "VERIFIED",
      creditScore: b.creditScore, behaviouralScore: b.behaviouralScore, riskBand: b.riskBand,
      portraitUrl, idFrontUrl, locationPinned,
    },
    product: app.product ? {
      name: app.product.name, interestRate: rate, interestMethod: app.product.interestMethod,
      repaymentPeriod: count, repaymentPeriodUnit: unit,
      guarantorRequired: app.product.guarantorRequired, securityRequired: app.product.securityRequired,
      minPrincipal: Number(app.product.minPrincipal), maxPrincipal: Number(app.product.maxPrincipal),
    } : null,
    guarantor: app.guarantors[0] ?? null,
    kyc,
    recommendation: {
      verdict,
      approvedLimit: limit.approvedLimit,
      affordableInstallment: limit.affordableInstallment,
      installmentCount: limit.installmentCount,
      installmentUnit: limit.installmentUnit,
      reasons: limit.reasons,
      hasStatement: !!features?.avgMonthlyNet,
    },
    schedule, interest, loanAmount,
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "applications.decide");
  if (denied) return denied;
  const { id } = await ctx.params;

  let body: { action?: string; note?: string; otp?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }
  const action = body.action;
  if (action !== "approve" && action !== "decline" && action !== "send-back") {
    return NextResponse.json({ success: false, message: "Unknown action." }, { status: 400 });
  }

  const app = await prisma.loanApplication.findFirst({
    where: { id, orgId: session.user.orgId },
    include: { org: { select: { mode: true, status: true, slug: true } } },
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

  // ── Send back: return the application to an earlier review, not off the books ──
  // The middle option between "approve" and the terminal "decline": something needs
  // fixing (a missing pin, a wrong amount, an unsigned offer) before it can advance.
  // It re-enters the queue as REFERRED at stage one, with the reason on the record.
  if (action === "send-back") {
    if (!tiers.initiator && !tiers.authorizer && !tiers.validator) {
      return NextResponse.json({ success: false, message: "Your role cannot action applications." }, { status: 403 });
    }
    await prisma.loanApplication.update({
      where: { id: app.id },
      data: { status: "REFERRED", stageTitle: "Sent back for review", currentStageId: null },
    });
    await audit("application.send-back", { note: body.note ?? null, from: app.currentStageId ?? STAGE_OFFICER });
    return NextResponse.json({ success: true, status: "REFERRED", stageTitle: "Sent back for review" });
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

  // BRIDGED orgs: the book lives in ServiceSuite. Final approval here BOOKS the
  // loan into the lender's own approval workflow (the Micromart pilot: product
  // 31418 in the boss's fintech deployment, workflow "FINTECH APPROVAL" — Risk →
  // Customer Service — takes over from there). A pilot customer is brand-new to
  // that ledger, so the borrower is registered there first when missing. Reads
  // (history, graduation) stay on the lender's MAIN server; only the booking
  // goes to the posting target — getPostingOrg() keeps those apart.
  const postingOrg = getPostingOrg(app.org.slug);
  const [pilotProduct, borrowerRow] = await Promise.all([
    app.productId
      ? prisma.product.findUnique({ where: { id: app.productId }, select: { serviceSuiteProductId: true, name: true } })
      : Promise.resolve(null),
    app.borrowerId
      ? prisma.borrower.findUnique({ where: { id: app.borrowerId }, select: { firstName: true, otherName: true, phone: true, nationalId: true, email: true } })
      : Promise.resolve(null),
  ]);
  const ssProductId = pilotProduct?.serviceSuiteProductId ?? (/^\d+$/.test(app.productRef ?? "") ? Number(app.productRef) : null);

  if (isPostingEnabled() && postingOrg && ssProductId && borrowerRow?.phone) {
    const entityId = getEntityId(postingOrg);
    const ensured = await ensureBorrower(postingOrg, entityId, {
      phone: borrowerRow.phone,
      firstName: borrowerRow.firstName || app.borrowerName?.split(/\s+/)[0] || "CUSTOMER",
      otherName: borrowerRow.otherName || app.borrowerName?.split(/\s+/).slice(1).join(" ") || null,
      nationalId: borrowerRow.nationalId,
      email: borrowerRow.email,
    });
    if (!ensured.ok) {
      await prisma.loanApplication.update({ where: { id: app.id }, data: { postError: ensured.message } });
      return NextResponse.json({ success: false, message: `Could not register the customer with the lender: ${ensured.message}` }, { status: 502 });
    }
    const res = await postLoan(postingOrg, {
      borrowerId: ensured.borrowerId,
      principal: Number(app.amountRequested),
      productId: ssProductId,
      applicationId: app.id,
    });
    if (!res.ok) {
      await prisma.loanApplication.update({ where: { id: app.id }, data: { postError: res.message } });
      return NextResponse.json({ success: false, message: `The lender's system declined the booking: ${res.message}` }, { status: 502 });
    }
    await prisma.loanApplication.update({
      where: { id: app.id },
      data: {
        status: "APPROVED",
        stageTitle: `Booked to ${postingOrg.name} — lender approval`,
        postedToServiceSuite: true,
        serviceSuiteLoanId: res.loanId,
        postError: null,
        decidedAt: new Date(),
      },
    });
    await audit("application.finalize", {
      stage, note: body.note ?? null, bridged: true,
      posted: true, target: postingOrg.slug, serviceSuiteLoanId: res.loanId,
      borrowerRegistered: ensured.created,
    });
    return NextResponse.json({ success: true, status: "APPROVED", posted: true, serviceSuiteLoanId: res.loanId });
  }

  // Posting off/unconfigured: mark approved here; the loan is approved inside the
  // lender's ServiceSuite workflow by their own team.
  await prisma.loanApplication.update({
    where: { id: app.id },
    data: { status: "APPROVED", stageTitle: "Approved (lender's ServiceSuite workflow)", decidedAt: new Date() },
  });
  await audit("application.finalize", { stage, note: body.note ?? null, bridged: true });
  return NextResponse.json({ success: true, status: "APPROVED" });
}
