// ─────────────────────────────────────────────────────────────────────────────
// ERASURE — the right to be forgotten, honoured as far as the law allows.
//
// A borrower rings up and says "delete me". What actually happens depends on
// whether they ever took money, and this file is where that is decided.
//
//   NEVER BORROWED  → HARD DELETE. A lead who filled in the funnel, a KYC
//     session that went nowhere, an application that was declined. There is no
//     financial record, so there is no legal obligation, so there is nothing to
//     weigh against their request. They go, completely — rows and bytes.
//
//   BORROWED, AND THE AML FLOOR HAS NOT EXPIRED → ANONYMISE. POCAMLA s.46 makes
//     us keep the transaction and CDD record for seven years after the
//     relationship ends. We cannot lawfully delete the loan; the DPA (s.40(2))
//     does not ask us to. What we CAN do — and what the DPA's minimisation duty
//     says we MUST do — is destroy everything about that record that identifies
//     a human being. Name, phone, ID number, email, date of birth, face, home,
//     next of kin: gone, irreversibly. What remains is a pseudonymous financial
//     ledger: this account borrowed 20,000 and repaid it. That is what the FRC
//     is entitled to see, and it is all they are entitled to see.
//
//   BORROWED, FLOOR EXPIRED → HARD DELETE. Seven years past the last cleared
//     loan, the obligation is spent and the borrower's right is unopposed.
//
// THE HONEST PART. A "delete" button that silently leaves the loan behind is a
// lie to the customer, and one that deletes the loan is a crime. So the officer
// is shown the assessment BEFORE they act — what will be destroyed, what will
// survive, and the section of the Act that says so — and the customer can be
// told the truth on the phone. `assessErasure()` is that screen's answer.
//
// It is irreversible, so it is maker-checker (a second pair of eyes, exactly as
// with a disbursement) and the reason is mandatory. Solo-operator orgs — one
// active staff member — may approve their own, because a one-man lender who
// cannot honour a DPA request has a worse problem than the one this rule solves.
// ─────────────────────────────────────────────────────────────────────────────
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { deleteObjects, KYC_BUCKET, DOCS_BUCKET } from "@/lib/storage/provider";
import { AML_FLOOR_DAYS } from "./retention";

const DAY_MS = 86_400_000;

export type ErasureMode = "HARD_DELETE" | "ANONYMISE";

export type ErasureAssessment = {
  borrowerId: string;
  mode: ErasureMode;
  /** Plain English, for the officer to read to the customer. */
  summary: string;
  /** What will be destroyed. */
  destroys: string[];
  /** What the law makes us keep, each with the reason. Empty for a hard delete. */
  retains: { what: string; count: number; basis: string }[];
  /** When the AML floor lifts and a hard delete becomes possible. Null when it already is. */
  floorLiftsAt: Date | null;
  /** Already erased — the register should say so rather than offer the button again. */
  alreadyErased: boolean;
};

/** A masked handle that survives erasure, for the register: "2547••••1234". */
export function maskPhone(phone: string | null | undefined): string {
  const p = (phone ?? "").replace(/\D/g, "");
  if (p.length < 6) return "••••";
  return `${p.slice(0, 4)}••••${p.slice(-4)}`;
}

/**
 * What erasing this person would actually do — computed, never guessed. Read-only:
 * this is the sentence the officer reads out before anyone presses anything.
 */
