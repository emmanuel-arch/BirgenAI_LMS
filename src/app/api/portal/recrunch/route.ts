// POST /api/portal/recrunch — the customer-paid statement refresh, money side.
//
// Body: { lenderSlug, nationalId, action, intentId? }
//   action "offer"  → is it on, what does it cost, do I already have a paid credit?
//   action "pay"    → charge me for one refresh (STK to my registered phone).
//   action "status" → has that payment landed yet?
//
// The phone is ALWAYS the borrower's registered number (never caller-supplied), so
// the STK prompt can only ever land on the customer's own handset. When the lender
// has no M-Pesa credentials the payment is SIMULATED end to end — the demo flows,
// and the row is stamped `simulated` so it can never be mistaken for real money.
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveOrg } from "@/lib/tenancy";
import { enterOrg } from "@/lib/db/context";
import { borrowerFor, otpRequired } from "@/lib/portal/session";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { getIntegration } from "@/lib/vault/integrations";
import { requestPayment } from "@/lib/payments/request";
import { recrunchOffer, unusedRecrunchIntent, RECRUNCH_CODE } from "@/lib/statement/recrunch";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { lenderSlug?: string; nationalId?: string; action?: string; intentId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const nationalId = (body.nationalId ?? "").trim();
  const action = body.action ?? "offer";
  if (!nationalId) return NextResponse.json({ success: false, message: "Enter your national ID." }, { status: 400 });

  const org = await resolveOrg(body.lenderSlug ?? "");
  if (org) enterOrg(org.id);
  if (!org || org.mode !== "NATIVE") {
    return NextResponse.json({ success: false, available: false, message: "This service isn't available for this lender." }, { status: 400 });
  }

  const verified = await borrowerFor(org.id);
  if (!verified) return otpRequired();

  const borrower = await prisma.borrower.findFirst({
    where: { orgId: org.id, phone: { endsWith: verified.phone.slice(-9) }, nationalId },
    orderBy: { createdAt: "desc" },
    select: { id: true, phone: true },
  });
  if (!borrower) return NextResponse.json({ success: false, message: "We couldn't match your details." }, { status: 404 });

  const offer = await recrunchOffer(org.id);

  // ── OFFER — the card's copy comes from here. ────────────────────────────────
  if (action === "offer") {
    if (!offer) return NextResponse.json({ success: true, available: false });
    const [credit, mpesa] = await Promise.all([
      unusedRecrunchIntent(org.id, borrower.id),
      getIntegration(org.id, "MPESA_STK").catch(() => null),
    ]);
    return NextResponse.json({
      success: true, available: true,
      price: offer.amount, name: offer.name,
      mpesaConfigured: !!mpesa, credit,
    });
  }

  // ── PAY — one refresh. ──────────────────────────────────────────────────────
  if (action === "pay") {
    if (!offer) return NextResponse.json({ success: false, message: "Statement refresh isn't offered here yet." }, { status: 400 });

    // Never charge twice for an unspent credit.
    const existing = await unusedRecrunchIntent(org.id, borrower.id);
    if (existing) return NextResponse.json({ success: true, intentId: existing, pending: false, alreadyPaid: true });

    const limited = await rateLimit([
      { name: "recrunch:phone", subject: `${org.id}:${borrower.phone}`, max: 5, windowSec: 600 },
      { name: "recrunch:ip", subject: clientIp(req), max: 20, windowSec: 3600 },
    ]);
    if (limited) return limited;

    const mpesa = await getIntegration(org.id, "MPESA_STK").catch(() => null);
    if (mpesa) {
      // Real rails — priced server-side from the Charge row, pushed to the handset.
      const r = await requestPayment({
        orgId: org.id, orgSlug: org.slug, purpose: "CHARGE", chargeId: offer.chargeId,
        borrowerId: borrower.id, phone: borrower.phone, channel: "portal", requestedById: null,
      });
      if (!r.ok) return NextResponse.json({ success: false, message: r.message }, { status: 400 });
      return NextResponse.json({ success: true, intentId: r.intentId, pending: true, simulated: false, amount: r.amount });
    }

    // Simulated — no lender M-Pesa yet. Stamped so it is never mistaken for real money.
    const intent = await prisma.paymentIntent.create({
      data: {
        orgId: org.id, purpose: "CHARGE", chargeId: offer.chargeId, borrowerId: borrower.id,
        beneficiary: offer.beneficiary, phone: borrower.phone, amount: new Prisma.Decimal(offer.amount),
        reference: RECRUNCH_CODE, channel: "portal", state: "PENDING", raw: { simulated: true } as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return NextResponse.json({ success: true, intentId: intent.id, pending: true, simulated: true, amount: offer.amount });
  }

  // ── STATUS — has it landed? ─────────────────────────────────────────────────
  if (action === "status") {
    const intentId = (body.intentId ?? "").trim();
    if (!intentId) return NextResponse.json({ success: false, message: "No payment to check." }, { status: 400 });
    const intent = await prisma.paymentIntent.findFirst({
      where: { id: intentId, orgId: org.id, borrowerId: borrower.id },
      select: { id: true, state: true, raw: true },
    });
    if (!intent) return NextResponse.json({ success: false, message: "Payment not found." }, { status: 404 });
    if (intent.state === "SUCCESS") return NextResponse.json({ success: true, state: "SUCCESS" });

    // A simulated push confirms itself on the first check — the demo shouldn't hang
    // on a callback that will never come.
    const simulated = (intent.raw as { simulated?: boolean } | null)?.simulated;
    if (simulated && intent.state === "PENDING") {
      await prisma.paymentIntent.update({
        where: { id: intent.id },
        data: { state: "SUCCESS", settledAt: new Date(), mpesaReceipt: "SIMULATED", resultDesc: "Simulated confirmation (no M-Pesa credentials)." },
      });
      await prisma.auditLog.create({
        data: { orgId: org.id, actorType: "system", action: "payment.charge-paid", entity: "PaymentIntent", entityId: intent.id, meta: { charge: RECRUNCH_CODE, simulated: true } },
      }).catch(() => {});
      return NextResponse.json({ success: true, state: "SUCCESS", simulated: true });
    }
    return NextResponse.json({ success: true, state: intent.state });
  }

  return NextResponse.json({ success: false, message: "Unknown action." }, { status: 400 });
}
