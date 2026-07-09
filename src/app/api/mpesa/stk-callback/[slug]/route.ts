// POST /api/mpesa/stk-callback/[slug]?key=… — Daraja STK push result webhook.
// Updates the PaymentIntent; on success allocates to the intent's loan.
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { runAsPlatform, runWithOrg } from "@/lib/db/context";
import { verifyCallbackKey } from "@/lib/mpesa/daraja";
import { allocateRepayment } from "@/lib/lending/allocate";
import { sendSms } from "@/lib/sms/send";

export const runtime = "nodejs";

const ACK = { ResultCode: 0, ResultDesc: "Accepted" };

type StkItem = { Name?: string; Value?: unknown };

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

  const cb = (body as { Body?: { stkCallback?: Record<string, unknown> } }).Body?.stkCallback;
  if (!cb) return NextResponse.json(ACK);

  const checkoutRequestId = String(cb.CheckoutRequestID ?? "");
  const resultCode = Number(cb.ResultCode);
  const resultDesc = String(cb.ResultDesc ?? "");
  if (!checkoutRequestId) return NextResponse.json(ACK);

  // Everything touching the lender's book runs inside their RLS fence — so the
  // globally-unique checkoutRequestId can no longer resolve another org's intent.
  return runWithOrg(org.id, async () => {
    const intent = await prisma.paymentIntent.findUnique({ where: { checkoutRequestId } });
    if (!intent || intent.orgId !== org.id) return NextResponse.json(ACK);
    if (intent.state === "SUCCESS") return NextResponse.json(ACK); // idempotent

    if (resultCode === 0) {
      const items = ((cb.CallbackMetadata as { Item?: StkItem[] } | undefined)?.Item ?? []) as StkItem[];
      const get = (name: string) => items.find((i) => i.Name === name)?.Value;
      const amount = Number(get("Amount") ?? intent.amount);
      const receipt = String(get("MpesaReceiptNumber") ?? "");

      await prisma.paymentIntent.update({
        where: { id: intent.id },
        data: { state: "SUCCESS", resultCode: "0", resultDesc, mpesaReceipt: receipt || null, raw: body as Prisma.InputJsonValue },
      });

      if (intent.loanId) {
        try {
          const result = await allocateRepayment(intent.loanId, amount, `STK:${receipt || checkoutRequestId}`);
          await sendSms(org.id, intent.phone, result.cleared ? "cleared" : "payment", {
            org: org.name,
            amount: Math.round(amount).toLocaleString(),
            balance: Math.round(result.newBalance).toLocaleString(),
          });
        } catch { /* left for manual allocation */ }
      }
    } else {
      await prisma.paymentIntent.update({
        where: { id: intent.id },
        data: { state: resultCode === 1032 ? "FAILED" : "FAILED", resultCode: String(resultCode), resultDesc, raw: body as Prisma.InputJsonValue },
      });
    }

    return NextResponse.json(ACK);
  });
}
