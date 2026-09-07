// ─────────────────────────────────────────────────────────────────────────────
// UPFRONT CHARGES — the gate before a loan is processed.
//
// The lender's rule, in the founder's words: "the first process before processing
// your loan is checking your account balance, because we deduct the money before
// disbursement, not after." So an application cannot enter the queue while a
// registration or processing fee is still owed — the officer is told "Pay all
// upfront charges" and the fees are handed back so the counter can collect them.
//
// A registration fee (ON_REGISTRATION) is one-off: any successful payment ever
// satisfies it. A processing fee (ON_APPLICATION) is per-application: it must have
// been paid AFTER the borrower's most recent prior application, so a second loan
// cannot ride in on the first loan's fee. Percentage fees are priced off the
// principal being requested — server-side, never from the client.
//
// Only BEFORE_DISBURSEMENT fees gate. A fee that is netted off the principal, or
// spread across the installments, is taken out of money that is already moving —
// demanding it at the counter first would be charging for it twice.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";
import { chargeAmount, chargeAppliesTo } from "@/lib/payments/request";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type UpfrontCharge = { id: string; code: string; name: string; amount: number; trigger: string };

export async function unpaidUpfrontCharges(opts: {
  orgId: string;
  borrowerId: string;
  productId: string | null;
  /** The principal the fee is a percentage of, and the band that selects it. */
  principal: number;
}): Promise<{ unpaid: UpfrontCharge[]; total: number }> {
  const productClause = opts.productId ? { OR: [{ productId: null }, { productId: opts.productId }] } : { productId: null };
  const all = await prisma.charge.findMany({
    where: {
      orgId: opts.orgId, isActive: true,
      trigger: { in: ["ON_REGISTRATION", "ON_APPLICATION"] },
      applyAt: "BEFORE_DISBURSEMENT",
      ...productClause,
    },
    select: {
      id: true, code: true, name: true, amount: true, isPercent: true, trigger: true,
      minValue: true, maxValue: true, minPrincipal: true, maxPrincipal: true,
    },
  });
  const charges = all.filter((c) => chargeAppliesTo(c, opts.principal));
  if (charges.length === 0) return { unpaid: [], total: 0 };

  const lastApp = await prisma.loanApplication.findFirst({
    where: { orgId: opts.orgId, borrowerId: opts.borrowerId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  const unpaid: UpfrontCharge[] = [];
  for (const c of charges) {
    // One pricing function for the whole system — the gate must quote exactly what
    // the STK push will ask for, clamps and all, or the customer pays and stays blocked.
    const amt = round2(chargeAmount(c, opts.principal));
    const freshnessFence = c.trigger === "ON_APPLICATION" && lastApp ? { gt: lastApp.createdAt } : undefined;
    const paid = await prisma.paymentIntent.findFirst({
      where: {
        orgId: opts.orgId, borrowerId: opts.borrowerId, chargeId: c.id,
        purpose: "CHARGE", state: "SUCCESS",
        ...(freshnessFence ? { createdAt: freshnessFence } : {}),
      },
      select: { id: true },
    });
    if (!paid) unpaid.push({ id: c.id, code: c.code, name: c.name, amount: amt, trigger: c.trigger });
  }

  return { unpaid, total: round2(unpaid.reduce((s, c) => s + c.amount, 0)) };
}

// ─────────────────────────────────────────────────────────────────────────────
// THE OTHER WAY TO COLLECT A FEE: net it off the money on its way out.
//
// A BEFORE_DISBURSEMENT fee has to be in hand before the loan exists, which means
// the customer needs cash before they can borrow — the thing they came in without.
// A DEDUCT_FROM_PRINCIPAL fee is taken out of the disbursement instead: they
// borrow 15,000, they receive 13,950, and they owe 15,000. Same money to the
// lender, no cash required up front, and nothing to collect at the counter.
//
// The schema and the upfront gate have both understood this from the start —
// `unpaidUpfrontCharges` above deliberately filters to BEFORE_DISBURSEMENT so that
// a netted fee is not ALSO demanded at the counter. What was missing is the other
// half: something that actually performs the netting. lending/book.ts created the
// disbursement for the full principal with a comment reading "net-of-fees logic
// lands with the fee engine", and until now it never landed. A charge set to
// DEDUCT_FROM_PRINCIPAL was therefore silently never charged at all.
//
// PRICED BY THE SAME FUNCTION AS EVERYTHING ELSE. chargeAmount/chargeAppliesTo are
// what the gate quotes and what the STK push asks for, clamps and bands included.
// A second pricing rule here is how the offer, the prompt and the payout start
// disagreeing about what a loan costs.
// ─────────────────────────────────────────────────────────────────────────────

export type DeductedCharge = { id: string; code: string; name: string; amount: number };

/**
 * Fees taken out of the principal at disbursement, for a given loan size.
 *
 * `net` is what actually leaves the float and reaches the customer. It is floored
 * at zero: a fee table that eats the whole principal is a configuration mistake,
 * and a negative B2C amount would be a far stranger one.
 */
export async function principalDeductions(opts: {
  orgId: string;
  productId: string | null;
  principal: number;
}): Promise<{ deductions: DeductedCharge[]; total: number; net: number }> {
  const productClause = opts.productId ? { OR: [{ productId: null }, { productId: opts.productId }] } : { productId: null };
  const all = await prisma.charge.findMany({
    where: {
      orgId: opts.orgId, isActive: true,
      applyAt: "DEDUCT_FROM_PRINCIPAL",
      ...productClause,
    },
    select: {
      id: true, code: true, name: true, amount: true, isPercent: true,
      minValue: true, maxValue: true, minPrincipal: true, maxPrincipal: true,
    },
  });

  const deductions = all
    .filter((c) => chargeAppliesTo(c, opts.principal))
    .map((c) => ({ id: c.id, code: c.code, name: c.name, amount: round2(chargeAmount(c, opts.principal)) }))
    .filter((d) => d.amount > 0);

  const total = round2(deductions.reduce((s, d) => s + d.amount, 0));
  return { deductions, total, net: round2(Math.max(0, opts.principal - total)) };
}
