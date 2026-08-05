// ─────────────────────────────────────────────────────────────────────────────
// WHOSE SYSTEM PAYS THIS LOAN OUT?
//
// Until now the answer was a property of how the lender's org happened to be
// wired: NATIVE orgs booked here and moved money through our B2C queue, BRIDGED
// orgs posted into their own system and their process paid. That is a reasonable
// default and a poor rule — it makes an operational choice a structural one, and
// it means a bridged lender who wants ONE product automated has to migrate their
// whole book to get it.
//
// So the finalizing stage of a workflow may now say it directly. The lender picks,
// per workflow, at the last stage before money moves:
//
//   LENDER_BRIDGE   post into their approval workflow; they disburse.
//                   We keep the application, the score and the audit trail.
//   LMS_NATIVE      book here; our maker-checker queue → Daraja B2C → callback
//                   → auto-reconciliation. The product's `disbursementMode` still
//                   decides the instrument (B2C / manual / to a third party).
//
// Null on the stage means "inherit the org's mode", which is exactly what every
// workflow did before the column existed — so adding it changed nothing, and a
// lender opts in one workflow at a time.
// ─────────────────────────────────────────────────────────────────────────────
import type { DisbursementRoute, OrgMode } from "@prisma/client";

export type RouteDecision = {
  route: DisbursementRoute;
  /** Did a stage say so, or did we fall back to the org's mode? */
  source: "stage" | "org-mode";
  /** One line for the audit record and the officer's screen. */
  detail: string;
};

/** The org's wiring, when nothing more specific was configured. */
export function routeFromOrgMode(mode: OrgMode): DisbursementRoute {
  return mode === "NATIVE" ? "LMS_NATIVE" : "LENDER_BRIDGE";
}

export function resolveDisbursementRoute(input: {
  /** The finalizing stage's setting, if the workflow named one. */
  stageRoute: DisbursementRoute | null | undefined;
  stageTitle?: string | null;
  orgMode: OrgMode;
}): RouteDecision {
  if (input.stageRoute) {
    return {
      route: input.stageRoute,
      source: "stage",
      detail:
        input.stageRoute === "LMS_NATIVE"
          ? `"${input.stageTitle ?? "Finalize"}" disburses through BirgenAI.`
          : `"${input.stageTitle ?? "Finalize"}" posts the loan into the lender's own workflow.`,
    };
  }
  const route = routeFromOrgMode(input.orgMode);
  return {
    route,
    source: "org-mode",
    detail:
      route === "LMS_NATIVE"
        ? "No route set on the finalizing stage — defaulting to BirgenAI disbursement (native org)."
        : "No route set on the finalizing stage — defaulting to the lender's own workflow (bridged org).",
  };
}
