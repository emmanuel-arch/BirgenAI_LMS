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

/**
 * Charges are keyed to a product; a null productId means every product on the org.
 *
 * A lender's fee sheet is a LIST — Micromart's Micro Eazy carries a processing fee,
 * a CRB fee and a security fee, all mandatory, all before disbursement. This used to
 * pick ONE row (`find`), which meant a three-fee product was priced on whichever fee
 * the database happened to return first.
 */
type ChargeRow = {
  productId: string | null;
  code: string;
  amount: unknown;
  isPercent: boolean;
  minValue: unknown;
  maxValue: unknown;
  minPrincipal: unknown;
  maxPrincipal: unknown;
};

const num = (v: unknown): number | null => (v == null ? null : Number(v));

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
        // Two filters, and both matter to what an offer says the customer receives.
        //
        // BEFORE_DISBURSEMENT: a fee netted off the principal or spread across the
        // schedule is taken out of money that is already moving — quoting it here
        // would charge for it twice.
        //
        // ON_APPLICATION: a registration fee is one-off, owed once by a borrower
        // rather than by a loan, and the engine has no idea whether this person
        // already paid it years ago. Pricing it into every offer would understate
        // what a repeat customer nets. lib/lending/upfront-charges.ts settles that
        // question properly at application time, where the borrower is known.
        where: { orgId, isActive: true, applyAt: "BEFORE_DISBURSEMENT", trigger: "ON_APPLICATION" },
        select: {
          productId: true, code: true, amount: true, isPercent: true,
          minValue: true, maxValue: true, minPrincipal: true, maxPrincipal: true,
        },
      }) as unknown as Promise<ChargeRow[]>,
    ]),
  );

  return products.flatMap((p) => {
    const latest = p.versions[0];
    const def = latest ? mergeProduct(latest.definition) : null;

    // Product-scoped fees win outright; otherwise the org-wide sheet applies. A
    // product with its OWN fees is a deliberate override, not an addition.
    const scoped = charges.filter((c) => c.productId === p.id);
    const sheet = (scoped.length ? scoped : charges.filter((c) => c.productId === null))
      // A fee may be priced differently at different loan sizes, so the principal
      // band selects it. We price at the product's floor, which is the amount every
      // offer on this product is at least subject to.
      .filter((c) => {
        const lo = num(c.minPrincipal);
        const hi = num(c.maxPrincipal);
        const at = Number(p.minPrincipal);
        return (lo == null || at >= lo) && (hi == null || at <= hi);
      })
      .map((c) => ({
        code: c.code,
        percent: Boolean(c.isPercent),
        amount: Number(c.amount),
        minValue: num(c.minValue),
        maxValue: num(c.maxValue),
      }));

    const base = {
      id: p.id,
      name: p.name,
      minPrincipal: Number(p.minPrincipal),
      maxPrincipal: Number(p.maxPrincipal),
      termUnit: (["day", "week", "fortnight", "month"].includes(p.repaymentPeriodUnit)
        ? p.repaymentPeriodUnit
        : "week") as ProductCandidate["termUnit"],
      // Legacy single-fee field, kept populated for anything still reading it.
      // `charges` is what the engine actually prices.
      processing: sheet[0] ? { percent: sheet[0].percent, amount: sheet[0].amount } : { percent: false, amount: 0 },
      charges: sheet,
      eligibility: def?.eligibility,
      versionId: latest?.id ?? null,
    };

    // ONE CANDIDATE PER ALLOWABLE TERM.
    //
    // A product that names a `minRepaymentPeriod` is not selling one loan shape,
    // it is selling a range of them: Micromart's Micro Eazy reads "10 (Week)" but
    // a borrower whose cashflow only carries four weeks should be offered four
    // weeks, not declined for ten. Fanning out here means the engine's existing
    // price stage — which already sorts shortest-term-first and honours
    // `prefer: "shortest_affordable"` — chooses the term for free, with the same
    // reason codes it gives every other decision. `engine.ts` never learns that
    // terms can vary.
    // interestRate is the rate for the WHOLE term, so a shorter term prices at the
    // per-period rate times the shorter count. Exact for flat interest, which is
    // why termsFor() refuses to fan out anything else.
    const perPeriod = Number(p.interestRate) / Math.max(1, p.repaymentPeriod);
    return termsFor(p).map((t) => ({ ...base, termCount: t, interestPct: round4(perPeriod * t) }));
  });
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/**
 * Every term this product will book, shortest first.
 *
 * Fixed-term products yield exactly one, so nothing about them changes. A range
 * is only honoured on FLAT interest: on reducing balance the whole-term rate is
 * not a linear function of the term, and quietly pricing it as though it were
 * would understate the cost of a shorter loan.
 */
function termsFor(p: { repaymentPeriod: number; minRepaymentPeriod: number | null; interestMethod: string }): number[] {
  const max = Math.max(1, p.repaymentPeriod);
  const min = p.minRepaymentPeriod ?? max;
  if (min >= max || min < 1) return [max];
  if (p.interestMethod !== "flat") return [max];
  const terms: number[] = [];
  for (let t = min; t <= max; t++) terms.push(t);
  return terms;
}

/**
 * Collapse a fanned-out offer list to ONE row per product — the term that was
 * actually recommended, or failing that the shortest affordable, or failing that
 * the shortest offered.
 *
 * The engine is right to price all ten weekly terms; a customer looking at a shelf
 * is not right to see "Micro Eazy" ten times. Anything showing offers to a human
 * calls this; anything auditing the decision reads the full list.
 */
export function collapseByProduct<T extends { productId: string; termCount: number; affordable: boolean; recommended: boolean }>(
  offered: T[],
): T[] {
  const best = new Map<string, T>();
  for (const o of offered) {
    const held = best.get(o.productId);
    if (!held) { best.set(o.productId, o); continue; }
    if (o.recommended && !held.recommended) { best.set(o.productId, o); continue; }
    if (held.recommended) continue;
    if (o.affordable && !held.affordable) { best.set(o.productId, o); continue; }
    if (o.affordable === held.affordable && o.termCount < held.termCount) best.set(o.productId, o);
  }
  return offered.filter((o) => best.get(o.productId) === o);
}
