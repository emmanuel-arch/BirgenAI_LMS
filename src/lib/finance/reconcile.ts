// ─────────────────────────────────────────────────────────────────────────────
// Reconciliation — does the money agree with the book?
//
// Every shilling that moves has two records: what M-Pesa says happened (a C2B
// receipt, an STK callback, a B2C result) and what the book says happened (an
// allocation, a loan state). This file is the referee between them. It never
// fixes anything by itself — money mistakes get corrected by a person with a
// note — it just refuses to let a disagreement stay invisible.
//
// Exceptions are written two ways, deliberately:
//   • the payment webhooks RAISE one the moment an allocation fails, while the
//     evidence is freshest (raiseException, called from their catch blocks);
//   • the nightly sweep RE-DERIVES every check from scratch, so a crashed
//     webhook, a missed event or a manual database edit still surfaces within
//     a day (reconcileOrg).
// The unique (orgId, kind, reference) key lets both writers coexist: the same
// fact lands in the same row, re-detection bumps lastSeenAt, and a condition
// that stops reproducing closes itself as "self-healed". IGNORED is a human
// decision and is never overturned by the sweep; RESOLVED that reappears is
// REOPENED, because the fix evidently didn't hold.
// ─────────────────────────────────────────────────────────────────────────────
import { Prisma, type ReconSeverity } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { runWithOrg } from "@/lib/db/context";

export type ReconKind =
  | "C2B_UNALLOCATED"
  | "STK_SUCCESS_UNAPPLIED"
  | "DISB_STUCK"
  | "DISB_LOAN_STATE_MISMATCH"
  | "DISB_AMOUNT_MISMATCH"
  | "DUP_RECEIPT"
  | "FLOAT_DRIFT";

export type ReconFact = {
  kind: ReconKind;
  /** The row this fact is about — receipt/intent/disbursement/loan id, or "float". */
  reference: string;
  severity: ReconSeverity;
  amountKes: number | null;
  message: string;
  meta?: Record<string, unknown>;
};

/** A B2C that has been "sending" longer than this has probably lost its callback. */
const STUCK_HOURS = 24;
/** How far back the STK-vs-book cross-check looks. Older months are frozen history. */
const STK_WINDOW_DAYS = 30;

const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

// ── The checks ────────────────────────────────────────────────────────────────

/** Money arrived at the paybill and is not on any loan. */
async function checkC2BUnallocated(orgId: string): Promise<ReconFact[]> {
  const receipts = await prisma.c2BReceipt.findMany({
    where: { orgId, allocatedLoanId: null },
    orderBy: { createdAt: "asc" },
  });
  return receipts.map((r) => ({
    kind: "C2B_UNALLOCATED" as const,
    reference: r.id,
    severity: "HIGH" as const,
    amountKes: Number(r.amount),
    message: `${kes(Number(r.amount))} paid to the paybill${r.phone ? ` by ${r.phone}` : ""}${r.billRef ? ` (account "${r.billRef}")` : ""} is not on any loan. Allocate it from Repayments.`,
    meta: { transId: r.transId, phone: r.phone, billRef: r.billRef, receivedAt: r.createdAt.toISOString() },
  }));
}

/**
 * M-Pesa confirmed an STK payment but the book never received it — the
 * allocation threw, or the intent had no loan attached. Detected by absence of
 * the allocation's own audit record (written in the same transaction as the
 * allocation, so no record means no posting).
 */
