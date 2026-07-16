// ─────────────────────────────────────────────────────────────────────────────
// REQUEST A PAYMENT — the one road every shilling travels down.
//
// There are many places a member of staff needs to ask a customer for money:
//
//   · a loan officer with a walk-in at the counter, taking the registration fee
//   · the same officer taking a processing fee as the application goes in
//   · a collections agent on the phone, prompting for the installment that is due
//   · a field agent at the customer's shop, taking whatever they can get today
//   · the customer themselves, on the portal, paying their own loan
//
// Those are five screens. They must not be five implementations. Every one of them
// calls THIS function, and everything that matters — what the money is for, whose
// money it becomes, what the customer sees on their phone, and how the receipt finds
// its way home when it lands — is decided here, once, on the server.
//
// THREE RULES, AND THEY ARE THE WHOLE DESIGN:
//
//   1. THE AMOUNT IS NEVER TAKEN FROM THE CLIENT for a charge. It is read from the
//      Charge row. A price a browser can set is not a price, it is a suggestion.
//
//   2. THE PURPOSE IS RECORDED WHEN THE REQUEST IS MADE, never inferred from the
//      amount when the money arrives. Infer it later and a KES 200 processing fee
//      lands on a KES 200 installment, the loan looks paid, and nobody can see why.
//
//   3. THE BENEFICIARY DECIDES THE TILL. The lender's interest and principal are the
//      LENDER's and settle to the lender's own paybill. BirgenAI's fees are OURS and
//      settle to the platform Till. One button that cannot tell those apart is a
//      button that quietly pays the wrong party.
//
// Reconciliation is the mirror image: the STK callback finds the PaymentIntent by its
// CheckoutRequestID, reads the purpose off the row, and does the one right thing.
// See src/lib/payments/settle.ts.
// ─────────────────────────────────────────────────────────────────────────────
import type { ChargeBeneficiary, PaymentPurpose } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { initiateStkPush, normalizeMsisdn } from "@/lib/mpesa/daraja";
import { getIntegration } from "@/lib/vault/integrations";

export type PaymentRequest = {
  orgId: string;
  orgSlug: string;
  purpose: PaymentPurpose;
  /** Required for CHARGE. The amount comes from this row, never from the caller. */
  chargeId?: string;
  /** Required for INSTALLMENT. Ignored for a pure fee. */
  loanId?: string;
  borrowerId?: string;
  /** CUSTOM only — an officer typed it. Ignored for CHARGE (see rule 1). */
  amount?: number;
  /** Defaults to the borrower's REGISTERED number. See below — this matters. */
  phone?: string;
  /** Who pressed the button. Null when the customer is paying for themselves. */
  requestedById?: string | null;
  /** c360 | collections | counter | field | portal | funnel */
  channel: string;
  note?: string;
};

export type PaymentRequestResult = {
  ok: boolean;
  intentId?: string;
  amount?: number;
  message: string;
  /** The M-Pesa prompt is on the customer's phone; nothing has been paid YET. */
  pending?: boolean;
};

/**
 * The customer's registered number, or an override — but ONLY a registered override.
 *
 * A free-text phone field on a "request payment" button is a fraud surface: an officer
 * could send the prompt to their own handset, pay a small fee themselves, and mark the
 * customer as having paid. So the number defaults to the one on the customer's record,
 * and an explicit override is allowed only where there is no borrower to have a record
 * (a walk-in being registered, who does not exist yet).
 */
async function resolvePhone(orgId: string, borrowerId: string | undefined, override: string | undefined): Promise<string | null> {
  if (borrowerId) {
    const b = await prisma.borrower.findFirst({ where: { id: borrowerId, orgId }, select: { phone: true, erasedAt: true } });
    if (!b || b.erasedAt) return null;
    return normalizeMsisdn(b.phone);
  }
  return override ? normalizeMsisdn(override) : null;
}

