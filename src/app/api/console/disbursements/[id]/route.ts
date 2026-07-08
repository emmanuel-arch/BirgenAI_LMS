// POST /api/console/disbursements/[id] — maker-checker actions on the queue.
// Body: { action: "submit" | "approve" | "manual" | "retry", ref? , note? }
//
//   submit  (maker, Initiator/Authorizer) PENDING_MAKER → PENDING_CHECKER
//   approve (checker, Validator, ≠maker)  PENDING_CHECKER → B2C send (vault creds)
//   manual  (checker, Validator, ≠maker)  PENDING_CHECKER → MANUAL_CONFIRMED with
//           the M-Pesa/bank ref of a payment made outside the platform
//   retry   (Validator) FAILED → PENDING_CHECKER
//
// Solo-operator mode: when the org has exactly one active staff member, the
// same person may be maker and checker (still audit-logged as both).
// Float: debited on confirmation (B2C result webhook, or manual confirm here).
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { initiateB2C } from "@/lib/mpesa/daraja";
import { addFloatEntry, floatBalance } from "@/lib/lending/float";
import { sendSms } from "@/lib/sms/send";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const { id } = await ctx.params;

  let body: { action?: string; ref?: string; note?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const disb = await prisma.disbursement.findFirst({
    where: { id, orgId: session.user.orgId },
    include: {
      loan: { select: { id: true, expectedClearDate: true, borrowerId: true } },
      // org fields for gating + slug for callback registration
    },
  });
  if (!disb) return NextResponse.json({ success: false, message: "Disbursement not found." }, { status: 404 });

  const org = await prisma.org.findUnique({ where: { id: disb.orgId }, select: { slug: true, name: true, status: true } });
  if (!org) return NextResponse.json({ success: false, message: "Org missing." }, { status: 500 });

  const tiers = session.user.tiers ?? { initiator: false, authorizer: false, validator: false };
  const staffCount = await prisma.staffUser.count({ where: { orgId: disb.orgId, status: "ACTIVE" } });
  const solo = staffCount <= 1;

  const audit = (action: string, meta: Record<string, unknown>) =>
    prisma.auditLog.create({
      data: { orgId: disb.orgId, actorId: session.user!.id, actorType: "staff", action, entity: "Disbursement", entityId: disb.id, meta: meta as Prisma.InputJsonValue },
    }).catch(() => {});

  // ── submit (maker) ───────────────────────────────────────────────────────────
  if (body.action === "submit") {
    if (!tiers.initiator && !tiers.authorizer) {
      return NextResponse.json({ success: false, message: "Submitting requires the Initiator/Authorizer tier." }, { status: 403 });
    }
    if (disb.state !== "PENDING_MAKER") {
      return NextResponse.json({ success: false, message: `Cannot submit from ${disb.state}.` }, { status: 409 });
    }
    await prisma.disbursement.update({ where: { id: disb.id }, data: { state: "PENDING_CHECKER", makerId: session.user.id } });
    await audit("disbursement.submit", { note: body.note ?? null });
    return NextResponse.json({ success: true, state: "PENDING_CHECKER" });
  }

  // ── checker actions ──────────────────────────────────────────────────────────
  const checkerActions = ["approve", "manual", "retry"];
  if (!checkerActions.includes(body.action ?? "")) {
    return NextResponse.json({ success: false, message: "Unknown action." }, { status: 400 });
  }
  if (!tiers.validator) {
    return NextResponse.json({ success: false, message: "Checker actions require the Validator tier." }, { status: 403 });
  }
  if (org.status !== "ACTIVE") {
    return NextResponse.json({ success: false, message: "Money movement is disabled until BirgenAI activates the organization." }, { status: 403 });
  }

  if (body.action === "retry") {
    if (disb.state !== "FAILED") return NextResponse.json({ success: false, message: "Only FAILED disbursements can be retried." }, { status: 409 });
    await prisma.disbursement.update({ where: { id: disb.id }, data: { state: "PENDING_CHECKER", failReason: null } });
    await audit("disbursement.retry", {});
    return NextResponse.json({ success: true, state: "PENDING_CHECKER" });
  }

  if (disb.state !== "PENDING_CHECKER") {
    return NextResponse.json({ success: false, message: `Cannot action from ${disb.state}.` }, { status: 409 });
  }
  if (!solo && disb.makerId === session.user.id) {
    return NextResponse.json({ success: false, message: "Maker and checker must be different people." }, { status: 403 });
  }

  const amount = Number(disb.amount);
  const balance = await floatBalance(disb.orgId);
  if (balance < amount) {
    return NextResponse.json({ success: false, message: `Insufficient float (KES ${balance.toLocaleString()} available, KES ${amount.toLocaleString()} needed). Top up first.` }, { status: 400 });
  }

  // manual: money moved outside the platform — record the ref, activate the loan.
  if (body.action === "manual") {
    const ref = (body.ref ?? "").trim();
    if (ref.length < 6) return NextResponse.json({ success: false, message: "Enter the M-Pesa/bank reference of the payment." }, { status: 400 });
    await prisma.$transaction(async (tx) => {
      await tx.disbursement.update({
        where: { id: disb.id },
        data: { state: "MANUAL_CONFIRMED", checkerId: session.user!.id, receiptRef: ref },
      });
      await tx.loan.update({ where: { id: disb.loanId }, data: { status: "ACTIVE", disbursedAt: new Date() } });
    }, { timeout: 30000, maxWait: 10000 });
    await addFloatEntry(disb.orgId, "DISBURSE", -amount, { ref, note: `Manual · loan ${disb.loanId.slice(0, 8)}`, createdBy: session.user.id });
    await audit("disbursement.manual-confirm", { ref });
    await sendSms(disb.orgId, disb.phone, "disbursed", {
      org: org.name,
      amount: Math.round(amount).toLocaleString(),
      phone: disb.phone,
      due: disb.loan.expectedClearDate ? disb.loan.expectedClearDate.toISOString().slice(0, 10) : "",
      ref: disb.loanId.slice(0, 8).toUpperCase(),
    });
    return NextResponse.json({ success: true, state: "MANUAL_CONFIRMED" });
  }

  // approve: execute B2C with the org's vault credentials.
  const res = await initiateB2C(disb.orgId, org.slug, { phone: disb.phone, amount, remarks: "Loan disbursement" });
  if (!res.ok) {
    await audit("disbursement.b2c-reject", { message: res.message });
    return NextResponse.json({ success: false, message: res.message }, { status: 400 });
  }
  await prisma.disbursement.update({
    where: { id: disb.id },
    data: { state: "SENT", checkerId: session.user.id, b2cRef: res.conversationId, raw: (res.raw ?? {}) as Prisma.InputJsonValue },
  });
  await audit("disbursement.b2c-sent", { conversationId: res.conversationId });
  return NextResponse.json({ success: true, state: "SENT", message: res.message });
}
