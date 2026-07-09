// ─────────────────────────────────────────────────────────────────────────────
// Repayment allocation — apply a received amount to a loan's schedule.
//
// Oldest installment first; each installment's amountPaid fills toward its
// amountDue (+ penalty). Loan.balance decrements by what was allocated; when it
// reaches zero the loan is CLEARED (clearedAt set, borrower's cleared count is
// what graduation reads). Idempotency is the CALLER's job (unique receipt ids).
// ─────────────────────────────────────────────────────────────────────────────
import { Prisma } from "@prisma/client";
import { prisma, orgTx } from "@/lib/prisma";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type AllocationResult = {
  loanId: string;
  allocated: number;
  unallocated: number; // overpayment beyond the loan balance
  newBalance: number;
  cleared: boolean;
  installmentsTouched: number;
};

/** Allocate `amount` to a loan inside one transaction. */
export async function allocateRepayment(loanId: string, amount: number, ref?: string): Promise<AllocationResult> {
  if (!(amount > 0)) throw new Error("Allocation amount must be positive.");

  return orgTx(async (tx) => {
    const loan = await tx.loan.findUnique({
      where: { id: loanId },
      include: { installments: { orderBy: { seq: "asc" } } },
    });
    if (!loan) throw new Error("Loan not found.");

    const balance = Number(loan.balance);
    let remaining = Math.min(round2(amount), balance);
    const unallocated = round2(amount - remaining);
    let touched = 0;

    for (const inst of loan.installments) {
      if (remaining <= 0) break;
      const due = round2(Number(inst.amountDue) + Number(inst.penalty) - Number(inst.amountPaid));
      if (due <= 0) continue;
      const pay = Math.min(due, remaining);
      const newPaid = round2(Number(inst.amountPaid) + pay);
      const fullyPaid = newPaid >= round2(Number(inst.amountDue) + Number(inst.penalty));
      await tx.installment.update({
        where: { id: inst.id },
        data: {
          amountPaid: new Prisma.Decimal(newPaid),
          status: fullyPaid ? "PAID" : "PARTIAL",
          paidAt: fullyPaid ? new Date() : null,
        },
      });
      remaining = round2(remaining - pay);
      touched++;
    }

    const allocated = round2(Math.min(amount, balance) - remaining);
    const newBalance = round2(balance - allocated);
    const cleared = newBalance <= 0;

    await tx.loan.update({
      where: { id: loan.id },
      data: {
        balance: new Prisma.Decimal(Math.max(0, newBalance)),
        ...(cleared ? { status: "CLEARED", clearedAt: new Date() } : {}),
      },
    });

    await tx.auditLog.create({
      data: {
        orgId: loan.orgId,
        actorType: "system",
        action: "repayment.allocate",
        entity: "Loan",
        entityId: loan.id,
        meta: { amount, allocated, unallocated, newBalance, cleared, ref: ref ?? null },
      },
    });

    return { loanId: loan.id, allocated, unallocated, newBalance: Math.max(0, newBalance), cleared, installmentsTouched: touched };
  }, { timeout: 30000, maxWait: 10000 });
}

/** Find the loan a paybill payment belongs to: by account reference (loan id
 *  prefix) first, else the payer's most recent active loan in the org. */
export async function matchLoanForPayment(orgId: string, phone: string | null, billRef: string | null): Promise<string | null> {
  const ref = (billRef ?? "").trim();
  if (ref.length >= 6) {
    const byRef = await prisma.loan.findFirst({
      where: { orgId, id: { startsWith: ref.toLowerCase() }, status: { in: ["ACTIVE", "PENDING_DISBURSEMENT"] } },
      select: { id: true },
    });
    if (byRef) return byRef.id;
  }
  if (phone) {
    const digits = phone.replace(/\D/g, "").slice(-9);
    const byPhone = await prisma.loan.findFirst({
      where: { orgId, status: "ACTIVE", borrower: { phone: { endsWith: digits } } },
      orderBy: { borrowDate: "desc" },
      select: { id: true },
    });
    if (byPhone) return byPhone.id;
  }
  return null;
}
