// POST /api/mpesa/c2b/[slug]?key=… — Daraja C2B confirmation webhook (paybill).
// Idempotent on (orgId, TransID). Records the receipt, matches a loan (account
// reference → payer's active loan), allocates to the schedule, thanks by SMS.
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifyCallbackKey } from "@/lib/mpesa/daraja";
import { allocateRepayment, matchLoanForPayment } from "@/lib/lending/allocate";
import { sendSms } from "@/lib/sms/send";

export const runtime = "nodejs";

const ACK = { ResultCode: 0, ResultDesc: "Accepted" };

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  if (!verifyCallbackKey(slug, req.nextUrl.searchParams.get("key"))) {
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Rejected" }, { status: 401 });
  }
  const org = await prisma.org.findUnique({ where: { slug }, select: { id: true, name: true } });
  if (!org) return NextResponse.json({ ResultCode: 1, ResultDesc: "Unknown org" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(ACK); // never provoke Daraja retries with 4xx here
  }

  const transId = String(body.TransID ?? body.transId ?? "").trim();
  const amount = Number(body.TransAmount ?? body.amount ?? 0);
  const phone = String(body.MSISDN ?? body.msisdn ?? "") || null;
  const billRef = String(body.BillRefNumber ?? body.billRef ?? "") || null;
  if (!transId || !(amount > 0)) return NextResponse.json(ACK);

  // Idempotency: a repeated confirmation is acknowledged but not re-allocated.
  const existing = await prisma.c2BReceipt.findUnique({ where: { orgId_transId: { orgId: org.id, transId } } });
  if (existing) return NextResponse.json(ACK);

  const receipt = await prisma.c2BReceipt.create({
    data: {
      orgId: org.id,
      transId,
      amount: new Prisma.Decimal(amount),
      phone,
      billRef,
      raw: body as Prisma.InputJsonValue,
    },
  });

  try {
    const loanId = await matchLoanForPayment(org.id, phone, billRef);
    if (loanId) {
      const result = await allocateRepayment(loanId, amount, `C2B:${transId}`);
      await prisma.c2BReceipt.update({
        where: { id: receipt.id },
        data: { allocatedLoanId: loanId, allocatedAt: new Date() },
      });
      if (phone) {
        await sendSms(org.id, phone, result.cleared ? "cleared" : "payment", {
          org: org.name,
          amount: Math.round(amount).toLocaleString(),
          balance: Math.round(result.newBalance).toLocaleString(),
        });
      }
    }
    // Unmatched receipts stay on the exceptions list for Finance to allocate manually.
  } catch {
    /* allocation failure leaves the receipt unallocated for manual handling */
  }

  return NextResponse.json(ACK);
}
