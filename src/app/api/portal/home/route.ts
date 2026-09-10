// ─────────────────────────────────────────────────────────────────────────────
// POST /api/portal/home — everything the first screen needs, in one call.
//
// Body: { lenderSlug, nationalId? }
//
// ── WHY ONE ENDPOINT AND NOT FOUR CALLS ─────────────────────────────────────
// Home asks four questions: what can I borrow, what do I owe, has anyone told me
// anything, and is anything of mine in flight. Answering them from four routes
// means four round trips on the screen the app is judged on in the first four
// seconds — on a handset, over a Kenyan mobile connection, that is the
// difference between an app that feels instant and one that assembles itself
// while somebody watches.
//
// It also means four independent failures. A customer whose message count fails
// to load should still see their balance; composing that here lets one weak
// answer degrade a section instead of the screen.
//
// ── WHERE THE MONEY COMES FROM ──────────────────────────────────────────────
// NATIVE org → our own Loan/Installment tables.
// BRIDGED org (Micromart) → THEIR book, over their public API, using the bearer
// token the customer's own sign-in produced.
//
// That second path is the one that matters here and it did not exist. my-loan
// answers `{ found: false, bridged: true }` for every non-native org, so Home
// and Repay were rendering samples not for want of wiring but because our side
// held no loan to wire to.
//
// ── `CreditScore` IS NOT A CREDIT SCORE ─────────────────────────────────────
// AccountPreview returns `CreditScore: 30000` and it is a MISNOMER in their
// schema: the figure is the customer's AVERAGE DAILY SALES — a cashflow number
// in shillings, captured at onboarding. It has nothing to do with
// creditworthiness scoring.
//
// Passing it through under its own name would have been the expensive kind of
// mistake, because 30000 is a perfectly plausible-looking score and nobody
// reading a screen would question it. It would have been rendered beside our
// 900-point score, compared against it, and eventually reconciled by somebody
// who assumed one of the two engines was broken.
//
// So it is carried as `avgDailySales`, which is what it is, and it is genuinely
// useful — it is the affordability signal their officers already trust. The
// headline score stays OURS (out of 900, explained by the Score screen) or stays
// absent.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveOrg } from "@/lib/tenancy";
import { enterOrg } from "@/lib/db/context";
import { borrowerFor, otpRequired } from "@/lib/portal/session";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { micromartAccount, micromartLoans } from "@/lib/portal/micromart-account";
import { micromartSavings, micromartScore, type PortalScore, type SavingsPosition } from "@/lib/portal/micromart-standing";

export const runtime = "nodejs";

/** Enough to fill the "what is next" panel without becoming a statement. */
const SCHEDULE_ROWS = 6;