async function checkStkUnapplied(orgId: string): Promise<ReconFact[]> {
  const since = new Date(Date.now() - STK_WINDOW_DAYS * 86_400_000);
  const [intents, audits] = await Promise.all([
    prisma.paymentIntent.findMany({
      where: { orgId, state: "SUCCESS", createdAt: { gte: since } },
    }),
    prisma.auditLog.findMany({
      where: { orgId, action: "repayment.allocate", createdAt: { gte: new Date(since.getTime() - 86_400_000) } },
      select: { meta: true },
    }),
  ]);
  const posted = new Set(
    audits.map((a) => (a.meta as { ref?: string } | null)?.ref).filter((r): r is string => !!r),
  );

  const facts: ReconFact[] = [];
  for (const i of intents) {
    const refs = [i.mpesaReceipt ? `STK:${i.mpesaReceipt}` : null, i.checkoutRequestId ? `STK:${i.checkoutRequestId}` : null];
    if (refs.some((r) => r && posted.has(r))) continue;
    facts.push({
      kind: "STK_SUCCESS_UNAPPLIED",
      reference: i.id,
      severity: "HIGH",
      amountKes: Number(i.amount),
      message: i.loanId
        ? `M-Pesa confirmed ${kes(Number(i.amount))} from ${i.phone}${i.mpesaReceipt ? ` (receipt ${i.mpesaReceipt})` : ""} but it never posted to the loan. Apply it, or resolve with a note saying how it was handled.`
        : `M-Pesa confirmed ${kes(Number(i.amount))} from ${i.phone}${i.mpesaReceipt ? ` (receipt ${i.mpesaReceipt})` : ""} and the request had NO loan attached. Find where this money belongs.`,
      meta: { loanId: i.loanId, mpesaReceipt: i.mpesaReceipt, phone: i.phone, paidAt: i.updatedAt.toISOString() },
    });
  }
  return facts;
}

/** A B2C left (or is mid-flight) and Daraja has not answered for a day. */
async function checkDisbStuck(orgId: string): Promise<ReconFact[]> {
  const cutoff = new Date(Date.now() - STUCK_HOURS * 3_600_000);
  const stuck = await prisma.disbursement.findMany({
    where: { orgId, state: { in: ["SENDING", "SENT"] }, updatedAt: { lt: cutoff } },
  });
  return stuck.map((d) => ({
    kind: "DISB_STUCK" as const,
    reference: d.id,
    severity: "HIGH" as const,
    amountKes: Number(d.amount),
    message: `${kes(Number(d.amount))} to ${d.phone} has been "${d.state.toLowerCase()}" since ${d.updatedAt.toISOString().slice(0, 10)} with no confirmation. Check the M-Pesa org portal before retrying — the float may already be gone.`,
    meta: { loanId: d.loanId, b2cRef: d.b2cRef, state: d.state },
  }));
}

/** The loan's state and its payout's state tell two different stories. */
async function checkDisbLoanMismatch(orgId: string): Promise<ReconFact[]> {
  const loans = await prisma.loan.findMany({
    where: { orgId, status: { in: ["PENDING_DISBURSEMENT", "ACTIVE"] } },
    include: { disbursement: true },
  });

  const facts: ReconFact[] = [];
  for (const l of loans) {
    const d = l.disbursement;
    if (l.status === "PENDING_DISBURSEMENT" && d && (d.state === "CONFIRMED" || d.state === "MANUAL_CONFIRMED")) {
      facts.push({
        kind: "DISB_LOAN_STATE_MISMATCH",
        reference: l.id,
        severity: "HIGH",
        amountKes: Number(d.amount),
        message: `${kes(Number(d.amount))} was paid out (${d.receiptRef ?? d.b2cRef ?? "confirmed"}) but the loan was never activated — the borrower has the money and no schedule is running.`,
        meta: { disbursementId: d.id, disbState: d.state, loanStatus: l.status },
      });
    }
    if (l.status === "ACTIVE" && (!d || ["FAILED", "PENDING_MAKER", "PENDING_CHECKER"].includes(d.state))) {
      facts.push({
        kind: "DISB_LOAN_STATE_MISMATCH",
        reference: l.id,
        severity: "HIGH",
        amountKes: Number(l.principal),
        message: `The loan is live on the book but no confirmed payout stands behind it${d ? ` (disbursement is ${d.state.toLowerCase().replace(/_/g, " ")})` : " (no disbursement recorded at all)"}. Either money left off-system or the book is wrong.`,
        meta: { disbursementId: d?.id ?? null, disbState: d?.state ?? null, loanStatus: l.status },
      });
    }
  }
  return facts;
}

