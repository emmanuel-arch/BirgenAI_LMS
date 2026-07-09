// POST /api/mpesa/b2c-result/[slug]?key=… — Daraja B2C result webhook.
// Confirms (or fails) a SENT disbursement: loan goes ACTIVE, float is debited,
// the borrower gets the "money sent" SMS. Failure reverses nothing (float is
// only debited on confirmation) and returns the row to FAILED for retry.
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { runAsPlatform, runWithOrg } from "@/lib/db/context";
import { verifyCallbackKey } from "@/lib/mpesa/daraja";
import { addFloatEntry } from "@/lib/lending/float";
import { sendSms } from "@/lib/sms/send";

export const runtime = "nodejs";

const ACK = { ResultCode: 0, ResultDesc: "Accepted" };

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  if (!verifyCallbackKey(slug, req.nextUrl.searchParams.get("key"))) {
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Rejected" }, { status: 401 });
  }
  // The slug is all we have until the Org registry resolves it — a platform read.
  const org = await runAsPlatform(() => prisma.org.findUnique({ where: { slug }, select: { id: true, name: true } }));
  if (!org) return NextResponse.json({ ResultCode: 1, ResultDesc: "Unknown org" }, { status: 404 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json(ACK); }

  const result = (body as { Result?: Record<string, unknown> }).Result;
  if (!result) return NextResponse.json(ACK);

  const conversationId = String(result.ConversationID ?? "");
  const resultCode = Number(result.ResultCode);
  const resultDesc = String(result.ResultDesc ?? "");
  const receipt = String(result.TransactionID ?? "");

  // Money movement runs inside the lender's RLS fence.
  return runWithOrg(org.id, async () => {
    const disb = await prisma.disbursement.findFirst({
      where: { orgId: org.id, b2cRef: conversationId || undefined, state: { in: ["SENDING", "SENT"] } },
      include: { loan: { select: { id: true, expectedClearDate: true } } },
    });
    if (!disb) return NextResponse.json(ACK);

    if (resultCode === 0) {
      await prisma.disbursement.update({
        where: { id: disb.id },
        data: { state: "CONFIRMED", receiptRef: receipt || null, raw: body as Prisma.InputJsonValue },
      });
      await prisma.loan.update({
        where: { id: disb.loanId },
        data: { status: "ACTIVE", disbursedAt: new Date() },
      });
      await addFloatEntry(org.id, "DISBURSE", -Number(disb.amount), { ref: receipt || conversationId, note: `Loan ${disb.loanId.slice(0, 8)}` });
      await sendSms(org.id, disb.phone, "disbursed", {
        org: org.name,
        amount: Math.round(Number(disb.amount)).toLocaleString(),
        phone: disb.phone,
        due: disb.loan.expectedClearDate ? disb.loan.expectedClearDate.toISOString().slice(0, 10) : "",
        ref: disb.loanId.slice(0, 8).toUpperCase(),
      });
    } else {
      await prisma.disbursement.update({
        where: { id: disb.id },
        data: { state: "FAILED", failReason: `${resultCode}: ${resultDesc}`, raw: body as Prisma.InputJsonValue },
      });
    }

    return NextResponse.json(ACK);
  });
}
