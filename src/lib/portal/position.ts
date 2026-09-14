// ─────────────────────────────────────────────────────────────────────────────
// THE CUSTOMER'S POSITION — everything Home shows, and everything Riri may say.
//
// Moved here out of /api/portal/home, verbatim in behaviour, for one reason: the
// customer's Riri reads the SAME record the Home screen renders. If the two read
// it separately they will one day disagree — Home says KSh 12,400 and Riri says
// KSh 12,000 because one of them rounded, or cached, or read the API fallback
// while the other read SQL — and a customer who is told two different balances
// by one app believes neither. One function, one truth, two readers.
//
// ── WHY ONE READ AND NOT FOUR ───────────────────────────────────────────────
// Home asks four questions: what can I borrow, what do I owe, has anyone told me
// anything, and is anything of mine in flight. Answering them from four routes
// means four round trips on the screen the app is judged on in the first four
// seconds. It also means four independent failures; composing them here lets one
// weak answer degrade a section instead of the screen.
//
// ── WHERE THE MONEY COMES FROM ──────────────────────────────────────────────
// NATIVE org → our own Loan/Installment tables.
// BRIDGED org (Micromart) → THEIR book, read over keyed SQL through the relay —
// the same road the console's Customer-360 uses — with their public API as the
// fallback for a password session whose SQL read failed. See
// lib/portal/micromart-book.ts for why the API alone excluded every customer who
// came in by SMS code.
//
// ── `CreditScore` IS NOT A CREDIT SCORE ─────────────────────────────────────
// Their AccountPreview `CreditScore: 30000` is AVERAGE DAILY SALES in shillings.
// It is carried as `avgDailySales`, which is what it is. The headline score is
// OURS (out of 900) or absent.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";
import type { ResolvedOrg } from "@/lib/tenancy";
import type { BorrowerSession } from "./session";
import { micromartAccount, micromartLoans } from "./micromart-account";
import { micromartSavings, micromartScore, type PortalScore, type SavingsPosition } from "./micromart-standing";
import { findBookBorrower, readBookPosition, type BookPosition } from "./micromart-book";

/** Enough to fill the "what is next" panel without becoming a statement. */
const SCHEDULE_ROWS = 6;

export type CustomerPosition = {
  /** Erased under the Data Protection Act. Nothing else in the object is meaningful. */
  erased: boolean;
  found: boolean;
  lender: string;
  firstName: string | null;
  kycStatus: string;
  /** Our Borrower row id, when there is one. Server-side only — never sent to a client by Riri. */
  borrowerId: string | null;
  bookSource: "native" | "lender" | "onboarding" | "unavailable";
  bookIssue: "unreachable" | "ambiguous" | "mismatch" | null;
  limit: number;
  outstanding: number;
  available: number;
  loanCount: number;
  activeLoan: {
    ref: string; product: string | null; balance: number; loanAmount: number;
    nextDue: { date: string; amount: number } | null;
    expectedClearDate: string | null;
  } | null;
  schedule: { seq: number; due: string; amount: number; status: string }[];
  score: number | null;
  scoreMax: number;
  band: string | null;
  scoreTone: PortalScore["tone"] | null;
  scoreDrivers: PortalScore["drivers"];
  avgDailySales: number | null;
  savings: { balance: number; lastAmount: number | null; lastAt: string | null } | null;
  ratiba: { available: boolean; active: boolean; amount: number | null; frequency: string | null };
  unreadMessages: number;
  messages: { id: string; subject: string; preview: string | null; at: Date; fromStaff: boolean; unread: boolean }[];
  application: { id: string; status: string; stageTitle: string | null; amount: number; product: string | null } | null;
};

/**
 * Read the signed-in customer's position at this lender.
 *
 * `session` is the proven one from borrowerFor(); nothing here takes a phone or a
 * borrower id from a caller. `nationalId` only NARROWS the match (a second
 * factor), it never widens it.
 */
