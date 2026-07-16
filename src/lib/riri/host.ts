// ─────────────────────────────────────────────────────────────────────────────
// THE SEAM THAT MAKES RIRI A PRODUCT.
//
// Riri is sold as a thing you add to a lending system — ours today, ServiceSuite next.
// That only works if her brain never touches a database directly. Everything she needs
// to know about the world arrives through this one interface, and a host implements it:
//
//   providers/lms.ts          → reads our Postgres (Prisma)
//   providers/servicesuite.ts → reads their SQL Server through the existing read-only
//                               adapter (lib/enterprise/mssql.ts). Not written yet, but
//                               nothing in assistant.ts will have to change when it is.
//
// If the core imported Prisma, "add Riri to your system" would mean "migrate your loan
// book to our database first" — which is not a sale, it is a replacement, and these
// lenders are not replacing ServiceSuite.
//
// The unit of integration is therefore this file. A host answers four questions:
// who is asking, who are they looking at, what has Riri concluded about them before,
// and how does she write that down.
// ─────────────────────────────────────────────────────────────────────────────

/** The person at the keyboard. Always resolved by the HOST from its own session. */
export type RiriActor = {
  id: string | null;
  name: string | null;
  /** The host's own role title, verbatim — "Relationship Officer", "Team Leader". */
  roleTitle: string | null;
  branch: string | null;
  /** What they may see. Riri never describes a screen they cannot open. */
  rights: ReadonlySet<string>;
  /**
   * The host's own operator, acting as this tenant, rather than the tenant's staff.
   * A host without that concept simply never sets it.
   */
  isPlatformAdmin?: boolean;
};

/**
 * A customer, as facts.
 *
 * Plain sentences rather than a typed schema on purpose: every lending system models a
 * borrower differently, and a shared type would either be so loose it says nothing or
 * so tight only we could satisfy it. The host states what is true in its own terms;
 * Riri writes the prose. `lines` is the contract.
 */
export type RiriSubjectFacts = {
  kind: "borrower";
  id: string;
  /** For display and logging. Never used as a fact. */
  label: string;
  lines: string[];
  /** Set when the host must not discuss this person at all (e.g. erased under DPA). */
  restricted?: boolean;
};

/** One thing Riri concluded about a member of staff, previously. */
export type RiriMemoryNote = {
  kind: "recommendation" | "pattern" | "preference" | "summary";
  body: string;
  subjectId?: string | null;
  createdAt: Date;
};

/**
 * Everything Riri needs from the system she is living in.
 *
 * A host that cannot do memory returns [] and ignores writes — she is then merely
 * contextual rather than continuous, which is a licensing tier, not a broken install.
 */
export type RiriHost = {
  /** Stable id of the tenant, used to scope everything. */
  orgId: string;
  /** The lender's display name — she says it out loud. */
  lenderName: string;

  actor(): Promise<RiriActor>;
  subject(kind: string, id: string): Promise<RiriSubjectFacts | null>;

  /**
   * The book this actor is accountable for, as facts.
   *
   * Scoped by the host to match the job: an officer's own customers, a manager's whole
   * portfolio. "Who should I chase today?" is a question about THEIR book, and answering
   * it with the lender's aggregate is answering a question nobody asked.
   */
  book(actor: RiriActor): Promise<string[]>;

  /** What she already knows about this member of staff. Newest first. */
  recall(staffId: string, limit: number): Promise<RiriMemoryNote[]>;
  /** Write something down. Best-effort: a host without memory may no-op. */
  remember(staffId: string, note: Omit<RiriMemoryNote, "createdAt">, ttlDays?: number): Promise<void>;
};
