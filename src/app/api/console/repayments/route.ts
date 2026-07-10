// Console repayments & receipts (staff).
//   GET  → active loans (collections view) + recent receipts + STK intents,
//          with unallocated receipts flagged as the exceptions queue
//   POST → manually allocate an unallocated receipt { receiptId, loanId }
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { prisma } from "@/lib/prisma";
import { allocateRepayment } from "@/lib/lending/allocate";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "repayments.view");
  if (denied) return denied;
  const orgId = session.user.orgId;

  const [loans, receipts, intents] = await Promise.all([
    prisma.loan.findMany({
      where: { orgId, status: "ACTIVE" },
      orderBy: { borrowDate: "desc" },
      take: 100,
      include: {
        borrower: { select: { firstName: true, otherName: true, phone: true } },
        product: { select: { name: true } },
        installments: { where: { status: { in: ["UPCOMING", "DUE", "PARTIAL", "OVERDUE"] } }, orderBy: { seq: "asc" }, take: 1 },
      },
    }),
    prisma.c2BReceipt.findMany({ where: { orgId }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.paymentIntent.findMany({ where: { orgId }, orderBy: { createdAt: "desc" }, take: 30 }),
  ]);

  return NextResponse.json({
    success: true,
    loans: loans.map((l) => ({
      id: l.id,
      ref: l.id.slice(0, 8).toUpperCase(),
      borrower: `${l.borrower.firstName ?? ""} ${l.borrower.otherName ?? ""}`.trim() || l.borrower.phone,
      phone: l.borrower.phone,
      product: l.product.name,
      balance: Number(l.balance),
      nextDue: l.installments[0]
        ? { date: l.installments[0].dueDate.toISOString().slice(0, 10), amount: Math.max(0, Number(l.installments[0].amountDue) + Number(l.installments[0].penalty) - Number(l.installments[0].amountPaid)) }
        : null,
    })),
    receipts: receipts.map((r) => ({
      id: r.id, transId: r.transId, amount: Number(r.amount), phone: r.phone, billRef: r.billRef,
      allocatedLoanId: r.allocatedLoanId, createdAt: r.createdAt,
    })),
    intents: intents.map((i) => ({
      id: i.id, amount: Number(i.amount), phone: i.phone, state: i.state, resultDesc: i.resultDesc,
      mpesaReceipt: i.mpesaReceipt, createdAt: i.createdAt, loanId: i.loanId,
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "repayments.collect");
  if (denied) return denied;

  let body: { receiptId?: string; loanId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }
  if (!body.receiptId || !body.loanId) {
    return NextResponse.json({ success: false, message: "Pick the receipt and the loan." }, { status: 400 });
  }

  const receipt = await prisma.c2BReceipt.findFirst({ where: { id: body.receiptId, orgId: session.user.orgId } });
  if (!receipt) return NextResponse.json({ success: false, message: "Receipt not found." }, { status: 404 });
  if (receipt.allocatedLoanId) return NextResponse.json({ success: false, message: "Receipt is already allocated." }, { status: 409 });

  const loan = await prisma.loan.findFirst({ where: { id: body.loanId, orgId: session.user.orgId } });
  if (!loan) return NextResponse.json({ success: false, message: "Loan not found." }, { status: 404 });

  const result = await allocateRepayment(loan.id, Number(receipt.amount), `MANUAL-ALLOC:${receipt.transId}`);
  await prisma.c2BReceipt.update({
    where: { id: receipt.id },
    data: { allocatedLoanId: loan.id, allocatedAt: new Date() },
  });
  // Allocating the receipt IS the fix — close its reconciliation exception so
  // Finance's queue empties by doing the work, not by clicking "resolve" twice.
  await prisma.reconciliationException.updateMany({
    where: { orgId: session.user.orgId, kind: "C2B_UNALLOCATED", reference: receipt.id, status: "OPEN" },
    data: {
      status: "RESOLVED", resolvedAt: new Date(), resolvedBy: session.user.id ?? "staff",
      resolution: `allocated to loan ${loan.id.slice(0, 8).toUpperCase()} — KES ${Math.round(Number(receipt.amount)).toLocaleString()}`,
    },
  }).catch(() => {});
  await prisma.auditLog.create({
    data: { orgId: session.user.orgId, actorId: session.user.id, actorType: "staff", action: "receipt.allocate", entity: "C2BReceipt", entityId: receipt.id, meta: { loanId: loan.id, amount: Number(receipt.amount) } },
  }).catch(() => {});

  return NextResponse.json({ success: true, result });
}
