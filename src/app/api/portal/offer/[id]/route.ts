// The borrower's credit agreement — blueprint §5.1 step 13.
//
//   GET  /api/portal/offer/[id]           → the terms + the full schedule
//   POST /api/portal/offer/[id]           → { action: "sign" | "decline", code? }
//
// Signing is a two-step: POST without a code sends one to the phone this borrower
// already verified, and POST with the code accepts the offer. Possession of that
// phone is the signature, so the code is scoped to THIS offer — a code issued to
// prove identity, or to sign a different offer, will not accept this one.
//
// The offer is only ever read through the borrower's own session cookie. An offer id
// is a uuid, but a uuid is not an authorisation: we check that the offer belongs to
// the org the session is bound to AND to the phone in that session.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { enterOrg } from "@/lib/db/context";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { readBorrowerSession, otpRequired } from "@/lib/portal/session";
import { issueBorrowerOtp, verifyBorrowerOtp, signPurpose } from "@/lib/portal/otp";
import { effectiveStatus, termsOf, hashTerms } from "@/lib/lending/offer";
import { earlySettlementSaving } from "@/lib/lending/schedule";

export const runtime = "nodejs";

const OTP_MESSAGES = {
  invalid: "That code isn't right. Check the SMS and try again.",
  expired: "That code has expired. Request a new one.",
  locked: "Too many wrong attempts. Request a new code.",
} as const;

