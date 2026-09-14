// ─────────────────────────────────────────────────────────────────────────────
// POST /api/portal/apply — the customer applies, from the app, into the lender's
// own LMS workflow.
//
// Body: {
//   lenderSlug, productId, amount,
//   termCount,                       the repayment period the customer chose
//   schedule?: [{ seq, dueDate, amount }],   their reshaped plan, if they shaped one
//   agreement: { accepted, version, crbConsent },
//   lat?, lng?
// }
//
// ── WHERE THE APPLICATION LANDS ─────────────────────────────────────────────
// It used to be written as SUBMITTED with a stage called "Submitted" that no
// workflow in the console contains — so an officer's Risk queue never saw it, and
// the customer's tracker named a desk that does not exist. It now enters the
// product's OWN workflow at its first stage, resolved by the same chain the
// console advances (lib/workflow/chain.ts): for Micromart's Micro Eazy that is
// "Risk", then "Customer Service", and only the finalizing stage books it into
// Micromart's own ServiceSuite. The app does not post to the lender at submit.
//
// ── NOTHING THE HANDSET COMPUTED IS TAKEN AS GIVEN ─────────────────────────
//   the limit     — allocated by the statement crunch, read from the borrower row
//   the price     — re-derived from the lender's live rate and fee sheet at the
//                   chosen term (lib/portal/pricing.ts)
//   the score     — read from the customer's own crunch snapshot, never the body
//   the schedule  — accepted only if its rows sum to the server's total to the
//                   cent over the chosen number of periods; otherwise rebuilt
//   the bureau    — the stored Metropol file; the Risk stage's own gate needs it
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveOrg, type ResolvedOrg } from "@/lib/tenancy";
import { enterOrg } from "@/lib/db/context";
import { borrowerFor, otpRequired } from "@/lib/portal/session";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { findOrOpenThread, postMessage } from "@/lib/conversation/threads";
import { micromartApply, isMicromartApplyArmed, micromartProducts, toShelfProduct, isSellable } from "@/lib/portal/micromart-apply";
import { sqlShelf, type ShelfCharge } from "@/lib/portal/shelf";
import { priceLoan } from "@/lib/portal/pricing";
import { portalBorrowerId } from "@/lib/portal/borrower";
import { portalContract } from "@/lib/portal/journey";
import { resolveStageChain } from "@/lib/workflow/chain";
import { MERGED_CRB_ONLY } from "@/lib/crb/rows";
import { CRB_FRESH_DAYS } from "@/lib/crb/stage-gate";
import { decisionFor } from "@/lib/statement/score-scale";

export const runtime = "nodejs";

const LIVE = ["SUBMITTED", "AI_PRESCREEN", "OFFICER_REVIEW", "REFERRED"] as const;
const AGREEMENT_VERSION = "micromart-terms-2026-09";

type Body = {
  lenderSlug?: string;
  productId?: string;
  amount?: number;
  nationalId?: string;
  termCount?: number;
  schedule?: { seq?: number; dueDate?: string; amount?: number }[];
  agreement?: { accepted?: boolean; version?: string; crbConsent?: boolean };
  lat?: number;
  lng?: number;
};

