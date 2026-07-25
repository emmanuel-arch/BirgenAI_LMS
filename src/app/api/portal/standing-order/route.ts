// POST /api/portal/standing-order — M-Pesa Ratiba auto-repayments, customer side.
//
// Body: { lenderSlug, nationalId, action, standingOrderId? }
//   "offer"  → what an auto-repay would look like (amount, how often, when), and
//              whether one is already running for their active loan.
//   "setup"  → create the standing order and send it to Safaricom (or simulate it
//              where the lender has no M-Pesa yet). The customer authorizes it on
//              their handset; the Ratiba callback turns it ACTIVE.
//   "cancel" → stop an order.
//
// The plan is DERIVED server-side from the loan and its product — the installment
// becomes the debit, the repayment unit becomes the frequency, the next due date
// the start, and the expected clear date the end. Nothing about the money comes
// from the client. Degrades to `available:false` if the table isn't migrated yet,
// so the portal never breaks on a pending db:push.
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveOrg } from "@/lib/tenancy";
import { enterOrg } from "@/lib/db/context";
import { borrowerFor, otpRequired } from "@/lib/portal/session";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { getIntegration } from "@/lib/vault/integrations";
import { createStandingOrder, type RatibaFrequency } from "@/lib/mpesa/daraja";

export const runtime = "nodejs";

const FREQ_LABEL: Record<RatibaFrequency, string> = {
  ONCE: "one-off", DAILY: "daily", WEEKLY: "weekly", MONTHLY: "monthly",
  BIMONTHLY: "every 2 months", QUARTERLY: "quarterly", HALFYEAR: "twice a year", YEARLY: "yearly",
};
function freqFromUnit(unit: string | null | undefined): RatibaFrequency {
  const u = (unit ?? "month").toLowerCase();
  if (u.startsWith("week")) return "WEEKLY";
  if (u.startsWith("day")) return "DAILY";
  return "MONTHLY";
}
function addPeriods(start: Date, freq: RatibaFrequency, count: number): Date {
  const d = new Date(start);
  const n = Math.max(1, count);
  if (freq === "WEEKLY") d.setDate(d.getDate() + n * 7);
  else if (freq === "DAILY") d.setDate(d.getDate() + n);
  else d.setMonth(d.getMonth() + n);
  return d;
}