export async function readPosition(org: ResolvedOrg, session: BorrowerSession, nationalIdRaw?: string | null): Promise<CustomerPosition> {
  const nationalId = (nationalIdRaw ?? "").trim();
  const borrower = await prisma.borrower.findFirst({
    where: {
      orgId: org.id,
      phone: { endsWith: session.phone.slice(-9) },
      ...(nationalId ? { nationalId } : {}),
    },
    select: {
      id: true, firstName: true, otherName: true, kycStatus: true, erasedAt: true,
      loanLimit: true, creditScore: true, riskBand: true, graduationCount: true,
      nationalId: true, serviceSuiteBorrowerId: true,
    },
    orderBy: { createdAt: "desc" },
  });

  if (borrower?.erasedAt) {
    return emptyPosition(org.name);
  }

  // ── OUR SIDE ──────────────────────────────────────────────────────────────
  // True regardless of who holds the loan book: the conversation, the identity
  // check, and any application currently moving through a workflow.
  const [unread, application, nativeLoan, threads, standingOrder] = await Promise.all([
    borrower
      ? prisma.conversationThread.aggregate({
          where: { orgId: org.id, borrowerId: borrower.id },
          _sum: { unreadForBorrower: true },
        })
      : Promise.resolve(null),
    borrower
      ? prisma.loanApplication.findFirst({
          where: { orgId: org.id, borrowerId: borrower.id, status: { notIn: ["DISBURSED", "WITHDRAWN"] } },
          orderBy: { createdAt: "desc" },
          select: { id: true, status: true, stageTitle: true, amountRequested: true, productName: true },
        })
      : Promise.resolve(null),
    borrower && org.mode === "NATIVE"
      ? prisma.loan.findFirst({
          where: { orgId: org.id, borrowerId: borrower.id, status: { in: ["ACTIVE", "PENDING_DISBURSEMENT"] } },
          orderBy: { borrowDate: "desc" },
          include: {
            product: { select: { name: true } },
            installments: { orderBy: { seq: "asc" } },
          },
        })
      : Promise.resolve(null),
    // The two most recent conversations, for the panel that used to render two
    // invented messages from "Micromart Fintech". Real ones or none.
    borrower
      ? prisma.conversationThread.findMany({
          where: { orgId: org.id, borrowerId: borrower.id },
          orderBy: { lastAt: "desc" },
          take: 2,
          select: {
            id: true, subject: true, lastPreview: true, lastAt: true,
            lastAuthorType: true, unreadForBorrower: true,
          },
        })
      : Promise.resolve([]),
    borrower
      ? prisma.standingOrder.findFirst({
          where: { orgId: org.id, borrowerId: borrower.id, status: { in: ["ACTIVE", "PENDING"] } },
          orderBy: { createdAt: "desc" },
          select: { status: true, amount: true, frequency: true },
        })
      : Promise.resolve(null),
  ]);

  let limit = borrower?.loanLimit != null ? Number(borrower.loanLimit) : 0;
  let outstanding = 0;
  let loanCount = 0;
  let activeLoan: CustomerPosition["activeLoan"] = null;
  let schedule: CustomerPosition["schedule"] = [];
  let avgDailySales: number | null = null;
  // "onboarding" — a bridged customer who is not on the lender's book yet (a new
  // borrower mid-KYC or mid-first-application). Their figures are ours: the limit
  // the statement cruncher assigned, and nothing owed. That is a true position,
  // not an outage, and must not render as one.
  let bookSource: CustomerPosition["bookSource"] = "unavailable";
  /** Why the book is unavailable, so the screen says the right sentence. */
  let bookIssue: CustomerPosition["bookIssue"] = null;
  let firstName = borrower?.firstName ?? null;
  let savings: SavingsPosition | null = null;
  let liveScore: PortalScore | null = null;

  if (org.mode === "NATIVE") {
    bookSource = "native";
    if (nativeLoan) {
      const open = nativeLoan.installments.filter((i) =>
        ["UPCOMING", "DUE", "PARTIAL", "OVERDUE"].includes(i.status),
      );
      const next = open[0] ?? null;
      outstanding = Number(nativeLoan.balance);
      loanCount = 1;
      activeLoan = {
        ref: nativeLoan.id.slice(0, 8).toUpperCase(),
        product: nativeLoan.product.name,
        balance: outstanding,
        loanAmount: Number(nativeLoan.loanAmount),
        expectedClearDate: nativeLoan.expectedClearDate?.toISOString().slice(0, 10) ?? null,
        nextDue: next
          ? {
              date: next.dueDate.toISOString().slice(0, 10),
              amount: Math.max(0, Number(next.amountDue) + Number(next.penalty) - Number(next.amountPaid)),
            }
          : null,
      };
      schedule = nativeLoan.installments.slice(0, SCHEDULE_ROWS).map((i) => ({
        seq: i.seq,
        due: i.dueDate.toISOString().slice(0, 10),
        amount: Number(i.amountDue),
        status: i.status,
      }));
    }
  } else {
    // ── THE LENDER'S BOOK, OVER SQL ──────────────────────────────────────
    // The pair must travel together: an id only means something inside its
    // entity, and 3002 and 3005 hold different people on the same numbers.
    const fromSession = Number(session.ssBorrowerId) > 0 && session.ssEntityId
      ? { entity: session.ssEntityId, id: Number(session.ssBorrowerId) }
      : null;
    const entity = fromSession?.entity ?? org.entityId;
    let ssId: number | null = fromSession?.id ?? borrower?.serviceSuiteBorrowerId ?? null;
    let position: BookPosition | null = null;
    let sqlRead = false;

    if (org.registry && entity) {
      try {
        if (ssId) position = await readBookPosition(org.registry, entity, ssId);
        if (!position) {
          // No id held, or the one held is no longer on this entity: match the
          // phone the session proved, disambiguated only by the ID they proved.
          const who = await findBookBorrower(org.registry, entity, session.phone, borrower?.nationalId);
          ssId = who.kind === "found" ? who.borrowerId : null;
          if (who.kind === "ambiguous") bookIssue = "ambiguous";
          if (ssId) position = await readBookPosition(org.registry, entity, ssId);
        }
        sqlRead = true;
      } catch {
        position = null;
        ssId = fromSession?.id ?? null;
      }
    }

    // A record on this number that carries a DIFFERENT national ID from the one
    // this customer proved is somebody else's account. Never shown.
    if (
      position && borrower?.nationalId && position.nationalId &&
      position.nationalId.replace(/\s/g, "") !== borrower.nationalId.replace(/\s/g, "")
    ) {
      position = null;
      bookIssue = "mismatch";
    }

    if (position) {
      bookSource = "lender";
      limit = position.loanLimit || limit;
      outstanding = position.outstanding;
      loanCount = position.openLoans;
      firstName = position.firstName ?? firstName;
      if (position.activeLoan) {
        const l = position.activeLoan;
        activeLoan = {
          ref: String(l.id),
          product: l.product,
          balance: l.balance,
          loanAmount: l.principal,
          expectedClearDate: l.clearDate,
          // The instalment breakdown lives in loanSchedule, a 1.95M-row heap
          // with no index on the loan — not a read Home may make per open. No
          // invented "next due" in its place.
          nextDue: null,
        };
      }
      const ssKey = position.borrowerId;
      if (org.registry) {
        [savings, liveScore] = await Promise.all([
          micromartSavings(org.registry, ssKey),
          micromartScore(org.registry, entity, ssKey),
        ]);
      }
      // Link our row to the record we just matched, so the next open is a
      // primary-key read and the console opens the same person.
      if (borrower && !borrower.serviceSuiteBorrowerId && !fromSession && entity === org.entityId) {
        await prisma.borrower
          .update({ where: { id: borrower.id }, data: { serviceSuiteBorrowerId: ssKey } })
          .catch(() => {});
      }
    } else if (sqlRead && !bookIssue) {
      // Read cleanly and not there: a new borrower, not a failure.
      bookSource = "onboarding";
      savings = { balance: 0, lastAmount: null, lastAt: null };
    }
  }

  if (bookSource === "unavailable" && !bookIssue && org.mode !== "NATIVE" && session.ssToken) {
    // ── THE FALLBACK: THEIR PUBLIC API ───────────────────────────────────
    // Only for a password session whose SQL read could not run.
    const [acct, loans] = await Promise.all([
      micromartAccount(session.ssToken),
      micromartLoans(session.ssToken),
    ]);

    if (acct.ok) {
      bookSource = "lender";
      limit = acct.account.loanLimit || limit;
      outstanding = acct.account.outstanding;
      loanCount = acct.account.loanCount;
      avgDailySales = acct.account.avgDailySales;
      firstName = acct.account.firstName ?? firstName;

      // Savings and score go over SQL — their API exposes neither — and each is
      // independently best-effort so a slow score never holds up a balance.
      const ssId = Number(session.ssBorrowerId ?? acct.account.borrowerId) || 0;
      if (org.registry && ssId > 0) {
        const entity = session.ssEntityId ?? org.entityId;
        [savings, liveScore] = await Promise.all([
          micromartSavings(org.registry, ssId),
          micromartScore(org.registry, entity, ssId),
        ]);
      }

      if (loans.ok) {
        const open = loans.loans.filter((l) => !l.cleared && l.balance > 0);
        const l = open[0] ?? null;
        if (l) {
          activeLoan = {
            ref: String(l.id),
            product: l.product,
            balance: l.balance,
            loanAmount: l.principal,
            expectedClearDate: l.dueDate,
            // Their Loans feed carries no instalment breakdown; inventing a next
            // due from the balance and the term would put a figure on screen the
            // lender never said — which is precisely the number a customer pays.
            nextDue: null,
          };
        }
      }
    }
    // acct not ok → bookSource stays "unavailable" and the screen says so
    // rather than showing zeroes, which read as "you owe nothing".
  }
  if (bookSource === "unavailable" && !bookIssue) bookIssue = "unreachable";

  return {
    erased: false,
    found: Boolean(borrower) || bookSource === "lender",
    lender: org.name,
    firstName,
    kycStatus: borrower?.kycStatus ?? "NONE",
    borrowerId: borrower?.id ?? null,
    bookSource,
    bookIssue: bookSource === "unavailable" ? bookIssue : null,
    limit,
    outstanding,
    available: Math.max(limit - outstanding, 0),
    loanCount,
    activeLoan,
    schedule,
    // One number on one scale, whichever book the customer is on — see the note
    // in the route about why neither of their own columns is a score.
    score: liveScore?.score ?? borrower?.creditScore ?? null,
    scoreMax: 900,
    band: liveScore?.band ?? borrower?.riskBand ?? null,
    scoreTone: liveScore?.tone ?? null,
    scoreDrivers: liveScore?.drivers ?? [],
    avgDailySales,
    // Null means "we could not ask"; a zero balance inside a present object means
    // "you have saved nothing yet". The shape keeps the difference.
    savings: savings
      ? { balance: savings.balance, lastAmount: savings.lastAmount, lastAt: savings.lastAt }
      : null,
    // Our own Ratiba integration debits into OUR books, so it is meaningful only
    // for a native lender — reported `available: false` on a bridged one rather
    // than omitted, so no screen shows a switch that does nothing.
    ratiba: {
      available: org.mode === "NATIVE",
      active: Boolean(standingOrder && ["ACTIVE", "PENDING"].includes(standingOrder.status)),
      amount: standingOrder ? Number(standingOrder.amount) : null,
      frequency: standingOrder?.frequency ?? null,
    },
    unreadMessages: unread?._sum.unreadForBorrower ?? 0,
    messages: threads.map((t) => ({
      id: t.id,
      subject: t.subject,
      preview: t.lastPreview,
      at: t.lastAt,
      fromStaff: t.lastAuthorType !== "borrower",
      unread: t.unreadForBorrower > 0,
    })),
    application: application
      ? {
          id: application.id,
          status: application.status,
          stageTitle: application.stageTitle,
          amount: Number(application.amountRequested),
          product: application.productName,
        }
      : null,
  };
}

/** An erased borrower is nobody, exactly as the route always answered. */
function emptyPosition(lender: string): CustomerPosition {
  return {
    erased: true, found: false, lender, firstName: null, kycStatus: "NONE", borrowerId: null,
    bookSource: "unavailable", bookIssue: null, limit: 0, outstanding: 0, available: 0, loanCount: 0,
    activeLoan: null, schedule: [], score: null, scoreMax: 900, band: null, scoreTone: null, scoreDrivers: [],
    avgDailySales: null, savings: null, ratiba: { available: false, active: false, amount: null, frequency: null },
    unreadMessages: 0, messages: [], application: null,
  };
}
