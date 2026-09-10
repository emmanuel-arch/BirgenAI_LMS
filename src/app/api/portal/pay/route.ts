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
import { micromartAccount, micromartRepay } from "@/lib/portal/micromart-account";
import { explainAllocation, isPayPurpose, type PayPurpose } from "@/lib/portal/pay-purpose";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { lenderSlug?: string; nationalId?: string; amount?: number; purpose?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  // ── THE STATED PURPOSE ────────────────────────────────────────────────────
  // What the customer believed they were paying for. It does NOT route the
  // money — the lender's own RepaymentTrigger decides that, and no endpoint on
  // their side accepts a destination. See lib/portal/pay-purpose.ts for the
  // rule and for why pretending otherwise would be the worst thing this
  // feature could do.
  //
  // It is captured because it is the first question asked in any dispute, and
  // because it is what makes the confirmation honest: the response says where
  // the money will actually land, derived from the trigger's own logic.
  //
  // An unrecognised value falls back to "repayment" rather than 400ing. This is
  // a money screen: a client that sends a purpose we have not shipped yet
  // should still be able to take the payment.
  const purpose: PayPurpose = isPayPurpose(body.purpose) ? body.purpose : "repayment";

  const nationalId = (body.nationalId ?? "").trim();
  if (!nationalId) {
    return NextResponse.json({ success: false, message: "Enter your national ID." }, { status: 400 });
  }

  const org = await resolveOrg(body.lenderSlug ?? "");
  // Bind the RLS tenant in OUR async context (enterWith does not escape a callee).
  if (org) enterOrg(org.id);
  if (!org) return NextResponse.json({ success: false, message: "Choose a lender." }, { status: 400 });

  const verified = await borrowerFor(org.id);
  if (!verified) return otpRequired();
  const phone = verified.phone;

  const limited = await rateLimit([
    { name: "pay:phone", subject: `${org.id}:${phone}`, max: 5, windowSec: 600 },
    { name: "pay:ip", subject: clientIp(req), max: 30, windowSec: 3600 },
  ]);
  if (limited) return limited;

  // ── THE BRIDGED ROAD ──────────────────────────────────────────────────────
  // This route used to refuse every non-native org outright — "Pay-now is
  // available for this lender via their own channels" — which for Micromart
  // meant the Repay screen could never take a shilling, because the money has to
  // land in THEIR book and our M-Pesa integration pays into ours.
  //
  // Their own Repayment endpoint raises the prompt on their paybill, against
  // their book, and their existing app has used it in production for years. It
  // is shadow-gated behind MICROMART_PAY_ENABLED — a SEPARATE switch from the
  // application one, because filing a form and pulling money off somebody's
  // phone have very different blast radii.
  if (org.mode !== "NATIVE") {
    if (!verified.ssToken || !verified.ssEntityId) {
      return NextResponse.json(
        { success: false, message: "Sign in with your Micromart password to pay from the app." },
        { status: 400 },
      );
    }
    const amount = Math.round(Number(body.amount));
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ success: false, message: "Enter how much you want to pay." }, { status: 400 });
    }

    // Their current balance, so the confirmation can state where this payment
    // will actually land. Read before the prompt goes out, because afterwards
    // is too late to tell somebody their "savings" cleared a loan.
    //
    // Best-effort: a failed read costs the customer the split, not the payment.
    // `null` and `0` are kept apart — 0 means "you owe nothing", null means "we
    // could not ask", and only the first is safe to describe.
    const acct = await micromartAccount(verified.ssToken);
    const outstanding = acct.ok ? acct.account.outstanding : null;
    const allocation = outstanding == null ? null : explainAllocation(purpose, amount, outstanding);

    const r = await micromartRepay({
      token: verified.ssToken,
      amount,
      // The phone the SESSION proved, never one from the body — otherwise this
      // endpoint raises M-Pesa prompts on numbers the caller does not own.
      phone,
      entityId: verified.ssEntityId,
    });

    if (r.kind === "pushed") {
      // The stated purpose, filed against the customer. Not for routing — for
      // the conversation that happens if the allocation is ever questioned.
      await prisma.auditLog.create({
        data: {
          orgId: org.id,
          actorId: String(verified.ssBorrowerId ?? ""),
          actorType: "borrower",
          action: "portal.pay.stk",
          ip: clientIp(req),
          meta: {
            purpose,
            amount,
            entityId: verified.ssEntityId,
            outstandingAtRequest: outstanding,
            predicted: allocation ? { toLoan: allocation.toLoan, toSavings: allocation.toSavings } : null,
          },
        },
      }).catch(() => {});

      return NextResponse.json({
        success: true,
        amount,
        purpose,
        message: r.message,
        pushed: true,
        // Where the lender's own trigger will put it. Null when the balance
        // could not be read — the screen then says only that the prompt is on
        // its way, which is the honest reduced statement.
        allocation,
      });
    }
    if (r.kind === "shadowed") {
      // Reported as a REFUSAL, not as a success. A customer told "check your
      // phone" who then gets no prompt is worse off than one told plainly that
      // the channel is not switched on yet.
      return NextResponse.json(
        {
          success: false,
          shadowed: true,
          message: "Paying from the app is not switched on for this lender yet. Use M-PESA paybill for now.",
        },
        { status: 503 },
      );
    }
    if (r.kind === "refused") {
      return NextResponse.json({ success: false, message: r.message }, { status: 400 });
    }
    return NextResponse.json(
      { success: false, message: "We could not reach your lender to raise the prompt. Please try again in a moment." },
      { status: 503 },
    );
  }

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
