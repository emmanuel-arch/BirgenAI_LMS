// ─────────────────────────────────────────────────────────────────────────────
// The returning customer's door: national ID, then PIN.
//
//   POST { lenderSlug, nationalId }        → step 1: is there an account here?
//   POST { lenderSlug, nationalId, pin }   → step 2: unlock it, mint the session.
//
// ONE ENDPOINT, TWO STEPS, ON PURPOSE. Splitting them into /lookup and /verify
// would create a URL whose entire job is answering "does this ID bank here?", and
// that URL would be scraped. Here the lookup is a step in an authentication
// attempt, rate-limited as one.
//
// WHAT STEP 1 IS ALLOWED TO SAY. Only `known: true|false`, a masked phone, and
// whether a PIN exists. Never the name — "Is that you, Emmanuel Kipleting?" in
// response to a typed ID number hands a stranger the account holder's name, and
// the masked phone is already enough for the real customer to recognise
// themselves. The rate limits below are the enumeration control; this restraint
// is what limits the damage if they are ever beaten.
//
// The session this mints is the SAME borrower cookie the OTP funnel issues, bound
// to the phone read from the borrower's own row. Everything downstream — the
// Customer-360, the offer, the signature — is therefore unchanged and cannot tell
// which door was used, which is the property that makes this safe to add.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { resolveOrg } from "@/lib/tenancy";
import { enterOrg } from "@/lib/db/context";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { createBorrowerSession } from "@/lib/portal/session";
import { lookupByNationalId, verifyPin, normaliseNationalId, isWellFormedPin, maskPhone, PIN_LENGTH } from "@/lib/portal/pin";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { lenderSlug?: string; nationalId?: string; pin?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const org = await resolveOrg(body.lenderSlug ?? "");
  if (!org) return NextResponse.json({ success: false, message: "Choose a lender." }, { status: 400 });
  enterOrg(org.id);

  const nationalId = normaliseNationalId(body.nationalId ?? "");
  if (nationalId.length < 5) {
    return NextResponse.json({ success: false, message: "Enter your ID number." }, { status: 400 });
  }

  const ip = clientIp(req);

  // ── Step 1: is there an account behind this ID? ───────────────────────────
  if (!body.pin) {
    // The enumeration control. Tight per IP, because walking a list of ID numbers
    // is the attack; looser per ID, because a real person retyping their own ID
    // after a typo must not lock themselves out of their lender.
    const limited = await rateLimit(
      [
        { name: "pin:lookup:ip", subject: ip, max: 12, windowSec: 900 },
        { name: "pin:lookup:ip:day", subject: ip, max: 60, windowSec: 86400 },
        { name: "pin:lookup:id", subject: `${org.id}:${nationalId}`, max: 8, windowSec: 900 },
      ],
      "Too many attempts. Please wait a few minutes and try again.",
    );
    if (limited) return limited;

    const subject = await lookupByNationalId(org.id, nationalId);
    if (!subject) {
      return NextResponse.json({
        success: true,
        known: false,
        message: "We can't find an account with that ID number. If you're new here, continue with your phone number instead.",
      });
    }

    const locked = subject.lockedUntil && subject.lockedUntil > new Date();
    return NextResponse.json({
      success: true,
      known: true,
      hasPin: subject.hasPin,
      locked: !!locked,
      retryAt: locked ? subject.lockedUntil : null,
      // Enough for the real customer to recognise themselves; not enough to be a leak.
      phoneMasked: maskPhone(subject.phone),
      message: locked
        ? "This account is temporarily locked after too many wrong PINs."
        : subject.hasPin
          ? "Enter your PIN to continue."
          : "You don't have a PIN yet — we'll verify you by phone instead.",
    });
  }

  // ── Step 2: unlock ────────────────────────────────────────────────────────
  if (!isWellFormedPin(body.pin)) {
    return NextResponse.json({ success: false, message: `Your PIN is ${PIN_LENGTH} digits.` }, { status: 400 });
  }

  const limited = await rateLimit(
    [
      { name: "pin:verify:ip", subject: ip, max: 20, windowSec: 900 },
      { name: "pin:verify:id", subject: `${org.id}:${nationalId}`, max: 10, windowSec: 900 },
    ],
    "Too many attempts. Please wait a few minutes and try again.",
  );
  if (limited) return limited;

  const verdict = await verifyPin(org.id, nationalId, body.pin);

  if (!verdict.ok) {
    // "unknown" is answered with the same words as a wrong PIN. A different
    // message here would undo step 1's restraint by another route: an attacker
    // could skip the lookup, post a junk PIN, and read membership off the error.
    const msg =
      verdict.reason === "locked"
        ? "Too many wrong PINs. Try again in a few minutes, or ask your loan officer to reset it."
        : verdict.reason === "no-pin"
          ? "You don't have a PIN yet. Continue with your phone number and we'll send you a code."
          : verdict.attemptsLeft != null && verdict.attemptsLeft <= 2
            ? `That PIN is not right. ${verdict.attemptsLeft} attempt${verdict.attemptsLeft === 1 ? "" : "s"} left before this account locks.`
            : "That PIN is not right.";
    return NextResponse.json(
      { success: false, reason: verdict.reason, ...(verdict.retryAt ? { retryAt: verdict.retryAt } : {}), message: msg },
      { status: 401 },
    );
  }

  // The session carries the phone off the BORROWER'S ROW, never off the request.
  // That is what makes this door equivalent to the OTP one: downstream code reads
  // the phone from the cookie and has no way to be handed someone else's.
  await createBorrowerSession({ orgId: org.id, orgSlug: org.slug, phone: verdict.phone });

  await prisma.auditLog.create({
    data: {
      orgId: org.id,
      actorId: verdict.borrowerId,
      actorType: "borrower",
      action: "portal.pin-signin",
      ip,
      meta: { via: "national-id" },
    },
  }).catch(() => {});

  return NextResponse.json({ success: true, authenticated: true });
}
