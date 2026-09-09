// ─────────────────────────────────────────────────────────────────────────────
// POST /api/portal/micromart — the EXISTING Micromart customer's door.
//
//   { lenderSlug, phone, password }   → sign in, mint the borrower session.
//   { lenderSlug, phone, reset: true } → ask Micromart to SMS a new password.
//
// The session this mints is the SAME `lms_borrower` cookie the OTP funnel and
// the PIN door issue, bound to the phone the borrower proved. So everything
// downstream — the Customer-360, the enrolment check, the offer — is unchanged
// and cannot tell which door was used. That equivalence is the property that
// makes adding a door safe; see lib/portal/micromart.ts for why the credential
// check happens on this side of the wire rather than in the app.
//
// ── WHY BOTH VERBS ARE ONE ENDPOINT ─────────────────────────────────────────
// The same reason /api/portal/pin keeps its lookup and its unlock together: a
// separate /reset URL is a URL whose entire job is answering "does this number
// bank at Micromart?", and it would be scraped for exactly that. Here the reset
// is a branch of an authentication attempt and is rate-limited as one.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveOrg } from "@/lib/tenancy";
import { enterOrg } from "@/lib/db/context";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { createBorrowerSession, toMsisdn, isKenyanMsisdn } from "@/lib/portal/session";
import { micromartSignIn, micromartResetPassword } from "@/lib/portal/micromart";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { lenderSlug?: string; phone?: string; password?: string; reset?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 });
  }

  const org = await resolveOrg(body.lenderSlug ?? "");
  if (!org) return NextResponse.json({ success: false, message: "Choose a lender." }, { status: 400 });
  enterOrg(org.id);

  const phone = toMsisdn(body.phone ?? "");
  if (!isKenyanMsisdn(phone)) {
    return NextResponse.json({ success: false, message: "Enter the phone number your account is on." }, { status: 400 });
  }

  const ip = clientIp(req);

  // ── Reset: mint a new password at Micromart and let their outbox send it ──
  if (body.reset) {
    // Tighter than sign-in, and deliberately so: every accepted call sends a
    // real SMS to a real handset and INVALIDATES the password that person is
    // currently holding. Someone spamming this against a number they do not own
    // is a denial of service against that customer's account, not just noise.
    const limited = await rateLimit(
      [
        { name: "micromart:reset:phone", subject: `${org.id}:${phone}`, max: 3, windowSec: 900 },
        { name: "micromart:reset:phone:day", subject: `${org.id}:${phone}`, max: 6, windowSec: 86400 },
        { name: "micromart:reset:ip", subject: ip, max: 12, windowSec: 3600 },
      ],
      "Too many password requests for this number. Please wait a few minutes.",
    );
    if (limited) return limited;

    const r = await micromartResetPassword(phone, org.entityId);

    if (r.kind === "unreachable") {
      return NextResponse.json(
        { success: false, reachable: false, message: "We could not reach Micromart just now. Please try again in a moment." },
        { status: 503 },
      );
    }

    // `none` and `ok` answer IDENTICALLY on purpose. A distinct "no such
    // account" here would turn this into the membership oracle the header says
    // it must not be — and unlike the sign-in branch below, there is no
    // credential being checked, so anyone could ask about any number.
    return NextResponse.json({
      success: true,
      message: "If that number has a Micromart account, a new password is on its way by SMS.",
    });
  }

  // ── Sign in ───────────────────────────────────────────────────────────────
  const password = (body.password ?? "").trim();
  if (!password) {
    return NextResponse.json({ success: false, message: "Enter your password." }, { status: 400 });
  }

  const limited = await rateLimit(
    [
      { name: "micromart:signin:phone", subject: `${org.id}:${phone}`, max: 10, windowSec: 900 },
      { name: "micromart:signin:ip", subject: ip, max: 30, windowSec: 900 },
      { name: "micromart:signin:ip:day", subject: ip, max: 200, windowSec: 86400 },
    ],
    "Too many sign-in attempts. Please wait a few minutes and try again.",
  );
  if (limited) return limited;

  const r = await micromartSignIn(phone, password, org.entityId);

  if (r.kind === "unreachable") {
    // 503, not 401. "We could not ask" must never render as "you are not a
    // customer" — that is the answer that makes a ten-year customer register a
    // second account, which is the mess this platform exists to stop making.
    return NextResponse.json(
      {
        success: false,
        reachable: false,
        message: "We could not reach Micromart just now. Your details are fine — please try again in a moment.",
      },
      { status: 503 },
    );
  }

  if (r.kind === "ambiguous") {
    // Refused rather than resolved. Two live records for one person is a data
    // fault, and opening whichever book answered first shows somebody a balance
    // that may not be theirs.
    await prisma.auditLog.create({
      data: {
        orgId: org.id,
        actorType: "borrower",
        action: "portal.micromart-signin.ambiguous",
        ip,
        meta: { phone, entityIds: r.entityIds },
      },
    }).catch(() => {});

    return NextResponse.json(
      {
        success: false,
        reason: "ambiguous",
        message:
          "Your number is registered on more than one Micromart book, so we cannot safely open the right one. Please call Micromart and they will merge them.",
      },
      { status: 409 },
    );
  }

  if (r.kind === "none") {
    // Micromart's own message when they gave one — they know whether it was the
    // password or the account, and rewriting that as a generic failure hides the
    // one instruction the customer can act on.
    return NextResponse.json(
      {
        success: false,
        reason: "rejected",
        message: r.message || "That phone number and password did not match. If you have forgotten it, ask for a new one below.",
      },
      { status: 401 },
    );
  }

  // The phone on the session is the NORMALISED one we authenticated with, not
  // anything the borrower record echoes back — same rule the PIN door follows.
  //
  // The ServiceSuite trio rides along because this is the ONLY moment we learn
  // it: which of Micromart's books answered, and who this person is inside it.
  // Applying for a loan needs all three, and re-deriving them later would mean
  // asking their Login again with a password we correctly did not keep.
  await createBorrowerSession({
    orgId: org.id,
    orgSlug: org.slug,
    phone,
    ssBorrowerId: r.data.borrowerId,
    ssAccount: r.data.accountNo ?? phone,
    ssEntityId: r.entityId,
    ssToken: r.data.token,
  });

  await prisma.auditLog.create({
    data: {
      orgId: org.id,
      actorId: String(r.data.borrowerId),
      actorType: "borrower",
      action: "portal.micromart-signin",
      ip,
      meta: { via: "micromart-password", entityId: r.entityId },
    },
  }).catch(() => {});

  return NextResponse.json({
    success: true,
    authenticated: true,
    entityId: r.entityId,
    // For the greeting only. The account number is the customer's own and is
    // already visible on every statement they hold.
    // Their Login returns the name in two parts. It read `r.data.fullname`,
    // which their API has never returned, so every customer coming through this
    // door was greeted with nothing.
    name: [r.data.firstName, r.data.otherName].filter(Boolean).join(" ").trim() || null,
    accountNumber: r.data.accountNo ?? null,
  });
}
