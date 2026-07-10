// ─────────────────────────────────────────────────────────────────────────────
// Closing a month.
//
// Metering has always frozen the unit price onto each UsageEvent. This is what that
// was for: an invoice is built from the prices AS CHARGED, event by event, and never
// from today's catalogue. Reprice CRB from 35 to 40 tomorrow and last month's
// invoice does not move by a shilling.
//
// The allowance is consumed CHRONOLOGICALLY. If a plan includes 100 CRB pulls and a
// lender made 90 at KES 35 and 20 more after we repriced to 40, they used up their
// allowance on the cheap ones first — 10 free at 35, then 20 billed at 40 — because
// that is the order the pulls actually happened in. Averaging the two prices, or
// billing the overage at whichever rate is current, would both be defensible-looking
// and wrong. The invoice therefore carries one line per (kind, price) pair.
//
// Freezing is idempotent. `@@unique([orgId, periodStart])` means the monthly cron can
// run twice, or be retried after a timeout, without billing a lender twice — the
// second attempt finds the existing invoice and returns it untouched.
//
// A trial month is not billed at all. Not billed at zero: no invoice. A lender who
// never paid us anything should not receive a piece of paper implying they did.
// ─────────────────────────────────────────────────────────────────────────────
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { runWithOrg } from "@/lib/db/context";
import {
  PLANS, USAGE_LABEL, isBillableKind, planFor,
  type UsageKind,
} from "./plans";
import type { OrgPlan } from "@prisma/client";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type BuiltLine = {
  kind: string;
  label: string;
  qty: number;
  includedQty: number;
  unitCostKes: number;
  amountKes: number;
};

/**
 * Walk one kind's events in the order they happened, spend the allowance, and bill
 * whatever is left at the price each event actually carried.
 */
export function billKind(
  kind: UsageKind,
  events: { qty: number; unitCost: number }[],
  included: number,
): BuiltLine[] {
  let free = Math.max(0, included);
  /** price → units billed at it. Insertion order is chronological. */
  const billed = new Map<number, number>();

  for (const e of events) {
    let units = e.qty;
    if (free > 0) {
      const covered = Math.min(free, units);
      free -= covered;
      units -= covered;
    }
    if (units > 0) billed.set(e.unitCost, (billed.get(e.unitCost) ?? 0) + units);
  }

  const usedFree = Math.max(0, included) - free;
  return [...billed.entries()].map(([unitCostKes, qty]) => ({
    kind,
    label: USAGE_LABEL[kind],
    qty,
    includedQty: usedFree,
    unitCostKes,
    amountKes: round2(qty * unitCostKes),
  }));
}

export type FrozenInvoice = {
  id: string;
  number: string;
  planFeeKes: number;
  overageKes: number;
  totalKes: number;
  lines: BuiltLine[];
  alreadyExisted: boolean;
};

/** The month `date` falls in, as a half-open [start, end) window in UTC. */
export function monthWindow(date: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  return { start, end };
}

export const nextMonth = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));

const invoiceNumber = (slug: string, start: Date) =>
  `INV-${slug.toUpperCase()}-${start.getUTCFullYear()}${String(start.getUTCMonth() + 1).padStart(2, "0")}`;

/**
 * Freeze [periodStart, periodEnd) into an invoice. Idempotent.
 *
 * Returns null when there is nothing to bill: a month spent entirely on trial, or an
 * org with no subscription at all.
 */
