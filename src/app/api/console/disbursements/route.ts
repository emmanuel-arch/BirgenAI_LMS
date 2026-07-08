// GET /api/console/disbursements — the org's disbursement queue + float balance.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { floatBalance } from "@/lib/lending/float";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });

  const [rows, balance] = await Promise.all([
    prisma.disbursement.findMany({
      where: { orgId: session.user.orgId },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        loan: {
          select: {
            id: true, principal: true, loanAmount: true, status: true,
            borrower: { select: { firstName: true, otherName: true, phone: true } },
            product: { select: { name: true, disbursementMode: true } },
          },
        },
      },
    }),
    floatBalance(session.user.orgId),
  ]);

  return NextResponse.json({
    success: true,
    floatBalance: balance,
    disbursements: rows.map((d) => ({
      id: d.id,
      state: d.state,
      amount: Number(d.amount),
      phone: d.phone,
      makerId: d.makerId,
      checkerId: d.checkerId,
      receiptRef: d.receiptRef,
      failReason: d.failReason,
      createdAt: d.createdAt,
      loanId: d.loanId,
      loanStatus: d.loan.status,
      borrower: `${d.loan.borrower.firstName ?? ""} ${d.loan.borrower.otherName ?? ""}`.trim() || d.loan.borrower.phone,
      product: d.loan.product.name,
      mode: d.loan.product.disbursementMode,
    })),
  });
}