/** The shape of a priceable fee — the columns that decide what it costs. */
export type PriceableCharge = {
  amount: unknown;
  isPercent: boolean;
  minValue?: unknown;
  maxValue?: unknown;
  minPrincipal?: unknown;
  maxPrincipal?: unknown;
};

const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Does this fee's principal band cover the loan being written?
 *
 * A lender prices the same fee differently at different loan sizes (Micromart's
 * 4 WEEKS takes a 500 processing fee from 4,001 to 35,000 and nothing above it), so
 * the band — not the product alone — is what selects a row. An unset bound is open,
 * which is why an org-wide fee with no band at all matches everything.
 */
export function chargeAppliesTo(charge: PriceableCharge, principal?: number): boolean {
  const lo = num(charge.minPrincipal);
  const hi = num(charge.maxPrincipal);
  if (lo === null && hi === null) return true;
  // A banded fee is a statement about a loan size. With no principal in hand we
  // cannot say it applies, and guessing would either invent a fee or hide one.
  if (!principal || principal <= 0) return false;
  if (lo !== null && principal < lo) return false;
  if (hi !== null && principal > hi) return false;
  return true;
}

/** What this charge actually costs, given the loan it is attached to. */
export function chargeAmount(charge: PriceableCharge, principal?: number): number {
  const base = Number(charge.amount);
  if (!charge.isPercent) return Math.round(base);
  if (!principal || principal <= 0) return 0;

  // Percentage fees are clamped: 5% of a school-fees loan, but never below 1,000 nor
  // above 2,500. The clamp is the lender's real price list — applying the raw
  // percentage would undercharge the small loans and overcharge the large ones.
  const raw = (principal * base) / 100;
  const lo = num(charge.minValue);
  const hi = num(charge.maxValue);
  let priced = raw;
  if (lo !== null) priced = Math.max(priced, lo);
  if (hi !== null) priced = Math.min(priced, hi);
  return Math.round(priced);
}

/**
 * Whose credentials send this push.
 *
 * A LENDER charge and a loan repayment go out on the lender's own vault credentials —
 * their paybill, their money. A PLATFORM charge is BirgenAI's fee and goes out on the
 * platform's Till. Both are vault entries; they are just different orgs' vaults, and
 * "the platform" is simply the org that owns the Till.
 *
 * Today the platform Till lives in the Hub's env and is seeded into the org vault by
 * scripts/seed-charges.ts. Keeping it in the SAME mechanism as a lender's credentials
 * (rather than a special env-var path) means there is one code path to audit, one
 * place a key can leak from, and no "except for us" branch in the money rails.
 */
async function credentialsFor(orgId: string, beneficiary: ChargeBeneficiary): Promise<{ orgId: string; ok: boolean }> {
  if (beneficiary === "LENDER") {
    const cfg = await getIntegration(orgId, "MPESA_STK").catch(() => null);
    return { orgId, ok: !!cfg };
  }
  // PLATFORM fees settle to BirgenAI's own Till, wherever that vault entry lives.
  const platform = await prisma.org.findFirst({ where: { slug: PLATFORM_ORG_SLUG }, select: { id: true } });
  if (!platform) return { orgId, ok: false };
  const cfg = await getIntegration(platform.id, "MPESA_STK").catch(() => null);
  return { orgId: platform.id, ok: !!cfg };
}

/** The org whose vault holds BirgenAI's own Till. */
export const PLATFORM_ORG_SLUG = "hub";

