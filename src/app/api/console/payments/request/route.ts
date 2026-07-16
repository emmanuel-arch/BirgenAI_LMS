// GET/POST /api/console/payments/request — the one payment-request endpoint.
//
//   GET  ?borrowerId=…  → what it would make sense to ask this customer for, and
//                         what each thing costs. The dropdown behind every button.
//   POST { borrowerId, purpose, chargeId?, loanId?, amount?, note?, channel }
//                       → send the STK prompt.
//
// Every surface in the console — Customer-360, the collections work queue, the
// counter, Field Ops — points here. The screens differ; the money rails do not.
// The amount for a charge is read from the Charge row and never from this body.
import { NextRequest, NextResponse } from "next/server";
import type { PaymentPurpose } from "@prisma/client";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { prisma } from "@/lib/prisma";
import { resolveScope, canSeeBorrower } from "@/lib/rbac/scope";
import { rateLimit } from "@/lib/ratelimit";
import { requestPayment, askablesFor } from "@/lib/payments/request";

export const runtime = "nodejs";

const CHANNELS = new Set(["c360", "collections", "counter", "field", "portal", "funnel"]);

export async function GET(req: NextRequest) {
  const session = await auth();
  const denied = await requireRight(session, "repayments.collect");
  if (denied) return denied;
  const orgId = session!.user!.orgId!;

  const borrowerId = req.nextUrl.searchParams.get("borrowerId") ?? "";
  const scope = await resolveScope(session!);
  if (!borrowerId || !(await canSeeBorrower(scope, borrowerId))) {
    return NextResponse.json({ success: false, message: "Customer not found." }, { status: 404 });
  }

  return NextResponse.json({ success: true, askables: await askablesFor(orgId, borrowerId) });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const denied = await requireRight(session, "repayments.collect");
  if (denied) return denied;
  const orgId = session!.user!.orgId!;
  const staffId = session!.user!.id;

  let body: {
    borrowerId?: string; purpose?: string; chargeId?: string; loanId?: string;
    amount?: number; note?: string; channel?: string; phone?: string;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const purpose = String(body.purpose ?? "") as PaymentPurpose;
  if (!["CHARGE", "INSTALLMENT", "CUSTOM"].includes(purpose)) {
    return NextResponse.json({ success: false, message: "Unknown payment purpose." }, { status: 400 });
  }

  // A payment prompt costs the customer nothing but their attention — and an officer
  // who can fire them without limit can harass a customer's phone into silence, which
  // is exactly when a real prompt gets ignored.
  const limited = await rateLimit([
    { name: "stk:staff", subject: staffId ?? orgId, max: 120, windowSec: 3600 },
    ...(body.borrowerId ? [{ name: "stk:borrower", subject: `${orgId}:${body.borrowerId}`, max: 6, windowSec: 900 }] : []),
  ]);
  if (limited) return limited;

  const org = await prisma.org.findUnique({ where: { id: orgId }, select: { slug: true, status: true } });
  if (!org) return NextResponse.json({ success: false, message: "Organisation not found." }, { status: 404 });
  // The same rule the booking engine holds to: a lender who is not ACTIVE does not
  // move money, in either direction.
  if (org.status !== "ACTIVE") {
    return NextResponse.json({ success: false, message: "Your organisation is not active yet — money rails are switched off." }, { status: 403 });
  }

  // The scope fence holds here too: an officer who cannot SEE a customer cannot ring
  // their phone and ask them for money.
  if (body.borrowerId) {
    const scope = await resolveScope(session!);
    if (!(await canSeeBorrower(scope, body.borrowerId))) {
      return NextResponse.json({ success: false, message: "Customer not found." }, { status: 404 });
    }
  }

  const channel = CHANNELS.has(String(body.channel)) ? String(body.channel) : "c360";

  const result = await requestPayment({
    orgId,
    orgSlug: org.slug,
    purpose,
    chargeId: body.chargeId,
    loanId: body.loanId,
    borrowerId: body.borrowerId,
    amount: body.amount,
    phone: body.phone,
    note: body.note,
    channel,
    requestedById: staffId,
  });

  return NextResponse.json(
    { success: result.ok, ...result },
    { status: result.ok ? 200 : 400 },
  );
}
