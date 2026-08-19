// ─────────────────────────────────────────────────────────────────────────────
// PEOPLEHUB → BRANCHES.
//
// `OrganizationUnits` is the org tree. This puts three things at every node that
// have never been at the same node before: the staff who work there, the book
// booked to it, and what the collections floor is carrying against that book.
// See src/lib/suite/officers.ts.
// ─────────────────────────────────────────────────────────────────────────────
import { collectBoxOrg, CollectBoxUnavailable } from "@/lib/collectbox/client";
import { getBranchTree } from "@/lib/suite/officers";
import BranchBoard from "@/components/people/BranchBoard";
import { Broken } from "@/components/suite/kit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function BranchesPage() {
  try {
    const org = collectBoxOrg("micromart");
    const { branches, totals } = await getBranchTree(org);
    return <BranchBoard branches={branches} totals={totals} />;
  } catch (e) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <Broken
          title="The branch tree could not be read"
          detail={e instanceof CollectBoxUnavailable ? e.message : e instanceof Error ? e.message : "Unknown error."}
        />
      </div>
    );
  }
}
