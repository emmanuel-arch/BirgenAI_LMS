// ─────────────────────────────────────────────────────────────────────────────
// SETTLE — the money landed. Where does it go?
//
// The mirror of request.ts, and the reason the purpose is written down at request
// time rather than guessed at here.
//
// THE BUG THIS EXISTS TO PREVENT. The STK callback used to do one thing: "if the
// intent has a loanId, allocate the money to that loan". The moment fees exist, that
// is wrong in both directions —
//
//   · A PROCESSING FEE is charged as a percentage of a loan, so it carries that
//     loan's id. Allocated as a repayment, the customer's KES 200 fee silently pays
//     down their balance. The lender never receives the fee, the loan reads as
//     partly repaid, and the arithmetic is wrong from that day on.
//   · A REGISTRATION FEE has no loan at all, so the old code raised a HIGH-severity
//     "M-Pesa confirmed this money and the request had NO loan attached — find where
//     this money belongs" exception. Which is a false alarm on every single fee, and
//     an exceptions queue that cries wolf is an exceptions queue nobody reads.
//
// So: the purpose was recorded when the request was made, and settlement reads it.
// Nothing is inferred from the amount, ever.
// ─────────────────────────────────────────────────────────────────────────────
import type { PaymentIntent } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { allocateRepayment } from "@/lib/lending/allocate";
import { depositToBorrower } from "@/lib/savings/ledger";
import { sendSms } from "@/lib/sms/send";
import { raiseException } from "@/lib/finance/reconcile";

export type SettleResult = { applied: boolean; how: string };

/**
 * Apply a confirmed payment. Call inside the org's RLS fence.
 *
 * IDEMPOTENT. Daraja retries callbacks, and M-Pesa will happily deliver the same
 * confirmation twice. `settledAt` is the latch: once set, the money has been applied
 * and a second delivery does nothing. Without it, a retried callback allocates the
 * same shilling to the same loan a second time and the customer's balance falls by
 * money nobody paid.
 */
export async function settlePayment(
  orgId: string,
  orgName: string,
  intent: PaymentIntent,
  amount: number,
  receipt: string,
): Promise<SettleResult> {
  if (intent.settledAt) return { applied: true, how: "already-settled" };

  const stamp = () => prisma.paymentIntent.update({ where: { id: intent.id }, data: { settledAt: new Date() } }).catch(() => {});

  // ── A FEE. It is income, not a repayment. It never touches the loan. ───────
  if (intent.purpose === "CHARGE") {
    const charge = intent.chargeId
      ? await prisma.charge.findFirst({ where: { id: intent.chargeId, orgId }, select: { name: true, beneficiary: true } })
      : null;

    await stamp();
    await prisma.auditLog.create({
      data: {
        orgId,
        actorType: "system",
        action: "payment.charge-paid",
        entity: "PaymentIntent",
        entityId: intent.id,
        meta: {
          charge: charge?.name ?? intent.reference,
          beneficiary: intent.beneficiary,
          amount,
          mpesaReceipt: receipt || null,
        },
      },
    }).catch(() => {});

    // The customer gets a receipt for a fee exactly as they do for a repayment. A fee
    // taken with no acknowledgement is the kind of thing that turns into a complaint.
    await sendSms(orgId, intent.phone, "payment", {
      org: orgName,
      amount: Math.round(amount).toLocaleString(),
      balance: "0",
    }).catch(() => {});

    return { applied: true, how: `charge:${charge?.name ?? intent.reference ?? "fee"}` };
  }

  // ── MONEY AGAINST A LOAN. ─────────────────────────────────────────────────
  if (intent.loanId) {
    try {
      const result = await allocateRepayment(intent.loanId, amount, `STK:${receipt || intent.checkoutRequestId || intent.id}`);
      await stamp();
      await sendSms(orgId, intent.phone, result.cleared ? "cleared" : "payment", {
        org: orgName,
        amount: Math.round(amount).toLocaleString(),
        balance: Math.round(result.newBalance).toLocaleString(),
      }).catch(() => {});
      return { applied: true, how: result.cleared ? "loan:cleared" : "loan:allocated" };
    } catch (err) {
      await raiseException(orgId, {
        kind: "STK_SUCCESS_UNAPPLIED",
        reference: intent.id,
        severity: "HIGH",
        amountKes: amount,
        message:
          `M-Pesa confirmed KES ${Math.round(amount).toLocaleString()} from ${intent.phone}` +
          `${receipt ? ` (receipt ${receipt})` : ""} but it never posted to the loan. Apply it, or resolve with a note saying how it was handled.`,
        meta: { loanId: intent.loanId, mpesaReceipt: receipt || null, phone: intent.phone, error: err instanceof Error ? err.message : String(err) },
      });
      return { applied: false, how: "allocation-failed" };
    }
  }

  // ── A DEPOSIT FROM A KNOWN CUSTOMER, NO SPECIFIC LOAN. ────────────────────
  // The deposit rule (lib/savings/ledger.ts): offset their oldest live loan first,
  // then bank whatever remains to savings. A customer with no balance saves it all.
  // This is a home, not an exception — money from someone we can name always belongs
  // to that someone.
  if (intent.borrowerId) {
    try {
      const dep = await depositToBorrower({
        orgId, borrowerId: intent.borrowerId, amount,
        ref: receipt || intent.checkoutRequestId || intent.id,
        createdById: intent.requestedById,
      });
      await stamp();
      const balanceForSms = dep.loan && !dep.loan.cleared ? dep.loan.newBalance : (dep.savingsBalanceAfter ?? 0);
      await sendSms(orgId, intent.phone, dep.loan?.cleared ? "cleared" : "payment", {
        org: orgName,
        amount: Math.round(amount).toLocaleString(),
        balance: Math.round(balanceForSms).toLocaleString(),
      }).catch(() => {});
      const how = dep.loan
        ? (dep.toSavings > 0 ? "deposit:loan+savings" : "deposit:loan")
        : "deposit:savings";
      return { applied: true, how };
    } catch (err) {
      await raiseException(orgId, {
        kind: "STK_SUCCESS_UNAPPLIED",
        reference: intent.id,
        severity: "HIGH",
        amountKes: amount,
        message:
          `M-Pesa confirmed KES ${Math.round(amount).toLocaleString()} from ${intent.phone}` +
          `${receipt ? ` (receipt ${receipt})` : ""} for a known customer but it could not be banked. Apply it by hand.`,
        meta: { mpesaReceipt: receipt || null, phone: intent.phone, borrowerId: intent.borrowerId, error: err instanceof Error ? err.message : String(err) },
      });
      return { applied: false, how: "deposit-failed" };
    }
  }

  // ── A CUSTOM AMOUNT WITH NOTHING AND NO ONE TO APPLY IT TO. ────────────────
  // This IS a genuine exception: the money is real, confirmed, and belongs nowhere.
  await raiseException(orgId, {
    kind: "STK_SUCCESS_UNAPPLIED",
    reference: intent.id,
    severity: "HIGH",
    amountKes: amount,
    message:
      `M-Pesa confirmed KES ${Math.round(amount).toLocaleString()} from ${intent.phone}` +
      `${receipt ? ` (receipt ${receipt})` : ""} and the request had no loan, no charge and no customer attached. Find where this money belongs.`,
    meta: { mpesaReceipt: receipt || null, phone: intent.phone, purpose: intent.purpose },
  });
  return { applied: false, how: "unallocated" };
}
