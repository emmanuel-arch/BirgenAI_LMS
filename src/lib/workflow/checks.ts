// ─────────────────────────────────────────────────────────────────────────────
// THE CHECK CATALOGUE — every automated verification the platform can run, as
// data, so a lender can attach any of them ANYWHERE.
//
// The system we are replacing hard-codes each check into the one place its author
// happened to need it. `RequestMpesaRatiba` is a bit column on a workflow stage.
// A CRB pull is a button on the finance screen. An IPRS lookup only exists on the
// borrower form. The consequence is that a lender who wants CRB at ONBOARDING, or
// a Ratiba mandate at the RISK stage rather than the finance one, cannot have it —
// not because it is hard, but because the check is not a thing, it is a column.
//
// Here a check IS a thing:
//
//   · it declares WHERE it may be attached (`surfaces`)
//   · it declares WHAT IT NEEDS to run (`requires` — a vault credential, a
//     document, a prior check), so a screen can say "connect Metropol first"
//     instead of failing at the counter
//   · it declares WHETHER IT CAN BLOCK, so "advisory" and "hard gate" are the
//     lender's decision rather than ours
//   · it declares its COST SHAPE, because a lender running a full CRB pull on
//     every walk-in deserves to be told before the invoice arrives
//
// Attaching one is then the same act everywhere: a workflow stage holds check
// bindings, the onboarding config holds check bindings, a product's evidence block
// holds check bindings. One vocabulary, one runner, one audit line.
// ─────────────────────────────────────────────────────────────────────────────

/** Where a check may be attached. */
export type CheckSurface =
  /** Borrower onboarding — before the person is a customer. */
  | "onboarding"
  /** A loan application, at submission. */
  | "application"
  /** Any stage of any approval workflow. */
  | "stage"
  /** Immediately before money moves. */
  | "disbursement"
  /** On the live book, on a cadence. */
  | "monitoring";

/** What must exist for the check to be runnable at all. */
export type CheckRequirement =
  | { kind: "vault"; vaultKind: string; label: string }
  | { kind: "document"; attachmentCode: string; label: string }
  | { kind: "field"; path: string; label: string }
  | { kind: "check"; checkId: string; label: string };

export type CheckGroup =
  | "Identity" | "Bureau & risk" | "Cashflow" | "Collateral & people"
  | "Field" | "Money rails" | "Engine";

export type CheckSpec = {
  id: string;
  label: string;
  /** One line, in the lender's words, of what actually happens. */
  blurb: string;
  group: CheckGroup;
  surfaces: CheckSurface[];
  requires: CheckRequirement[];
  /**
   * May a lender configure this check to STOP the flow when it fails?
   * A face match can block. A behavioural re-score cannot — there is nothing to fail.
   */
  canBlock: boolean;
  /**
   * What running it costs, so the screen can warn before the invoice does.
   *   free      — ours, no third party
   *   metered   — a per-call charge from a provider
   *   billable  — a per-call charge the LENDER may pass on to the borrower
   */
  cost: "free" | "metered" | "billable";
  /** Roughly how long it takes, for the "this stage will feel slow" warning. */
  latency: "instant" | "seconds" | "minutes" | "human";
};

