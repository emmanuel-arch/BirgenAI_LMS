// POST /api/portal/ladder — the limit ladder, as the customer climbed it (0.9)
//
// Body: { lenderSlug, nationalId }. Same door as /api/portal/decision.
//
// GraduationEvent is already written by the graduation cron; nothing here
// computes a limit or decides anything. This route only reads back a ladder the
// customer has already climbed, which is the property that makes the screen
// trustworthy: it cannot promise a rung, because it has no power to grant one.
//
// THE LADDER GOES BOTH WAYS. `move` is not always "graduate" — the engine can
// lower a limit too. A screen that renders only increases would quietly hide
// every decrease, and a customer whose limit fell would find no explanation on
// the one screen built to explain limits. Both directions are returned, labelled.
//
// ── AND FOR A BRIDGED LENDER, THE LADDER IS NOT OURS ────────────────────────
// GraduationEvent is written by OUR cron, so for a bridged org it is empty and
// always will be — Micromart's ladder is climbed by their own
// sp_CreditScoringAndGraduation and recorded in dbo.LoanGraduationHistory. This
// route therefore had exactly one honest answer for all 17,022 of their
// customers: "no limit history". lib/portal/micromart-ladder.ts reads the real
// one; the response shape is identical either way, so the screen does not know
// or care which book answered.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveOrg } from "@/lib/tenancy";
import { enterOrg } from "@/lib/db/context";
import { borrowerFor, otpRequired } from "@/lib/portal/session";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { micromartLadder } from "@/lib/portal/micromart-ladder";

export const runtime = "nodejs";

/** Newest first, and never unbounded — a long ladder is still one screen. */
const MAX_RUNGS = 24;

/**
 * What earns the next rung. Stated as the RULE, never as a promise or a date:
 * the engine decides on the evidence at the time, and a screen that says "your
 * limit will rise next month" writes a cheque this route cannot sign.
 *
 * Shared by both books so the two sides cannot drift into telling the same
 * customer two different things about how their limit moves.
 */
/**
 * How much the limit has grown across the history shown.
 *
 * This used to sum the upward rungs, which is wrong in two ways and was only
 * ever right by accident on a tidy ladder.
 *
 *   · It ignores the downward ones. A ladder that went 0 → 5,000 → 8,000 →
 *     6,000 has gained 6,000, not 8,000.
 *   · It double-counts whenever consecutive rows both record the same starting
 *     point. Micromart's book does exactly that — a live customer whose limit
 *     is KSh 5,750 has two rungs both reading "from KSh 0", and the sum came to
 *     KSh 13,800. A headline figure more than twice the customer's actual limit
 *     is the single most damaging number this screen could print.
 *
 * Where you are now, minus where the shown history started, is the thing the
 * words "total gained" actually mean, and it cannot double-count. Null when
 * either end is unknown — a missing figure beats a confident wrong one.
 */
function totalGainedOver(currentLimit: number | null, startedAt: number | null): number | null {
  if (currentLimit == null || startedAt == null) return null;
  return Math.round((currentLimit - startedAt) * 100) / 100;
}

const NEXT_RULE = (activeLoans: number) => ({
  rule: "Limits are reviewed after each loan you clear. Clearing on time is what moves the ladder up; falling into arrears is what moves it down.",
  hasActiveLoan: activeLoans > 0,
  action:
    activeLoans > 0
      ? "Clear the loan you have running now, on or before its due dates."
      : "Take and clear a loan to start the next review.",
});

