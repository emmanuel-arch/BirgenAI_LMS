// ─────────────────────────────────────────────────────────────────────────────
// PEOPLEHUB — the directory.
//
// Reads 1,088 staff out of the lending system, 32 seats off the call floor, and
// the borrower book each officer carries; presents them as one roster. Nobody
// re-enters anybody.
//
// The sections that would need data Micromart do not hold — payroll, leave,
// contracts, appraisals — say so, and name the empty table that would power
// them. A demo that invents a salary cannot be trusted about the balances.
// ─────────────────────────────────────────────────────────────────────────────
import { collectBoxOrg, CollectBoxUnavailable } from "@/lib/collectbox/client";
import { getRoster } from "@/lib/suite/people";
import PeopleBoard from "@/components/people/PeopleBoard";
import { Broken } from "@/components/suite/kit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function PeoplePage() {
  try {
    const org = collectBoxOrg("micromart");
    const roster = await getRoster(org);

    return (
      <PeopleBoard
        totals={roster.totals}
        roles={roster.roles}
        branches={roster.branches.slice(0, 30)}
        emptySources={roster.emptySources}
        people={roster.people
          .slice()
          .sort((a, b) => b.borrowers - a.borrowers || b.bookOlb - a.bookOlb)
          .slice(0, 200)
          .map((p) => ({
            id: p.id, name: p.name, role: p.role, roleId: p.roleId,
            email: p.email, phone: p.phone, branch: p.branch, entityId: p.entityId,
            active: p.active, borrowers: p.borrowers, bookOlb: p.bookOlb,
            lastLoginAt: p.lastLoginAt?.toISOString() ?? null,
            desk: p.desk ? { agentId: p.desk.agentId, recovered30d: p.desk.recovered30d, payments30d: p.desk.payments30d, linkedBy: p.desk.linkedBy } : null,
          }))}
      />
    );
  } catch (e) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <Broken
          title="The roster could not be read"
          detail={e instanceof CollectBoxUnavailable ? e.message : e instanceof Error ? e.message : "Unknown error."}
        />
      </div>
    );
  }
}