export const CHECKS: CheckSpec[] = [
  // ── Identity ───────────────────────────────────────────────────────────────
  {
    id: "iprs.lookup",
    label: "National registry match (IPRS)",
    blurb: "Confirms the ID number exists and returns the person the registry holds against it.",
    group: "Identity",
    surfaces: ["onboarding", "application", "stage"],
    requires: [
      { kind: "vault", vaultKind: "IPRS", label: "IPRS credentials" },
      { kind: "field", path: "nationalId", label: "National ID number" },
    ],
    canBlock: true,
    cost: "metered",
    latency: "seconds",
  },
  {
    id: "ocr.id",
    label: "ID document read (OCR)",
    blurb: "Reads the ID card photo and fills the identity fields from it. No credentials needed.",
    group: "Identity",
    surfaces: ["onboarding", "application", "stage"],
    requires: [{ kind: "document", attachmentCode: "ID_FRONT", label: "Photo of the ID front" }],
    canBlock: true,
    cost: "free",
    latency: "seconds",
  },
  {
    id: "face.match",
    label: "Face match",
    blurb: "Compares the selfie against the photo on the ID document.",
    group: "Identity",
    surfaces: ["onboarding", "stage"],
    requires: [
      { kind: "document", attachmentCode: "SELFIE", label: "Selfie" },
      { kind: "document", attachmentCode: "ID_FRONT", label: "Photo of the ID front" },
    ],
    canBlock: true,
    cost: "free",
    latency: "seconds",
  },
  {
    id: "liveness",
    label: "Liveness",
    blurb: "Proves the selfie is a live person and not a photograph of one.",
    group: "Identity",
    surfaces: ["onboarding"],
    requires: [{ kind: "check", checkId: "face.match", label: "Face match" }],
    canBlock: true,
    cost: "free",
    latency: "seconds",
  },
  {
    id: "duplicate.check",
    label: "Duplicate customer check",
    blurb: "Refuses a second record for an ID number or phone already on your book.",
    group: "Identity",
    surfaces: ["onboarding"],
    requires: [],
    canBlock: true,
    cost: "free",
    latency: "instant",
  },

  // ── Bureau & risk ──────────────────────────────────────────────────────────
  {
    id: "crb.score",
    label: "CRB score only",
    blurb: "The bureau score alone — the cheapest pull, enough to sort applicants.",
    group: "Bureau & risk",
    surfaces: ["onboarding", "application", "stage", "monitoring"],
    requires: [{ kind: "vault", vaultKind: "CRB", label: "Bureau credentials" }],
    canBlock: true,
    cost: "billable",
    latency: "seconds",
  },
  {
    id: "crb.standard",
    label: "CRB standard report",
    blurb: "Score plus the credit file — accounts, arrears and enquiries.",
    group: "Bureau & risk",
    surfaces: ["onboarding", "application", "stage"],
    requires: [{ kind: "vault", vaultKind: "CRB", label: "Bureau credentials" }],
    canBlock: true,
    cost: "billable",
    latency: "seconds",
  },
  {
    id: "crb.full",
    label: "CRB full report",
    blurb: "The complete file including income indicators. The most expensive pull.",
    group: "Bureau & risk",
    surfaces: ["onboarding", "application", "stage"],
    requires: [{ kind: "vault", vaultKind: "CRB", label: "Bureau credentials" }],
    canBlock: true,
    cost: "billable",
    latency: "seconds",
  },
  {
    id: "blacklist.check",
    label: "Internal blacklist",
    blurb: "Refuses anyone you have written off or barred, before anything else runs.",
    group: "Bureau & risk",
    surfaces: ["onboarding", "application", "stage"],
    requires: [],
    canBlock: true,
    cost: "free",
    latency: "instant",
  },
  {
    id: "aml.screen",
    label: "Sanctions & PEP screen",
    blurb: "Screens the name against sanctions and politically-exposed-person lists.",
    group: "Bureau & risk",
    surfaces: ["onboarding", "stage"],
    requires: [{ kind: "vault", vaultKind: "AML", label: "Screening provider" }],
    canBlock: true,
    cost: "metered",
    latency: "seconds",
  },

  // ── Cashflow ───────────────────────────────────────────────────────────────
  {
    id: "mpesa.statement",
    label: "M-Pesa statement crunch",
    blurb: "Reads a 6-month statement and derives income, expenditure and volatility.",
    group: "Cashflow",
    surfaces: ["onboarding", "application", "stage"],
    requires: [{ kind: "document", attachmentCode: "MPESA_STATEMENT", label: "M-Pesa statement PDF" }],
    canBlock: false,
    cost: "free",
    latency: "seconds",
  },
  {
    id: "bank.statement",
    label: "Bank statement crunch",
    blurb: "The same cashflow read, for a banked borrower.",
    group: "Cashflow",
    surfaces: ["application", "stage"],
    requires: [{ kind: "document", attachmentCode: "BANK_STATEMENT", label: "Bank statement PDF" }],
    canBlock: false,
    cost: "free",
    latency: "seconds",
  },
  {
    id: "affordability",
    label: "Affordability test",
    blurb: "Checks the instalment against assessed capacity under your credit policy.",
    group: "Cashflow",
    surfaces: ["application", "stage"],
    requires: [{ kind: "check", checkId: "mpesa.statement", label: "A cashflow read" }],
    canBlock: true,
    cost: "free",
    latency: "instant",
  },

  // ── Collateral & people ────────────────────────────────────────────────────
  {
    id: "guarantor.confirm",
    label: "Guarantor confirmation",
    blurb: "The guarantor is asked to confirm by SMS link or OTP before the loan may advance.",
    group: "Collateral & people",
    surfaces: ["application", "stage"],
    requires: [{ kind: "vault", vaultKind: "SMS", label: "SMS sender" }],
    canBlock: true,
    cost: "metered",
    latency: "human",
  },
  {
    id: "security.valuation",
    label: "Security valuation",
    blurb: "Verified collateral value must cover the product's required percentage.",
    group: "Collateral & people",
    surfaces: ["application", "stage"],
    requires: [{ kind: "document", attachmentCode: "SECURITY_PHOTO", label: "Photo of the security" }],
    canBlock: true,
    cost: "free",
    latency: "human",
  },

  // ── Field ──────────────────────────────────────────────────────────────────
  {
    id: "geo.pin",
    label: "Location snapshot",
    blurb: "A consented one-time pin of the business or home. What dispatch routes on.",
    group: "Field",
    surfaces: ["onboarding", "application"],
    requires: [],
    canBlock: true,
    cost: "free",
    latency: "instant",
  },
  {
    id: "field.visit",
    label: "Field verification visit",
    blurb: "An officer must physically verify and file a visit before this stage clears.",
    group: "Field",
    surfaces: ["onboarding", "application", "stage", "disbursement"],
    requires: [{ kind: "check", checkId: "geo.pin", label: "A location on file" }],
    canBlock: true,
    cost: "free",
    latency: "human",
  },

  // ── Money rails ────────────────────────────────────────────────────────────
  {
    id: "ratiba.mandate",
    label: "M-Pesa Ratiba mandate",
    blurb: "Requests a standing-order mandate from the borrower so instalments collect themselves.",
    group: "Money rails",
    surfaces: ["application", "stage", "disbursement"],
    requires: [{ kind: "vault", vaultKind: "MPESA_RATIBA", label: "Ratiba credentials" }],
    canBlock: true,
    cost: "metered",
    latency: "human",
  },
  {
    id: "ratiba.status",
    label: "Ratiba mandate status",
    blurb: "Confirms an active mandate exists before the stage may advance.",
    group: "Money rails",
    surfaces: ["stage", "disbursement", "monitoring"],
    requires: [{ kind: "check", checkId: "ratiba.mandate", label: "A requested mandate" }],
    canBlock: true,
    cost: "metered",
    latency: "instant",
  },
  {
    id: "float.available",
    label: "Disbursement float check",
    blurb: "Refuses to finalize when the paying shortcode cannot cover the payout.",
    group: "Money rails",
    surfaces: ["stage", "disbursement"],
    requires: [{ kind: "vault", vaultKind: "MPESA_B2C", label: "B2C credentials" }],
    canBlock: true,
    cost: "free",
    latency: "instant",
  },
  {
    id: "charges.settled",
    label: "Upfront charges settled",
    blurb: "Every before-disbursement fee on the product must be paid before money moves.",
    group: "Money rails",
    surfaces: ["stage", "disbursement"],
    requires: [],
    canBlock: true,
    cost: "free",
    latency: "instant",
  },

  // ── Engine ─────────────────────────────────────────────────────────────────
  {
    id: "score.behaviour",
    label: "Behavioural re-score",
    blurb: "Re-scores the borrower on their own repayment record under the live policy.",
    group: "Engine",
    surfaces: ["application", "stage", "monitoring"],
    requires: [],
    canBlock: false,
    cost: "free",
    latency: "instant",
  },
  {
    id: "limit.engine",
    label: "Limit engine",
    blurb: "Derives what this borrower may take under your credit policy, right now.",
    group: "Engine",
    surfaces: ["onboarding", "application", "stage"],
    requires: [],
    canBlock: true,
    cost: "free",
    latency: "instant",
  },
  {
    id: "document.complete",
    label: "Required documents present",
    blurb: "Every attachment the product asks for must be on file and legible.",
    group: "Engine",
    surfaces: ["application", "stage", "disbursement"],
    requires: [],
    canBlock: true,
    cost: "free",
    latency: "instant",
  },
];

