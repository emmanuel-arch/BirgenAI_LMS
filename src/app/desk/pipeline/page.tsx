// ─────────────────────────────────────────────────────────────────────────────
// THE FINTECH BRIDGE — connecting entity 3005 to the collections floor.
//
// This is the screen the demo is for.
//
// CollectBox holds 93,376 tracked loans and every one of them belongs to
// EntityId 3002 — Micromart's main book. Entity 3005, Micromart Fintech, the
// entity they migrated 17,016 borrowers into on 2 August 2026 and are writing
// their future on, has NO presence in CollectBox at all. Their new book has no
// collections engine.
//
// Nothing is broken. Nothing was ever built to carry a loan from Serviceconnect
// into CollectBox — the two databases sit on the same server, three feet apart,
// and the bridge between them is a person exporting a spreadsheet.
//
// This screen is the bridge. It reads the live Fintech book, ages every open
// loan against the same rule the 3002 floor runs on, shows exactly which agents
// would carry it and what it would earn them — and, one click and one
// environment variable later, writes those rows in for real.
// ─────────────────────────────────────────────────────────────────────────────
import { auth } from "@/lib/auth";
import { hasRight } from "@/lib/rbac/authz";
import { collectBoxOrg, CollectBoxUnavailable } from "@/lib/collectbox/client";
import { projectFintechPipeline, allocateProjection, reconcileBands } from "@/lib/collectbox/pipeline";
import { getFloorSummary } from "@/lib/collectbox/floor";
import { mirrorPosture } from "@/lib/collectbox/write";
import PipelineBoard from "@/components/desk/PipelineBoard";
import { Broken } from "@/components/suite/kit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const session = await auth();
  const canRun = await hasRight(session, "collections.manage");

  try {
    const org = collectBoxOrg("micromart");
    const projection = await projectFintechPipeline(org, 3005);

    const [allocation, recon, floor] = await Promise.all([
      allocateProjection(org, projection),
      reconcileBands(org),
      getFloorSummary(org),
    ]);

    return (
      <PipelineBoard
        canRun={canRun}
        posture={mirrorPosture()}
        book={projection.book}
        totals={projection.totals}
        alreadyTracked={projection.alreadyTracked}
        bands={projection.bands.map((b) => ({
          id: b.category.id, name: b.category.name, short: b.category.short,
          accent: b.category.accent, commission: b.category.commission,
          loans: b.loans, olb: b.olb, commissionAtFull: b.commissionAtFull, share: b.share,
        }))}
        rows={projection.rows.slice(0, 80).map((r) => ({
          loanId: r.loanId, borrowerId: r.borrowerId, name: r.name, phone: r.phone,
          product: r.product, principal: r.principal, olb: r.olb, dpd: r.dpd,
          band: { id: r.category.id, short: r.category.short, accent: r.category.accent, name: r.category.name },
          dueAt: r.dueAt?.toISOString() ?? null,
          officer: r.officer, branch: r.branch,
          priorLoans: r.priorLoans, priorRepaid: r.priorRepaid, migrated: r.migrated,
          commissionAtFull: r.commissionAtFull,
        }))}
        allocation={allocation.map((a) => ({
          agentId: a.agentId, agentName: a.agentName, loans: a.loans,
          olb: a.olb, commissionAtFull: a.commissionAtFull,
        }))}
        accuracy={recon.accuracy}
        mainBook={{
          loans: floor.totals.loans,
          olb: floor.totals.olb,
          agents: floor.totals.agentsOnFloor,
          recoveredToday: floor.totals.recoveredToday,
        }}
      />
    );
  } catch (e) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <Broken
          title="The pipeline could not be projected"
          detail={e instanceof CollectBoxUnavailable ? e.message : e instanceof Error ? e.message : "Unknown error."}
        />
      </div>
    );
  }
}