export async function POST(req: NextRequest) {
  let body: { lenderSlug?: string; nationalId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const nationalId = (body.nationalId ?? "").trim();

  const org = await resolveOrg(body.lenderSlug ?? "");
  if (org) enterOrg(org.id);
  if (!org) return NextResponse.json({ success: false, message: "Choose a lender." }, { status: 400 });

  const verified = await borrowerFor(org.id);
  if (!verified) return otpRequired();
  const phone = verified.phone;

  // ── WHO THIS IS, ON WHICHEVER SIDE HOLDS THE LADDER ───────────────────────
  // The national ID is how a borrower row in OUR table is disambiguated when a
  // phone number appears more than once. A bridged customer is identified by the
  // borrower id their own sign-in against the lender returned, so requiring the
  // national ID as well would lock out precisely the customers this bridge
  // exists to serve — many of whom have no row on our side at all.
  const ssBorrowerId = Number(verified.ssBorrowerId ?? NaN);
  const lenderIdentity =
    org.mode !== "NATIVE" && !!org.registry && Number.isFinite(ssBorrowerId) && ssBorrowerId > 0;
  if (!nationalId && !lenderIdentity) {
    return NextResponse.json({ success: false, message: "Enter your national ID." }, { status: 400 });
  }

  const limited = await rateLimit([
    { name: "ladder:phone", subject: `${org.id}:${phone}`, max: 10, windowSec: 900 },
    { name: "ladder:ip", subject: clientIp(req), max: 60, windowSec: 3600 },
  ]);
  if (limited) return limited;

  const borrower = await prisma.borrower.findFirst({
    where: {
      orgId: org.id,
      phone: { endsWith: phone.slice(-9) },
      ...(nationalId ? { nationalId } : {}),
    },
    select: { id: true, firstName: true, loanLimit: true, graduationCount: true, creditScore: true, riskBand: true },
    orderBy: { createdAt: "desc" },
  });

  // ── THE LENDER'S OWN LADDER ───────────────────────────────────────────────
  if (lenderIdentity && org.registry) {
    const read = await micromartLadder({
      org: org.registry,
      // WHICH book signed them in outranks the org default: 3002 and 3005 hold
      // different people on the same phone numbers, so reading the wrong one
      // does not fail — it succeeds, against a stranger's ladder.
      entityId: verified.ssEntityId ?? org.entityId,
      borrowerId: ssBorrowerId,
      max: MAX_RUNGS,
    });

    // A 503, deliberately, rather than `found: false`. The app renders "found:
    // false" as a calm "you have no history yet", which is the wrong sentence
    // for "we could not reach your lender" — and the difference matters most to
    // the customer who DOES have a ladder. A 503 gets them a Retry instead.
    if (!read.ok) {
      return NextResponse.json(
        { success: false, message: "We could not reach your lender's records just now. Try again in a moment." },
        { status: 503 },
      );
    }

    const { rungs, current, rawRows } = read.ladder;
    const startedAt = rungs.length ? rungs[rungs.length - 1].previousLimit : null;
    return NextResponse.json({
      success: true,
      found: rungs.length > 0,
      lender: org.name,
      firstName: borrower?.firstName ?? null,
      source: "lender",
      current,
      startedAt,
      totalGained: totalGainedOver(current.limit, startedAt),
      rungs,
      // How many raw rows those rungs stand for. Not decoration: while the
      // lender's procedure re-graduates nightly, this is 100x the rung count,
      // and a support agent looking at a customer's screen beside the lender's
      // table needs to know the screen collapsed them on purpose.
      collapsedFrom: rawRows,
      next: NEXT_RULE(current.activeLoans),
    });
  }

  if (!borrower) return NextResponse.json({ success: true, found: false, lender: org.name });

  const [events, clearedLoans, activeLoans] = await Promise.all([
    prisma.graduationEvent.findMany({
      where: { orgId: org.id, borrowerId: borrower.id },
      orderBy: { createdAt: "desc" },
      take: MAX_RUNGS,
      select: {
        id: true, previousLimit: true, newLimit: true, increase: true, move: true,
        clearedLoans: true, provenPrincipal: true, cappedByCeiling: true,
        graduationPercent: true, riskBand: true, createdAt: true,
      },
    }),
    prisma.loan.count({ where: { orgId: org.id, borrowerId: borrower.id, status: "CLEARED" } }),
    prisma.loan.count({ where: { orgId: org.id, borrowerId: borrower.id, status: { in: ["ACTIVE", "PENDING_DISBURSEMENT"] } } }),
  ]);

  const rungs = events.map((e) => {
    const previous = Number(e.previousLimit);
    const next = Number(e.newLimit);
    return {
      id: e.id,
      at: e.createdAt.toISOString(),
      previousLimit: previous,
      newLimit: next,
      /** Signed, so the screen never has to infer direction from the label. */
      change: next - previous,
      direction: e.move === "graduate" || next > previous ? "up" : next < previous ? "down" : "flat",
      move: e.move,
      clearedLoans: e.clearedLoans,
      provenPrincipal: Number(e.provenPrincipal),
      graduationPercent: e.graduationPercent,
      riskBand: e.riskBand,
      // The difference between "you earned 30%" and "you earned 30% but the
      // per-step ceiling paid out less". Hiding the cap makes the ladder look
      // arbitrary the one time it does not do what the percentage implies.
      cappedByCeiling: e.cappedByCeiling,
    };
  });

  const nativeStartedAt = rungs.length ? rungs[rungs.length - 1].previousLimit : null;

  return NextResponse.json({
    success: true,
    found: true,
    lender: org.name,
    firstName: borrower.firstName,
    source: "native",
    current: {
      limit: borrower.loanLimit != null ? Number(borrower.loanLimit) : null,
      graduationCount: borrower.graduationCount,
      riskBand: borrower.riskBand,
      clearedLoans,
      activeLoans,
    },
    /** The starting rung — where this customer began, for the "from → to" line. */
    startedAt: nativeStartedAt,
    totalGained: totalGainedOver(
      borrower.loanLimit != null ? Number(borrower.loanLimit) : null,
      nativeStartedAt,
    ),
    rungs,
    next: NEXT_RULE(activeLoans),
  });
}