export async function POST(req: NextRequest) {
  let body: { lenderSlug?: string; nationalId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 });
  }

  const org = await resolveOrg(body.lenderSlug ?? "");
  if (!org) return NextResponse.json({ success: false, message: "Choose a lender." }, { status: 400 });
  enterOrg(org.id);

  const session = await borrowerFor(org.id);
  if (!session) return otpRequired();

  const limited = await rateLimit([
    { name: "home:phone", subject: `${org.id}:${session.phone}`, max: 60, windowSec: 900 },
    { name: "home:ip", subject: clientIp(req), max: 200, windowSec: 3600 },
  ]);
  if (limited) return limited;

  const nationalId = (body.nationalId ?? "").trim();
  const borrower = await prisma.borrower.findFirst({
    where: {
      orgId: org.id,
      phone: { endsWith: session.phone.slice(-9) },
      ...(nationalId ? { nationalId } : {}),
    },
    select: {
      id: true, firstName: true, otherName: true, kycStatus: true, erasedAt: true,
      loanLimit: true, creditScore: true, riskBand: true, graduationCount: true,
    },
    orderBy: { createdAt: "desc" },
  });

  if (borrower?.erasedAt) {
    return NextResponse.json({ success: true, found: false, lender: org.name });
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
  let activeLoan: {
    ref: string; product: string | null; balance: number; loanAmount: number;
    nextDue: { date: string; amount: number } | null;
    expectedClearDate: string | null;
  } | null = null;
  let schedule: { seq: number; due: string; amount: number; status: string }[] = [];
  let avgDailySales: number | null = null;
  let bookSource: "native" | "lender" | "unavailable" = "unavailable";
  let firstName = borrower?.firstName ?? null;
  // The two figures a customer opens the app to look at, and which nothing was
  // answering. See lib/portal/micromart-standing.ts for where each one lives
  // and why neither could come from AccountPreview.
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
  } else if (session.ssToken) {
    // ── THE LENDER'S BOOK ────────────────────────────────────────────────
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

      // ── SAVINGS AND SCORE ────────────────────────────────────────────
      // Both need the ServiceSuite borrower id, which only exists once the
      // customer has authenticated against the lender — and both go over SQL
      // rather than their API, because their API exposes neither.
      //
      // In parallel, and each independently best-effort: Home's whole design
      // is that one weak answer degrades a section rather than the screen, and
      // the score in particular is a model call that must never be able to
      // hold up somebody's balance.
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
            // Their Loans feed carries no instalment breakdown, so there is no
            // "next due" to state. Inventing one from the balance and the term
            // would put a date and an amount on screen that the lender never
            // said — which is precisely the number a customer would then pay.
            nextDue: null,
          };
        }
      }
    }
    // acct not ok → bookSource stays "unavailable" and the screen says so
    // rather than showing zeroes, which read as "you owe nothing".
  }

  return NextResponse.json({
    success: true,
    found: Boolean(borrower) || bookSource === "lender",
    lender: org.name,
    firstName,
    kycStatus: borrower?.kycStatus ?? "NONE",

    // ── The money ────────────────────────────────────────────────────────
    // `bookSource` is not decoration. "unavailable" must render differently
    // from a zero balance: one is "we could not ask", the other is "you owe
    // nothing", and showing the first as the second is how a customer with
    // arrears is told they are clear.
    bookSource,
    limit,
    outstanding,
    available: Math.max(limit - outstanding, 0),
    loanCount,
    activeLoan,
    schedule,

    // ── THE 900-POINT SCORE ───────────────────────────────────────────────
    // One number on one scale, whichever book the customer is on.
    //
    // For a BRIDGED customer it comes from the deployed behavioural model,
    // which is the only thing on this system that speaks 300–900: their
    // `Borrowers.RiskScore` is NULL across most of the book, and their
    // `CreditScore` column is average daily sales (see `avgDailySales` below).
    // Rendering either as a score would put a plausible-looking number on a
    // gauge that nobody could reconcile with anything.
    //
    // For a NATIVE customer it stays our own stored figure. Both arrive here
    // on the same scale, so the screen does not branch.
    score: liveScore?.score ?? borrower?.creditScore ?? null,
    scoreMax: 900,
    band: liveScore?.band ?? borrower?.riskBand ?? null,
    // How to colour the gauge, and what moved the number. The app's own footer
    // promises that every decision on the screen can be explained on request —
    // this is that promise kept in the response rather than in a support call.
    scoreTone: liveScore?.tone ?? null,
    scoreDrivers: liveScore?.drivers ?? [],
    // Theirs, on their own scale, labelled. Never mixed with the above.
    // THEIR `CreditScore` field, correctly named: average daily sales in
    // shillings. An affordability signal, not a competing score.
    avgDailySales,

    // ── SAVINGS ───────────────────────────────────────────────────────────
    // Null means "we could not ask", exactly as `bookSource` does for the
    // balance. A zero BALANCE inside a present object means "you have saved
    // nothing yet", which is a different and true statement. The screen has to
    // be able to tell them apart, so the shape carries the difference rather
    // than collapsing both to 0.
    savings: savings
      ? { balance: savings.balance, lastAmount: savings.lastAmount, lastAt: savings.lastAt }
      : null,

    // ── AUTO-REPAY ────────────────────────────────────────────────────────
    // Our own M-Pesa Ratiba integration debits into OUR books, so it is
    // meaningful only for a native lender. On a bridged one it is reported
    // `available: false` rather than omitted, so the Repay screen can say
    // "not offered by this lender yet" instead of showing a switch that does
    // nothing — which is the version a customer taps and then believes is on.
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
      // So the panel can say "You:" rather than attributing the customer's own
      // last message to the lender.
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
  });
}
