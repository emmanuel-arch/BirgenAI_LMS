// ─────────────────────────────────────────────────────────────────────────────
// THE CUSTOMER JOURNEY — one state machine, read by both faces of the platform.
//
// WHY THIS FILE EXISTS. The borrower portal and the staff console are two views
// of ONE customer, and they were each deriving "where is this person up to" from
// their own local reasoning: the 360 page computed a five-step ladder inline, the
// portal advanced a numeric wizard step. Nothing forced them to agree. That is
// how you end up with a customer who is being asked to verify their ID on their
// phone while an officer is looking at a screen that says they are ready for a
// statement crunch — two truths about one person, and a support call that nobody
// can win.
//
// So the stage is computed HERE, from rows, once. Both faces render it. They can
// still SAY different things — the portal says "we're checking your ID", the
// console says "KYC pending, assigned to you" — but they can no longer BE at
// different stages, because there is only one function that decides.
//
// THE ORDER IS THE PRODUCT. Each stage is gated on the one before it because the
// business genuinely requires it: you cannot score a statement for someone whose
// identity is unproven, and you cannot lend to someone you have not scored. A
// stage's `blockedBy` names what is missing, which is the only thing anyone
// actually wants to know when they ask "why is this stuck?".
// ─────────────────────────────────────────────────────────────────────────────

export const JOURNEY_STAGES = [
  "REGISTERED",
  "KYC_PENDING",
  "KYC_VERIFIED",
  "SCORED",
  "APPLIED",
  "OFFERED",
  "SIGNED",
  "ACTIVE",
  "CLEARED",
] as const;

export type JourneyStage = (typeof JOURNEY_STAGES)[number];

/** The rows the stage is derived from. Deliberately small — anything richer would
 *  tempt a caller to pass a half-loaded record and get a confident wrong answer. */
export type JourneyFacts = {
  kycStatus: string | null;
  /** Any score at all: the crunch snapshot, or a headline score on the row. */
  hasScore: boolean;
  applications: { status: string }[];
  offers: { status: string }[];
  loans: { status: string }[];
};

export type JourneyView = {
  stage: JourneyStage;
  /** 0-based index into the ladder — what a progress bar renders. */
  index: number;
  /** What the STAFF see on the console. */
  staffLabel: string;
  /** What the CUSTOMER sees in the portal. Same stage, their language. */
  borrowerLabel: string;
  /** The single next action, named. Null when there is nothing to do but wait. */
  next: string | null;
  /** What is missing, when the stage cannot advance on its own. */
  blockedBy: string | null;
  /** Whose move it is. The most common support question, answered structurally. */
  waitingOn: "borrower" | "lender" | "system" | "nobody";
};

const ORDER: Record<JourneyStage, number> = Object.fromEntries(
  JOURNEY_STAGES.map((s, i) => [s, i]),
) as Record<JourneyStage, number>;

// The exact enum members from prisma/schema.prisma. Spelled out rather than
// derived so a new status is a compile-time conversation, not a customer who
// silently falls back to "Registered" on both screens at once.

/** ApplicationStatus values that mean "still moving" — nobody has finished with it. */
const OPEN_APPLICATION = new Set(["SUBMITTED", "AI_PRESCREEN", "OFFICER_REVIEW", "REFERRED"]);
/** ApplicationStatus values that mean an officer said yes. */
const APPROVED_APPLICATION = new Set(["APPROVED", "DISBURSED"]);
/** OfferStatus: the borrower has signed it. */
const SIGNED_OFFER = new Set(["ACCEPTED"]);
/** OfferStatus: it is out there, waiting on them. */
const OPEN_OFFER = new Set(["OFFERED"]);
/** LoanStatus values that mean money is out. */
const LIVE_LOAN = new Set(["ACTIVE", "PENDING_DISBURSEMENT", "RESTRUCTURED"]);
/** KycStatus values that mean documents are in and a decision is pending. */
const KYC_IN_FLIGHT = new Set(["IN_PROGRESS", "PENDING_REVIEW"]);

/**
 * Where this customer actually is.
 *
 * Read strictly downward: the FURTHEST stage whose evidence exists wins, because a
 * customer with an active loan is not "KYC pending" merely because someone let
 * their ID expire. Regressing a live borrower to an onboarding step is the single
 * most confusing thing this function could do.
 */
