// ─────────────────────────────────────────────────────────────────────────────
// Staff OTP — ServiceSuite parity, two kinds of code with different lifetimes:
//
//   ACTION codes (final approvals, password resets): 6 digits, 10 minutes,
//   SINGLE-USE — verification consumes the challenge.
//
//   The DAILY SIGN-IN code (founder's spec): issued on the first sign-in of the
//   day, emailed in the lender's branding, REUSABLE until midnight Nairobi time.
//   One email a morning, not one per session — verification does NOT consume it.
//   Wrong guesses still burn it (5 strikes), and a burned or expired code simply
//   reissues on the next attempt.
//
// All codes are CSPRNG 6-digit, bcrypt-hashed at rest. Shares the OtpChallenge
// table with the borrower funnel (lib/portal/otp.ts), which keys by `phone`.
// ─────────────────────────────────────────────────────────────────────────────
import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { sendTemplatedEmail } from "@/lib/email/send";
import { emailBrandFor } from "@/lib/email/layout";
import { approvalOtpEmail, resetCodeEmail, loginOtpEmail } from "@/lib/email/templates";
import { sendSms } from "@/lib/sms/send";

const TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export const LOGIN_PURPOSE = "login:daily";

/** Next midnight in Nairobi (UTC+3, no DST) — the founder's "whole day". */
export function endOfDayNairobi(now = new Date()): Date {
  const EAT_OFFSET_MS = 3 * 3600_000;
  const eatMs = now.getTime() + EAT_OFFSET_MS;
  const nextMidnightEat = (Math.floor(eatMs / 86_400_000) + 1) * 86_400_000;
  return new Date(nextMidnightEat - EAT_OFFSET_MS);
}

const newCode = () => String(randomInt(100000, 1000000));

/** Create + deliver an ACTION challenge (approval/reset). Single-use, 10 min. */
export async function issueOtp(orgId: string, staffId: string, purpose: string): Promise<{ delivered: boolean }> {
  const code = newCode();
  const codeHash = await bcrypt.hash(code, 8);

  // One live challenge per purpose — reissue invalidates the previous code.
  await prisma.otpChallenge.deleteMany({ where: { orgId, staffId, purpose, usedAt: null } });
  await prisma.otpChallenge.create({
    data: { orgId, staffId, purpose, codeHash, expiresAt: new Date(Date.now() + TTL_MS) },
  });

  const staff = await prisma.staffUser.findUnique({ where: { id: staffId }, select: { email: true, phone: true, firstName: true } });
  if (!staff) return { delivered: false };

  const brand = await emailBrandFor(orgId);
  const parts = purpose.startsWith("password:")
    ? resetCodeEmail(brand, { name: staff.firstName, email: staff.email, code })
    : approvalOtpEmail(brand, { name: staff.firstName, code });
  const mailed = await sendTemplatedEmail(orgId, staff.email, parts, purpose.startsWith("password:") ? "reset_code" : "approval_otp");
  if (staff.phone) {
    // Queued even without a provider — flushes once SMS goes live.
    await sendSms(orgId, staff.phone, "otp", { code });
  }
  return { delivered: mailed || !!staff.phone };
}

/**
 * Verify + consume an ACTION code. Returns true only for a fresh, unexpired,
 * matching code. MAX_ATTEMPTS wrong guesses burn the challenge — a 6-digit code
 * is otherwise a short walk for a script.
 */
export async function verifyOtp(orgId: string, staffId: string, purpose: string, code: string): Promise<boolean> {
  return verifyChallenge(orgId, staffId, purpose, code, { consume: true });
}

export type DailyOtpIssue = {
  /** False when a still-valid code from earlier today already exists (no re-email). */
  issued: boolean;
  delivered: boolean;
  /** Outside production the UI shows the code — same seam as the borrower OTP. */
  devCode?: string;
};

/**
 * Issue (or acknowledge) today's sign-in code. If a live challenge already
 * exists it is NOT reissued — the email from this morning still works, and
 * re-hashing would silently invalidate it mid-day.
 */
export async function issueDailyLoginOtp(orgId: string, staffId: string): Promise<DailyOtpIssue> {
  const existing = await prisma.otpChallenge.findFirst({
    where: { orgId, staffId, purpose: LOGIN_PURPOSE, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (existing && existing.attempts < MAX_ATTEMPTS) {
    return { issued: false, delivered: true };
  }

  const code = newCode();
  const codeHash = await bcrypt.hash(code, 8);
  await prisma.otpChallenge.deleteMany({ where: { orgId, staffId, purpose: LOGIN_PURPOSE, usedAt: null } });
  await prisma.otpChallenge.create({
    data: { orgId, staffId, purpose: LOGIN_PURPOSE, codeHash, expiresAt: endOfDayNairobi() },
  });

  const staff = await prisma.staffUser.findUnique({ where: { id: staffId }, select: { email: true, phone: true, firstName: true } });
  if (!staff) return { issued: true, delivered: false };

  const brand = await emailBrandFor(orgId);
  const mailed = await sendTemplatedEmail(orgId, staff.email, loginOtpEmail(brand, { name: staff.firstName, email: staff.email, code }), "login_otp");
  let smsed = false;
  if (staff.phone) {
    smsed = !!(await sendSms(orgId, staff.phone, "login_code", { code, org: brand.name }));
  }

  return {
    issued: true,
    delivered: mailed || smsed,
    ...(process.env.NODE_ENV !== "production" ? { devCode: code } : {}),
  };
}

/** Verify today's code WITHOUT consuming it — reusable until midnight. */
export async function verifyDailyLoginOtp(orgId: string, staffId: string, code: string): Promise<boolean> {
  return verifyChallenge(orgId, staffId, LOGIN_PURPOSE, code, { consume: false });
}

async function verifyChallenge(
  orgId: string,
  staffId: string,
  purpose: string,
  code: string,
  opts: { consume: boolean },
): Promise<boolean> {
  const challenge = await prisma.otpChallenge.findFirst({
    where: { orgId, staffId, purpose, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!challenge) return false;
  if (challenge.attempts >= MAX_ATTEMPTS) return false;

  if (!(await bcrypt.compare((code ?? "").trim(), challenge.codeHash))) {
    const attempts = challenge.attempts + 1;
    await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { attempts, ...(attempts >= MAX_ATTEMPTS ? { usedAt: new Date() } : {}) },
    });
    return false;
  }
  if (opts.consume) {
    await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { usedAt: new Date() } });
  } else if (challenge.attempts > 0) {
    // A correct entry forgives earlier typos — the day's budget of 5 resets.
    await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { attempts: 0 } });
  }
  return true;
}
