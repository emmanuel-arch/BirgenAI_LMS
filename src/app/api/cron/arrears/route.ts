// GET/POST /api/cron/arrears — daily portfolio housekeeping (CRON_SECRET).
// Per org, per active loan:
//   • installments past due → OVERDUE + one-time penalty (product.penaltyRate %
//     of the outstanding due), added to the loan balance; arrears SMS
//   • installments due today → DUE + "due today" SMS
//   • installments due in 2 days → reminder SMS (once per installment: only on
//     the exact T-2 day, so reruns the same day are the only repeat risk)
//   • installments due tomorrow → "due tomorrow" SMS (T-1)
//   • installments 3 days past due and still short → firmer arrears SMS (T+3)
//
// THE LADDER IS FIVE TOUCHES: T-2, T-1, T+0, T+1 (the OVERDUE transition) and
// T+3. Every one of them renders from an editable template, so a lender who
// wants four, or wants them worded differently, changes copy rather than code.
// The offsets themselves are deliberately NOT configurable yet — see the note on
// the T+3 pass for why keying off the due date is what keeps each message
// firing exactly once.
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma, orgTx } from "@/lib/prisma";
import { runAsPlatform } from "@/lib/db/context";
import { sendSms } from "@/lib/sms/send";
import { sweepRateLimits } from "@/lib/ratelimit";
import { expireStaleOffers } from "@/lib/lending/offer";
import { expireStaleGuarantors } from "@/lib/lending/guarantor";
import { resolveDuePromises } from "@/lib/collections/ptp";

export const runtime = "nodejs";
export const maxDuration = 300;

const round2 = (n: number) => Math.round(n * 100) / 100;
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  return !!token && token === secret;
}

