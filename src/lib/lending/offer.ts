// ─────────────────────────────────────────────────────────────────────────────
// The offer — blueprint §5.1 step 13, "Offer acceptance: e-sign (OTP)".
//
// Until now a loan could be booked without the borrower ever agreeing to anything.
// The officer approved, the schedule appeared, and the money moved. That is a
// credit agreement with no consent in it, and no lender should be able to produce
// one from this platform.
//
// So: an approved native application generates a LoanOffer carrying the exact
// terms and the exact schedule the borrower is shown. Nothing books until that
// offer is ACCEPTED. Acceptance happens one of two honest ways —
//
//   PORTAL — the borrower reads the schedule and enters a code we sent to the
//            phone they verified. Possession of that phone is the signature.
//   BRANCH — they signed paper at a desk, and a staff member records it under
//            their own name, with a note, into the audit log.
//
// Nothing else is accepted, and a booking without either is refused in book.ts.
//
// The offer freezes its terms rather than pointing at the product, because a
// product's rate can be edited the day after an offer goes out and the borrower
// agreed to the number in front of them. `termsHash` is the fingerprint of that
// number set; booking re-derives it and refuses on a mismatch.
// ─────────────────────────────────────────────────────────────────────────────
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildSchedule, type ScheduleRow, type ScheduleTerms } from "./schedule";
import { hashTerms, type OfferTerms } from "./terms";

export { canonicalTerms, hashTerms, type OfferTerms } from "./terms";

/** How long a borrower has to accept before the offer goes stale. */
export const OFFER_TTL_DAYS = 7;

/** Rebuild the schedule an offer's stored terms describe. Used to verify at booking. */
export function scheduleFor(t: OfferTerms): ReturnType<typeof buildSchedule> {
  const terms: ScheduleTerms = {
    principal: t.principal,
    rate: t.interestRate,
    count: t.termCount,
    unit: t.termUnit,
    method: t.interestMethod,
    graceDays: t.graceDays,
    borrowDate: t.borrowDate,
  };
  return buildSchedule(terms);
}

export type CreatedOffer = { id: string; termsHash: string; totalRepayable: number };

/**
 * Draft the agreement for an application. Idempotent: an application has at most
 * one live offer, and re-running while one is OFFERED returns it untouched — a
 * refreshed page must not silently re-price a borrower mid-decision.
 *
 * Returns null when there is nothing to offer (no product, or a bridged org whose
 * book — and whose paperwork — lives in ServiceSuite).
 */
export async function createOfferForApplication(applicationId: string): Promise<CreatedOffer | null> {
  const app = await prisma.loanApplication.findUnique({
    where: { id: applicationId },
    include: { product: true, offer: true, org: { select: { mode: true } } },
  });
  if (!app || app.org.mode !== "NATIVE" || !app.product) return null;

  if (app.offer) {
    if (app.offer.status === "OFFERED" && app.offer.expiresAt > new Date()) {
      return { id: app.offer.id, termsHash: app.offer.termsHash, totalRepayable: Number(app.offer.totalRepayable) };
    }
    return null; // already accepted, declined, or expired — not ours to redraft
  }

  const borrowDate = new Date();
  const method = app.product.interestMethod === "reducing" ? "reducing" : "flat";
  const sched = buildSchedule({
    principal: Number(app.amountRequested),
    rate: Number(app.product.interestRate),
    count: Math.max(1, app.product.repaymentPeriod),
    unit: app.product.repaymentPeriodUnit,
    method,
    graceDays: app.product.gracePeriodDays ?? 0,
    borrowDate,
  });

  const terms: OfferTerms = {
    principal: Number(app.amountRequested),
    interestRate: Number(app.product.interestRate),
    interestMethod: method,
    termCount: Math.max(1, app.product.repaymentPeriod),
    termUnit: app.product.repaymentPeriodUnit,
    graceDays: app.product.gracePeriodDays ?? 0,
    totalInterest: sched.interest,
    totalRepayable: sched.loanAmount,
    borrowDate,
  };

  const offer = await prisma.loanOffer.create({
    data: {
      orgId: app.orgId,
      applicationId: app.id,
      borrowerId: app.borrowerId,
      productId: app.product.id,
      principal: new Prisma.Decimal(terms.principal),
      interestRate: new Prisma.Decimal(terms.interestRate),
      interestMethod: terms.interestMethod,
      termCount: terms.termCount,
      termUnit: terms.termUnit,
      graceDays: terms.graceDays,
      totalInterest: new Prisma.Decimal(terms.totalInterest),
      totalRepayable: new Prisma.Decimal(terms.totalRepayable),
      borrowDate,
      firstDueDate: sched.firstDueDate,
      expectedClearDate: sched.expectedClearDate,
      schedule: sched.rows.map(serializeRow) as unknown as Prisma.InputJsonValue,
      termsHash: hashTerms(terms),
      expiresAt: new Date(Date.now() + OFFER_TTL_DAYS * 86_400_000),
    },
  });

  return { id: offer.id, termsHash: offer.termsHash, totalRepayable: terms.totalRepayable };
}

const serializeRow = (r: ScheduleRow) => ({
  seq: r.seq,
  dueDate: r.dueDate.toISOString(),
  amountDue: r.amountDue,
  principalDue: r.principalDue,
  interestDue: r.interestDue,
});

/** Terms as stored, back in plain numbers. The one place Decimals are unwrapped. */
export function termsOf(offer: {
  principal: Prisma.Decimal; interestRate: Prisma.Decimal; interestMethod: string;
  termCount: number; termUnit: string; graceDays: number;
  totalInterest: Prisma.Decimal; totalRepayable: Prisma.Decimal; borrowDate: Date;
}): OfferTerms {
  return {
    principal: Number(offer.principal),
    interestRate: Number(offer.interestRate),
    interestMethod: offer.interestMethod === "reducing" ? "reducing" : "flat",
    termCount: offer.termCount,
    termUnit: offer.termUnit,
    graceDays: offer.graceDays,
    totalInterest: Number(offer.totalInterest),
    totalRepayable: Number(offer.totalRepayable),
    borrowDate: offer.borrowDate,
  };
}

/** An offer past its expiry reads EXPIRED whether or not a cron has swept it. */
export function effectiveStatus(offer: { status: string; expiresAt: Date }): string {
  if (offer.status === "OFFERED" && offer.expiresAt <= new Date()) return "EXPIRED";
  return offer.status;
}

/** Sweep stale offers. Called from the daily cron; gating never depends on it. */
export async function expireStaleOffers(): Promise<number> {
  const { count } = await prisma.loanOffer.updateMany({
    where: { status: "OFFERED", expiresAt: { lte: new Date() } },
    data: { status: "EXPIRED" },
  });
  return count;
}
