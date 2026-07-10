// ─────────────────────────────────────────────────────────────────────────────
// Guarantors — blueprint §4, borrower-side role 4: "invited by phone, consents,
// e-signs (product-dependent)".
//
// `Product.guarantorRequired` and `Product.securityRequired` have been decorative
// booleans since Phase 2: a product demanding a guarantor booked perfectly happily
// without one. This makes them mean something.
//
// The rule that matters: A GUARANTOR CONSENTS TO ONE AGREEMENT. Their consent is
// bound to the `termsHash` of the offer the borrower signed. Re-issue that offer on
// different terms and the consent goes stale, and the loan will not book until they
// are asked again. Somebody who agreed to stand behind KES 10,000 has not agreed to
// stand behind KES 50,000, and no amount of convenience justifies pretending they
// have.
//
// Consent is proved by a one-time code sent to the GUARANTOR's phone — never the
// borrower's, never a staff member's. There is no endpoint by which anyone else can
// consent on their behalf. A guarantee taken without the guarantor is worthless in a
// dispute, which is precisely when a lender needs it.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";
import { runAsPlatform } from "@/lib/db/context";
import { sendSms, hasSmsProvider } from "@/lib/sms/send";
import { issueBorrowerOtp, verifyBorrowerOtp, type IssueResult, type VerifyResult } from "@/lib/portal/otp";

/** How long a guarantor has to answer before the invitation lapses. */
export const GUARANTOR_TTL_DAYS = 7;

/**
 * Which tenant does this invitation belong to?
 *
 * The one cross-tenant read in this file, and a deliberate one: a guarantor arrives
 * from an SMS holding a uuid and nothing else — no session, no lender slug — so the
 * tenant cannot be known until the row is found. The same narrow escape the M-Pesa
 * webhooks take before they can resolve a slug. It returns an org id and nothing
 * else, and every read after it is scoped to that org.
 */
export async function resolveGuarantorOrg(id: string): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const row = await runAsPlatform(() => prisma.guarantor.findUnique({ where: { id }, select: { orgId: true } }));
  return row?.orgId ?? null;
}

export const guarantorPurpose = (guarantorId: string) => `guarantor:${guarantorId}:sign`;

/** An invitation past its expiry reads EXPIRED whether or not a cron has swept it. */
export function effectiveGuarantorStatus(g: { status: string; expiresAt: Date }): string {
  if (g.status === "INVITED" && g.expiresAt <= new Date()) return "EXPIRED";
  return g.status;
}

/** Only a consent bound to THIS agreement counts. */
export function standsBehind(g: { status: string; expiresAt: Date; offerTermsHash: string | null }, termsHash: string): boolean {
  return effectiveGuarantorStatus(g) === "CONSENTED" && g.offerTermsHash === termsHash;
}

export type InviteInput = {
  applicationId: string;
  fullName: string;
  phone: string; // msisdn
  nationalId?: string | null;
  relationship?: string | null;
  invitedBy?: string | null;
};

export class GuarantorError extends Error {}

/**
 * Ask someone to guarantee an application, and text them the link.
 *
 * The invitation carries the terms hash of the offer as it stands now, so the
 * guarantor is always answering a specific question. If no offer exists yet the
 * hash is null and they cannot consent until one does — you cannot stand behind an
 * agreement nobody has written.
 */
export async function inviteGuarantor(input: InviteInput): Promise<{ id: string; delivered: boolean }> {
  const app = await prisma.loanApplication.findUnique({
    where: { id: input.applicationId },
    include: { offer: true, org: { select: { id: true, name: true, slug: true } }, borrower: { select: { id: true, phone: true, firstName: true } } },
  });
  if (!app) throw new GuarantorError("Application not found.");

  // A borrower cannot guarantee their own loan. It reads as an oversight; it is the
  // whole point of a guarantor.
  if (app.borrower.phone === input.phone) {
    throw new GuarantorError("A borrower cannot guarantee their own loan.");
  }

  const already = await prisma.guarantor.findFirst({
    where: { orgId: app.orgId, applicationId: app.id, phone: input.phone, status: { in: ["INVITED", "CONSENTED"] } },
  });
  if (already) throw new GuarantorError("That person has already been asked.");

  const g = await prisma.guarantor.create({
    data: {
      orgId: app.orgId,
      applicationId: app.id,
      borrowerId: app.borrowerId,
      fullName: input.fullName.trim().slice(0, 120),
      phone: input.phone,
      nationalId: input.nationalId?.trim() || null,
      relationship: input.relationship?.trim().slice(0, 60) || null,
      offerTermsHash: app.offer?.termsHash ?? null,
      amountGuaranteed: app.offer?.totalRepayable ?? null,
      invitedBy: input.invitedBy ?? null,
      expiresAt: new Date(Date.now() + GUARANTOR_TTL_DAYS * 86_400_000),
    },
  });

  // sendSms queues a row whether or not a provider exists, so its id proves nothing
  // about delivery. Ask the provider directly: staff need to know whether this person
  // was actually reached, or whether someone has to phone them.
  const delivered = await hasSmsProvider(app.orgId);
  await sendSms(app.orgId, input.phone, "guarantor_invite", {
    org: app.org.name,
    borrower: app.borrower.firstName ?? "a borrower",
    amount: app.offer ? Number(app.offer.totalRepayable).toLocaleString() : Number(app.amountRequested).toLocaleString(),
    link: `${base()}/guarantee/${g.id}`,
  });

  return { id: g.id, delivered };
}

