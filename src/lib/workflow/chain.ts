// ─────────────────────────────────────────────────────────────────────────────
// THE STAGE CHAIN — one resolution, read by both sides of the glass.
//
// This logic lived inside POST /api/console/applications/[id], which was fine
// while the only thing that needed to know the stages was the screen that
// advanced them. It stops being fine the moment the CUSTOMER can see the
// workflow too: two copies of "which stages does this application pass through"
// is two answers, and the first time they disagree the app tells a borrower
// their loan is at "Final Approval" while the officer is looking at "Risk
// Review".
//
// The promise being made on the customer's tracker screen is that it is the
// same chain, not a parallel description of one. So it is resolved HERE, once,
// and both the console and /api/portal/track call it.
//
// ── THE VIRTUAL DEFAULT IS NOT A PLACEHOLDER ────────────────────────────────
// A lender with no workflow configured still has a process — an officer looks,
// then someone senior releases the money. The two virtual stages ARE that
// process, written down. They carry the `virtual:` prefix so a stale
// `currentStageId` from before a lender built a real workflow is recognisable
// rather than mysterious, and so nothing tries to load them from the database.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";
import type { DisbursementRoute } from "@prisma/client";

export const STAGE_OFFICER = "virtual:officer";
export const STAGE_FINAL = "virtual:final";

export type StageDef = {
  id: string;
  title: string;
  accessTier: number;
  canFinalize: boolean;
  otpRequired: boolean;
  crbRequired: boolean;
  maxAmount: number | null;
  disbursementRoute: DisbursementRoute | null;
  /** Nobody acted for this long → escalated. 0 = never. Shown to the customer as
   *  a plain-language expectation, which is the single most effective thing an
   *  app can say to somebody waiting. */
  slaHours: number;
};

/** What a lender with no configured workflow still does. */
export function virtualChain(): StageDef[] {
  return [
    {
      id: STAGE_OFFICER, title: "Officer Review", accessTier: 1, canFinalize: false,
      otpRequired: false, crbRequired: false, maxAmount: null, disbursementRoute: null, slaHours: 0,
    },
    {
      id: STAGE_FINAL, title: "Final Approval", accessTier: 3, canFinalize: true,
      otpRequired: true, crbRequired: false, maxAmount: null, disbursementRoute: null, slaHours: 0,
    },
  ];
}

/**
 * The stages THIS application passes through, in order, and where it is now.
 *
 * A repeat borrower may take a different chain from a new one — that is
 * `repeatWorkflowId`, and it is the lender's call, not ours. Falling back to
 * `newWorkflowId` when a lender has set only one is deliberate: a repeat
 * customer must never end up with NO workflow because the optional one was left
 * blank.
 */
export async function resolveStageChain(app: {
  orgId: string;
  productId: string | null;
  currentStageId: string | null;
  graduated: boolean;
  priorLoanCount: number;
}): Promise<{ chain: StageDef[]; index: number; current: StageDef }> {
  let chain = virtualChain();

  if (app.productId) {
    const product = await prisma.product.findUnique({
      where: { id: app.productId },
      select: { newWorkflowId: true, repeatWorkflowId: true },
    });
    const isRepeat = app.graduated || app.priorLoanCount > 0;
    const workflowId = (isRepeat ? product?.repeatWorkflowId : product?.newWorkflowId) ?? product?.newWorkflowId;

    if (workflowId) {
      const stages = await prisma.workflowStage.findMany({
        where: { workflowId, workflow: { orgId: app.orgId } },
        orderBy: { order: "asc" },
      });
      if (stages.length > 0) {
        chain = stages.map((s) => ({
          id: s.id,
          title: s.title,
          accessTier: s.accessTier,
          canFinalize: s.canFinalize,
          otpRequired: s.otpRequired,
          crbRequired: s.crbRequired,
          maxAmount: s.maxAmount != null ? Number(s.maxAmount) : null,
          disbursementRoute: s.disbursementRoute,
          slaHours: s.slaHours,
        }));
      }
    }
  }

  // An unknown or stale id — the workflow was edited under a live case — restarts
  // at stage one rather than throwing. A case that cannot be located in its own
  // chain is a case no officer can action, which is worse than one that has to
  // be re-walked.
  const found = chain.findIndex((s) => s.id === (app.currentStageId ?? chain[0].id));
  const index = Math.max(0, found);
  return { chain, index, current: chain[index] };
}