export async function POST(req: NextRequest) {
  let body: Body;
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const org = await resolveOrg(body.lenderSlug ?? "");
  if (!org) return NextResponse.json({ success: false, message: "Choose a lender." }, { status: 400 });
  enterOrg(org.id);

  const session = await borrowerFor(org.id);
  if (!session) return otpRequired();

  const limited = await rateLimit(
    [
      { name: "apply:phone", subject: `${org.id}:${session.phone}`, max: 5, windowSec: 3600 },
      { name: "apply:phone:day", subject: `${org.id}:${session.phone}`, max: 10, windowSec: 86400 },
      { name: "apply:ip", subject: clientIp(req), max: 20, windowSec: 3600 },
    ],
    "You have applied several times just now. Give us a moment to process those first.",
  );
  if (limited) return limited;

  const amount = Math.round(Number(body.amount));
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ success: false, field: "amount", message: "Choose how much you would like to borrow." }, { status: 400 });
  }
  if (body.agreement?.accepted !== true) {
    return NextResponse.json({ success: false, field: "agreement", message: "Read and accept the loan agreement to apply." }, { status: 400 });
  }

  const borrowerId = await portalBorrowerId(org, session);
  const borrower = borrowerId
    ? await prisma.borrower.findUnique({
        where: { id: borrowerId },
        select: {
          id: true, firstName: true, otherName: true, nationalId: true, phone: true, kycStatus: true,
          loanLimit: true, erasedAt: true, graduationCount: true, lat: true, lng: true, locationType: true, locationAddress: true,
          branchId: true, createdById: true, serviceSuiteBorrowerId: true,
        },
      })
    : null;
  if (!borrower || borrower.erasedAt) {
    return NextResponse.json({ success: false, reason: "kyc", message: "Verify your identity first, then apply." }, { status: 404 });
  }

  // ── IDENTITY ──────────────────────────────────────────────────────────────
  // VERIFIED passes. PENDING_REVIEW passes only when the ONE thing outstanding is
  // the lender's own mandatory sign-off: every machine check has cleared, the
  // application goes to Risk where people look anyway, and no money moves before
  // the sign-off. Any other referral — a face, a registry miss — waits.
  const kyc = await prisma.kycSession.findFirst({
    where: { orgId: org.id, phone: { endsWith: session.phone.slice(-9) }, status: { in: ["VERIFIED", "PENDING_REVIEW"] } },
    orderBy: { createdAt: "desc" },
    select: { status: true, riskFlags: true },
  });
  const kycFlags = Array.isArray(kyc?.riskFlags) ? (kyc!.riskFlags as unknown[]).map(String) : [];
  const signOffOnly = borrower.kycStatus === "PENDING_REVIEW" && kycFlags.length > 0 && kycFlags.every((f) => f === "manualReview");
  // A customer resolved from the lender's own book was identified by the lender
  // when that account was opened. Their row here carries no local KYC status
  // (NONE), and refusing them on it would lock every existing customer out.
  const lenderCustomer = org.mode !== "NATIVE" && borrower.serviceSuiteBorrowerId != null;
  if (borrower.kycStatus !== "VERIFIED" && !signOffOnly && !lenderCustomer) {
    return NextResponse.json(
      {
        success: false, reason: "kyc", kycStatus: borrower.kycStatus,
        message: borrower.kycStatus === "PENDING_REVIEW"
          ? "Your ID is with our team for a quick look. We will message you as soon as it clears — you can apply right after."
          : "Finish verifying your identity before you apply.",
      },
      { status: 409 },
    );
  }

  const contract = await portalContract(org);

  // ── ONE AT A TIME ─────────────────────────────────────────────────────────
  const open = await prisma.loanApplication.findFirst({
    where: { orgId: org.id, borrowerId: borrower.id, status: { in: [...LIVE] } },
    select: { id: true, stageTitle: true },
  });
  if (open) {
    return NextResponse.json(
      { success: false, reason: "open-application", applicationId: open.id, message: `You already have an application with ${open.stageTitle ?? "our team"}. Follow it from Application.` },
      { status: 409 },
    );
  }
  if (contract.flags.oneActiveLoan) {
    const running = await prisma.loan.count({ where: { orgId: org.id, borrowerId: borrower.id, status: { in: ["ACTIVE", "PENDING_DISBURSEMENT", "RESTRUCTURED"] } } });
    if (running > 0) {
      return NextResponse.json({ success: false, reason: "active-loan", message: `${org.name} lends one loan at a time. Clear your running loan, then apply.` }, { status: 409 });
    }
  }

  // ── THE PRODUCT, AT THE LENDER'S PRICE ────────────────────────────────────
  const product = await resolveProduct(org, (body.productId ?? "").trim(), session);
  if (!product) {
    return NextResponse.json({ success: false, field: "productId", message: "That product is not available right now. Choose again." }, { status: 400 });
  }

  // ── THE LIMIT ─────────────────────────────────────────────────────────────
  const cleared = await prisma.loan.count({ where: { orgId: org.id, borrowerId: borrower.id, status: "CLEARED" } });
  const limit = borrower.loanLimit != null ? Number(borrower.loanLimit) : null;
  if (limit == null && cleared === 0 && !lenderCustomer) {
    return NextResponse.json({ success: false, reason: "crunch", message: "Read your M-PESA statement first — your starting limit comes from it." }, { status: 409 });
  }
  const ceiling = Math.min(product.maxPrincipal > 0 ? product.maxPrincipal : Number.MAX_SAFE_INTEGER, limit ?? Number.MAX_SAFE_INTEGER);
  if (amount < product.minPrincipal) {
    return NextResponse.json({ success: false, field: "amount", message: `The smallest ${product.name} loan is KSh ${product.minPrincipal.toLocaleString("en-KE")}.` }, { status: 400 });
  }
  if (amount > ceiling) {
    return NextResponse.json(
      { success: false, reason: "limit", field: "amount", ceiling, message: `You can borrow up to KSh ${ceiling.toLocaleString("en-KE")} on ${product.name} right now. Your limit grows each time you clear a loan.` },
      { status: 400 },
    );
  }

  // ── THE TERM THE CUSTOMER CHOSE, PRICED HERE ──────────────────────────────
  const maxTerm = product.repaymentPeriod;
  const minTerm = product.interestMethod === "flat" ? Math.max(1, product.minRepaymentPeriod) : maxTerm;
  const termCount = Number.isInteger(Number(body.termCount)) ? Number(body.termCount) : maxTerm;
  if (termCount < minTerm || termCount > maxTerm) {
    return NextResponse.json(
      { success: false, field: "termCount", message: `${product.name} is repaid over ${minTerm === maxTerm ? maxTerm : `${minTerm} to ${maxTerm}`} ${product.repaymentUnit}${maxTerm === 1 ? "" : "s"}.` },
      { status: 400 },
    );
  }
  const priced = priceLoan({
    principal: amount,
    ratePerPeriod: product.ratePerPeriod,
    termCount,
    termUnit: product.repaymentUnit,
    method: product.interestMethod,
    charges: product.charges,
  });

  // The customer's own plan is kept only if it is a plan for THIS loan.
  const rows = (Array.isArray(body.schedule) ? body.schedule : [])
    .map((r, i) => ({ seq: Number(r.seq) || i + 1, dueDate: String(r.dueDate ?? ""), amount: Math.round(Number(r.amount) * 100) }));
  const shaped =
    rows.length === termCount &&
    rows.every((r) => Number.isFinite(r.amount) && r.amount >= 0) &&
    rows.reduce((a, r) => a + r.amount, 0) === Math.round(priced.totalRepayable * 100);

  // ── SCORE AND BUREAU, FROM WHAT IS ON FILE ────────────────────────────────
  const [snapshot, crb] = await Promise.all([
    prisma.scoreSnapshot.findFirst({
      where: { orgId: org.id, borrowerId: borrower.id, modelKind: "thin-file" },
      orderBy: { createdAt: "desc" },
      select: { id: true, score: true, pd: true, modelVersion: true, reasons: true, features: true },
    }),
    prisma.kycCheck.findFirst({
      where: { orgId: org.id, borrowerId: borrower.id, kind: "CRB", ...MERGED_CRB_ONLY },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, score: true, payload: true },
    }),
  ]);

  const { chain, current } = await resolveStageChain({
    orgId: org.id,
    productId: product.localId,
    currentStageId: null,
    graduated: borrower.graduationCount > 0,
    priorLoanCount: cleared,
  });
  const lmsWorkflow = !current.id.startsWith("virtual:");

  const crbFresh = crb && Date.now() - crb.createdAt.getTime() < CRB_FRESH_DAYS * 86_400_000;
  if (chain.some((s) => s.crbRequired) && !crbFresh) {
    return NextResponse.json(
      { success: false, reason: "crb", message: `${org.name} checks every application with a credit reference bureau. Run your credit check, then apply.` },
      { status: 409 },
    );
  }
  const crbPayload = (crb?.payload ?? null) as { verdict?: string; bureau?: string; summary?: string } | null;

  let decision: string | null = snapshot?.score != null ? decisionFor(snapshot.score) : null;
  const reasonCodes: unknown[] = Array.isArray(snapshot?.reasons) ? [...(snapshot!.reasons as unknown[])] : [];
  if (crbPayload?.verdict === "ADVERSE") {
    // Never an automatic decline from the bureau alone — a person decides.
    if (decision === "APPROVE") decision = "REFER";
    reasonCodes.push({ code: "CRB_ADVERSE", factor: "Credit bureau", detail: crbPayload.summary ?? "Adverse bureau file.", direction: "down", points: 0 });
  }
  if (signOffOnly) {
    reasonCodes.push({ code: "KYC_SIGNOFF", factor: "Identity sign-off", detail: "All automated identity checks passed; the lender's mandatory human sign-off is outstanding.", direction: "down", points: 0 });
  }

  const consent = {
    agreementVersion: body.agreement?.version || AGREEMENT_VERSION,
    agreementAccepted: true,
    crbCheck: body.agreement?.crbConsent === true,
    shareWithCrb: body.agreement?.crbConsent === true,
    at: new Date().toISOString(),
    ip: clientIp(req),
  };

  const lat = Number.isFinite(body.lat) ? Number(body.lat) : borrower.lat;
  const lng = Number.isFinite(body.lng) ? Number(body.lng) : borrower.lng;

  const app = await prisma.loanApplication.create({
    data: {
      orgId: org.id,
      borrowerId: borrower.id,
      officerId: borrower.createdById ?? null,
      branchId: borrower.branchId ?? null,
      ...(product.localId ? { productId: product.localId } : {}),
      productRef: product.serviceSuiteProductId != null ? String(product.serviceSuiteProductId) : null,
      productName: product.name,
      phone: borrower.phone,
      nationalId: borrower.nationalId,
      borrowerName: [borrower.firstName, borrower.otherName].filter(Boolean).join(" ").trim() || null,
      amountRequested: new Prisma.Decimal(amount),
      approvedLimit: limit != null ? new Prisma.Decimal(limit) : null,
      graduated: borrower.graduationCount > 0,
      priorLoanCount: cleared,
      status: "OFFICER_REVIEW",
      stageTitle: current.title,
      currentStageId: current.id,
      fusionEngine: "portal",
      ...(snapshot
        ? {
            score: snapshot.score,
            pd: snapshot.pd != null ? new Prisma.Decimal(Number(snapshot.pd)) : null,
            scoreModelVersion: snapshot.modelVersion,
            featuresSnapshot: (snapshot.features ?? undefined) as Prisma.InputJsonValue | undefined,
          }
        : {}),
      decision,
      reasonCodes: reasonCodes as Prisma.InputJsonValue,
      consent: consent as Prisma.InputJsonValue,
      consentVersion: consent.agreementVersion,
      details: {
        plan: {
          termCount: priced.termCount,
          termUnit: priced.termUnit,
          ratePerPeriod: priced.ratePerPeriod,
          totalRatePct: priced.totalRatePct,
          interest: priced.interest,
          fees: priced.fees,
          upfront: priced.upfront,
          deducted: priced.deducted,
          spread: priced.spread,
          netDisbursed: priced.netDisbursed,
          totalRepayable: priced.totalRepayable,
          schedule: shaped
            ? rows.map((r) => ({ seq: r.seq, dueDate: r.dueDate, amount: r.amount / 100 }))
            : priced.installments,
          shapedByCustomer: shaped,
        },
        crb: crb ? { at: crb.createdAt.toISOString(), verdict: crbPayload?.verdict ?? null, score: crb.score, bureau: crbPayload?.bureau ?? null } : null,
        crunchSnapshotId: snapshot?.id ?? null,
        kycSignOffPending: signOffOnly,
        channel: "micro-eazy-app",
      } as Prisma.InputJsonValue,
      // The lender's own id for this person: from the password door when it
      // answered, otherwise from the book record the row was resolved from.
      serviceSuiteBorrowerId:
        Number(session.ssBorrowerId) > 0 ? Number(session.ssBorrowerId) : borrower.serviceSuiteBorrowerId ?? null,
      ...(Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng, locationType: borrower.locationType, locationAddress: borrower.locationAddress } : {}),
      decidedAt: new Date(),
    },
    select: { id: true, createdAt: true },
  });

  await prisma.auditLog.create({
    data: {
      orgId: org.id, actorId: borrower.id, actorType: "borrower", action: "application.submitted",
      entity: "LoanApplication", entityId: app.id, ip: clientIp(req),
      meta: {
        via: "portal", amount, termCount, product: product.name, productId: product.localId,
        serviceSuiteProductId: product.serviceSuiteProductId, stage: current.title, totalRepayable: priced.totalRepayable,
      },
    },
  }).catch(() => {});

  const thread = await findOrOpenThread({
    orgId: org.id,
    borrowerId: borrower.id,
    kind: "APPLICATION",
    subject: `${product.name} — KSh ${amount.toLocaleString("en-KE")}`,
    applicationId: app.id,
    stageTitle: current.title,
  }).catch(() => null);
  if (thread) {
    await postMessage({
      orgId: org.id,
      threadId: thread.id,
      authorType: "system",
      authorName: "Micro Eazy",
      body: `Your application for KSh ${amount.toLocaleString("en-KE")} on ${product.name}, repaid over ${termCount} ${product.repaymentUnit}${termCount === 1 ? "" : "s"}, has been received and is now with ${current.title}.`,
      event: "application.submitted",
      eventData: { amount, product: product.name, termCount, stage: current.title },
    }).catch(() => {});
  }

  // ── THE LENDER'S BOOK ─────────────────────────────────────────────────────
  // With an LMS workflow, the finalizing stage books the loan into the lender's
  // system — an application that has not passed Risk must never appear there.
  // Only a product with no workflow at all keeps the old submit-time post, which
  // stays behind MICROMART_APPLY_ENABLED.
  const posted: { loanId?: string; shadowed?: boolean; error?: string } = {};
  if (!lmsWorkflow && product.serviceSuiteProductId && session.ssBorrowerId != null && session.ssEntityId) {
    const result = await micromartApply({
      borrowerAccount: session.ssAccount ?? session.phone,
      borrowedAmount: amount,
      borrowerId: session.ssBorrowerId,
      entityId: session.ssEntityId,
      productId: product.serviceSuiteProductId,
      borrowerType: 1,
    });
    if (result.kind === "posted") {
      posted.loanId = result.loanId;
      await prisma.loanApplication.update({ where: { id: app.id }, data: { postedToServiceSuite: true, serviceSuiteLoanId: result.loanId, postError: null } });
    } else if (result.kind === "shadowed") {
      posted.shadowed = true;
      await prisma.loanApplication.update({ where: { id: app.id }, data: { postError: "SHADOWED — MICROMART_APPLY_ENABLED is not set. Nothing was sent to the lender." } });
    } else {
      posted.error = result.kind === "refused" ? result.message : "We could not reach Micromart to file this.";
      await prisma.loanApplication.update({ where: { id: app.id }, data: { postError: posted.error } });
    }
  }

  return NextResponse.json({
    success: true,
    applicationId: app.id,
    threadId: thread?.id ?? null,
    amount,
    product: product.name,
    submittedAt: app.createdAt,
    stage: { title: current.title, index: 1, of: chain.length, stages: chain.map((s) => s.title) },
    plan: priced,
    lender: {
      armed: isMicromartApplyArmed(),
      posted: Boolean(posted.loanId),
      loanId: posted.loanId ?? null,
      shadowed: Boolean(posted.shadowed),
      error: posted.error ?? null,
      bookedAt: lmsWorkflow ? chain.find((s) => s.canFinalize)?.title ?? chain[chain.length - 1].title : null,
    },
  });
}

