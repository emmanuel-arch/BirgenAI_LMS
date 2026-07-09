// ─────────────────────────────────────────────────────────────────────────────
// Usage metering — the raw material of an invoice.
//
// One rule: the unit price is FROZEN onto the event at the moment it happens.
// The catalogue in plans.ts is a deployable and will change; last month's invoice
// must not. A UsageEvent that says "1 CRB pull, KES 35" stays true forever, even
// after we reprice CRB to 40.
//
// Metering never throws and never blocks. A lender's loan disbursement does not
// fail because our billing counter had a bad day — we would rather lose the
// event than the loan. (The events we cannot afford to lose are the ones with a
// real third-party cost behind them, and those are gated BEFORE the call is made,
// so an ungated call never happens in the first place.)
// ─────────────────────────────────────────────────────────────────────────────
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { runWithOrg } from "@/lib/db/context";
import { UNIT_PRICE_KES, type UsageKind } from "./plans";

/**
 * Record `qty` units of `kind` against `orgId`.
 *
 * Fire-and-forget by design — callers should NOT await this on a hot path, but
 * awaiting it is safe. Binds its own tenant scope so it works from a webhook, a
 * cron sweep, or a borrower route with no session.
 */
export async function meter(
  orgId: string,
  kind: UsageKind,
  qty = 1,
  meta?: Record<string, unknown>,
): Promise<void> {
  if (!orgId || qty <= 0) return;
  try {
    await runWithOrg(orgId, () =>
      prisma.usageEvent.create({
        data: {
          orgId,
          kind,
          qty,
          // The price as charged, not the price as currently listed.
          unitCost: new Prisma.Decimal(UNIT_PRICE_KES[kind] ?? 0),
          meta: (meta ?? {}) as Prisma.InputJsonValue,
        },
      }),
    );
  } catch (err) {
    console.error(`[meter] dropped ${qty}x ${kind} for org ${orgId}:`, err);
  }
}

export type UsageTotals = Record<UsageKind, number>;

/** Units consumed per kind within [from, to). Drives the billing page and invoices. */
export async function usageBetween(orgId: string, from: Date, to: Date): Promise<UsageTotals> {
  const rows = await prisma.usageEvent.groupBy({
    by: ["kind"],
    where: { orgId, createdAt: { gte: from, lt: to } },
    _sum: { qty: true },
  });
  const totals = {} as UsageTotals;
  for (const r of rows) totals[r.kind as UsageKind] = r._sum.qty ?? 0;
  return totals;
}
