// ─────────────────────────────────────────────────────────────────────────────
// THE VOCABULARY — the bands and dispositions this floor runs on, checked
// against Micromart's own tables at request time.
//
// The point is not to show a settings page. It is that this platform mirrors
// their vocabulary rather than imposing one, and that the mirror is CHECKED. If
// somebody adds a disposition in CollectBox, this screen says so — and says it
// as a gap that needs a decision (what should it trigger?) rather than silently
// appending a row with no meaning attached.
// ─────────────────────────────────────────────────────────────────────────────
import { collectBoxOrg, CollectBoxUnavailable } from "@/lib/collectbox/client";
import { verifyTaxonomy, CATEGORY_LIST, DISPOSITION_LIST, TASK_ACTIONS } from "@/lib/collectbox/taxonomy";
import TaxonomyBoard from "@/components/desk/TaxonomyBoard";
import { Broken } from "@/components/suite/kit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function TaxonomyPage() {
  try {
    const org = collectBoxOrg("micromart");
    const drift = await verifyTaxonomy(org);

    return (
      <TaxonomyBoard
        drift={drift}
        categories={CATEGORY_LIST.map((c) => ({
          id: c.id, name: c.name, short: c.short, from: c.from, to: c.to,
          commission: c.commission, column: c.column, severity: c.severity,
          accent: c.accent, posture: c.posture,
        }))}
        dispositions={DISPOSITION_LIST.map((d) => ({
          id: d.id, name: d.name, callStatus: d.callStatus,
          requiresPromise: d.requiresPromise, schedulesTask: d.schedulesTask,
          suppresses: d.suppresses, accent: d.accent, meaning: d.meaning,
        }))}
        tasks={Object.values(TASK_ACTIONS)}
      />
    );
  } catch (e) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <Broken
          title="The vocabulary could not be checked"
          detail={e instanceof CollectBoxUnavailable ? e.message : e instanceof Error ? e.message : "Unknown error."}
        />
      </div>
    );
  }
}