/** The payout does not equal the loan's principal. Sometimes fine — then say why. */
async function checkDisbAmount(orgId: string): Promise<ReconFact[]> {
  const disbs = await prisma.disbursement.findMany({
    where: { orgId, state: { in: ["SENDING", "SENT", "CONFIRMED", "MANUAL_CONFIRMED"] } },
    include: { loan: { select: { principal: true } } },
  });
  return disbs
    .filter((d) => !near(Number(d.amount), Number(d.loan.principal)))
    .map((d) => ({
      kind: "DISB_AMOUNT_MISMATCH" as const,
      reference: d.id,
      severity: "MEDIUM" as const,
      amountKes: Number(d.amount) - Number(d.loan.principal),
      message: `The payout was ${kes(Number(d.amount))} but the loan's principal is ${kes(Number(d.loan.principal))}. If fees were netted off, ignore this with that note; otherwise the difference needs an owner.`,
      meta: { loanId: d.loanId, paidOut: Number(d.amount), principal: Number(d.loan.principal) },
    }));
}

/** One M-Pesa receipt number settling more than one payment. */
async function checkDupReceipts(orgId: string): Promise<ReconFact[]> {
  const dupes = await prisma.paymentIntent.groupBy({
    by: ["mpesaReceipt"],
    where: { orgId, state: "SUCCESS", mpesaReceipt: { not: null } },
    _count: { _all: true },
    _sum: { amount: true },
    having: { mpesaReceipt: { _count: { gt: 1 } } },
  });
  return dupes.map((g) => ({
    kind: "DUP_RECEIPT" as const,
    reference: String(g.mpesaReceipt),
    severity: "HIGH" as const,
    amountKes: Number(g._sum.amount ?? 0),
    message: `M-Pesa receipt ${g.mpesaReceipt} settled ${g._count._all} separate payments — the same money may have been credited twice.`,
    meta: { occurrences: g._count._all },
  }));
}

/** The float ledger's running balance no longer equals the sum of its entries. */
async function checkFloatDrift(orgId: string): Promise<ReconFact[]> {
  const [sum, last] = await Promise.all([
    prisma.floatLedger.aggregate({ where: { orgId }, _sum: { amount: true } }),
    prisma.floatLedger.findFirst({ where: { orgId }, orderBy: { createdAt: "desc" } }),
  ]);
  if (!last) return [];
  const expected = Number(sum._sum.amount ?? 0);
  const stated = Number(last.balanceAfter);
  if (near(expected, stated)) return [];
  return [{
    kind: "FLOAT_DRIFT",
    reference: "float",
    severity: "HIGH",
    amountKes: stated - expected,
    message: `The float ledger says the balance is ${kes(stated)}, but its own entries add up to ${kes(expected)}. An entry was edited, deleted or written with the wrong running balance.`,
    meta: { stated, expected },
  }];
}

// ── The sweep ─────────────────────────────────────────────────────────────────

export type ReconStats = {
  facts: number;
  opened: number;
  reopened: number;
  selfHealed: number;
  stillOpen: number;
};

const keyOf = (f: { kind: string; reference: string }) => `${f.kind}|${f.reference}`;

/**
 * Re-derive every check for one org and sync the exceptions table to match.
 * Idempotent: running twice changes nothing but lastSeenAt. Self-scoping, like
 * every helper that can be called from a cron.
 */
