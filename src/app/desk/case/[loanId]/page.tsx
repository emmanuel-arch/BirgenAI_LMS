// ─────────────────────────────────────────────────────────────────────────────
// THE CASE FILE — one customer, everything known about them, and the call.
//
// This is the screen the whole architecture exists to make possible. It reads
// from FIVE places at once and presents them as one thing:
//
//   CollectBox.CollectionTracker   the queue position, band and assignment
//   Serviceconnect.Loans/Borrowers the person, the loan, the relationship officer
//   Serviceconnect (whole history)  every loan they have ever taken
//   The merged timeline             calls, payments, promises, SMS, tasks, notes
//   Our DeskInteraction rows        anything ConnectDesk itself has recorded
//
// No system Micromart currently runs can show a collections agent the four loans
// this customer repaid perfectly before this one. That single fact changes how
// the call opens more than any script does.
// ─────────────────────────────────────────────────────────────────────────────
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { hasRight } from "@/lib/rbac/authz";
import { collectBoxOrg, CollectBoxUnavailable } from "@/lib/collectbox/client";
import { getCase } from "@/lib/collectbox/floor";
import { listAgents } from "@/lib/collectbox/agents";
import { getTimeline } from "@/lib/interactions/timeline";
import { DISPOSITION_LIST } from "@/lib/collectbox/taxonomy";
import { mirrorPosture } from "@/lib/collectbox/write";
import CaseFile from "@/components/desk/CaseFile";
import { Broken } from "@/components/suite/kit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function CasePage({ params }: { params: Promise<{ loanId: string }> }) {
  const { loanId: raw } = await params;
  const loanId = Number(raw);
  if (!Number.isInteger(loanId) || loanId <= 0) notFound();

  const session = await auth();
  const orgId = session?.user?.orgId;
  const canWork = await hasRight(session, "collections.manage");

  try {
    const org = collectBoxOrg("micromart");
    const file = await getCase(org, loanId);
    if (!file) notFound();

    const [timeline, agents] = await Promise.all([
      getTimeline(org, {
        loanId,
        borrowerId: file.borrower.id,
        wholeRelationship: true,
        limit: 120,
        orgId,
      }),
      listAgents(org),
    ]);

    const posture = mirrorPosture();

    return (
      <CaseFile
        canWork={canWork}
        posture={posture}
        subject={{
          loanId: file.row.loanId,
          borrowerId: file.borrower.id,
          entityId: file.row.entityId,
          categoryId: file.row.category.id,
          name: file.borrower.name,
          phone: file.borrower.phone,
        }}
        row={{
          dpd: file.row.dpd,
          band: {
            id: file.row.category.id, short: file.row.category.short, name: file.row.category.name,
            accent: file.row.category.accent, posture: file.row.category.posture, commission: file.row.category.commission,
          },
          olb: file.row.olb,
          amountDue: file.row.amountDue,
          instalment: file.row.instalment,
          product: file.row.product,
          agentName: file.row.agentName,
          agentId: file.row.agentId,
          actioned: file.row.actioned,
          lastActionAt: file.row.lastActionAt?.toISOString() ?? null,
          lastComment: file.row.lastComment,
          lastCallAt: file.row.lastCallAt?.toISOString() ?? null,
          callCount: file.row.callCount,
          recovered30d: file.row.recovered30d,
          ptpDate: file.row.ptpDate?.toISOString() ?? null,
          ptpAmount: file.row.ptpAmount,
          expectedClearDate: file.row.expectedClearDate?.toISOString() ?? null,
        }}
        borrower={{
          ...file.borrower,
          since: file.borrower.since?.toISOString() ?? null,
        }}
        loans={file.loans.map((l) => ({
          id: l.id, product: l.product, amount: l.amount, balance: l.balance,
          borrowedAt: l.borrowedAt?.toISOString() ?? null,
          clearedAt: l.clearedAt?.toISOString() ?? null,
          cleared: l.cleared, dpd: l.dpd,
        }))}
        totals={file.totals}
        timeline={timeline.map((i) => ({
          id: i.id, at: i.at.toISOString(), system: i.system, kind: i.kind,
          headline: i.headline, detail: i.detail, actor: i.actor?.name ?? null,
          actorRole: i.actor?.role ?? null, amount: i.amount ?? null, tone: i.tone, tags: i.tags,
        }))}
        dispositions={DISPOSITION_LIST.map((d) => ({
          id: d.id, name: d.name, callStatus: d.callStatus, requiresPromise: d.requiresPromise,
          schedulesTask: d.schedulesTask, suppresses: d.suppresses, accent: d.accent, meaning: d.meaning,
        }))}
        agents={agents.filter((a) => a.roleId === 4 || a.roleId === 6).map((a) => ({ id: a.id, name: a.name }))}
      />
    );
  } catch (e) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <Broken
          title="This case could not be opened"
          detail={e instanceof CollectBoxUnavailable ? e.message : e instanceof Error ? e.message : "Unknown error."}
        />
      </div>
    );
  }
}