export async function requestPayment(req: PaymentRequest): Promise<PaymentRequestResult> {
  const { orgId, orgSlug, purpose, channel } = req;

  // ── 1. What is being asked for, and how much. Server-side, always. ─────────
  let amount = 0;
  let reference = "PAYMENT";
  let description = "Payment";
  let beneficiary: ChargeBeneficiary = "LENDER";
  let chargeId: string | undefined;

  if (purpose === "CHARGE") {
    if (!req.chargeId) return { ok: false, message: "No charge was named." };
    const charge = await prisma.charge.findFirst({ where: { id: req.chargeId, orgId, isActive: true } });
    if (!charge) return { ok: false, message: "That charge does not exist, or is switched off." };

    // The principal is needed to price a percentage fee AND to test a banded one, so
    // read it whenever either applies — a flat 500 fee that only exists between 4,001
    // and 35,000 is still a statement about the loan.
    const banded = charge.minPrincipal !== null || charge.maxPrincipal !== null;
    let principal: number | undefined;
    if ((charge.isPercent || banded) && req.loanId) {
      const loan = await prisma.loan.findFirst({ where: { id: req.loanId, orgId }, select: { principal: true } });
      principal = loan ? Number(loan.principal) : undefined;
    }
    if (!chargeAppliesTo(charge, principal)) {
      return { ok: false, message: `${charge.name} does not apply to a loan of that size.` };
    }
    amount = chargeAmount(charge, principal);
    if (amount < 1) return { ok: false, message: "That charge works out at nothing — check how it is set up." };

    reference = charge.code;
    description = charge.name;
    beneficiary = charge.beneficiary;
    chargeId = charge.id;
  } else if (purpose === "INSTALLMENT") {
    if (!req.loanId) return { ok: false, message: "No loan was named." };
    const loan = await prisma.loan.findFirst({
      where: { id: req.loanId, orgId },
      select: { id: true, balance: true, status: true, installments: { where: { status: { not: "PAID" } }, orderBy: { dueDate: "asc" }, take: 1 } },
    });
    if (!loan) return { ok: false, message: "Loan not found." };
    if (loan.status === "CLEARED") return { ok: false, message: "That loan is already cleared." };

    const next = loan.installments[0];
    // An officer may ask for a specific amount (a part payment the customer offered);
    // otherwise we ask for the installment that is due. Never more than the balance —
    // asking a customer for more than they owe is how trust is lost.
    const due = next ? Number(next.amountDue) - Number(next.amountPaid) : Number(loan.balance);
    const asked = req.amount && req.amount > 0 ? Math.round(req.amount) : Math.round(due);
    amount = Math.min(asked, Math.round(Number(loan.balance)));
    if (amount < 1) return { ok: false, message: "There is nothing outstanding on that loan." };

    reference = loan.id.slice(0, 8).toUpperCase();
    description = "Loan repayment";
  } else {
    // CUSTOM — an officer typed a figure. It is theirs to justify, and it is audited.
    amount = Math.round(Number(req.amount) || 0);
    if (amount < 1) return { ok: false, message: "Enter an amount." };
    reference = req.loanId ? req.loanId.slice(0, 8).toUpperCase() : "PAYMENT";
    description = req.note?.slice(0, 13) || "Payment";
  }

  // ── 2. Who is being asked. ─────────────────────────────────────────────────
  const phone = await resolvePhone(orgId, req.borrowerId, req.phone);
  if (!phone) {
    return { ok: false, message: "No phone number on file for that customer." };
  }

  // ── 3. Whose till it lands in. ─────────────────────────────────────────────
  const creds = await credentialsFor(orgId, beneficiary);
  if (!creds.ok) {
    return {
      ok: false,
      message:
        beneficiary === "PLATFORM"
          ? "The BirgenAI platform Till is not configured — platform fees cannot be collected yet."
          : "M-Pesa is not connected for this lender (Settings → Vault).",
    };
  }

  // ── 4. The record comes FIRST. ─────────────────────────────────────────────
  // If the STK call succeeds and we crash before writing the row, a customer has paid
  // money the system has no memory of. Write the intent, then push; a push that fails
  // leaves a FAILED row, which is noise. Money with no record is not noise.
  const intent = await prisma.paymentIntent.create({
    data: {
      orgId,
      purpose,
      chargeId,
      loanId: req.loanId ?? null,
      borrowerId: req.borrowerId ?? null,
      beneficiary,
      phone,
      amount,
      reference,
      channel,
      requestedById: req.requestedById ?? null,
      state: "INITIATED",
    },
  });

  // ── 5. Push. ───────────────────────────────────────────────────────────────
  const res = await initiateStkPush(creds.orgId, orgSlug, {
    phone,
    amount,
    accountReference: reference,
    description,
  });

  await prisma.paymentIntent.update({
    where: { id: intent.id },
    data: {
      state: res.ok ? "PENDING" : "FAILED",
      checkoutRequestId: res.checkoutRequestId || null,
      merchantRequestId: res.merchantRequestId || null,
      resultDesc: res.ok ? null : res.message,
      raw: (res.raw ?? undefined) as never,
    },
  }).catch(() => {});

  await prisma.auditLog.create({
    data: {
      orgId,
      actorId: req.requestedById ?? undefined,
      actorType: req.requestedById ? "staff" : "borrower",
      action: "payment.request",
      entity: "PaymentIntent",
      entityId: intent.id,
      meta: { purpose, amount, beneficiary, channel, phone: phone.slice(0, 6) + "••••", ok: res.ok },
    },
  }).catch(() => {});

  if (!res.ok) return { ok: false, intentId: intent.id, amount, message: res.message };

  return {
    ok: true,
    intentId: intent.id,
    amount,
    pending: true,
    message: `Sent. Ask them to enter their M-Pesa PIN — KES ${amount.toLocaleString()} for ${description}.`,
  };
}

