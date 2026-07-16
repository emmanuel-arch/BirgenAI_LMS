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
