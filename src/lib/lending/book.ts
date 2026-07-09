// ─────────────────────────────────────────────────────────────────────────────
// Native loan booking — approval finalization for NATIVE orgs.
//
// Books the loan the way ServiceSuite's finalize stage does, but with the money
// rail queued in-platform: Loan (PENDING_DISBURSEMENT) + full installment
// schedule + a Disbursement row awaiting maker-checker. Money only moves when
// Finance actions the queue (Daraja B2C — next slice) or records a manual ref.
//
// Interest (Phase 2): FLAT — interest = principal × rate%. Reducing-balance
// products still book flat with a TODO until the reducing engine lands.
// ─────────────────────────────────────────────────────────────────────────────
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const round2 = (n: number) => Math.round(n * 100) / 100;

function stepDate(from: Date, unit: string, count: number): Date {
  const d = new Date(from);
  const u = unit.toLowerCase();
  if (u.startsWith("month")) d.setMonth(d.getMonth() + count);
  else if (u.startsWith("week")) d.setDate(d.getDate() + 7 * count);
  else d.setDate(d.getDate() + count); // day
  return d;
}

export type BookResult = {
  loanId: string;
  principal: number;
  interest: number;
  loanAmount: number;
  installments: number;
  expectedClearDate: string;
  disbursementId: string;
};

/** Book an APPROVED native application into the org's loan book (one transaction). */
export async function bookLoanFromApplication(applicationId: string, actorStaffId: string): Promise<BookResult> {
  const app = await prisma.loanApplication.findUnique({
    where: { id: applicationId },
    include: { product: true, borrower: { select: { id: true, phone: true } }, loan: { select: { id: true } } },
  });
  if (!app) throw new Error("Application not found.");
  if (app.loan) throw new Error("This application already has a loan."); // double-safe: Loan.applicationId is unique
  if (!app.product) throw new Error("Assign a product to this application before final approval.");

  const principal = Number(app.amountRequested);
  const rate = Number(app.product.interestRate);
  const count = Math.max(1, app.product.repaymentPeriod);
  const unit = app.product.repaymentPeriodUnit;
  const reducing = app.product.interestMethod === "reducing";

  const borrowDate = new Date();
  const graceDays = app.product.gracePeriodDays ?? 0;
  const scheduleStart = new Date(borrowDate.getTime() + graceDays * 86400000);

  const rows: { seq: number; dueDate: Date; amountDue: number; principalDue: number; interestDue: number }[] = [];
  let interest: number;

  if (reducing) {
    // REDUCING BALANCE: equal principal, interest on the outstanding balance.
    // The product rate is the rate for the FULL term, spread per period —
    // total interest = P × rate% × (n+1)/(2n), always ≤ the flat equivalent.
    const periodicRate = rate / 100 / count;
    const perPrincipal = round2(principal / count);
    let outstanding = principal;
    let prinAcc = 0, intAcc = 0;
    for (let i = 1; i <= count; i++) {
      const last = i === count;
      const principalDue = last ? round2(principal - prinAcc) : perPrincipal;
      const interestDue = round2(outstanding * periodicRate);
      rows.push({
        seq: i,
        dueDate: stepDate(scheduleStart, unit, i),
        amountDue: round2(principalDue + interestDue),
        principalDue,
        interestDue,
      });
      prinAcc = round2(prinAcc + principalDue);
      intAcc = round2(intAcc + interestDue);
      outstanding = round2(outstanding - principalDue);
    }
    interest = intAcc;
  } else {
    // FLAT: interest = principal × rate%, equal installments; the LAST row
    // absorbs rounding remainders so the schedule sums exactly.
    interest = round2(principal * (rate / 100));
    const total = round2(principal + interest);
    const perAmount = round2(total / count);
    const perPrincipal = round2(principal / count);
    let amtAcc = 0, prinAcc = 0;
    for (let i = 1; i <= count; i++) {
      const last = i === count;
      const amountDue = last ? round2(total - amtAcc) : perAmount;
      const principalDue = last ? round2(principal - prinAcc) : perPrincipal;
      rows.push({
        seq: i,
        dueDate: stepDate(scheduleStart, unit, i),
        amountDue,
        principalDue,
        interestDue: round2(amountDue - principalDue),
      });
      amtAcc = round2(amtAcc + amountDue);
      prinAcc = round2(prinAcc + principalDue);
    }
  }

  const loanAmount = round2(principal + interest);
  const expectedClearDate = rows[rows.length - 1].dueDate;

  const result = await prisma.$transaction(async (tx) => {
    const loan = await tx.loan.create({
      data: {
        orgId: app.orgId,
        borrowerId: app.borrowerId,
        applicationId: app.id,
        productId: app.product!.id,
        principal: new Prisma.Decimal(principal),
        interest: new Prisma.Decimal(interest),
        loanAmount: new Prisma.Decimal(loanAmount),
        balance: new Prisma.Decimal(loanAmount),
        status: "PENDING_DISBURSEMENT",
        borrowDate,
        expectedClearDate,
        createdBy: actorStaffId,
      },
    });
    await tx.installment.createMany({
      data: rows.map((r) => ({
        orgId: app.orgId,
        loanId: loan.id,
        seq: r.seq,
        dueDate: r.dueDate,
        amountDue: new Prisma.Decimal(r.amountDue),
        principalDue: new Prisma.Decimal(r.principalDue),
        interestDue: new Prisma.Decimal(r.interestDue),
      })),
    });
    const disb = await tx.disbursement.create({
      data: {
        orgId: app.orgId,
        loanId: loan.id,
        amount: new Prisma.Decimal(principal), // net-of-fees logic lands with the fee engine
        phone: app.borrower.phone,
        state: "PENDING_MAKER",
      },
    });
    await tx.loanApplication.update({
      where: { id: app.id },
      data: { status: "APPROVED", stageTitle: "Approved — pending disbursement", currentStageId: null, decidedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        orgId: app.orgId,
        actorId: actorStaffId,
        actorType: "staff",
        action: "loan.book",
        entity: "Loan",
        entityId: loan.id,
        meta: { applicationId: app.id, principal, interest, loanAmount, installments: count },
      },
    });
    return { loan, disb };
  }, { timeout: 30000, maxWait: 10000 });

  return {
    loanId: result.loan.id,
    principal,
    interest,
    loanAmount,
    installments: count,
    expectedClearDate: expectedClearDate.toISOString(),
    disbursementId: result.disb.id,
  };
}