export async function POST(req: NextRequest) {
  let body: { lenderSlug?: string; nationalId?: string; action?: string; standingOrderId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const nationalId = (body.nationalId ?? "").trim();
  const action = body.action ?? "offer";
  if (!nationalId) return NextResponse.json({ success: false, message: "Enter your national ID." }, { status: 400 });

  const org = await resolveOrg(body.lenderSlug ?? "");
  if (org) enterOrg(org.id);
  if (!org || org.mode !== "NATIVE") return NextResponse.json({ success: true, available: false }, { status: 200 });

  const verified = await borrowerFor(org.id);
  if (!verified) return otpRequired();

  const borrower = await prisma.borrower.findFirst({
    where: { orgId: org.id, phone: { endsWith: verified.phone.slice(-9) }, nationalId },
    orderBy: { createdAt: "desc" },
    select: { id: true, phone: true },
  });
  if (!borrower) return NextResponse.json({ success: false, message: "We couldn't match your details." }, { status: 404 });

  try {
    // The active loan is what an auto-repay is FOR.
    const loan = await prisma.loan.findFirst({
      where: { orgId: org.id, borrowerId: borrower.id, status: "ACTIVE" },
      orderBy: { borrowDate: "desc" },
      select: {
        id: true, loanAmount: true, expectedClearDate: true,
        product: { select: { repaymentPeriod: true, repaymentPeriodUnit: true } },
        installments: { where: { status: { in: ["UPCOMING", "DUE", "PARTIAL", "OVERDUE"] } }, orderBy: { seq: "asc" }, take: 1, select: { dueDate: true, amountDue: true, amountPaid: true } },
      },
    });

    const existing = loan
      ? await prisma.standingOrder.findFirst({
          where: { orgId: org.id, borrowerId: borrower.id, loanId: loan.id, status: { in: ["PENDING", "ACTIVE"] } },
          orderBy: { createdAt: "desc" },
        })
      : null;

    const planFor = () => {
      const next = loan!.installments[0];
      const term = loan!.product?.repaymentPeriod ?? 1;
      const amount = next
        ? Math.max(1, Math.round(Number(next.amountDue) - Number(next.amountPaid)))
        : Math.max(1, Math.round(Number(loan!.loanAmount) / Math.max(1, term)));
      const frequency = freqFromUnit(loan!.product?.repaymentPeriodUnit);
      const startDate = next?.dueDate ?? new Date(Date.now() + 86_400_000);
      const endDate = loan!.expectedClearDate ?? addPeriods(startDate, frequency, term);
      return { amount, frequency, startDate, endDate };
    };

    // ── OFFER ────────────────────────────────────────────────────────────────
    if (action === "offer") {
      if (!loan) return NextResponse.json({ success: true, available: false });
      const p = planFor();
      const mpesa = !!(await getIntegration(org.id, "MPESA_STK").catch(() => null));
      return NextResponse.json({
        success: true, available: true,
        amount: p.amount, frequency: p.frequency, frequencyLabel: FREQ_LABEL[p.frequency],
        startDate: p.startDate.toISOString(), endDate: p.endDate.toISOString(),
        mpesaConfigured: mpesa,
        existing: existing ? { id: existing.id, status: existing.status, amount: Number(existing.amount), frequency: existing.frequency, simulated: existing.simulated } : null,
      });
    }

    // ── CANCEL ─────────────────────────────────────────────────────────────────
    if (action === "cancel") {
      const id = (body.standingOrderId ?? "").trim();
      const so = await prisma.standingOrder.findFirst({ where: { id, orgId: org.id, borrowerId: borrower.id } });
      if (!so) return NextResponse.json({ success: false, message: "Standing order not found." }, { status: 404 });
      await prisma.standingOrder.update({ where: { id: so.id }, data: { status: "CANCELLED" } });
      await prisma.auditLog.create({
        data: { orgId: org.id, actorType: "borrower", actorId: borrower.id, action: "standingorder.cancel", entity: "StandingOrder", entityId: so.id, meta: {} },
      }).catch(() => {});
      return NextResponse.json({ success: true, cancelled: true });
    }

    // ── SETUP ──────────────────────────────────────────────────────────────────
    if (action === "setup") {
      if (!loan) return NextResponse.json({ success: false, message: "No active loan to auto-repay." }, { status: 400 });
      if (existing) return NextResponse.json({ success: true, standingOrderId: existing.id, status: existing.status, alreadySet: true });

      const limited = await rateLimit([
        { name: "so:phone", subject: `${org.id}:${borrower.phone}`, max: 4, windowSec: 600 },
        { name: "so:ip", subject: clientIp(req), max: 20, windowSec: 3600 },
      ]);
      if (limited) return limited;

      const p = planFor();
      const reference = loan.id.slice(0, 8).toUpperCase();
      const name = `${org.name} auto-repay`.slice(0, 32);

      const so = await prisma.standingOrder.create({
        data: {
          orgId: org.id, borrowerId: borrower.id, loanId: loan.id, phone: borrower.phone,
          amount: new Prisma.Decimal(p.amount), frequency: p.frequency,
          startDate: p.startDate, endDate: p.endDate, reference, name, status: "PENDING",
        },
        select: { id: true },
      });

      const cfg = await getIntegration(org.id, "MPESA_STK").catch(() => null);
      if (cfg) {
        // Real Ratiba — the customer approves on their phone; the callback activates it.
        const r = await createStandingOrder(org.id, org.slug, {
          phone: borrower.phone, amount: p.amount, accountReference: reference, name,
          startDate: p.startDate, endDate: p.endDate, frequency: p.frequency, description: "Loan repayment",
        });
        await prisma.standingOrder.update({
          where: { id: so.id },
          data: { externalRef: r.ref || null, status: r.ok ? "PENDING" : "FAILED", raw: (r.raw ?? {}) as Prisma.InputJsonValue },
        });
        if (!r.ok) return NextResponse.json({ success: false, message: r.message }, { status: 400 });
        return NextResponse.json({ success: true, standingOrderId: so.id, status: "PENDING", simulated: false, message: "Approve the standing order on your phone." });
      }

      // Simulated — no lender M-Pesa yet. Authorized immediately, stamped simulated.
      await prisma.standingOrder.update({ where: { id: so.id }, data: { status: "ACTIVE", simulated: true } });
      await prisma.auditLog.create({
        data: { orgId: org.id, actorType: "borrower", actorId: borrower.id, action: "standingorder.active", entity: "StandingOrder", entityId: so.id, meta: { simulated: true, amount: p.amount, frequency: p.frequency } },
      }).catch(() => {});
      return NextResponse.json({ success: true, standingOrderId: so.id, status: "ACTIVE", simulated: true, message: "Automatic repayments are on." });
    }

    return NextResponse.json({ success: false, message: "Unknown action." }, { status: 400 });
  } catch {
    // Most likely the StandingOrder table hasn't been migrated yet (db:push pending).
    return NextResponse.json({ success: true, available: false });
  }
}
