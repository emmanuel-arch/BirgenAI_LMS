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
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveOrg } from "@/lib/tenancy";
import { enterOrg } from "@/lib/db/context";
import { borrowerFor, otpRequired } from "@/lib/portal/session";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const runtime = "nodejs";

/** Newest first, and never unbounded — a long ladder is still one screen. */
const MAX_RUNGS = 24;

export async function POST(req: NextRequest) {
  let body: { lenderSlug?: string; nationalId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const nationalId = (body.nationalId ?? "").trim();
  if (!nationalId) return NextResponse.json({ success: false, message: "Enter your national ID." }, { status: 400 });

  const org = await resolveOrg(body.lenderSlug ?? "");
  if (org) enterOrg(org.id);
  if (!org) return NextResponse.json({ success: false, message: "Choose a lender." }, { status: 400 });

  const verified = await borrowerFor(org.id);
  if (!verified) return otpRequired();
  const phone = verified.phone;

  const limited = await rateLimit([
    { name: "ladder:phone", subject: `${org.id}:${phone}`, max: 10, windowSec: 900 },
    { name: "ladder:ip", subject: clientIp(req), max: 60, windowSec: 3600 },
  ]);
  if (limited) return limited;

  const borrower = await prisma.borrower.findFirst({
    where: { orgId: org.id, phone: { endsWith: phone.slice(-9) }, nationalId },
    select: { id: true, firstName: true, loanLimit: true, graduationCount: true, creditScore: true, riskBand: true },
    orderBy: { createdAt: "desc" },
  });
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

  const climbed = rungs.filter((r) => r.direction === "up");

  return NextResponse.json({
    success: true,
    found: true,
    lender: org.name,
    firstName: borrower.firstName,
    current: {
      limit: borrower.loanLimit != null ? Number(borrower.loanLimit) : null,
      graduationCount: borrower.graduationCount,
      riskBand: borrower.riskBand,
      clearedLoans,
      activeLoans,
    },
    /** The starting rung — where this customer began, for the "from → to" line. */
    startedAt: rungs.length ? rungs[rungs.length - 1].previousLimit : null,
    totalGained: climbed.reduce((s, r) => s + r.change, 0),
    rungs,
    /**
     * What earns the next rung. Stated as the RULE, never as a promise or a
     * date: the engine decides on the evidence at the time, and a screen that
     * says "your limit will rise next month" writes a cheque this route has no
     * authority to sign.
     */
    next: {
      rule: "Limits are reviewed after each loan you clear. Clearing on time is what moves the ladder up; falling into arrears is what moves it down.",
      hasActiveLoan: activeLoans > 0,
      action: activeLoans > 0
        ? "Clear the loan you have running now, on or before its due dates."
        : "Take and clear a loan to start the next review.",
    },
  });
}