/** Resolve the offer, but only for the borrower it belongs to. */
async function loadForBorrower(offerId: string) {
  const session = await readBorrowerSession();
  if (!session) return { session: null as never, offer: null };
  enterOrg(session.orgId);

  const offer = await prisma.loanOffer.findFirst({
    where: { id: offerId, orgId: session.orgId, borrower: { phone: session.phone } },
    include: {
      org: { select: { name: true } },
      application: { select: { id: true, status: true, productName: true } },
    },
  });
  return { session, offer };
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { session, offer } = await loadForBorrower(id);
  if (!session) return otpRequired();
  if (!offer) return NextResponse.json({ success: false, message: "Offer not found." }, { status: 404 });

  const terms = termsOf(offer);
  const status = effectiveStatus(offer);

  // "Pay early, pay less" is only true on a reducing-balance loan. Under FLAT the
  // interest was fixed the day the loan was written, so we say so rather than
  // implying a discount that does not exist.
  const settleEarly = earlySettlementSaving(
    { principal: terms.principal, rate: terms.interestRate, count: terms.termCount, unit: terms.termUnit, method: terms.interestMethod, graceDays: terms.graceDays, borrowDate: terms.borrowDate },
    Math.max(1, Math.floor(terms.termCount / 2)),
  );

  return NextResponse.json({
    success: true,
    offer: {
      id: offer.id,
      status,
      lender: offer.org.name,
      productName: offer.application.productName,
      principal: terms.principal,
      interestRate: terms.interestRate,
      interestMethod: terms.interestMethod,
      termCount: terms.termCount,
      termUnit: terms.termUnit,
      totalInterest: terms.totalInterest,
      totalRepayable: terms.totalRepayable,
      firstDueDate: offer.firstDueDate,
      expectedClearDate: offer.expectedClearDate,
      expiresAt: offer.expiresAt,
      schedule: offer.schedule,
      acceptedAt: offer.acceptedAt,
      payEarly: {
        /** KES saved by settling in full at the halfway installment. */
        savingKes: settleEarly,
        applies: terms.interestMethod === "reducing",
        note: terms.interestMethod === "reducing"
          ? "Settle early and you pay less — interest stops accruing on what you have already repaid."
          : "This loan charges flat interest, so settling early does not reduce what you owe.",
      },
    },
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  let body: { action?: string; code?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const { session, offer } = await loadForBorrower(id);
  if (!session) return otpRequired();
  if (!offer) return NextResponse.json({ success: false, message: "Offer not found." }, { status: 404 });

  const status = effectiveStatus(offer);
  if (status !== "OFFERED") {
    return NextResponse.json(
      { success: false, status, message: status === "EXPIRED" ? "This offer has expired." : `This offer was already ${status.toLowerCase()}.` },
      { status: 409 },
    );
  }

  // ── Decline: terminal, and their right ───────────────────────────────────────
  if (body.action === "decline") {
    await prisma.loanOffer.update({ where: { id: offer.id }, data: { status: "DECLINED", declinedAt: new Date() } });
    await prisma.loanApplication.update({ where: { id: offer.applicationId }, data: { status: "WITHDRAWN", stageTitle: "Offer declined by borrower" } });
    await prisma.auditLog.create({
      data: { orgId: offer.orgId, actorType: "borrower", action: "offer.decline", entity: "LoanOffer", entityId: offer.id, ip: clientIp(req) },
    }).catch(() => {});
    return NextResponse.json({ success: true, status: "DECLINED" });
  }

  if (body.action !== "sign") {
    return NextResponse.json({ success: false, message: "Unknown action." }, { status: 400 });
  }

  const purpose = signPurpose(offer.id);
  const terms = termsOf(offer);

  // ── Step 1: no code yet → send one that says what it signs ───────────────────
  if (!body.code) {
    const limited = await rateLimit([
      { name: "offer:sign:issue", subject: `${offer.orgId}:${session.phone}`, max: 3, windowSec: 900 },
      { name: "offer:sign:issue:ip", subject: clientIp(req), max: 20, windowSec: 3600 },
    ]);
    if (limited) return limited;

    const { delivered, devCode } = await issueBorrowerOtp(offer.orgId, offer.org.name, session.phone, purpose, {
      principal: terms.principal.toLocaleString(),
      repayable: terms.totalRepayable.toLocaleString(),
      clearDate: offer.expectedClearDate.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
    });
    return NextResponse.json({
      success: true,
      codeSent: true,
      delivered,
      ...(devCode ? { devCode } : {}),
      message: delivered ? "We sent a signing code to your phone." : "Could not send the signing code.",
    });
  }

  // ── Step 2: the code is the signature ────────────────────────────────────────
  const limited = await rateLimit([
    { name: "offer:sign:verify", subject: `${offer.orgId}:${session.phone}`, max: 10, windowSec: 900 },
    { name: "offer:sign:verify:ip", subject: clientIp(req), max: 40, windowSec: 3600 },
  ]);
  if (limited) return limited;

  const result = await verifyBorrowerOtp(offer.orgId, session.phone, body.code.trim(), purpose);
  if (!result.ok) {
    return NextResponse.json({ success: false, reason: result.reason, message: OTP_MESSAGES[result.reason] }, { status: 401 });
  }

  // The terms must still hash to what was signed. If a migration or a bad write has
  // touched this row since it was drafted, refuse rather than accept an agreement
  // nobody actually read.
  if (hashTerms(terms) !== offer.termsHash) {
    return NextResponse.json({ success: false, message: "These terms have changed. Please request a fresh offer." }, { status: 409 });
  }

  const accepted = await prisma.loanOffer.update({
    where: { id: offer.id },
    data: {
      status: "ACCEPTED",
      acceptedAt: new Date(),
      channel: "PORTAL",
      acceptedIp: clientIp(req),
      acceptedUserAgent: req.headers.get("user-agent")?.slice(0, 400) ?? null,
      otpChallengeId: result.challengeId,
    },
  });
  await prisma.loanApplication.update({
    where: { id: offer.applicationId },
    data: { status: "OFFICER_REVIEW", stageTitle: "Offer accepted — awaiting review" },
  });
  await prisma.auditLog.create({
    data: {
      orgId: offer.orgId, actorType: "borrower", action: "offer.accept",
      entity: "LoanOffer", entityId: offer.id, ip: clientIp(req),
      meta: { termsHash: offer.termsHash, challengeId: result.challengeId, totalRepayable: terms.totalRepayable },
    },
  }).catch(() => {});

  return NextResponse.json({ success: true, status: "ACCEPTED", acceptedAt: accepted.acceptedAt });
}
