// ─────────────────────────────────────────────────────────────────────────────
// POST /api/portal/enrolment — "am I already a customer here?"
//
// Body: { lenderSlug, nationalId }. The phone comes from the verified OTP
// session and never from the body; the national ID is the second factor. Same
// door as /my-loan and /decision, deliberately — this answers a question about
// somebody's account, so it gets the same lock rather than a lighter one.
//
// ── WHY THIS ROUTE EXISTS ────────────────────────────────────────────────────
// The borrower app has to decide, immediately after a code is verified, whether
// it is looking at a RETURNING customer or a NEW one. Those are two different
// apps from that point on: one opens on a balance, the other opens on
// onboarding. Getting it wrong in either direction is bad in a specific way —
// send a returning customer through KYC they completed a year ago and they
// abandon; drop a stranger onto a dashboard and there is nothing to show them.
//
// Nothing else could answer it. /my-loan refuses BRIDGED lenders by design (the
// loan book is not ours to guess at) and /pin's lookup reads OUR Postgres only.
// Micromart's customers are in NEITHER of those places by default — they are in
// the lender's own ServiceSuite — so both existing doors would have reported
// every single one of them as new.
//
// ── TWO BOOKS, ONE QUESTION ──────────────────────────────────────────────────
// A person can be enrolled in either place, and both are checked:
//
//   local        our Postgres Borrower table, scoped to this org. Anyone who
//                onboarded through this platform.
//   servicesuite the lender's own SQL Server, for a BRIDGED org. Everyone who
//                predates us — which for Micromart is the entire book.
//
// Local is checked first because it is cheap, ours, and cannot be down. The
// bridged read is a network hop into somebody else's database and is allowed to
// fail without failing the request: see `reachable` below.
//
// ── WHAT THIS ROUTE WILL NOT SAY ─────────────────────────────────────────────
// Never the customer's name, and never anything about an ID that is NOT theirs.
// The caller has already proved possession of the phone, and the national ID is
// checked AGAINST that phone — so this cannot be used to ask "does ID X bank
// here?" for an arbitrary X. That restraint is the same one /pin's step 1 makes,
// and for the same reason: an endpoint whose whole job is answering membership
// questions is an endpoint that gets scraped.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveOrg } from "@/lib/tenancy";
import { enterOrg } from "@/lib/db/context";
import { borrowerFor, otpRequired } from "@/lib/portal/session";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { normaliseNationalId } from "@/lib/portal/pin";
import { findBorrowerByPhone } from "@/lib/lms/servicesuite";

export const runtime = "nodejs";

/** Where the customer was found. `null` means nowhere — a genuinely new person. */
type Enrolled = "local" | "servicesuite" | null;

