// ─────────────────────────────────────────────────────────────────────────────
// SMS credits — who pays for this message, before it leaves.
//
// Every other real-cost meter (CRB, KYC) is feature-gated BEFORE the third-party
// call, so an unpaid org simply cannot spend our money. SMS cannot work that way:
// a borrower's signing code has to go out whatever the ledger says, or a billing
// lapse locks real people out of their own loan agreements. So SMS is PREPAID,
// with one carefully bounded exception, and this file is the order of payment:
//
//   1. the lender's OWN provider (vault SMS config) — costs us nothing, charges
//      nothing, touches no wallet;
//   2. the plan's monthly allowance, spent chronologically like every allowance
//      on an invoice;
//   3. purchased credits (SmsWallet.balance), decremented atomically per send;
//   4. at zero: CRITICAL templates (codes, consent links) overdraw into the
//      negative — the next top-up settles it — while discretionary messages
//      (reminders, dunning) stay QUEUED until credit arrives.
//
// The money side never happens here. Packs are bought through the Hub wallet —
// the platform rule — and arrive as SmsTopUp rows via the read-back sync, whose
// idempotency is the `hubReference` unique constraint, not our diligence.
// ─────────────────────────────────────────────────────────────────────────────
import { Prisma, type SmsTopUpSource } from "@prisma/client";
import { prisma, orgTx } from "@/lib/prisma";
import { runWithOrg } from "@/lib/db/context";
import { entitlementsFor, currentPeriod } from "@/lib/billing/entitlements";

/** How each dispatched message was paid for. Stamped into the usage event. */
export type SmsFunding = "own-provider" | "allowance" | "credit" | "overdraft" | "refused";

/**
 * Templates that may overdraw an empty wallet. The test is: does a lending flow
 * BLOCK until this message arrives? A signing code does; a payment reminder is
 * money-saving but survivable. Dunning stops at zero credit — that pressure is
 * the product working, not a bug.
 */
const CRITICAL_TEMPLATES = new Set(["otp", "verify", "offer_sign", "guarantor_sign", "guarantor_invite"]);

export const isCriticalTemplate = (templateKey: string): boolean => CRITICAL_TEMPLATES.has(templateKey);

/** Current balance. Absent wallet = zero — a lender who never topped up owes nothing. */
export async function smsBalance(orgId: string): Promise<number> {
  const w = await runWithOrg(orgId, () => prisma.smsWallet.findUnique({ where: { orgId } }));
  return w?.balance ?? 0;
}

/**
 * Decide — and take — the funding for ONE message about to be dispatched.
 *
 * Self-scoping (the tuningFor lesson: a helper that assumes its caller's tenant
 * context silently falls back to the wrong answer from a webhook or cron).
 *
 * The allowance check is a read-then-send: two concurrent sends at 499/500 can
 * both land inside the allowance and we give one message away. That race costs
 * at most a shilling and never goes the other way — the wallet decrement below
 * it is atomic, so purchased credits cannot be double-spent.
 */
export async function fundSms(orgId: string, templateKey: string, platformProvider: boolean): Promise<SmsFunding> {
  if (!platformProvider) return "own-provider";

  return runWithOrg(orgId, async () => {
    // 2. Monthly allowance, measured the same way the billing page measures it.
    const ent = await entitlementsFor(orgId);
    const included = ent.included.sms ?? 0;
    if (included > 0) {
      const { start, end } = currentPeriod();
      const used = await prisma.usageEvent.aggregate({
        where: { orgId, kind: "sms", createdAt: { gte: start, lt: end } },
        _sum: { qty: true },
      });
      if ((used._sum.qty ?? 0) < included) return "allowance";
    }

    // 3. Purchased credit. The floor in the WHERE clause is the atomicity: two
    // concurrent sends racing for the last credit resolve inside Postgres, and
    // exactly one of them gets it.
    await ensureWallet(orgId);
    const got = await prisma.smsWallet.updateMany({
      where: { orgId, balance: { gte: 1 } },
      data: { balance: { decrement: 1 } },
    });
    if (got.count === 1) return "credit";

    // 4. Nothing left. A code still goes — into overdraft the next top-up settles.
    if (isCriticalTemplate(templateKey)) {
      await prisma.smsWallet.update({ where: { orgId }, data: { balance: { decrement: 1 } } });
      return "overdraft";
    }
    return "refused";
  });
}

/**
 * Give one unit back — the dispatch failed after we took the credit. A message
 * the provider never accepted is not a message the lender paid for.
 */
export async function refundSmsCredit(orgId: string): Promise<void> {
  try {
    await runWithOrg(orgId, () =>
      prisma.smsWallet.update({ where: { orgId }, data: { balance: { increment: 1 } } }),
    );
  } catch (err) {
    console.error(`[sms-wallet] refund failed for org ${orgId}:`, err);
  }
}

async function ensureWallet(orgId: string): Promise<void> {
  await prisma.smsWallet.upsert({ where: { orgId }, create: { orgId, balance: 0 }, update: {} });
}

export type CreditTopUpInput = {
  orgId: string;
  units: number;
  amountKes: number;
  source: SmsTopUpSource;
  /** The Hub's settlement record. Unique — crediting the same payment twice is impossible. */
  hubReference?: string | null;
  note?: string | null;
  createdBy?: string | null;
};

/**
 * Credit a purchase or grant: ledger row + balance move in ONE transaction, so
 * the invariant `balance = Σ top-ups − funded sends` cannot be broken by a crash
 * between the two writes. Returns false when this hubReference was already
 * credited — the caller (a sync that re-reads the Hub nightly) treats that as
 * "nothing new", not an error.
 */
export async function creditTopUp(input: CreditTopUpInput): Promise<boolean> {
  const units = Math.floor(input.units);
  if (units < 1 || units > 1_000_000) throw new Error(`Refusing a top-up of ${input.units} units.`);

  try {
    await runWithOrg(input.orgId, () =>
      orgTx(async (tx) => {
        await tx.smsTopUp.create({
          data: {
            orgId: input.orgId,
            units,
            amountKes: new Prisma.Decimal(input.amountKes),
            source: input.source,
            hubReference: input.hubReference ?? null,
            note: input.note ?? null,
            createdBy: input.createdBy ?? null,
          },
        });
        await tx.smsWallet.upsert({
          where: { orgId: input.orgId },
          create: { orgId: input.orgId, balance: units },
          update: { balance: { increment: units } },
        });
      }),
    );
    return true;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return false;
    throw err;
  }
}

/** The billing page's Messaging card, in one read. */
export async function smsWalletSummary(orgId: string) {
  return runWithOrg(orgId, async () => {
    const [wallet, topups, queued] = await Promise.all([
      prisma.smsWallet.findUnique({ where: { orgId } }),
      prisma.smsTopUp.findMany({
        where: { orgId },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, units: true, amountKes: true, source: true, note: true, createdAt: true },
      }),
      prisma.smsMessage.count({ where: { orgId, state: "QUEUED" } }),
    ]);
    return {
      balance: wallet?.balance ?? 0,
      queued,
      topups: topups.map((t) => ({ ...t, amountKes: Number(t.amountKes) })),
    };
  });
}
