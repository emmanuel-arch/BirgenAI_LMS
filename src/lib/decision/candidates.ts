// ─────────────────────────────────────────────────────────────────────────────
// Turning an org's live catalogue into engine candidates.
//
// The engine is pure and takes plain data; this is the one place that reads the
// database for it. Two details matter:
//
//   · A product's ELIGIBILITY comes from its published version, not its columns.
//     The columns are only a projection (lib/products/definition), and the rules a
//     lender actually wrote — minimum cleared loans, age bounds, one-at-a-time —
//     exist nowhere else. A product that has never been published simply carries no
//     eligibility block, and rules-mode falls back to the limit check alone.
//
//   · The version id travels with the candidate, so a stored decision can cite the
//     exact terms it priced against even after the product moves on.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";
import { runWithOrg } from "@/lib/db/context";
import { mergeProduct } from "@/lib/products/definition";
import type { ProductCandidate } from "./engine";

/** Charges are keyed to a product; a null productId is the org-wide fallback. */
type ChargeRow = { productId: string | null; amount: unknown; isPercent: boolean };

export async function candidatesFor(orgId: string): Promise<ProductCandidate[]> {
  const [products, charges] = await runWithOrg(orgId, () =>
    Promise.all([
      prisma.product.findMany({
        where: { orgId, isActive: true },
        orderBy: { minPrincipal: "asc" },
        include: {
          versions: {
            orderBy: { version: "desc" },
            take: 1,
            select: { id: true, definition: true },
          },
        },
      }),
      prisma.charge.findMany({
        where: { orgId, isActive: true },
        select: { productId: true, amount: true, isPercent: true },
      }) as unknown as Promise<ChargeRow[]>,
    ]),
  );

  const fallback = charges.find((c) => c.productId === null);

  return products.map((p) => {
    const latest = p.versions[0];
    const def = latest ? mergeProduct(latest.definition) : null;
    const charge = charges.find((c) => c.productId === p.id) ?? fallback;

    return {
      id: p.id,
      name: p.name,
      minPrincipal: Number(p.minPrincipal),
      maxPrincipal: Number(p.maxPrincipal),
      interestPct: Number(p.interestRate),
      termCount: p.repaymentPeriod,
      termUnit: (["day", "week", "fortnight", "month"].includes(p.repaymentPeriodUnit)
        ? p.repaymentPeriodUnit
        : "week") as ProductCandidate["termUnit"],
      processing: { percent: Boolean(charge?.isPercent), amount: Number(charge?.amount ?? 0) },
      eligibility: def?.eligibility,
      versionId: latest?.id ?? null,
    };
  });
}