// ── What can be asked of this customer right now ──────────────────────────────

export type Askable = {
  kind: "charge" | "installment";
  id: string;
  label: string;
  sublabel: string;
  amount: number;
  beneficiary: ChargeBeneficiary;
  loanId?: string;
};

/**
 * Everything it would make sense to ask this customer for, in the order a human would
 * think of it. Powers the one dropdown that appears on every surface — so a collections
 * agent and a counter officer see the same options for the same customer, because they
 * are looking at the same truth.
 */
export async function askablesFor(orgId: string, borrowerId: string): Promise<Askable[]> {
  const [charges, loans] = await Promise.all([
    prisma.charge.findMany({ where: { orgId, isActive: true }, orderBy: { createdAt: "asc" } }),
    prisma.loan.findMany({
      where: { orgId, borrowerId, status: "ACTIVE" },
      select: {
        id: true, balance: true, principal: true, productId: true,
        installments: { where: { status: { not: "PAID" } }, orderBy: { dueDate: "asc" }, take: 1 },
      },
    }),
  ]);

  const out: Askable[] = [];

  // The money they owe comes first — it is what anyone is actually ringing about.
  for (const loan of loans) {
    const next = loan.installments[0];
    const due = next ? Number(next.amountDue) - Number(next.amountPaid) : Number(loan.balance);
    if (due > 0) {
      out.push({
        kind: "installment",
        id: loan.id,
        loanId: loan.id,
        label: "Installment due",
        sublabel: next ? `Due ${next.dueDate.toISOString().slice(0, 10)} · balance KES ${Math.round(Number(loan.balance)).toLocaleString()}` : "Outstanding balance",
        amount: Math.round(Math.min(due, Number(loan.balance))),
        beneficiary: "LENDER",
      });
    }
  }

  for (const c of charges) {
    // A fee scoped to a product is only askable of someone who actually holds a loan on
    // that product — otherwise every product's processing fee would be offered against
    // every customer. An unscoped fee (registration) belongs to the whole shelf, and is
    // priced against whatever loan they have, if any.
    const loan = c.productId ? loans.find((l) => l.productId === c.productId) : loans[0];
    if (c.productId && !loan) continue;

    const principal = loan ? Number(loan.principal) : undefined;
    if (!chargeAppliesTo(c, principal)) continue;

    const amt = chargeAmount(c, principal);
    if (amt < 1) continue;
    out.push({
      kind: "charge",
      id: c.id,
      label: c.name,
      sublabel: c.description ?? (c.beneficiary === "PLATFORM" ? "BirgenAI platform fee" : "Lender fee"),
      amount: amt,
      beneficiary: c.beneficiary,
      loanId: loan?.id,
    });
  }

  return out;
}
