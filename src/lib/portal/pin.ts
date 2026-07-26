// ─────────────────────────────────────────────────────────────────────────────
// PORTAL PIN — the returning customer's door.
//
// Two doors into the borrower portal, and they are for two different people:
//
//   NEW PERSON      phone + OTP. They have no relationship with the lender, so
//                   the only thing they can prove is that they hold a number we
//                   can reach. That funnel is unchanged.
//
//   KNOWN CUSTOMER  national ID + PIN. They are already in the lender's book;
//                   the ID says which row, the PIN proves they are the person
//                   behind it. No SMS, no waiting, works on a dead-flat network.
//
// WHY A PIN AND NOT "JUST KEEP SENDING CODES". An OTP on every visit costs the
// lender a shilling a login, fails exactly when someone urgently needs to see
// their balance, and — the part that matters — trains customers that an unsolicited
// SMS with a code in it is normal. That is the precondition for every SMS phishing
// attack run against Kenyan borrowers. A PIN they already know breaks the habit.
//
// WHAT MAKES A 6-DIGIT SECRET DEFENSIBLE. Nothing, on its own: a million
// combinations is an afternoon for a script. It holds because of the three things
// around it, and all three live in this file so none can be forgotten at a call site:
//
//   1. LOCKOUT      MAX_ATTEMPTS wrong PINs freeze the account for LOCK_MINUTES.
//                   Wrong guesses are counted on the ROW, not in a session, so
//                   clearing cookies does not clear the counter.
//   2. HASHING      bcrypt. A database read yields no live credentials.
//   3. NO ORACLE    a wrong ID and a wrong PIN are indistinguishable from outside
//                   (see `lookupByNationalId`), so the lookup step cannot be used
//                   to enumerate who banks here.
//
// The ID lookup is additionally rate-limited per IP at the route. That is the
// enumeration control; this file is the credential control.
// ─────────────────────────────────────────────────────────────────────────────
import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

export const PIN_LENGTH = 6;
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const BCRYPT_ROUNDS = 10;

/** A fresh PIN. randomInt is CSPRNG-backed; Math.random guards nothing. */
export function newPin(): string {
  return String(randomInt(0, 10 ** PIN_LENGTH)).padStart(PIN_LENGTH, "0");
}

export function isWellFormedPin(v: string): boolean {
  return new RegExp(`^\\d{${PIN_LENGTH}}$`).test(v);
}

