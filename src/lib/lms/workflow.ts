// ─────────────────────────────────────────────────────────────────────────────
// BirgenAI Hub loan workflow — the SINGLE SOURCE OF TRUTH for the approval stages
// a portal-originated loan moves through. These stages are mirrored 1:1 in:
//   • the lms.birgenai.com portal (LmsApplication.status), and
//   • the ServiceSuite ApprovalWorkflowStage table (a dedicated "BirgenAI Hub"
//     workflow created via prisma/manual-sql/20260630_birgenai_workflow.sql).
//
// So a loan applied on lms appears inside ServiceSuite under the BirgenAI workflow,
// and the lender's officers approve/decline it with the SAME stage names they see
// in the portal. Keep this list and the ServiceSuite stages identical.
//
// ServiceSuite mapping: AccessID 1 = initiator, 2 = authorizer, 3 = validator
// (matches the MainDashboard SP). `serviceSuiteAccessId` aligns each portal stage
// to the ServiceSuite role tier that actions it.
// ─────────────────────────────────────────────────────────────────────────────

export type LmsStageKey =
  | "SUBMITTED"
  | "AI_PRESCREEN"
  | "OFFICER_REVIEW"
  | "APPROVED"
  | "DISBURSED"
  | "REFERRED"
  | "DECLINED";

export type LmsStage = {
  key: LmsStageKey;
  order: number;
  /** Title shown in BOTH the portal and the ServiceSuite workflow stage. */
  title: string;
  /** Borrower-facing description. */
  borrowerLabel: string;
  /** ServiceSuite role tier that acts on this stage (1/2/3), or null for terminal/auto. */
  serviceSuiteAccessId: 1 | 2 | 3 | null;
  /** A live, pending stage in the pipeline (vs terminal). */
  terminal: boolean;
  tone: "info" | "good" | "warn" | "bad";
};

export const BIRGENAI_WORKFLOW_NAME = "BirgenAI Hub";

export const LMS_STAGES: Record<LmsStageKey, LmsStage> = {
  SUBMITTED: {
    key: "SUBMITTED",
    order: 1,
    title: "BirgenAI Submitted",
    borrowerLabel: "Application received",
    serviceSuiteAccessId: 1,
    terminal: false,
    tone: "info",
  },
  AI_PRESCREEN: {
    key: "AI_PRESCREEN",
    order: 2,
    title: "BirgenAI AI Pre-Screen",
    borrowerLabel: "Running affordability & risk checks",
    serviceSuiteAccessId: 1,
    terminal: false,
    tone: "info",
  },
  OFFICER_REVIEW: {
    key: "OFFICER_REVIEW",
    order: 3,
    title: "BirgenAI Officer Review",
    borrowerLabel: "Under review by the lender",
    serviceSuiteAccessId: 2,
    terminal: false,
    tone: "warn",
  },
  APPROVED: {
    key: "APPROVED",
    order: 4,
    title: "BirgenAI Approved",
    borrowerLabel: "Approved — preparing disbursement",
    serviceSuiteAccessId: 3,
    terminal: false,
    tone: "good",
  },
  DISBURSED: {
    key: "DISBURSED",
    order: 5,
    title: "BirgenAI Disbursed",
    borrowerLabel: "Disbursed to your M-PESA",
    serviceSuiteAccessId: null,
    terminal: true,
    tone: "good",
  },
  REFERRED: {
    key: "REFERRED",
    order: 6,
    title: "BirgenAI Referred",
    borrowerLabel: "Referred for a human review",
    serviceSuiteAccessId: 2,
    terminal: false,
    tone: "warn",
  },
  DECLINED: {
    key: "DECLINED",
    order: 7,
    title: "BirgenAI Declined",
    borrowerLabel: "Not approved this time",
    serviceSuiteAccessId: null,
    terminal: true,
    tone: "bad",
  },
};

/** Ordered list of the pipeline stages (for progress UIs). */
export const LMS_PIPELINE: LmsStageKey[] = ["SUBMITTED", "AI_PRESCREEN", "OFFICER_REVIEW", "APPROVED", "DISBURSED"];

export function stage(key: LmsStageKey): LmsStage {
  return LMS_STAGES[key];
}

/**
 * Decide the initial post-screen stage from the thin-file decision.
 * APPROVE → goes to the lender's officer to verify & finalize (we never auto-disburse).
 * REFER/DECLINE → human-in-the-loop (DPA requirement: no purely-automated adverse decision).
 */
export function stageFromDecision(decision: "APPROVE" | "REFER" | "DECLINE"): LmsStageKey {
  if (decision === "APPROVE") return "OFFICER_REVIEW";
  if (decision === "REFER") return "REFERRED";
  return "REFERRED"; // even a model "DECLINE" gets a human review before a final no
}