export const CHECK_BY_ID: Record<string, CheckSpec> = Object.fromEntries(
  CHECKS.map((c) => [c.id, c]),
);

export const CHECK_GROUPS: readonly CheckGroup[] = [
  "Identity", "Bureau & risk", "Cashflow", "Collateral & people", "Field", "Money rails", "Engine",
] as const;

/** Every check that may be attached at a given surface. */
export function checksFor(surface: CheckSurface): CheckSpec[] {
  return CHECKS.filter((c) => c.surfaces.includes(surface));
}

/**
 * How a lender configured one attached check.
 *
 * `blocking` is the whole point of the split: the same CRB pull is a hard gate for
 * one lender and a note on the file for the next, and neither should need a deploy.
 */
export type CheckBinding = {
  id: string;
  /** Fail = the flow stops here. Only honoured when the spec `canBlock`. */
  blocking: boolean;
  /** A result older than this is re-run rather than trusted. 0 = always re-run. */
  maxAgeDays: number;
  /** A numeric bar, where the check has one — e.g. a minimum CRB score. */
  threshold: number | null;
};

export const defaultBinding = (id: string): CheckBinding => ({
  id,
  blocking: CHECK_BY_ID[id]?.canBlock ?? false,
  maxAgeDays: 30,
  threshold: null,
});