export async function assessErasure(orgId: string, borrowerId: string): Promise<ErasureAssessment | null> {
  const borrower = await prisma.borrower.findFirst({
    where: { id: borrowerId, orgId },
    select: { id: true, phone: true, erasedAt: true },
  });
  if (!borrower) return null;

  const loans = await prisma.loan.findMany({
    where: { orgId, borrowerId },
    select: { id: true, status: true, clearedAt: true, createdAt: true },
  });
  const loanIds = loans.map((l) => l.id);

  // Receipts and STK intents carry the PAYER's phone (and, in the raw Daraja
  // callback, their names) but have no borrowerId — they reach the person only
  // through the loan they were allocated to. Miss this join and a "deleted"
  // customer's number is still sitting in the receipts table.
  const [receipts, disbursements, kycChecks, consents] = await Promise.all([
    loanIds.length ? prisma.c2BReceipt.count({ where: { orgId, allocatedLoanId: { in: loanIds } } }) : Promise.resolve(0),
    loanIds.length ? prisma.disbursement.count({ where: { orgId, loanId: { in: loanIds } } }) : Promise.resolve(0),
    prisma.kycCheck.count({ where: { orgId, borrowerId } }),
    prisma.consent.count({ where: { orgId, borrowerId } }),
  ]);

  const hasMoney = loans.length > 0 || receipts > 0 || disbursements > 0;

  // When did the business relationship END? The seven years run from the last
  // loan closing — and a loan still ACTIVE has not ended at all, so the floor
  // cannot even start counting. An open loan is never erasable to zero.
  const openLoan = loans.some((l) => l.status === "ACTIVE" || l.status === "PENDING_DISBURSEMENT");
  const lastEnded = loans.reduce<Date | null>((acc, l) => {
    const ended = l.clearedAt ?? null;
    if (!ended) return acc;
    return !acc || ended > acc ? ended : acc;
  }, null);

  let floorLiftsAt: Date | null = null;
  if (hasMoney) {
    if (openLoan || !lastEnded) {
      floorLiftsAt = null; // the relationship is live; there is no clock yet
    } else {
      floorLiftsAt = new Date(lastEnded.getTime() + AML_FLOOR_DAYS * DAY_MS);
    }
  }

  const floorExpired = hasMoney && !openLoan && !!floorLiftsAt && floorLiftsAt <= new Date();
  const mode: ErasureMode = !hasMoney || floorExpired ? "HARD_DELETE" : "ANONYMISE";

  const destroys = [
    "Name, phone number, national ID number, email and date of birth",
    "ID photographs, selfie and portrait — every image we hold of them",
    "Home and business location pins",
    "Next of kin",
    "Registry (IPRS/CRB) lookup payloads",
    "Uploaded statements and documents",
  ];

  if (mode === "HARD_DELETE") {
    return {
      borrowerId,
      mode,
      summary: hasMoney
        ? "Every record of this customer will be permanently deleted. Their last loan closed more than seven years ago, so the anti-money-laundering retention period has expired and nothing stands in the way of their request."
        : "Every record of this customer will be permanently deleted. They never took a loan, so there is no financial record we are obliged to keep.",
      destroys: [...destroys, "Their loan applications and score history", "The customer record itself"],
      retains: [],
      floorLiftsAt: null,
      alreadyErased: !!borrower.erasedAt,
    };
  }

  const retains: { what: string; count: number; basis: string }[] = [
    {
      what: "Loans, repayment schedules and receipts — with no name attached to them",
      count: loans.length,
      basis: "POCAMLA s.46 — financial records must be kept seven years after the relationship ends.",
    },
    {
      what: "The verification OUTCOME (identity checked, passed, when, by which provider) — but not the identity itself",
      count: kycChecks,
      basis: "POCAMLA s.46 — the customer due diligence file. The evidence that we checked, not a copy of who we checked.",
    },
    {
      what: "The consent record",
      count: consents,
      basis: "DPA s.30 — the proof that they consented is the one thing we cannot destroy at their request without destroying our own defence.",
    },
    {
      what: "The audit trail of this erasure",
      count: 1,
      basis: "The record that the request was made and honoured — including this assessment.",
    },
  ];

  return {
    borrowerId,
    mode,
    summary: openLoan
      ? "This customer has a loan that is still open, so the business relationship has not ended and the seven-year retention period has not begun. Everything that identifies them will be destroyed now; the loan itself survives as an anonymous account, and can only be deleted seven years after it closes."
      : `This customer has borrowed from you, so the law requires the financial record to be kept for seven years after their last loan closed${
          floorLiftsAt ? ` — until ${floorLiftsAt.toISOString().slice(0, 10)}` : ""
        }. Everything that identifies them will be destroyed now. What survives is an anonymous ledger: an account that borrowed and repaid, with no person attached.`,
    destroys,
    retains,
    floorLiftsAt,
    alreadyErased: !!borrower.erasedAt,
  };
}

export type ErasureOutcome = {
  mode: ErasureMode;
  objectsDeleted: number;
  rowsDeleted: Record<string, number>;
  rowsAnonymised: Record<string, number>;
  retained: { what: string; count: number; basis: string }[];
  executedAt: string;
};

/**
 * Do it. Assesses again from live data at the moment of execution — an approval
 * granted yesterday must not carry out a plan that was true yesterday (a loan may
 * have been booked since, which changes a hard delete into an anonymisation).
 *
 * ORDER MATTERS. Bytes first, rows second: if the transaction rolls back after
 * the objects are gone we have a row pointing at nothing, which is recoverable
 * noise. The reverse — rows gone, bytes still sitting in a bucket — is a national
 * ID photograph that nothing in the system knows about any more, and therefore
 * nothing will ever delete. That is the failure mode worth engineering against.
 */