export async function freezeInvoice(orgId: string, periodStart: Date, periodEnd: Date): Promise<FrozenInvoice | null> {
  return runWithOrg(orgId, async () => {
    const existing = await prisma.invoice.findUnique({
      where: { orgId_periodStart: { orgId, periodStart } },
      include: { lines: true },
    });
    if (existing) {
      return {
        id: existing.id, number: existing.number,
        planFeeKes: Number(existing.planFeeKes), overageKes: Number(existing.overageKes),
        totalKes: Number(existing.totalKes),
        lines: existing.lines.map((l) => ({
          kind: l.kind, label: l.label, qty: l.qty, includedQty: l.includedQty,
          unitCostKes: Number(l.unitCostKes), amountKes: Number(l.amountKes),
        })),
        alreadyExisted: true,
      };
    }

    const org = await prisma.org.findUniqueOrThrow({ where: { id: orgId }, select: { slug: true, plan: true } });
    const sub = await prisma.orgSubscription.findUnique({ where: { orgId } });
    if (!sub) return null;

    // A trial that covered the whole month owes nothing, and gets no invoice.
    if (sub.trialEndsAt && sub.trialEndsAt >= periodEnd) return null;
    if (sub.status === "CANCELED" && sub.currentPeriodEnd <= periodStart) return null;

    const plan = planFor(org.plan as OrgPlan);
    const included = { ...plan.included, ...((sub.includedOverrides ?? {}) as Partial<Record<UsageKind, number>>) };

    const events = await prisma.usageEvent.findMany({
      where: { orgId, createdAt: { gte: periodStart, lt: periodEnd } },
      orderBy: { createdAt: "asc" },
      select: { kind: true, qty: true, unitCost: true },
    });

    const byKind = new Map<UsageKind, { qty: number; unitCost: number }[]>();
    for (const e of events) {
      const kind = e.kind as UsageKind;
      // A kind whose tool does not exist is never billed, whatever got recorded.
      if (!isBillableKind(kind)) continue;
      const arr = byKind.get(kind) ?? [];
      arr.push({ qty: e.qty, unitCost: Number(e.unitCost ?? 0) });
      byKind.set(kind, arr);
    }

    const usageLines = [...byKind.entries()].flatMap(([kind, evs]) => billKind(kind, evs, included[kind] ?? 0));
    const overageKes = round2(usageLines.reduce((s, l) => s + l.amountKes, 0));

    const planFeeKes = plan.monthlyKes;
    const lines: BuiltLine[] = [
      { kind: "subscription", label: `${plan.name} package`, qty: 1, includedQty: 0, unitCostKes: planFeeKes, amountKes: planFeeKes },
      ...usageLines,
    ];
    const totalKes = round2(planFeeKes + overageKes);

    const invoice = await prisma.invoice.create({
      data: {
        orgId,
        number: invoiceNumber(org.slug, periodStart),
        periodStart, periodEnd,
        plan: plan.key,
        planFeeKes: new Prisma.Decimal(planFeeKes),
        overageKes: new Prisma.Decimal(overageKes),
        totalKes: new Prisma.Decimal(totalKes),
        lines: {
          create: lines.map((l) => ({
            orgId, kind: l.kind, label: l.label, qty: l.qty, includedQty: l.includedQty,
            unitCostKes: new Prisma.Decimal(l.unitCostKes),
            amountKes: new Prisma.Decimal(l.amountKes),
          })),
        },
      },
    });

    return { id: invoice.id, number: invoice.number, planFeeKes, overageKes, totalKes, lines, alreadyExisted: false };
  });
}

/** What a lender is looking at right now — the open month, not yet frozen. */
export async function estimateOpenPeriod(orgId: string, plan: OrgPlan, includedOverrides: Partial<Record<UsageKind, number>> | null) {
  const { start, end } = monthWindow(new Date());
  const p = PLANS[plan] ?? PLANS.STARTER;
  const included = { ...p.included, ...(includedOverrides ?? {}) };

  const events = await prisma.usageEvent.findMany({
    where: { orgId, createdAt: { gte: start, lt: end } },
    orderBy: { createdAt: "asc" },
    select: { kind: true, qty: true, unitCost: true },
  });
  const byKind = new Map<UsageKind, { qty: number; unitCost: number }[]>();
  for (const e of events) {
    const kind = e.kind as UsageKind;
    if (!isBillableKind(kind)) continue;
    const arr = byKind.get(kind) ?? [];
    arr.push({ qty: e.qty, unitCost: Number(e.unitCost ?? 0) });
    byKind.set(kind, arr);
  }
  const lines = [...byKind.entries()].flatMap(([kind, evs]) => billKind(kind, evs, included[kind] ?? 0));
  const overageKes = round2(lines.reduce((s, l) => s + l.amountKes, 0));
  return { periodStart: start, periodEnd: end, planFeeKes: p.monthlyKes, overageKes, totalKes: round2(p.monthlyKes + overageKes), lines };
}
