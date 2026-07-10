// ─────────────────────────────────────────────────────────────────────────────
// Borrower OTP — blueprint §5.1 step 1, "Phone + OTP → account stub".
//
// A 6-digit code is 1,000,000 guesses, which is nothing to a script. Three
// things make it hold:
//   • the challenge is burned after MAX_ATTEMPTS wrong guesses (here),
//   • issuing and verifying are both rate-limited per phone and per IP (routes),
//   • the code lives 5 minutes.
// Only the bcrypt hash is stored, so a database read does not yield live codes.
//
// Reissuing invalidates the previous code — otherwise every resend widens the
// guessing surface instead of narrowing it.
// ─────────────────────────────────────────────────────────────────────────────
import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { sendSms, hasSmsProvider } from "@/lib/sms/send";

export const OTP_TTL_SEC = 5 * 60;
const MAX_ATTEMPTS = 5;

/**
 * Purposes are separate namespaces. A code sent to prove "this is my phone" must
 * not be replayable to sign a credit agreement, so signing carries the offer's id:
 * a challenge issued for one offer cannot accept another.
 */
export const PURPOSE_VERIFY = "borrower:verify";
export const signPurpose = (offerId: string) => `offer:${offerId}:sign`;

/**
 * The SMS that carries the code. Each purpose says plainly what the code does, so a
 * recipient can tell an identity check from a credit agreement from a guarantee.
 */
function templateFor(purpose: string): string {
  if (purpose.startsWith("offer:")) return "offer_sign";
  if (purpose.startsWith("guarantor:")) return "guarantor_sign";
  return "verify";
}

export type IssueResult = {
  /** An SMS provider accepted the message. False → the borrower cannot receive it. */
  delivered: boolean;
  /** Non-production only, and only when nothing could deliver the code. */
  devCode?: string;
};

export type VerifyResult =
  /** `challengeId` is the evidence trail — an offer records which challenge signed it. */
  | { ok: true; challengeId: string }
  | { ok: false; reason: "invalid" | "expired" | "locked" };

/**
 * Create + deliver a challenge for this phone. Previous live codes for the same
 * purpose are voided. `vars` decorate the SMS (the amount being signed for, etc.).
 */
export async function issueBorrowerOtp(
  orgId: string,
  orgName: string,
  msisdn: string,
  purpose: string = PURPOSE_VERIFY,
  vars: Record<string, string | number> = {},
): Promise<IssueResult> {
  // randomInt is CSPRNG-backed; Math.random is not, and this guards a loan book.
  const code = String(randomInt(100000, 1000000));
  const codeHash = await bcrypt.hash(code, 8);

  await prisma.otpChallenge.deleteMany({ where: { orgId, phone: msisdn, purpose, usedAt: null } });
  await prisma.otpChallenge.create({
    data: { orgId, phone: msisdn, purpose, codeHash, expiresAt: new Date(Date.now() + OTP_TTL_SEC * 1000) },
  });

  const delivered = await hasSmsProvider(orgId);
  await sendSms(orgId, msisdn, templateFor(purpose), { code, org: orgName, ...vars });

  if (delivered) return { delivered: true };

  // No provider configured. In production that is a hard stop — you cannot prove
  // possession of a phone you never sent anything to, and quietly waving the
  // borrower through would defeat the entire mechanism. Locally, hand the code
  // back so the funnel stays walkable.
  if (process.env.NODE_ENV !== "production") {
    console.warn(`[otp] no SMS provider for org ${orgId} — code for ${msisdn} is ${code}`);
    return { delivered: false, devCode: code };
  }
  return { delivered: false };
}

/** Verify + consume. Wrong guesses count; MAX_ATTEMPTS of them burn the challenge. */
export async function verifyBorrowerOtp(
  orgId: string,
  msisdn: string,
  code: string,
  purpose: string = PURPOSE_VERIFY,
): Promise<VerifyResult> {
  const challenge = await prisma.otpChallenge.findFirst({
    where: { orgId, phone: msisdn, purpose, usedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!challenge) return { ok: false, reason: "expired" };
  if (challenge.expiresAt <= new Date()) return { ok: false, reason: "expired" };
  if (challenge.attempts >= MAX_ATTEMPTS) return { ok: false, reason: "locked" };

  if (!(await bcrypt.compare((code ?? "").trim(), challenge.codeHash))) {
    const attempts = challenge.attempts + 1;
    await prisma.otpChallenge.update({
      where: { id: challenge.id },
      // Burning on the last attempt means a fresh code must be requested, and
      // requesting one is itself rate-limited.
      data: { attempts, ...(attempts >= MAX_ATTEMPTS ? { usedAt: new Date() } : {}) },
    });
    return { ok: false, reason: attempts >= MAX_ATTEMPTS ? "locked" : "invalid" };
  }

  await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { usedAt: new Date() } });
  return { ok: true, challengeId: challenge.id };
}