/**
 * Drop bindings whose check no longer exists or was never valid here, and clamp
 * what the spec forbids. A bare string is accepted as the shorthand a screen writes
 * when it only wants the default.
 */
export function normaliseBindings(raw: unknown, surface: CheckSurface): CheckBinding[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set(checksFor(surface).map((c) => c.id));
  const seen = new Set<string>();
  const out: CheckBinding[] = [];
  for (const item of raw) {
    const id = typeof item === "string" ? item : String((item as { id?: unknown } | null)?.id ?? "");
    if (!allowed.has(id) || seen.has(id)) continue;
    seen.add(id);
    const spec = CHECK_BY_ID[id];
    const o = (typeof item === "object" && item ? item : {}) as Record<string, unknown>;
    const wanted = o.blocking === undefined ? spec.canBlock : Boolean(o.blocking);
    const age = Number(o.maxAgeDays);
    out.push({
      // A lender cannot make a check block that has nothing to fail — the spec wins.
      blocking: spec.canBlock && wanted,
      id,
      maxAgeDays: Number.isFinite(age) ? Math.max(0, Math.min(365, Math.round(age))) : 30,
      threshold: typeof o.threshold === "number" && Number.isFinite(o.threshold) ? o.threshold : null,
    });
  }
  return out;
}

/** The credentials a set of bindings needs, deduplicated — for "connect this first". */
export function requiredVaultKinds(bindings: CheckBinding[]): string[] {
  const out = new Set<string>();
  for (const b of bindings) {
    for (const r of CHECK_BY_ID[b.id]?.requires ?? []) {
      if (r.kind === "vault") out.add(r.vaultKind);
    }
  }
  return [...out];
}
