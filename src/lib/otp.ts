// ─────────────────────────────────────────────────────────────────────────────
// Staff OTP — one-time codes for sensitive actions (final approvals),
// ServiceSuite parity. Codes are 6 digits, bcrypt-hashed at rest, expire in
// 10 minutes, single-use, and are delivered by email (+ SMS when a provider
// is live). Verification consumes the challenge.
//
// Shares the OtpChallenge table with the borrower funnel (lib/portal/otp.ts),
// which keys its rows by `phone` instead of `staffId`.
// ─────────────────────────────────────────────────────────────────────────────
import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email/send";
import { sendSms } from "@/lib/sms/send";

const TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

/** Create + deliver a challenge. Returns true when at least one channel accepted it. */
export async function issueOtp(orgId: string, staffId: string, purpose: string): Promise<{ delivered: boolean }> {
  // CSPRNG — Math.random() is predictable, and this code authorises money.
  const code = String(randomInt(100000, 1000000));
  const codeHash = await bcrypt.hash(code, 8);

  // One live challenge per purpose — reissue invalidates the previous code.
  await prisma.otpChallenge.deleteMany({ where: { orgId, staffId, purpose, usedAt: null } });
  await prisma.otpChallenge.create({
    data: { orgId, staffId, purpose, codeHash, expiresAt: new Date(Date.now() + TTL_MS) },
  });

  const staff = await prisma.staffUser.findUnique({ where: { id: staffId }, select: { email: true, phone: true, firstName: true } });
  if (!staff) return { delivered: false };

  const mailed = await sendEmail(
    orgId,
    staff.email,
    `Your approval code: ${code}`,
    `Hi ${staff.firstName},\n\nYour one-time approval code is ${code}. It expires in 10 minutes.\n\nIf you didn't request this, ignore it and tell your admin.`,
  );
  if (staff.phone) {
    // Queued even without a provider — flushes once SMS goes live.
    await sendSms(orgId, staff.phone, "otp", { code });
  }
  return { delivered: mailed || !!staff.phone };
}

/**
 * Verify + consume. Returns true only for a fresh, unexpired, matching code.
 * MAX_ATTEMPTS wrong guesses burn the challenge — a 6-digit code is otherwise a
 * short walk for a script.
 */
export async function verifyOtp(orgId: string, staffId: string, purpose: string, code: string): Promise<boolean> {
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
  await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { usedAt: new Date() } });
  return true;
}