export async function eraseBorrower(orgId: string, borrowerId: string): Promise<ErasureOutcome> {
  const assessment = await assessErasure(orgId, borrowerId);
  if (!assessment) throw new Error("Borrower not found.");

  // ── 1. The bytes. ──────────────────────────────────────────────────────────
  const [borrower, sessions, documents] = await Promise.all([
    prisma.borrower.findFirstOrThrow({
      where: { id: borrowerId, orgId },
      select: { id: true, phone: true, portraitKey: true, selfieKey: true, idFrontKey: true, idBackKey: true },
    }),
    prisma.kycSession.findMany({ where: { orgId, borrowerId }, select: { id: true, idFrontKey: true, idBackKey: true, selfieKey: true, portraitKey: true } }),
    prisma.document.findMany({ where: { orgId, borrowerId }, select: { id: true, storageKey: true } }),
  ]);

  const kycKeys = [
    borrower.portraitKey, borrower.selfieKey, borrower.idFrontKey, borrower.idBackKey,
    ...sessions.flatMap((s) => [s.idFrontKey, s.idBackKey, s.selfieKey, s.portraitKey]),
  ].filter((k): k is string => !!k);
  const docKeys = documents.map((d) => d.storageKey).filter(Boolean);

  const objectsDeleted =
    (await deleteObjects(kycKeys, KYC_BUCKET)) + (await deleteObjects(docKeys, DOCS_BUCKET));

  const rowsDeleted: Record<string, number> = {};
  const rowsAnonymised: Record<string, number> = {};

  // ── 2. The rows. ───────────────────────────────────────────────────────────
  await prisma.$transaction(async (tx) => {
    // Common to both modes: the personal data that no law asks us to keep.
    rowsDeleted.geoPins = (await tx.geoPin.deleteMany({ where: { orgId, borrowerId } })).count;
    rowsDeleted.documents = (await tx.document.deleteMany({ where: { orgId, borrowerId } })).count;
    rowsDeleted.kycSessions = (await tx.kycSession.deleteMany({ where: { orgId, borrowerId } })).count;
    rowsDeleted.fieldVisits = (await tx.fieldVisit.deleteMany({ where: { orgId, borrowerId } })).count;

    const loanIds = (await tx.loan.findMany({ where: { orgId, borrowerId }, select: { id: true } })).map((l) => l.id);

    if (assessment.mode === "HARD_DELETE") {
      // Nothing is owed to anyone. Take it all, children first.
      rowsDeleted.kycChecks = (await tx.kycCheck.deleteMany({ where: { orgId, borrowerId } })).count;
      rowsDeleted.consents = (await tx.consent.deleteMany({ where: { orgId, borrowerId } })).count;
      rowsDeleted.scoreSnapshots = (await tx.scoreSnapshot.deleteMany({ where: { orgId, borrowerId } })).count;
      rowsDeleted.offers = (await tx.loanOffer.deleteMany({ where: { orgId, borrowerId } })).count;
      rowsDeleted.guarantors = (await tx.guarantor.deleteMany({ where: { orgId, borrowerId } })).count;
      rowsDeleted.collateral = (await tx.collateral.deleteMany({ where: { orgId, borrowerId } })).count;
      rowsDeleted.promises = (await tx.promiseToPay.deleteMany({ where: { orgId, borrowerId } })).count;
      rowsDeleted.calls = (await tx.collectionCall.deleteMany({ where: { orgId, borrowerId } })).count;
      rowsDeleted.tickets = (await tx.collectionTicket.deleteMany({ where: { orgId, borrowerId } })).count;

      // A floor-expired borrower may still have ancient loans. They are older than
      // seven years and the obligation is spent, so they go with everything else.
      if (loanIds.length) {
        await tx.installment.deleteMany({ where: { loanId: { in: loanIds } } });
        await tx.disbursement.deleteMany({ where: { loanId: { in: loanIds } } });
        rowsDeleted.receipts = (await tx.c2BReceipt.deleteMany({ where: { orgId, allocatedLoanId: { in: loanIds } } })).count;
        rowsDeleted.paymentIntents = (await tx.paymentIntent.deleteMany({ where: { orgId, loanId: { in: loanIds } } })).count;
        rowsDeleted.loans = (await tx.loan.deleteMany({ where: { id: { in: loanIds } } })).count;
      }
      rowsDeleted.applications = (await tx.loanApplication.deleteMany({ where: { orgId, borrowerId } })).count;
      rowsDeleted.borrower = (await tx.borrower.deleteMany({ where: { id: borrowerId, orgId } })).count;
      return;
    }

    // ANONYMISE. The financial record stays; the person is taken out of it.
    //
    // The registry payload is the sharp edge: KycCheck.payload holds IPRS's full
    // copy of the human. The row must survive (it is the CDD evidence) so we keep
    // passed/score/provider/when and null the body.
    rowsAnonymised.kycChecks = (
      await tx.kycCheck.updateMany({ where: { orgId, borrowerId }, data: { payload: Prisma.DbNull } })
    ).count;
    // The consent row proves consent was given; the IP address it was given from
    // is a personal identifier we no longer need to hold.
    rowsAnonymised.consents = (await tx.consent.updateMany({ where: { orgId, borrowerId }, data: { ip: null } })).count;

    // THE MONEY RECORD SURVIVES; THE PAYER DOES NOT. The amount, the date and the
    // M-Pesa transaction ID are the transaction record POCAMLA wants. The payer's
    // phone number and Daraja's raw callback — which carries their first, middle
    // and last names — are a copy of the person sitting inside it, and they go.
    if (loanIds.length) {
      rowsAnonymised.receipts = (
        await tx.c2BReceipt.updateMany({
          where: { orgId, allocatedLoanId: { in: loanIds } },
          data: { phone: null, raw: Prisma.DbNull },
        })
      ).count;
      rowsAnonymised.paymentIntents = (
        await tx.paymentIntent.updateMany({
          where: { orgId, loanId: { in: loanIds } },
          data: { phone: "", raw: Prisma.DbNull },
        })
      ).count;
      // The disbursement says where the money WENT: the payee's phone, their name,
      // and the raw B2C result. The amount and the state are the record; the person
      // on the other end of it is not.
      rowsAnonymised.disbursements = (
        await tx.disbursement.updateMany({
          where: { orgId, loanId: { in: loanIds } },
          data: { phone: "", payeeName: null, payeePaybill: null, payeeAccount: null, raw: Prisma.DbNull },
        })
      ).count;
    }

    // THE APPLICATION ROW IS A SECOND COPY OF THE PERSON, and it is the one that is
    // easy to miss: the funnel denormalises phone, national ID, name, device and
    // location onto every LoanApplication so that a decision can be reconstructed
    // exactly as it was made. Those rows survive an anonymisation (they are the
    // lending record), so each of those columns has to be taken out by hand. The
    // amount, score, decision and reason codes stay — that IS the lending record.
    rowsAnonymised.applications = (
      await tx.loanApplication.updateMany({
        where: { orgId, borrowerId },
        data: {
          phone: null, nationalId: null, borrowerName: null, hubUserId: null,
          deviceFingerprint: null, consent: Prisma.DbNull,
          payeeName: null, payeePaybill: null, payeeAccount: null,
          lat: null, lng: null, locationType: null, locationAddress: null,
        },
      })
    ).count;
    // An offer carries the IP and user-agent of the device that accepted it —
    // evidence of consent to the terms, which the signed termsHash already proves.
    rowsAnonymised.offers = (
      await tx.loanOffer.updateMany({
        where: { orgId, borrowerId },
        data: { acceptedIp: null, acceptedUserAgent: null },
      })
    ).count;
    // Collections notes are free text an officer typed about a named human being.
    // No law requires them and they cannot be redacted field-by-field, so they go.
    rowsDeleted.calls = (await tx.collectionCall.deleteMany({ where: { orgId, borrowerId } })).count;
    rowsDeleted.tickets = (await tx.collectionTicket.deleteMany({ where: { orgId, borrowerId } })).count;
    rowsDeleted.promises = (await tx.promiseToPay.deleteMany({ where: { orgId, borrowerId } })).count;
    // Guarantors are THIRD parties whose names, phones and IDs we hold only because
    // of this borrower. Their basis dies with the relationship.
    rowsDeleted.guarantors = (await tx.guarantor.deleteMany({ where: { orgId, borrowerId } })).count;

    // The phone is UNIQUE per org, so it cannot simply be nulled — and it must not
    // remain reachable. A tombstone keeps the constraint meaningful while being an
    // unusable msisdn: no SMS will ever be sent to it and no lookup will match it.
    const tombstone = `erased:${borrowerId.slice(0, 8)}:${Date.now().toString(36)}`;
    rowsAnonymised.borrower = (
      await tx.borrower.updateMany({
        where: { id: borrowerId, orgId },
        data: {
          phone: tombstone,
          firstName: null, otherName: null, email: null, nationalId: null, dob: null, gender: null,
          nextOfKin: Prisma.DbNull,
          portraitKey: null, selfieKey: null, idFrontKey: null, idBackKey: null,
          lat: null, lng: null, locationType: null, locationAddress: null,
          homeLat: null, homeLng: null, homeAddress: null, geoConsentAt: null,
          hubUserId: null, deviceFingerprint: null,
          erasedAt: new Date(),
        },
      })
    ).count;
  }, { timeout: 30_000 });

  return {
    mode: assessment.mode,
    objectsDeleted,
    rowsDeleted,
    rowsAnonymised,
    retained: assessment.retains,
    executedAt: new Date().toISOString(),
  };
}
