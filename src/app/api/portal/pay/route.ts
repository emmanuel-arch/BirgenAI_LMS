// POST /api/portal/pay — borrower "Pay now": STK push for the active loan.
// Body: { lenderSlug, nationalId, amount? } — the phone comes from the verified
// OTP session; the STK ALWAYS targets the borrower's REGISTERED phone (never a
// caller-supplied payout target), so the worst misuse is paying someone's loan.
// Rate-limited hard: an STK push is an unsolicited PIN prompt on a real handset,
// and an unthrottled one is a harassment tool.
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveOrg } from "@/lib/tenancy";
import { enterOrg } from "@/lib/db/context";
import { borrowerFor, otpRequired } from "@/lib/portal/session";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { initiateStkPush } from "@/lib/mpesa/daraja";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { lenderSlug?: string; nationalId?: string; amount?: number };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const nationalId = (body.nationalId ?? "").trim();
  if (!nationalId) {
    return NextResponse.json({ success: false, message: "Enter your national ID." }, { status: 400 });
  }

  const org = await resolveOrg(body.lenderSlug ?? "");
  // Bind the RLS tenant in OUR async context (enterWith does not escape a callee).
  if (org) enterOrg(org.id);
  if (!org || org.mode !== "NATIVE") {
    return NextResponse.json({ success: false, message: "Pay-now is available for this lender via their own channels." }, { status: 400 });
  }

  const verified = await borrowerFor(org.id);
  if (!verified) return otpRequired();
  const phone = verified.phone;

  const limited = await rateLimit([
    { name: "pay:phone", subject: `${org.id}:${phone}`, max: 5, windowSec: 600 },
    { name: "pay:ip", subject: clientIp(req), max: 30, windowSec: 3600 },
  ]);
  if (limited) return limited;

  const borrower = await prisma.borrower.findFirst({
    where: { orgId: org.id, phone: { endsWith: phone.slice(-9) }, nationalId },
    orderBy: { createdAt: "desc" },
  });
  if (!borrower) return NextResponse.json({ success: false, message: "We couldn't match your details." }, { status: 404 });

  const loan = await prisma.loan.findFirst({
    where: { orgId: org.id, borrowerId: borrower.id, status: "ACTIVE" },
    orderBy: { borrowDate: "desc" },
    include: { installments: { where: { status: { in: ["UPCOMING", "DUE", "PARTIAL", "OVERDUE"] } }, orderBy: { seq: "asc" }, take: 1 } },
  });
  if (!loan) return NextResponse.json({ success: false, message: "No active loan to pay." }, { status: 404 });

  const next = loan.installments[0];
  const balance = Number(loan.balance);
  const suggested = next ? Number(next.amountDue) + Number(next.penalty) - Number(next.amountPaid) : balance;
  const requested = Number(body.amount);
  const amount = Math.min(balance, Number.isFinite(requested) && requested > 0 ? requested : Math.max(1, suggested));

  const res = await initiateStkPush(org.id, org.slug, {
    phone: borrower.phone, // registered phone only
    amount,
    accountReference: loan.id.slice(0, 8).toUpperCase(),
  });

  await prisma.paymentIntent.create({
    data: {
      orgId: org.id,
      loanId: loan.id,
      phone: borrower.phone,
      amount: new Prisma.Decimal(amount),
      checkoutRequestId: res.checkoutRequestId || null,
      merchantRequestId: res.merchantRequestId || null,
      state: res.ok ? "PENDING" : "FAILED",
      resultDesc: res.ok ? null : res.message,
      raw: (res.raw ?? {}) as Prisma.InputJsonValue,
    },
  });

  if (!res.ok) return NextResponse.json({ success: false, message: res.message }, { status: 400 });
  return NextResponse.json({ success: true, message: res.message, amount });
}
