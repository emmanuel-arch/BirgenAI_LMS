// ─────────────────────────────────────────────────────────────────────────────
// Collateral — what a lender can fall back on.
//
// Only VERIFIED collateral counts. What a borrower says they own is a starting
// point, not a valuation: somebody has to look at the lorry. So `REGISTERED` means
// "claimed", `VERIFIED` means "a named staff member saw it and said so", and only
// the second unlocks a loan on a product that requires security.
//
// Coverage is a percentage of the PRINCIPAL, not of the total repayable. A lender
// secures the money it hands over; the interest is its return on the risk it chose
// to take, and asking a borrower to pledge assets against it is a way to make a
// small loan unaffordable for the people who need one.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";

export type SecurityCheck = {
  required: boolean;
  coverPct: number;
  requiredValue: number;
  verifiedValue: number;
  /** Everything pledged, whatever its state — the officer wants the whole picture. */
  pledgedValue: number;
  ok: boolean;
  /** Why not, in words an officer can act on. */
  shortfall: string | null;
};

export async function checkSecurity(
  applicationId: string,
  principal: number,
  product: { securityRequired: boolean; securityCoverPct: number },
): Promise<SecurityCheck> {
  const rows = await prisma.collateral.findMany({ where: { applicationId } });
  const verifiedValue = rows.filter((c) => c.status === "VERIFIED").reduce((s, c) => s + Number(c.estimatedValueKes), 0);
  const pledgedValue = rows
    .filter((c) => c.status === "VERIFIED" || c.status === "REGISTERED")
    .reduce((s, c) => s + Number(c.estimatedValueKes), 0);

  const coverPct = Math.max(0, product.securityCoverPct ?? 100);
  const requiredValue = Math.round(principal * (coverPct / 100) * 100) / 100;

  if (!product.securityRequired) {
    return { required: false, coverPct, requiredValue: 0, verifiedValue, pledgedValue, ok: true, shortfall: null };
  }

  const ok = verifiedValue >= requiredValue;
  let shortfall: string | null = null;
  if (!ok) {
    // Four different problems, four different things for an officer to do. "Not
    // verified" and "rejected" are not the same sentence: one needs a site visit,
    // the other needs a different asset.
    const live = rows.filter((c) => c.status === "REGISTERED" || c.status === "VERIFIED");
    const rejected = rows.filter((c) => c.status === "REJECTED");

    shortfall = live.length === 0
      ? rejected.length > 0
        ? `The security offered was rejected${rejected[0].rejectedReason ? ` — ${rejected[0].rejectedReason}` : ""}. Nothing else has been pledged.`
        : "This product requires security, and nothing has been pledged."
      : verifiedValue === 0
        ? `Security has been pledged but none of it is verified. Someone has to see it before KES ${requiredValue.toLocaleString()} of cover counts.`
        : `Verified security is KES ${verifiedValue.toLocaleString()}, short of the KES ${requiredValue.toLocaleString()} this product needs (${coverPct}% of principal).`;
  }

  return { required: true, coverPct, requiredValue, verifiedValue, pledgedValue, ok, shortfall };
}
