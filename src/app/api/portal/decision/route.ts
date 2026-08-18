// POST /api/portal/decision — "why was this decided the way it was?" (task 0.8)
//
// Body: { lenderSlug, nationalId }. The phone comes from the verified OTP session
// and never from the body; the national ID stays the second factor. Identical
// door to /api/portal/my-loan, deliberately — a customer's assessment is at least
// as sensitive as their balance, so it gets the same lock, not a lighter one.
//
// WHY THIS ONE ANSWERS FOR BRIDGED LENDERS WHEN my-loan DOES NOT. A bridged
// lender's LOAN BOOK lives in their ServiceSuite, so my-loan correctly refuses to
// guess at it. The DECISION is the other way round: the application was scored by
// our engine, the reasons were written by our model, and the row is in our
// Postgres. Micromart's customers are the ones who most need this screen, and
// refusing them on a mode check would refuse the only book that has the answer.
//
// ONE APPLICATION, NOT A HISTORY. The most recent decided application is the one
// the customer is asking about; older ones were decided on facts that have since
// changed, and listing them invites reading a stale decline as a current one.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveOrg } from "@/lib/tenancy";
import { enterOrg } from "@/lib/db/context";
import { borrowerFor, otpRequired } from "@/lib/portal/session";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { normaliseReasons, verdictHeadline } from "@/lib/microeazy/reasons";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { lenderSlug?: string; nationalId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const nationalId = (body.nationalId ?? "").trim();
  if (!nationalId) return NextResponse.json({ success: false, message: "Enter your national ID." }, { status: 400 });

  const org = await resolveOrg(body.lenderSlug ?? "");
  if (org) enterOrg(org.id);
  if (!org) return NextResponse.json({ success: false, message: "Choose a lender." }, { status: 400 });

  const verified = await borrowerFor(org.id);
  if (!verified) return otpRequired();
  const phone = verified.phone;

  const limited = await rateLimit([
    { name: "decision:phone", subject: `${org.id}:${phone}`, max: 10, windowSec: 900 },
    { name: "decision:ip", subject: clientIp(req), max: 60, windowSec: 3600 },
  ]);
  if (limited) return limited;

  const borrower = await prisma.borrower.findFirst({
    where: { orgId: org.id, phone: { endsWith: phone.slice(-9) }, nationalId },
    select: { id: true, firstName: true, loanLimit: true },
    orderBy: { createdAt: "desc" },
  });
  if (!borrower) return NextResponse.json({ success: true, found: false, lender: org.name });

  const app = await prisma.loanApplication.findFirst({
    where: { orgId: org.id, borrowerId: borrower.id, NOT: { decision: null } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, decision: true, status: true, createdAt: true,
      amountRequested: true, approvedLimit: true, reasonCodes: true, productName: true,
    },
  });

  if (!app) {
    return NextResponse.json({
      success: true, found: true, lender: org.name,
      firstName: borrower.firstName, decision: null,
    });
  }

  const reasons = normaliseReasons(app.reasonCodes);
  const head = verdictHeadline(app.decision, org.name);
  const requested = Number(app.amountRequested);
  const limit = app.approvedLimit != null ? Number(app.approvedLimit) : null;

  return NextResponse.json({
    success: true,
    found: true,
    lender: org.name,
    firstName: borrower.firstName,
    decision: {
      ref: app.id.slice(0, 8).toUpperCase(),
      verdict: app.decision,
      status: app.status,
      decidedAt: app.createdAt.toISOString(),
      product: app.productName,
      requested,
      // What they could have had. The single most actionable number on the
      // screen when the decline was an affordability one.
      qualifiedFor: limit,
      // Only true when the arithmetic actually supports the advice "ask for
      // less" — offering that line when they already asked for less than their
      // limit would be visibly wrong to the one person who checks.
      askingAboveLimit: limit != null && requested > limit,
      ...head,
      reasons,
      // The appeal right is not a support link, it is a disclosure (§6.2). It
      // ships with the decline or the decline is incomplete.
      appeal: {
        available: app.decision === "DECLINE" || app.decision === "REFER",
        note: "You can ask for this decision to be looked at by a person, and to see the information it was based on.",
      },
    },
  });
}
