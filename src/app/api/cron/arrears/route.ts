// GET/POST /api/cron/arrears — daily portfolio housekeeping (CRON_SECRET).
// Per org, per active loan:
//   • installments past due → OVERDUE + one-time penalty (product.penaltyRate %
//     of the outstanding due), added to the loan balance; arrears SMS
//   • installments due today → DUE + "due today" SMS
//   • installments due in 2 days → reminder SMS (once per installment: only on
//     the exact T-2 day, so reruns the same day are the only repeat risk)
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma, orgTx } from "@/lib/prisma";
import { runAsPlatform } from "@/lib/db/context";
import { sendSms } from "@/lib/sms/send";
import { sweepRateLimits } from "@/lib/ratelimit";
import { expireStaleOffers } from "@/lib/lending/offer";

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
  const stats = { overdueMarked: 0, penaltiesApplied: 0, penaltyTotal: 0, dueToday: 0, reminders: 0, rateLimitsSwept: 0, offersExpired: 0 };

  // Housekeeping: closed rate-limit windows. Counters reset themselves in place,
  // so this only reclaims rows for subjects that never came back.
  stats.rateLimitsSwept = await sweepRateLimits();

  // Offers nobody signed. Booking already reads a lapsed offer as EXPIRED whether
  // or not this ran, so the sweep is tidiness, never the gate.
  stats.offersExpired = await runAsPlatform(() => expireStaleOffers());

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