export async function reconcileOrg(orgId: string): Promise<ReconStats> {
  return runWithOrg(orgId, async () => {
    const facts = (await Promise.all([
      checkC2BUnallocated(orgId),
      checkStkUnapplied(orgId),
      checkDisbStuck(orgId),
      checkDisbLoanMismatch(orgId),
      checkDisbAmount(orgId),
      checkDupReceipts(orgId),
      checkFloatDrift(orgId),
    ])).flat();

    const existing = await prisma.reconciliationException.findMany({ where: { orgId } });
    const byKey = new Map(existing.map((e) => [keyOf(e), e]));
    const now = new Date();
    const stats: ReconStats = { facts: facts.length, opened: 0, reopened: 0, selfHealed: 0, stillOpen: 0 };

    for (const f of facts) {
      const ex = byKey.get(keyOf(f));
      const data = {
        severity: f.severity,
        amountKes: f.amountKes === null ? null : new Prisma.Decimal(f.amountKes),
        message: f.message,
        meta: (f.meta ?? {}) as Prisma.InputJsonValue,
        lastSeenAt: now,
      };
      if (!ex) {
        await prisma.reconciliationException.create({
          data: { orgId, kind: f.kind, reference: f.reference, ...data },
        });
        stats.opened++;
      } else if (ex.status === "OPEN") {
        await prisma.reconciliationException.update({ where: { id: ex.id }, data });
        stats.stillOpen++;
      } else if (ex.status === "IGNORED") {
        // A human said this is fine. Keep the timestamp honest, keep quiet.
        await prisma.reconciliationException.update({ where: { id: ex.id }, data: { lastSeenAt: now } });
      } else {
        // RESOLVED, yet the condition is back — the fix didn't hold.
        await prisma.reconciliationException.update({
          where: { id: ex.id },
          data: { ...data, status: "OPEN", resolvedAt: null, resolvedBy: null, resolution: null },
        });
        stats.reopened++;
      }
    }

    // Anything OPEN that no check reproduces has healed — close it and say so.
    const factKeys = new Set(facts.map(keyOf));
    for (const ex of existing) {
      if (ex.status === "OPEN" && !factKeys.has(keyOf(ex))) {
        await prisma.reconciliationException.update({
          where: { id: ex.id },
          data: { status: "RESOLVED", resolvedAt: now, resolvedBy: "system", resolution: "self-healed: the condition stopped reproducing" },
        });
        stats.selfHealed++;
      }
    }

    return stats;
  });
}

/**
 * Raise one exception at the moment the evidence exists — called from the
 * payment webhooks' failure paths. Never throws: reconciliation must not be
 * the thing that breaks a payment webhook.
 */
export async function raiseException(orgId: string, fact: ReconFact): Promise<void> {
  try {
    await runWithOrg(orgId, async () => {
      const now = new Date();
      await prisma.reconciliationException.upsert({
        where: { orgId_kind_reference: { orgId, kind: fact.kind, reference: fact.reference } },
        create: {
          orgId,
          kind: fact.kind,
          reference: fact.reference,
          severity: fact.severity,
          amountKes: fact.amountKes === null ? null : new Prisma.Decimal(fact.amountKes),
          message: fact.message,
          meta: (fact.meta ?? {}) as Prisma.InputJsonValue,
        },
        update: { lastSeenAt: now },
      });
    });
  } catch (err) {
    console.error(`[reconcile] could not raise ${fact.kind} for org ${orgId}:`, err);
  }
}

/** Resolve helper shared by the console actions and self-healing flows. */
export async function resolveException(
  orgId: string,
  id: string,
  by: string,
  status: "RESOLVED" | "IGNORED" | "OPEN",
  note?: string,
): Promise<boolean> {
  return runWithOrg(orgId, async () => {
    const ex = await prisma.reconciliationException.findFirst({ where: { id, orgId } });
    if (!ex) return false;
    await prisma.reconciliationException.update({
      where: { id },
      data: status === "OPEN"
        ? { status: "OPEN", resolvedAt: null, resolvedBy: null, resolution: null }
        : { status, resolvedAt: new Date(), resolvedBy: by, resolution: note ?? null },
    });
    return true;
  });
}