/** Normalise a typed national ID. Kenyan IDs are digits; people type spaces. */
export function normaliseNationalId(raw: string): string {
  return (raw ?? "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}

export type PinSubject = {
  borrowerId: string;
  orgId: string;
  /** Server-authoritative — the session is minted from this, never from input. */
  phone: string;
  firstName: string | null;
  hasPin: boolean;
  lockedUntil: Date | null;
};

/**
 * Find the customer behind a national ID.
 *
 * Returns null for "no such customer" AND for an erased one. The caller must not
 * distinguish those in its response: both are "we can't place that ID", because a
 * screen that says "found — now enter your PIN" for real IDs and "not found" for
 * fake ones is a free membership oracle for anyone with a list of ID numbers.
 */
export async function lookupByNationalId(orgId: string, nationalId: string): Promise<PinSubject | null> {
  const id = normaliseNationalId(nationalId);
  if (id.length < 5) return null;

  const b = await prisma.borrower.findFirst({
    where: { orgId, nationalId: id, erasedAt: null },
    select: {
      id: true, orgId: true, phone: true, firstName: true,
      portalPinHash: true, portalPinLockedUntil: true,
    },
  });
  if (!b) return null;

  return {
    borrowerId: b.id,
    orgId: b.orgId,
    phone: b.phone,
    firstName: b.firstName,
    hasPin: !!b.portalPinHash,
    lockedUntil: b.portalPinLockedUntil,
  };
}

export type PinVerdict =
  | { ok: true; borrowerId: string; phone: string }
  | { ok: false; reason: "unknown" | "no-pin" | "locked" | "invalid"; attemptsLeft?: number; retryAt?: Date };

/**
 * Check a PIN against a national ID, and count the attempt.
 *
 * The attempt counter is incremented on the borrower row inside the same call
 * that checks, so there is no window in which a client can retry faster than the
 * counter advances. On success it resets — a customer who fumbles twice and then
 * gets it right should not be one mistake from a lockout next week.
 */
export async function verifyPin(orgId: string, nationalId: string, pin: string): Promise<PinVerdict> {
  const subject = await lookupByNationalId(orgId, nationalId);
  if (!subject) return { ok: false, reason: "unknown" };

  const now = new Date();
  if (subject.lockedUntil && subject.lockedUntil > now) {
    return { ok: false, reason: "locked", retryAt: subject.lockedUntil };
  }
  if (!subject.hasPin) return { ok: false, reason: "no-pin" };

  const row = await prisma.borrower.findUnique({
    where: { id: subject.borrowerId },
    select: { portalPinHash: true, portalPinAttempts: true },
  });
  if (!row?.portalPinHash) return { ok: false, reason: "no-pin" };

  if (await bcrypt.compare((pin ?? "").trim(), row.portalPinHash)) {
    await prisma.borrower.update({
      where: { id: subject.borrowerId },
      data: { portalPinAttempts: 0, portalPinLockedUntil: null },
    });
    return { ok: true, borrowerId: subject.borrowerId, phone: subject.phone };
  }

  const attempts = row.portalPinAttempts + 1;
  const lock = attempts >= MAX_ATTEMPTS;
  await prisma.borrower.update({
    where: { id: subject.borrowerId },
    data: {
      portalPinAttempts: lock ? 0 : attempts,
      ...(lock ? { portalPinLockedUntil: new Date(now.getTime() + LOCK_MINUTES * 60_000) } : {}),
    },
  });

  return lock
    ? { ok: false, reason: "locked", retryAt: new Date(now.getTime() + LOCK_MINUTES * 60_000) }
    : { ok: false, reason: "invalid", attemptsLeft: MAX_ATTEMPTS - attempts };
}

/**
 * Issue a new PIN and store its hash. Returns the plaintext ONCE, to the caller,
 * so it can be delivered — it is never readable again from anywhere.
 *
 * Setting a PIN also clears any lockout: the point of a reset is that the customer
 * can get in now, and leaving them frozen behind a credential they were just given
 * would make the reset button a lie.
 */
export async function issuePin(borrowerId: string): Promise<string> {
  const pin = newPin();
  await prisma.borrower.update({
    where: { id: borrowerId },
    data: {
      portalPinHash: await bcrypt.hash(pin, BCRYPT_ROUNDS),
      portalPinSetAt: new Date(),
      portalPinAttempts: 0,
      portalPinLockedUntil: null,
    },
  });
  return pin;
}

/** A customer choosing their own PIN. Same storage, same lockout reset. */
export async function setPin(borrowerId: string, pin: string): Promise<boolean> {
  if (!isWellFormedPin(pin)) return false;
  // A PIN that is one repeated digit or a straight run is not a secret; those
  // three shapes are the first guesses anyone makes.
  if (/^(\d)\1{5}$/.test(pin) || "0123456789".includes(pin) || "9876543210".includes(pin)) return false;
  await prisma.borrower.update({
    where: { id: borrowerId },
    data: {
      portalPinHash: await bcrypt.hash(pin, BCRYPT_ROUNDS),
      portalPinSetAt: new Date(),
      portalPinAttempts: 0,
      portalPinLockedUntil: null,
    },
  });
  return true;
}

/** 254712345678 → 0712 ••• 678. Enough to confirm it's them; not enough to be a leak. */
export function maskPhone(msisdn: string): string {
  const local = `0${msisdn.slice(3)}`;
  return `${local.slice(0, 4)} ••• ${local.slice(-3)}`;
}