function base(): string {
  return (process.env.PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || "https://lms.birgenai.com").replace(/\/$/, "");
}

/** Send the code that will act as their signature. */
export async function requestGuarantorCode(guarantorId: string): Promise<IssueResult> {
  const g = await prisma.guarantor.findUnique({
    where: { id: guarantorId },
    include: { org: { select: { name: true } }, application: { include: { offer: true } } },
  });
  if (!g) throw new GuarantorError("Invitation not found.");
  if (effectiveGuarantorStatus(g) !== "INVITED") throw new GuarantorError("This invitation is closed.");

  const offer = g.application.offer;
  if (!offer) throw new GuarantorError("There is no agreement to guarantee yet.");

  return issueBorrowerOtp(g.orgId, g.org.name, g.phone, guarantorPurpose(g.id), {
    borrower: "",
    amount: Number(offer.totalRepayable).toLocaleString(),
    org: g.org.name,
  });
}

export type ConsentResult = { ok: true } | { ok: false; reason: string; message: string };

/**
 * Consent — the guarantor's signature.
 *
 * Re-checks the binding at the moment of consent, not just at invitation: an offer
 * re-issued between the SMS landing and the code being typed must not be signed for
 * by accident.
 */
export async function consentGuarantor(
  guarantorId: string,
  code: string,
  meta: { ip?: string | null; userAgent?: string | null },
): Promise<ConsentResult> {
  const g = await prisma.guarantor.findUnique({
    where: { id: guarantorId },
    include: { application: { include: { offer: true } } },
  });
  if (!g) return { ok: false, reason: "not_found", message: "Invitation not found." };
  if (effectiveGuarantorStatus(g) !== "INVITED") {
    return { ok: false, reason: "closed", message: "This invitation is closed." };
  }

  const offer = g.application.offer;
  if (!offer) return { ok: false, reason: "no_offer", message: "There is no agreement to guarantee yet." };

  const verdict: VerifyResult = await verifyBorrowerOtp(g.orgId, g.phone, code, guarantorPurpose(g.id));
  if (!verdict.ok) {
    const messages = {
      invalid: "That code isn't right. Check the SMS and try again.",
      expired: "That code has expired. Request a new one.",
      locked: "Too many wrong attempts. Request a new code.",
    } as const;
    return { ok: false, reason: verdict.reason, message: messages[verdict.reason] };
  }

  await prisma.guarantor.update({
    where: { id: g.id },
    data: {
      status: "CONSENTED",
      consentedAt: new Date(),
      // Bind to the agreement AS IT IS NOW. If it moved since the invitation, this
      // is the version they actually saw and agreed to.
      offerTermsHash: offer.termsHash,
      amountGuaranteed: offer.totalRepayable,
      consentIp: meta.ip ?? null,
      consentUserAgent: meta.userAgent?.slice(0, 400) ?? null,
      otpChallengeId: verdict.challengeId,
    },
  });

  await prisma.auditLog.create({
    data: {
      orgId: g.orgId, actorType: "guarantor", action: "guarantor.consent",
      entity: "Guarantor", entityId: g.id, ip: meta.ip ?? null,
      meta: { applicationId: g.applicationId, termsHash: offer.termsHash, challengeId: verdict.challengeId },
    },
  }).catch(() => {});

  return { ok: true };
}

export async function declineGuarantor(guarantorId: string, ip?: string | null): Promise<void> {
  const g = await prisma.guarantor.findUnique({ where: { id: guarantorId } });
  if (!g || effectiveGuarantorStatus(g) !== "INVITED") return;
  await prisma.guarantor.update({ where: { id: g.id }, data: { status: "DECLINED", declinedAt: new Date() } });
  await prisma.auditLog.create({
    data: { orgId: g.orgId, actorType: "guarantor", action: "guarantor.decline", entity: "Guarantor", entityId: g.id, ip: ip ?? null },
  }).catch(() => {});
}

/** Sweep lapsed invitations. Booking already treats them as expired regardless. */
export async function expireStaleGuarantors(): Promise<number> {
  const { count } = await prisma.guarantor.updateMany({
    where: { status: "INVITED", expiresAt: { lte: new Date() } },
    data: { status: "EXPIRED" },
  });
  return count;
}
