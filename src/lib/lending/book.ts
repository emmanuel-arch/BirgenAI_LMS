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
import { standsBehind, effectiveGuarantorStatus } from "./guarantor";
import { checkSecurity } from "./security";

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
      guarantors: true,
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

  // ── The guarantee gate ──────────────────────────────────────────────────────
  // `guarantorRequired` has been a decorative boolean until now. A guarantor's
  // consent counts only if it is bound to THIS agreement: re-issue the offer on
  // different terms and the guarantee goes stale, because standing behind KES 10,000
  // is not standing behind KES 50,000.
  if (app.product.guarantorRequired) {
    const standing = app.guarantors.filter((g) => standsBehind(g, offer.termsHash));
    if (standing.length === 0) {
      // The officer has to know which of four different problems they have.
      const states = app.guarantors.map(effectiveGuarantorStatus);
      const waiting = states.filter((s) => s === "INVITED").length;
      const stale = states.includes("CONSENTED"); // consented, but to other terms
      const declined = states.filter((s) => s === "DECLINED").length;
      const expired = states.filter((s) => s === "EXPIRED").length;

      throw new Error(
        stale
          ? "The guarantor agreed to different terms. The offer changed since — ask them again."
          : waiting > 0
            ? `This product needs a guarantor, and ${waiting === 1 ? "the one asked has" : `the ${waiting} asked have`} not consented yet.`
            : declined > 0
              ? `This product needs a guarantor. ${declined === 1 ? "The person asked declined" : `All ${declined} people asked declined`} — ask someone else.`
              : expired > 0
                ? "The guarantor never answered and the invitation has expired. Ask again."
                : "This product needs a guarantor, and none has been asked.",
      );
    }
  }

  // ── The security gate ───────────────────────────────────────────────────────
  // Only VERIFIED collateral counts. A borrower's own word about what they own is a
  // claim, not a valuation.
  const security = await checkSecurity(app.id, Number(app.amountRequested), app.product);
  if (!security.ok) throw new Error(security.shortfall ?? "This product requires security.");

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
    // Security follows the loan it secures, so a Finance officer can find it later
    // without walking back through the application.
    await tx.collateral.updateMany({ where: { applicationId: app.id }, data: { loanId: loan.id } });
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
          // Who stood behind it, and what secured it, at the moment it was written.
          guarantors: app.guarantors.filter((g) => standsBehind(g, offer.termsHash)).map((g) => ({ id: g.id, name: g.fullName, phone: g.phone })),
          securedValueKes: security.verifiedValue,
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