export function journeyOf(f: JourneyFacts): JourneyView {
  const kyc = (f.kycStatus ?? "NONE").toUpperCase();
  const verified = kyc === "VERIFIED";
  const cleared = f.loans.some((l) => l.status === "CLEARED");
  const live = f.loans.some((l) => LIVE_LOAN.has(l.status));
  const signed = f.offers.some((o) => SIGNED_OFFER.has(o.status));
  const offered = f.offers.some((o) => OPEN_OFFER.has(o.status));
  const applied = f.applications.length > 0;
  const openApp = f.applications.some((a) => OPEN_APPLICATION.has(a.status));
  // An approved application with no offer yet is still the lender's move — the
  // offer has to be generated. Without this, "approved" reads as "waiting on the
  // borrower", and the officer who owes them a contract never sees it.
  const approvedNoOffer = f.applications.some((a) => APPROVED_APPLICATION.has(a.status)) && !offered && !signed;

  const stage: JourneyStage =
    live ? "ACTIVE"
      : cleared ? "CLEARED"
        : signed ? "SIGNED"
          : offered ? "OFFERED"
            : applied ? "APPLIED"
              : f.hasScore ? "SCORED"
                : verified ? "KYC_VERIFIED"
                  : KYC_IN_FLIGHT.has(kyc) ? "KYC_PENDING"
                    : "REGISTERED";

  return { stage, index: ORDER[stage], ...COPY[stage](f, { openApp, approvedNoOffer }) };
}

type Extra = { openApp: boolean; approvedNoOffer: boolean };
type Copy = Omit<JourneyView, "stage" | "index">;

const COPY: Record<JourneyStage, (f: JourneyFacts, x: Extra) => Copy> = {
  REGISTERED: () => ({
    staffLabel: "Registered",
    borrowerLabel: "Account created",
    next: "Verify their identity",
    blockedBy: "No ID has been submitted yet.",
    waitingOn: "borrower",
  }),
  KYC_PENDING: () => ({
    staffLabel: "KYC verification",
    borrowerLabel: "We're checking your ID",
    next: "Review the ID and selfie",
    blockedBy: "Identity documents are waiting for review.",
    waitingOn: "lender",
  }),
  KYC_VERIFIED: () => ({
    staffLabel: "Awaiting statement",
    borrowerLabel: "Share your M-Pesa statement",
    next: "Crunch their M-Pesa statement",
    blockedBy: "No statement has been scored yet.",
    waitingOn: "borrower",
  }),
  SCORED: () => ({
    staffLabel: "Scored — ready to apply",
    borrowerLabel: "You're approved to apply",
    next: "Start an application",
    blockedBy: null,
    waitingOn: "borrower",
  }),
  APPLIED: (_f, x) => x.approvedNoOffer
    ? {
        staffLabel: "Approved — offer not sent",
        borrowerLabel: "Approved — your offer is being prepared",
        next: "Generate and send the offer",
        blockedBy: "The credit agreement has not been issued yet.",
        waitingOn: "lender" as const,
      }
    : {
        staffLabel: x.openApp ? "Application in review" : "Application closed",
        borrowerLabel: x.openApp ? "Your application is being reviewed" : "Application closed",
        next: x.openApp ? "Decide the application" : null,
        blockedBy: x.openApp ? "An officer has not decided yet." : null,
        waitingOn: x.openApp ? ("lender" as const) : ("nobody" as const),
      },
  OFFERED: () => ({
    staffLabel: "Offer sent — awaiting signature",
    borrowerLabel: "Your offer is ready to sign",
    next: "Wait for the borrower to sign in the portal",
    blockedBy: "The offer has not been signed.",
    waitingOn: "borrower",
  }),
  SIGNED: () => ({
    staffLabel: "Signed — ready to disburse",
    borrowerLabel: "Signed — your money is on the way",
    next: "Disburse the loan",
    blockedBy: "Disbursement has not been released.",
    waitingOn: "lender",
  }),
  ACTIVE: () => ({
    staffLabel: "Active loan",
    borrowerLabel: "Loan running",
    next: "Collect on schedule",
    blockedBy: null,
    waitingOn: "borrower",
  }),
  CLEARED: () => ({
    staffLabel: "Cleared — eligible to graduate",
    borrowerLabel: "Loan cleared — you can borrow again",
    next: "Offer their next limit",
    blockedBy: null,
    waitingOn: "nobody",
  }),
};

/**
 * The ladder, for a progress rail. `done` is computed against the live stage, so
 * the console's five-step rail and the portal's checklist mark the same steps —
 * which is the whole point of this module.
 */
export function journeyLadder(view: JourneyView, audience: "staff" | "borrower" = "staff") {
  const blank: JourneyFacts = { kycStatus: null, hasScore: false, applications: [], offers: [], loans: [] };
  const neutral: Extra = { openApp: true, approvedNoOffer: false };
  return JOURNEY_STAGES.map((s) => {
    const c = COPY[s](blank, neutral);
    return {
      stage: s,
      label: audience === "staff" ? c.staffLabel : c.borrowerLabel,
      done: ORDER[s] < view.index,
      current: s === view.stage,
    };
  });
}