async function run() {
  const today = dayStart(new Date());
  const tomorrow2 = new Date(today.getTime() + 2 * 86400000);
  const tomorrow1 = new Date(today.getTime() + 86400000);
  const stats = { overdueMarked: 0, penaltiesApplied: 0, penaltyTotal: 0, dueToday: 0, reminders: 0, dueTomorrow: 0, arrearsFinal: 0, rateLimitsSwept: 0, offersExpired: 0, guarantorsExpired: 0, ptpsResolved: 0 };

  // Housekeeping: closed rate-limit windows. Counters reset themselves in place,
  // so this only reclaims rows for subjects that never came back.
  stats.rateLimitsSwept = await sweepRateLimits();

  // Offers nobody signed. Booking already reads a lapsed offer as EXPIRED whether
  // or not this ran, so the sweep is tidiness, never the gate.
  stats.offersExpired = await runAsPlatform(() => expireStaleOffers());
  // Guarantor invitations nobody answered. Booking already treats them as expired.
  stats.guarantorsExpired = await runAsPlatform(() => expireStaleGuarantors());
  // Promises whose date passed resolve against the money that actually came
  // (the collections queue also does this opportunistically on read).
  stats.ptpsResolved = (await resolveDuePromises()).length;

  // 1) OVERDUE + one-time penalties (loans ACTIVE only; penalty once per installment).
  const overdue = await prisma.installment.findMany({
    where: {
      dueDate: { lt: today },
      status: { in: ["UPCOMING", "DUE", "PARTIAL"] },
      loan: { status: "ACTIVE" },
    },
    take: 500,
    include: {
      loan: {
        select: {
          id: true, orgId: true, balance: true,
          product: { select: { penaltyRate: true } },
          borrower: { select: { phone: true } },
          org: { select: { name: true } },
        },
      },
    },
  });

  for (const inst of overdue) {
    const outstanding = round2(Number(inst.amountDue) + Number(inst.penalty) - Number(inst.amountPaid));
    const rate = inst.loan.product.penaltyRate != null ? Number(inst.loan.product.penaltyRate) : 0;
    const addPenalty = Number(inst.penalty) === 0 && rate > 0 ? round2(outstanding * (rate / 100)) : 0;

    await orgTx(async (tx) => {
      await tx.installment.update({
        where: { id: inst.id },
        data: { status: "OVERDUE", ...(addPenalty > 0 ? { penalty: new Prisma.Decimal(addPenalty) } : {}) },
      });
      if (addPenalty > 0) {
        await tx.loan.update({
          where: { id: inst.loan.id },
          data: { balance: new Prisma.Decimal(round2(Number(inst.loan.balance) + addPenalty)) },
        });
      }
    }, { timeout: 20000 });

    stats.overdueMarked++;
    if (addPenalty > 0) { stats.penaltiesApplied++; stats.penaltyTotal = round2(stats.penaltyTotal + addPenalty); }
    await sendSms(inst.loan.orgId, inst.loan.borrower.phone, "arrears", {
      org: inst.loan.org.name,
      amount: Math.round(outstanding + addPenalty).toLocaleString(),
      ref: inst.loan.id.slice(0, 8).toUpperCase(),
    });
  }

  // 2) Due today.
  const dueToday = await prisma.installment.findMany({
    where: {
      dueDate: { gte: today, lt: new Date(today.getTime() + 86400000) },
      status: "UPCOMING",
      loan: { status: "ACTIVE" },
    },
    take: 500,
    include: { loan: { select: { id: true, orgId: true, borrower: { select: { phone: true } }, org: { select: { name: true } } } } },
  });
  for (const inst of dueToday) {
    await prisma.installment.update({ where: { id: inst.id }, data: { status: "DUE" } });
    stats.dueToday++;
    await sendSms(inst.loan.orgId, inst.loan.borrower.phone, "due_today", {
      org: inst.loan.org.name,
      amount: Math.round(Number(inst.amountDue) - Number(inst.amountPaid)).toLocaleString(),
      ref: inst.loan.id.slice(0, 8).toUpperCase(),
    });
  }

  // 3) T-2 reminders (fires only on the exact day two days before due).
  const upcoming = await prisma.installment.findMany({
    where: {
      dueDate: { gte: tomorrow2, lt: new Date(tomorrow2.getTime() + 86400000) },
      status: "UPCOMING",
      loan: { status: "ACTIVE" },
    },
    take: 500,
    include: { loan: { select: { orgId: true, borrower: { select: { phone: true } }, org: { select: { name: true } } } } },
  });
  for (const inst of upcoming) {
    stats.reminders++;
    await sendSms(inst.loan.orgId, inst.loan.borrower.phone, "reminder", {
      org: inst.loan.org.name,
      amount: Math.round(Number(inst.amountDue) - Number(inst.amountPaid)).toLocaleString(),
      date: inst.dueDate.toISOString().slice(0, 10),
    });
  }

  // 4) T-1. The second nudge, the day before it falls due.
  //
  // WHY A SECOND PRE-DUE MESSAGE. One reminder at T-2 assumes the borrower acts
  // the day they are told. Micromart's ladder sends at T-2 AND T-1 because on a
  // weekly product the earlier message lands while the money is not yet in hand;
  // the T-1 one lands the evening before, which is when it can actually be paid.
  // Both are pre-due and both are polite — the escalation starts after the date,
  // not before it.
  //
  // Named `due_tomorrow` rather than `reminder_2` so a lender editing templates
  // reads WHEN it fires, not where it sits in a sequence they cannot see.
  const dueTomorrow = await prisma.installment.findMany({
    where: {
      dueDate: { gte: tomorrow1, lt: new Date(tomorrow1.getTime() + 86400000) },
      status: "UPCOMING",
      loan: { status: "ACTIVE" },
    },
    take: 500,
    include: { loan: { select: { orgId: true, borrower: { select: { phone: true, firstName: true } }, org: { select: { name: true } } } } },
  });
  for (const inst of dueTomorrow) {
    stats.dueTomorrow++;
    await sendSms(inst.loan.orgId, inst.loan.borrower.phone, "due_tomorrow", {
      org: inst.loan.org.name,
      // First token only, capped — the same rule the ServiceSuite reminders use.
      // Full names live in firstName often enough that interpolating one whole
      // pushes the message past a segment and bills every long-named borrower
      // twice, on every message, forever.
      name: (inst.loan.borrower.firstName ?? "").trim().split(/\s+/)[0]?.slice(0, 15) || "there",
      amount: Math.round(Number(inst.amountDue) - Number(inst.amountPaid)).toLocaleString(),
      date: inst.dueDate.toISOString().slice(0, 10),
    });
  }

  // 5) T+3. The firmer follow-up on something still unpaid.
  //
  // The `arrears` message above fires ONCE, on the day an installment crosses
  // into OVERDUE — after that the row is already OVERDUE and never re-enters the
  // query, so a borrower who ignores it is never contacted again by this job.
  // That is the gap this closes. Keyed off the due date being exactly three days
  // past rather than off the status, so it fires once and only once per
  // installment, and a same-day rerun is the only repeat risk (as with T-2).
  const threeDaysPast = new Date(today.getTime() - 3 * 86400000);
  const stillUnpaid = await prisma.installment.findMany({
    where: {
      dueDate: { gte: threeDaysPast, lt: new Date(threeDaysPast.getTime() + 86400000) },
      status: "OVERDUE",
      loan: { status: "ACTIVE" },
    },
    take: 500,
    include: { loan: { select: { id: true, orgId: true, borrower: { select: { phone: true } }, org: { select: { name: true } } } } },
  });
  for (const inst of stillUnpaid) {
    const outstanding = Number(inst.amountDue) + Number(inst.penalty ?? 0) - Number(inst.amountPaid);
    // Part-payment since the first notice counts: chasing someone for money they
    // have already sent is how a lender loses a customer who was cooperating.
    if (outstanding <= 0.5) continue;
    stats.arrearsFinal++;
    await sendSms(inst.loan.orgId, inst.loan.borrower.phone, "arrears_final", {
      org: inst.loan.org.name,
      amount: Math.round(outstanding).toLocaleString(),
      ref: inst.loan.id.slice(0, 8).toUpperCase(),
    });
  }

  return stats;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  try {
    // The arrears sweep spans every lender's book, so it runs platform-scoped.
    const stats = await runAsPlatform(run);
    return NextResponse.json({ success: true, ranAt: new Date().toISOString(), ...stats });
  } catch (err) {
    return NextResponse.json({ success: false, message: err instanceof Error ? err.message : "Arrears run failed." }, { status: 500 });
  }
}

export const POST = GET;