export async function POST(req: NextRequest) {
  let body: { lenderSlug?: string; nationalId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 });
  }

  const nationalId = normaliseNationalId(body.nationalId ?? "");
  if (nationalId.length < 5) {
    return NextResponse.json({ success: false, message: "Enter your national ID." }, { status: 400 });
  }

  const org = await resolveOrg(body.lenderSlug ?? "");
  // Bind the RLS tenant in OUR async context (enterWith does not escape a callee).
  if (org) enterOrg(org.id);
  if (!org) return NextResponse.json({ success: false, message: "Choose a lender." }, { status: 400 });

  const verified = await borrowerFor(org.id);
  if (!verified) return otpRequired();
  const phone = verified.phone;

  // The national ID is the remaining guessable factor, so the guesses are capped
  // on the same shape /my-loan uses. The per-IP bucket is loose because Kenyan
  // carriers NAT very large numbers of subscribers behind one address.
  const limited = await rateLimit([
    { name: "enrolment:phone", subject: `${org.id}:${phone}`, max: 10, windowSec: 900 },
    { name: "enrolment:ip", subject: clientIp(req), max: 60, windowSec: 3600 },
  ]);
  if (limited) return limited;

  // ── Book one: our Postgres ────────────────────────────────────────────────
  // Matched on BOTH the session phone and the claimed ID, exactly as /my-loan
  // does. The phone comparison is on the last nine digits because the column
  // holds a mix of 07…, 2547… and +2547… from years of different intake paths.
  const local = await prisma.borrower.findFirst({
    where: {
      orgId: org.id,
      nationalId,
      erasedAt: null,
      phone: { endsWith: phone.slice(-9) },
    },
    select: { id: true, firstName: true },
    orderBy: { createdAt: "desc" },
  });

  if (local) {
    return NextResponse.json({
      success: true,
      enrolled: true,
      where: "local" as Enrolled,
      lender: org.name,
      firstName: local.firstName,
      reachable: true,
    });
  }

  // ── Book two: the lender's own ServiceSuite ───────────────────────────────
  // Only for a BRIDGED org whose connection is actually configured. A NATIVE
  // lender has no second book, and "not configured" is not the same as "not a
  // customer" — see `reachable`.
  if (!org.bridgedReady || !org.registry) {
    return NextResponse.json({
      success: true,
      enrolled: false,
      where: null as Enrolled,
      lender: org.name,
      // TRUE only when every book that exists for this lender was actually
      // consulted. A NATIVE org has one book and we read it, so this is honest.
      reachable: org.mode === "NATIVE",
      ...(org.mode === "BRIDGED"
        ? { message: `${org.name}'s own system is not connected, so we could not check their records.` }
        : {}),
    });
  }

  try {
    // ── THE ENTITY IS AN IDENTITY BOUNDARY, NOT A LABEL ─────────────────────
    // `org.entityId` is `Org.serviceSuiteEntityId` when that column is set, and
    // only falls back to the registry default (connections.ts) when it is NULL.
    // For Micromart those two disagree: prisma/seed.ts writes 3002 and the
    // registry says 3005, with a comment recording that a live read found Micro
    // Eazy active under 3005 and absent from 3002 — and, crucially, that the two
    // books hold DIFFERENT PEOPLE on the same phone numbers.
    //
    // So the entity actually used is returned to the caller rather than left
    // implicit. If this ever answers "new customer" for somebody who has
    // borrowed for years, `entityId` in the response is the first thing to look
    // at, and the fix is the Org row — not this file.
    const match = await findBorrowerByPhone(org.registry, org.entityId, phone, nationalId);

    if (match.kind === "found") {
      return NextResponse.json({
        success: true,
        enrolled: true,
        where: "servicesuite" as Enrolled,
        lender: org.name,
        firstName: match.name ? match.name.split(/\s+/)[0] : null,
        entityId: org.entityId,
        reachable: true,
      });
    }

    if (match.kind === "ambiguous") {
      // Several people on one number, or an ID that disagrees with the row. This
      // is NOT "new customer" and must never be treated as one: onboarding
      // somebody who already has a loan creates a second account against the
      // same phone. It is a case for a human, and the app says so.
      return NextResponse.json({
        success: true,
        enrolled: false,
        ambiguous: true,
        where: null as Enrolled,
        lender: org.name,
        entityId: org.entityId,
        reachable: true,
        message:
          "We found more than one record against this phone number and could not tell which is yours. " +
          "Please contact your lender so they can confirm it — signing you up again would create a second account.",
      });
    }

    return NextResponse.json({
      success: true,
      enrolled: false,
      where: null as Enrolled,
      lender: org.name,
      entityId: org.entityId,
      reachable: true,
    });
  } catch {
    // The lender's SQL Server is unreachable. THIS IS NOT "NOT A CUSTOMER".
    // Answering `enrolled: false` here would push a returning borrower into
    // onboarding because of somebody else's network, so the honest answer is
    // "we do not know", and the app holds rather than guesses.
    return NextResponse.json({
      success: true,
      enrolled: false,
      where: null as Enrolled,
      lender: org.name,
      entityId: org.entityId,
      reachable: false,
      message: `We could not reach ${org.name}'s system to check your records. Please try again in a moment.`,
    });
  }
}
