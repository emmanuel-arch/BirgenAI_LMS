// ─────────────────────────────────────────────────────────────────────────────
// SAVINGS — the borrower's wallet with this lender, and the one rule that fills it.
//
// A deposit is not automatically savings. Money a borrower sends lands against an
// OUTSTANDING LOAN BALANCE first — a customer with a live loan who pays in is paying
// their loan, not building a nest egg — and only what remains, or everything when
// they carry no balance, is credited here. That is `depositToBorrower`, the entry
// point the STK/C2B settlement calls.
//
// `balance` on the account is a running MIRROR of the transaction ledger, written in
// the same transaction as every entry so the two can never drift. The ledger rows are
// append-only: a correction is a new, opposite row, never an edit — the customer
// statement reads this and it must be reproducible years later.
// ─────────────────────────────────────────────────────────────────────────────
import { Prisma } from "@prisma/client";
import { prisma, orgTx } from "@/lib/prisma";
import { allocateRepayment } from "@/lib/lending/allocate";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type SavingsMove = { balanceAfter: number; transactionId: string };

/** Money IN. Opens the account on first use. `source` is a stable token the customer
 *  statement groups on: deposit | loan_offset_remainder | charge_sweep | adjustment. */
export async function creditSavings(opts: {
  orgId: string;
  borrowerId: string;
  amount: number;
  source: string;
  ref?: string | null;
  note?: string | null;
  createdById?: string | null;
}): Promise<SavingsMove> {
  const amt = round2(opts.amount);
  if (!(amt > 0)) throw new Error("Savings credit must be positive.");
  return orgTx(async (tx) => {
    const account = await tx.savingsAccount.upsert({
      where: { borrowerId: opts.borrowerId },
      create: { orgId: opts.orgId, borrowerId: opts.borrowerId, balance: new Prisma.Decimal(0) },
      update: {},
      select: { id: true, balance: true },
    });
    const balanceAfter = round2(Number(account.balance) + amt);
    const row = await tx.savingsTransaction.create({
      data: {
        orgId: opts.orgId, accountId: account.id, borrowerId: opts.borrowerId,
        direction: "CREDIT", amount: new Prisma.Decimal(amt), balanceAfter: new Prisma.Decimal(balanceAfter),
        source: opts.source, ref: opts.ref ?? null, note: opts.note ?? null, createdById: opts.createdById ?? null,
      },
      select: { id: true },
    });
    await tx.savingsAccount.update({ where: { id: account.id }, data: { balance: new Prisma.Decimal(balanceAfter) } });
    return { balanceAfter, transactionId: row.id };
  });
}

/** Money OUT. Refuses to overdraw — savings can never go negative. */
export async function debitSavings(opts: {
  orgId: string;
  borrowerId: string;
  amount: number;
  source: string;
  ref?: string | null;
  note?: string | null;
  createdById?: string | null;
}): Promise<SavingsMove> {
  const amt = round2(opts.amount);
  if (!(amt > 0)) throw new Error("Savings debit must be positive.");
  return orgTx(async (tx) => {
    const account = await tx.savingsAccount.findUnique({
      where: { borrowerId: opts.borrowerId },
      select: { id: true, balance: true },
    });
    if (!account) throw new Error("No savings account to debit.");
    const balance = Number(account.balance);
    if (amt > balance) throw new Error("A withdrawal cannot exceed the savings balance.");
    const balanceAfter = round2(balance - amt);
    const row = await tx.savingsTransaction.create({
      data: {
        orgId: opts.orgId, accountId: account.id, borrowerId: opts.borrowerId,
        direction: "DEBIT", amount: new Prisma.Decimal(amt), balanceAfter: new Prisma.Decimal(balanceAfter),
        source: opts.source, ref: opts.ref ?? null, note: opts.note ?? null, createdById: opts.createdById ?? null,
      },
      select: { id: true },
    });
    await tx.savingsAccount.update({ where: { id: account.id }, data: { balance: new Prisma.Decimal(balanceAfter) } });
    return { balanceAfter, transactionId: row.id };
  });
}

export type DepositResult = {
  /** What went onto a loan, if any (the loan-offset half). */
  loan: { loanId: string; allocated: number; cleared: boolean; newBalance: number } | null;
  /** What was credited to savings (the remainder, or everything). */
  toSavings: number;
  savingsBalanceAfter: number | null;
};

/** THE DEPOSIT RULE. Offset the borrower's oldest live loan first; credit whatever
 *  remains — or the whole amount, when they carry no balance — to savings. */
export async function depositToBorrower(opts: {
  orgId: string;
  borrowerId: string;
  amount: number;
  ref?: string | null;
  createdById?: string | null;
}): Promise<DepositResult> {
  const amount = round2(opts.amount);
  if (!(amount > 0)) throw new Error("Deposit must be positive.");

  const loan = await prisma.loan.findFirst({
    where: { orgId: opts.orgId, borrowerId: opts.borrowerId, status: { in: ["ACTIVE", "PENDING_DISBURSEMENT"] } },
    orderBy: { borrowDate: "asc" },
    select: { id: true },
  });

  let toSavings = amount;
  let loanOut: DepositResult["loan"] = null;
  if (loan) {
    // allocateRepayment caps at the loan balance and hands back the overpayment.
    const r = await allocateRepayment(loan.id, amount, opts.ref ? `DEPOSIT:${opts.ref}` : "DEPOSIT");
    toSavings = round2(r.unallocated);
    loanOut = { loanId: r.loanId, allocated: r.allocated, cleared: r.cleared, newBalance: r.newBalance };
  }

  let savingsBalanceAfter: number | null = null;
  if (toSavings > 0) {
    const s = await creditSavings({
      orgId: opts.orgId, borrowerId: opts.borrowerId, amount: toSavings,
      source: loan ? "loan_offset_remainder" : "deposit",
      ref: opts.ref ?? null, createdById: opts.createdById ?? null,
    });
    savingsBalanceAfter = s.balanceAfter;
  }

  return { loan: loanOut, toSavings, savingsBalanceAfter };
}
