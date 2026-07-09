// ─────────────────────────────────────────────────────────────────────────────
// Native loan booking — approval finalization for NATIVE orgs.
//
// Books the loan the way ServiceSuite's finalize stage does, but with the money
// rail queued in-platform: Loan (PENDING_DISBURSEMENT) + full installment
// schedule + a Disbursement row awaiting maker-checker. Money only moves when
// Finance actions the queue (Daraja B2C) or records a manual ref.
//
// NOTHING BOOKS WITHOUT A SIGNED OFFER. The schedule is not recomputed from the
// product here — it is regenerated from the terms the borrower accepted, and the
// two are checked against each other. A product repriced between offer and
// approval therefore cannot change what the borrower owes. See lending/offer.ts.
// ─────────────────────────────────────────────────────────────────────────────
import { Prisma } from "@prisma/client";
import { prisma, orgTx } from "@/lib/prisma";
import { buildSchedule } from "./schedule";
import { effectiveStatus, hashTerms, termsOf } from "./offer";

export type BookResult = {
  loanId: string;
  principal: number;
  interest: number;
  loanAmount: number;
  installments: number;
  expectedClearDate: string;
  disbursementId: string;
};

/**
 * Book an ACCEPTED native application into the org's loan book (one transaction).
 *
 * Refuses without a signed offer. The schedule comes from the offer's frozen terms,
 * not from the product as it stands today, and the terms are re-hashed on the way in
 * — a booked loan therefore always matches the agreement the borrower put their
 * one-time code against.
 */
export async function bookLoanFromApplication(applicationId: string, actorStaffId: string): Promise<BookResult> {
  const app = await prisma.loanApplication.findUnique({
    where: { id: applicationId },
    include: {
      product: true,
      borrower: { select: { id: true, phone: true } },
      loan: { select: { id: true } },
      offer: true,
    },
  });
  if (!app) throw new Error("Application not found.");
  if (app.loan) throw new Error("This application already has a loan."); // double-safe: Loan.applicationId is unique
  if (!app.product) throw new Error("Assign a product to this application before final approval.");

  // ── The consent gate ────────────────────────────────────────────────────────
  const offer = app.offer;
  if (!offer) throw new Error("No offer has been made to this borrower yet.");
  const status = effectiveStatus(offer);
  if (status !== "ACCEPTED") {
    throw new Error(
      status === "EXPIRED"
        ? "The borrower's offer expired before they accepted it. Issue a new one."
        : status === "DECLINED"
          ? "The borrower declined this offer."
          : "The borrower has not accepted the offer yet.",
    );
  }

  // Terms are the offer's, never the product's — a rate edited after the offer went
  // out must not reach into a signed agreement.
  const terms = termsOf(offer);
  if (hashTerms(terms) !== offer.termsHash) {
    throw new Error("This offer's terms do not match its signature. Booking is blocked.");
  }

  const principal = terms.principal;
  const count = terms.termCount;
  const borrowDate = terms.borrowDate;

  const sched = buildSchedule({
    principal,
    rate: terms.interestRate,
    count,
    unit: terms.termUnit,
    method: terms.interestMethod,
    graceDays: terms.graceDays,
    borrowDate,
  });

  // Belt and braces: the totals we are about to write must equal the totals the
  // borrower read. If this ever fires, the schedule generator changed under a live
  // offer and we would rather fail loudly than quietly book different money.
  if (sched.interest !== terms.totalInterest || sched.loanAmount !== terms.totalRepayable) {
    throw new Error("The schedule no longer reproduces the accepted offer. Booking is blocked.");
  }

  const rows = sched.rows;
  const interest = sched.interest;
  const loanAmount = sched.loanAmount;
  const expectedClearDate = sched.expectedClearDate;

  const result = await orgTx(async (tx) => {
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
        // The signature travels with the booking record: which agreement, and how signed.
        meta: {
          applicationId: app.id, principal, interest, loanAmount, installments: count,
          offerId: offer.id, termsHash: offer.termsHash,
          acceptedVia: offer.channel, acceptedAt: offer.acceptedAt?.toISOString() ?? null,
        },
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
