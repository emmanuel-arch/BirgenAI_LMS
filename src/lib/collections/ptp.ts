// ─────────────────────────────────────────────────────────────────────────────
// Promises to pay — taken by a human, resolved by the money.
//
// A promise resolves KEPT/PARTIAL/BROKEN by what actually LANDED on the loan
// between the promise being taken and its due date passing — allocated paybill
// receipts plus successful STK payments, deduplicated by M-Pesa receipt (the
// same double-record hazard reconciliation's DUP_RECEIPT watches). Nobody
// resolves a promise by ticking a box; the only human override is CANCELLED,
// which demands a note.
//
// One PENDING promise per loan: a newer promise supersedes (cancels) the old
// one, because two live promises on one debt is how "he promised 5k twice"
// becomes 10k of imaginary expected cash on somebody's forecast.
// ─────────────────────────────────────────────────────────────────────────────
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Money that landed on the loan since `since` — allocated C2B + successful STK, deduped by receipt. */
export async function paidSince(orgId: string, loanId: string, since: Date): Promise<number> {
  const [c2b, stk] = await Promise.all([
    prisma.c2BReceipt.findMany({
      where: { orgId, allocatedLoanId: loanId, allocatedAt: { gte: since } },
      select: { amount: true, transId: true },
    }),
    prisma.paymentIntent.findMany({
      where: { orgId, loanId, state: "SUCCESS", updatedAt: { gte: since } },
      select: { amount: true, mpesaReceipt: true },
    }),
  ]);
  const seen = new Set(c2b.map((r) => r.transId));
  let total = c2b.reduce((s, r) => s + Number(r.amount), 0);
  for (const p of stk) {
    if (p.mpesaReceipt && seen.has(p.mpesaReceipt)) continue; // same M-Pesa receipt recorded twice
    total += Number(p.amount);
  }
  return round2(total);
}

/**
 * Take a promise on a loan, superseding any pending one. Returns the new row.
 * Callers validate amount/date; this enforces the one-pending-per-loan rule.
 */
export async function takePromise(args: {
  orgId: string; loanId: string; borrowerId: string;
  amount: number; dueDate: Date; note?: string | null; createdBy: string;
}): Promise<{ id: string }> {
  await prisma.promiseToPay.updateMany({
    where: { orgId: args.orgId, loanId: args.loanId, status: "PENDING" },
    data: { status: "CANCELLED", note: "Superseded by a newer promise.", resolvedAt: new Date() },
  });
  return prisma.promiseToPay.create({
    data: {
      orgId: args.orgId, loanId: args.loanId, borrowerId: args.borrowerId,
      amount: new Prisma.Decimal(round2(args.amount)),
      dueDate: args.dueDate,
      note: args.note?.trim() || null,
      createdBy: args.createdBy,
    },
    select: { id: true },
  });
}

export type PtpResolution = { id: string; status: "KEPT" | "PARTIAL" | "BROKEN"; paid: number };

/**
 * Resolve every PENDING promise whose due date has passed, org-scoped or (from
 * the cron) across the whole platform. Idempotent — a resolved promise never
 * comes back through here.
 */
export async function resolveDuePromises(orgId?: string): Promise<PtpResolution[]> {
  const now = new Date();
  // End-of-day grace: a promise "by Friday" is honest until Friday midnight.
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const due = await prisma.promiseToPay.findMany({
    where: { ...(orgId ? { orgId } : {}), status: "PENDING", dueDate: { lt: cutoff } },
    select: { id: true, orgId: true, loanId: true, amount: true, createdAt: true },
    take: 500,
  });

  const out: PtpResolution[] = [];
  for (const p of due) {
    const paid = await paidSince(p.orgId, p.loanId, p.createdAt);
    const status = paid >= Number(p.amount) ? "KEPT" : paid > 0 ? "PARTIAL" : "BROKEN";
    await prisma.promiseToPay.update({
      where: { id: p.id },
      data: { status, paidAmount: new Prisma.Decimal(paid), resolvedAt: now },
    });
    out.push({ id: p.id, status, paid });
  }
  return out;
}