type ResolvedProduct = {
  localId: string | null;
  serviceSuiteProductId: number | null;
  name: string;
  minPrincipal: number;
  maxPrincipal: number;
  ratePerPeriod: number;
  interestMethod: "flat" | "reducing";
  repaymentPeriod: number;
  minRepaymentPeriod: number;
  repaymentUnit: string;
  charges: ShelfCharge[];
};

/**
 * The product, from whichever side of the bridge holds it — and always at the
 * LENDER's live price when the lender has one. A local mirror lends its id (so
 * the application binds to our workflow); the rate, term and fee sheet come from
 * the lender's own tables. `ss:<n>` in a request is a CLAIM, re-read from the
 * shelf rather than trusted.
 */
async function resolveProduct(
  org: ResolvedOrg,
  productId: string,
  session: { ssEntityId?: number; ssToken?: string; ssAccount?: string; phone: string },
): Promise<ResolvedProduct | null> {
  if (!productId) return null;

  const live = org.mode === "BRIDGED" && org.bridgedReady && org.registry
    ? await sqlShelf(org.registry, org.entityId).catch(() => null)
    : null;

  let local: { id: string; name: string; minPrincipal: unknown; maxPrincipal: unknown; serviceSuiteProductId: number | null; interestRate: unknown; interestMethod: string; interestPeriodUnit: string; repaymentPeriod: number; minRepaymentPeriod: number | null; repaymentPeriodUnit: string } | null = null;
  let ssId: number | null = null;

  if (productId.startsWith("ss:")) {
    ssId = Number(productId.slice(3));
    if (!Number.isInteger(ssId) || ssId <= 0) return null;
    local = await prisma.product.findFirst({
      where: { orgId: org.id, serviceSuiteProductId: ssId, isActive: true },
      select: { id: true, name: true, minPrincipal: true, maxPrincipal: true, serviceSuiteProductId: true, interestRate: true, interestMethod: true, interestPeriodUnit: true, repaymentPeriod: true, minRepaymentPeriod: true, repaymentPeriodUnit: true },
    });
  } else {
    local = await prisma.product.findFirst({
      where: { id: productId, orgId: org.id, isActive: true },
      select: { id: true, name: true, minPrincipal: true, maxPrincipal: true, serviceSuiteProductId: true, interestRate: true, interestMethod: true, interestPeriodUnit: true, repaymentPeriod: true, minRepaymentPeriod: true, repaymentPeriodUnit: true },
    });
    if (!local) return null;
    ssId = local.serviceSuiteProductId;
  }

  const row = ssId != null ? live?.find((p) => p.serviceSuiteProductId === ssId) : undefined;
  if (row) {
    return {
      localId: local?.id ?? null,
      serviceSuiteProductId: row.serviceSuiteProductId,
      name: local?.name || row.name,
      minPrincipal: row.minPrincipal,
      maxPrincipal: row.maxPrincipal,
      ratePerPeriod: row.interestRate,
      interestMethod: row.interestMethod,
      repaymentPeriod: row.repaymentPeriod,
      minRepaymentPeriod: local?.minRepaymentPeriod ?? row.minRepaymentPeriod,
      repaymentUnit: row.repaymentUnit,
      charges: row.charges,
    };
  }

  // No SQL road: a live-only id can still be checked against the lender's API.
  if (!local && ssId != null && session.ssEntityId && session.ssToken) {
    const shelf = await micromartProducts({ entityId: session.ssEntityId, phoneNumber: session.ssAccount ?? session.phone, token: session.ssToken });
    const hit = shelf.ok ? shelf.products.find((p) => Number(p.ID) === ssId && isSellable(p)) : null;
    if (!hit) return null;
    const s = toShelfProduct(hit);
    return {
      localId: null, serviceSuiteProductId: ssId, name: s.name, minPrincipal: s.minPrincipal, maxPrincipal: s.maxPrincipal,
      ratePerPeriod: s.interestRate, interestMethod: s.interestMethod === "reducing" ? "reducing" : "flat",
      repaymentPeriod: s.repaymentPeriod, minRepaymentPeriod: s.interestMethod === "flat" ? 1 : s.repaymentPeriod,
      repaymentUnit: s.repaymentUnit, charges: [],
    };
  }
  if (!local) return null;

  // Our own row alone. Its rate is stored for the whole term.
  const whole = Number(local.interestRate);
  return {
    localId: local.id,
    serviceSuiteProductId: local.serviceSuiteProductId,
    name: local.name,
    minPrincipal: Number(local.minPrincipal ?? 0),
    maxPrincipal: Number(local.maxPrincipal ?? 0),
    ratePerPeriod: local.interestPeriodUnit === "term" ? whole / Math.max(1, local.repaymentPeriod) : whole,
    interestMethod: local.interestMethod === "reducing" ? "reducing" : "flat",
    repaymentPeriod: local.repaymentPeriod,
    minRepaymentPeriod: local.minRepaymentPeriod ?? local.repaymentPeriod,
    repaymentUnit: local.repaymentPeriodUnit,
    charges: [],
  };
}
