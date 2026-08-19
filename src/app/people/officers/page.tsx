// ─────────────────────────────────────────────────────────────────────────────
// PEOPLEHUB → RELATIONSHIP OFFICERS.
//
// The screen that follows `Borrowers.EntityAgent` all the way through: officer →
// their borrowers → those borrowers' open loans → which of those loans the
// collections floor is tracking → what the floor recovered against that book.
//
// Two databases, one row per officer. See src/lib/suite/officers.ts.
// ─────────────────────────────────────────────────────────────────────────────
import { collectBoxOrg, CollectBoxUnavailable } from "@/lib/collectbox/client";
import { getOfficers } from "@/lib/suite/officers";
import OfficerBoard from "@/components/people/OfficerBoard";
import { Broken } from "@/components/suite/kit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function OfficersPage() {
  try {
    const org = collectBoxOrg("micromart");
    const { officers, totals } = await getOfficers(org);

    return (
      <OfficerBoard
        totals={totals}
        officers={officers.map((o) => ({
          id: o.id,
          name: o.name,
          role: o.role,
          branch: o.branch,
          entityId: o.entityId,
          active: o.active,
          phone: o.phone,
          email: o.email,
          borrowers: o.borrowers,
          loansOpen: o.loansOpen,
          olb: o.olb,
          tracked: o.tracked,
          nplLoans: o.nplLoans,
          nplAmount: o.nplAmount,
          arrears: o.arrears,
          recovered30d: o.recovered30d,
          payments30d: o.payments30d,
          lastLoginAt: o.lastLoginAt?.toISOString() ?? null,
        }))}
      />
    );
  } catch (e) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <Broken
          title="The officer book could not be read"
          detail={e instanceof CollectBoxUnavailable ? e.message : e instanceof Error ? e.message : "Unknown error."}
        />
      </div>
    );
  }
}
