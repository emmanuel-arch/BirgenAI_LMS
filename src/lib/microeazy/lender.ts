// ─────────────────────────────────────────────────────────────────────────────
// WHO IS LENDING, on a screen that belongs to BirgenAI.
//
// Decision D2: BirgenAI is not a licensed lender and never lends. The licensed
// lender must therefore be named wherever money is discussed — that is a
// regulatory position, not a footer style. Micro Eazy is one installed app whose
// chrome repaints to whichever lender the customer was awarded to, so "which
// lender" is a runtime question on every one of those screens.
//
// TODAY THE ANSWER IS ALWAYS MICROMART, and it is still resolved rather than
// typed. Two reasons, and the second is the one that matters:
//
//   1. The name printed to a customer is the lender's REGISTERED name, which
//      lives on the Org row. A literal in a component drifts from it silently —
//      and it already had: the install door said "Micromart Africa Ltd" while
//      the registry says "Micromart Africa".
//
//   2. This function is the seam the Exchange (blueprint §5, task 0.4) replaces.
//      The SOLE policy is one allocation mode of five; when WEIGHTED and
//      CAPACITY_FIRST arrive, they change what this returns and nothing else.
//      Lender #2 is then a policy change, not a find-and-replace through the
//      customer app.
//
// FAILS SOFT, DELIBERATELY. If the lookup cannot answer, callers get null and
// `coBrandLine(null)` says "licensed Kenyan lenders" — true, compliant, and
// vague. A door that will not open because a name could not be read is worse
// than a door that opens with the general form of the same sentence.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";
import { runAsPlatform } from "@/lib/db/context";

/** The launch allocation policy: SOLE → micromart (blueprint §5.3). */
const SOLE_LENDER_SLUG = "micromart";

export type LenderOfRecord = {
  slug: string;
  /** The lender's registered name, as it must appear on money screens. */
  name: string;
};

/**
 * The lender a customer arriving at Micro Eazy right now would be funded by.
 *
 * Org is the one table with no orgId of its own and is read before any tenant is
 * known, so the read goes through the platform scope — the same chicken-and-egg
 * `resolveOrg` handles (src/lib/tenancy.ts).
 */
export async function lenderOfRecord(): Promise<LenderOfRecord | null> {
  try {
    const org = await runAsPlatform(() =>
      prisma.org.findUnique({
        where: { slug: SOLE_LENDER_SLUG },
        select: { slug: true, name: true, status: true },
      }),
    );
    // A suspended lender must not be named as the funder of a new application.
    if (!org || org.status === "SUSPENDED") return null;
    return { slug: org.slug, name: org.name };
  } catch {
    return null;
  }
}
