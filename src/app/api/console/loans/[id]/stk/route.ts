// POST /api/console/loans/[id]/stk — staff-initiated STK push for a repayment.
// Body: { amount? } — defaults to the next unpaid installment's outstanding due.
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { prisma } from "@/lib/prisma";
import { initiateStkPush } from "@/lib/mpesa/daraja";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "repayments.collect");
  if (denied) return denied;
  const { id } = await ctx.params;

  let body: { amount?: number };
  try { body = await req.json(); } catch { body = {}; }

  const loan = await prisma.loan.findFirst({
    where: { id, orgId: session.user.orgId, status: "ACTIVE" },
    include: {
      borrower: { select: { phone: true } },
      installments: { where: { status: { in: ["UPCOMING", "DUE", "PARTIAL", "OVERDUE"] } }, orderBy: { seq: "asc" }, take: 1 },
    },
  });
  if (!loan) return NextResponse.json({ success: false, message: "Active loan not found." }, { status: 404 });

  const org = await prisma.org.findUnique({ where: { id: loan.orgId }, select: { slug: true } });
  const next = loan.installments[0];
  const fallback = next ? Number(next.amountDue) + Number(next.penalty) - Number(next.amountPaid) : Number(loan.balance);
  const amount = Number.isFinite(Number(body.amount)) && Number(body.amount)! > 0 ? Number(body.amount) : Math.max(1, fallback);

  const res = await initiateStkPush(loan.orgId, org!.slug, {
    phone: loan.borrower.phone,
    amount,
    accountReference: loan.id.slice(0, 8).toUpperCase(),
  });

  const intent = await prisma.paymentIntent.create({
    data: {
      orgId: loan.orgId,
      loanId: loan.id,
      phone: loan.borrower.phone,
      amount: new Prisma.Decimal(amount),
      checkoutRequestId: res.checkoutRequestId || null,
      merchantRequestId: res.merchantRequestId || null,
      state: res.ok ? "PENDING" : "FAILED",
      resultDesc: res.ok ? null : res.message,
      raw: (res.raw ?? {}) as Prisma.InputJsonValue,
    },
  });

  if (!res.ok) return NextResponse.json({ success: false, message: res.message, intentId: intent.id }, { status: 400 });
  return NextResponse.json({ success: true, message: res.message, intentId: intent.id });
}
