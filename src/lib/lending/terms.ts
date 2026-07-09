// The terms of a credit agreement, and their fingerprint.
//
// Kept free of Prisma so the seeds, the tests and any offline verifier can hash an
// agreement without opening a tenant-scoped database connection.

import { createHash } from "node:crypto";

export type OfferTerms = {
  principal: number;
  interestRate: number;
  interestMethod: "flat" | "reducing";
  termCount: number;
  termUnit: string;
  graceDays: number;
  totalInterest: number;
  totalRepayable: number;
  borrowDate: Date;
};

/**
 * The canonical string that gets signed. Field order is fixed and every number is
 * rendered at a fixed precision, so the same agreement hashes identically on any
 * machine, in any locale, under any Node version. Change this and every existing
 * offer stops verifying — which is the point.
 */
export function canonicalTerms(t: OfferTerms): string {
  return [
    `principal=${t.principal.toFixed(2)}`,
    `rate=${t.interestRate.toFixed(4)}`,
    `method=${t.interestMethod}`,
    `term=${t.termCount}${t.termUnit.toLowerCase()}`,
    `grace=${t.graceDays}`,
    `interest=${t.totalInterest.toFixed(2)}`,
    `repayable=${t.totalRepayable.toFixed(2)}`,
    `borrowDate=${t.borrowDate.toISOString().slice(0, 10)}`,
  ].join("|");
}

export const hashTerms = (t: OfferTerms): string =>
  createHash("sha256").update(canonicalTerms(t)).digest("hex");
