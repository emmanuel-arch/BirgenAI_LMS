// ─────────────────────────────────────────────────────────────────────────────
// PORTAL RE-CRUNCH — the customer pays to refresh their own Internal Report.
//
// The Internal Report engine (analyze.ts) is our CRB-beating read of a customer's
// M-Pesa statement. In the console it is the lender's tool; on the borrower portal
// it becomes a SELF-SERVE product the customer pays for — "see your score, and
// refresh it whenever your money story changes." The price is the lender's, set as
// an ordinary Charge (code RECRUNCH), so a lender can turn it on, price it, or
// switch it off from the Charges screen like any other fee — no special config.
//
// A paid refresh is a one-shot ENTITLEMENT: one successful RECRUNCH payment buys
// exactly one crunch. The latch is an audit row (`recrunch.run`) written the moment
// the crunch runs, so a paid-but-unused credit is discoverable and a used one can
// never be spent twice — no schema column, and it reads straight from the trail a
// regulator would already ask for.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";
import { chargeAmount, type PriceableCharge } from "@/lib/payments/request";
import type { ChargeBeneficiary } from "@prisma/client";

/** The Charge code that turns on customer-paid statement refreshes. */
export const RECRUNCH_CODE = "RECRUNCH";

export type RecrunchOffer = { chargeId: string; name: string; amount: number; beneficiary: ChargeBeneficiary };

/** The lender's price for a customer-paid refresh — or null if they haven't set one. */
export async function recrunchOffer(orgId: string): Promise<RecrunchOffer | null> {
  const charge = await prisma.charge.findFirst({ where: { orgId, code: RECRUNCH_CODE, isActive: true } });
  if (!charge) return null;
  // A flat fee prices with no principal in hand; a percent one would come back 0
  // (there is no loan to take a percentage of), which correctly reads as "not set up".
  const amount = chargeAmount(charge as unknown as PriceableCharge);
  if (amount < 1) return null;
  return { chargeId: charge.id, name: charge.name, amount, beneficiary: charge.beneficiary };
}

/**
 * The id of a paid-but-not-yet-used re-crunch for this borrower, or null.
 *
 * A SUCCESS RECRUNCH payment with no `recrunch.run` audit against it is a credit
 * waiting to be spent. Newest first, so a customer who paid twice spends the fresh one.
 */
export async function unusedRecrunchIntent(orgId: string, borrowerId: string): Promise<string | null> {
  const paid = await prisma.paymentIntent.findMany({
    where: { orgId, borrowerId, purpose: "CHARGE", reference: RECRUNCH_CODE, state: "SUCCESS" },
    select: { id: true },
    orderBy: { createdAt: "desc" },
    take: 25,
  });
  if (!paid.length) return null;
  const used = await prisma.auditLog.findMany({
    where: { orgId, action: "recrunch.run", entityId: { in: paid.map((p) => p.id) } },
    select: { entityId: true },
  });
  const usedSet = new Set(used.map((u) => u.entityId));
  return paid.find((p) => !usedSet.has(p.id))?.id ?? null;
}
