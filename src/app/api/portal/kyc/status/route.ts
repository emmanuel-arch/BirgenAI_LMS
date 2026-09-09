// ─────────────────────────────────────────────────────────────────────────────
// GET /api/portal/kyc/status?lenderSlug=… — where my ID check stands.
//
// The screen a referred customer opens. Until now the only thing the app could
// learn about a referral was the single word on `Borrower.kycStatus`, and the
// reasons — which signals fired, whether another photograph would help — existed
// only inside the finalize response, which is gone the moment the customer
// closes the app.
//
// ── WHAT IS RETURNED AND WHAT IS NOT ────────────────────────────────────────
// The SIGNALS are named in the customer's own language, from the same policy
// document the decision was made against (lib/config/kyc.ts), so a lender who
// changes an outcome cannot leave a message describing the old one.
//
// The SCORES are not returned. A customer told their face matched at 79 against
// a floor of 80 has been handed the number to beat, and the next attempt is
// tuned rather than honest. The same reasoning as the console withholding stage
// approval caps on the tracker.
//
// `retakeable` is the field the screen's primary button hangs off, and it is
// false unless EVERY firing signal is one a better photograph could fix. Sending
// somebody to retake a selfie six times over a registry miss is the cruellest
// loop this app could implement.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveOrg } from "@/lib/tenancy";
import { enterOrg } from "@/lib/db/context";
import { borrowerFor, otpRequired } from "@/lib/portal/session";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { readKycConfig } from "@/lib/config/store";
import { KYC_SIGNALS, type SignalKey } from "@/lib/config/kyc";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const org = await resolveOrg(req.nextUrl.searchParams.get("lenderSlug") ?? "");
  if (!org) return NextResponse.json({ success: false, message: "Choose a lender." }, { status: 400 });
  enterOrg(org.id);

  const verified = await borrowerFor(org.id);
  if (!verified) return otpRequired();

  const limited = await rateLimit([
    { name: "kycstatus:phone", subject: `${org.id}:${verified.phone}`, max: 40, windowSec: 900 },
    { name: "kycstatus:ip", subject: clientIp(req), max: 120, windowSec: 3600 },
  ]);
  if (limited) return limited;

  const [borrower, session, policy] = await Promise.all([
    prisma.borrower.findFirst({
      where: { orgId: org.id, phone: { endsWith: verified.phone.slice(-9) } },
      select: { id: true, firstName: true, kycStatus: true, erasedAt: true },
      orderBy: { createdAt: "desc" },
    }),
    // The session is keyed on the PHONE, not the borrower: KYC runs during
    // onboarding, before a Borrower row exists, and a first-time applicant's
    // referral has to be readable too.
    prisma.kycSession.findFirst({
      where: { orgId: org.id, phone: verified.phone },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, riskFlags: true, completedAt: true, createdAt: true },
    }),
    readKycConfig(org.id),
  ]);

  if (borrower?.erasedAt) {
    return NextResponse.json({ success: true, found: false, lender: org.name });
  }

  // No session and no borrower is somebody who has verified a phone and not yet
  // started. A real state, and the screen invites them to begin rather than
  // reporting an absence as a problem.
  if (!session) {
    return NextResponse.json({
      success: true,
      found: true,
      lender: org.name,
      firstName: borrower?.firstName ?? null,
      status: borrower?.kycStatus ?? "NONE",
      started: false,
      reasons: [],
      retakeable: true,
      conversation: null,
    });
  }

  // `riskFlags` holds signal KEYS. Anything unrecognised is dropped rather than
  // rendered raw: a flag from a previous version of the pipeline is not
  // something to show a customer as an explanation of their own refusal.
  const raw = Array.isArray(session.riskFlags) ? (session.riskFlags as unknown[]) : [];
  const reasons = raw
    .map((k) => KYC_SIGNALS.find((s) => s.key === String(k)))
    .filter((s): s is (typeof KYC_SIGNALS)[number] => Boolean(s))
    .map((s) => ({ key: s.key as SignalKey, says: s.customerSays, fixable: s.fixable }));

  const conversation = borrower
    ? await prisma.conversationThread.findFirst({
        where: { orgId: org.id, borrowerId: borrower.id, kind: "KYC_REVIEW", state: { not: "RESOLVED" } },
        select: { id: true, unreadForBorrower: true },
        orderBy: { lastAt: "desc" },
      })
    : null;

  return NextResponse.json({
    success: true,
    found: true,
    lender: org.name,
    firstName: borrower?.firstName ?? null,
    // The SESSION's status, not the borrower's: a customer who has just been
    // referred has a session saying PENDING_REVIEW while their Borrower row may
    // still say IN_PROGRESS, and the session is the fresher fact.
    status: session.status,
    started: true,
    submittedAt: session.completedAt ?? session.createdAt,
    reasons,
    retakeable: reasons.length > 0 && reasons.every((r) => r.fixable),
    /** The lender's own expectation, so the screen need not invent one. */
    expectedHours: policy.value.review.slaHours > 0 ? policy.value.review.slaHours : null,
    conversation: conversation ? { id: conversation.id, unread: conversation.unreadForBorrower } : null,
  });
}
