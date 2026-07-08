// Float ledger — the org's disbursement till. Append-only entries carrying a
// running balanceAfter; the balance is the latest entry's balanceAfter.
import { Prisma, type FloatEntryKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function floatBalance(orgId: string): Promise<number> {
  const last = await prisma.floatLedger.findFirst({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    select: { balanceAfter: true },
  });
  return last ? Number(last.balanceAfter) : 0;
}

/** Append a signed entry (TOPUP positive, DISBURSE negative, REVERSAL positive). */
export async function addFloatEntry(
  orgId: string,
  kind: FloatEntryKind,
  signedAmount: number,
  opts: { ref?: string; note?: string; createdBy?: string } = {},
) {
  const balance = await floatBalance(orgId);
  const after = round2(balance + signedAmount);
  return prisma.floatLedger.create({
    data: {
      orgId,
      kind,
      amount: new Prisma.Decimal(signedAmount),
      balanceAfter: new Prisma.Decimal(after),
      ref: opts.ref ?? null,
      note: opts.note ?? null,
      createdBy: opts.createdBy ?? null,
    },
  });
}
