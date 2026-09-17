// ─────────────────────────────────────────────────────────────────────────────
// TELLING A MERGED BUREAU FILE FROM ONE REPORT.
//
// Two different things now live in KycCheck rows of kind "CRB", and every screen
// that reads "the latest bureau file" has to want only the first:
//
//   THE MERGED FILE   what /api/console/crb writes — the lender's whole report
//                     set, run and merged into one CrbReport. Provider is the
//                     bureau's name ("Metropol CRB") or "simulation".
//   ONE REPORT        what scripts/crb-pull-all writes — a single Metropol
//                     report with the bureau's RAW answer kept, so the master
//                     file can weigh and age each scrutiny on its own. Provider
//                     is "metropol:report-<code>".
//
// Without this distinction the fragments would win on recency: pull the
// catalogue for a customer and the Customer-360 bureau panel, the application
// screen and the borrower portal would all start rendering a raw report-22
// payload as if it were the merged file, because it happens to be newest. That
// is not a hypothetical — it is what would have happened the first time this
// script ran.
//
// One predicate, imported by every reader, so the rule cannot be applied in four
// places and forgotten in a fifth.
// ─────────────────────────────────────────────────────────────────────────────

/** Provider prefix marking a row as ONE Metropol report rather than a merged file. */
export const PER_REPORT_PROVIDER = "metropol:report-";

/**
 * Provider prefix for a bureau file bought THROUGH THE INTERCHANGE.
 *
 * A third thing now lives in KycCheck(kind="CRB"), and it is neither of the
 * other two: the payload is the Interchange's normalised `BureauFile`, not a
 * `CrbReport` and not a raw Metropol body. Every screen that renders "the
 * latest bureau file" expects the CrbReport shape, so these rows are excluded
 * from MERGED_CRB_ONLY exactly as the per-report rows are — otherwise the
 * newest row wins on recency and the Customer-360 panel renders a shape it
 * cannot read.
 *
 * They DO satisfy the per-stage CRB gate, because they are a real, paid, recent
 * bureau file on that borrower. That is the one reader that wants all three.
 */
export const INTERCHANGE_PROVIDER = "interchange:report-";

/**
 * Prisma `where` fragment: merged bureau files only.
 *
 * Spread it beside `kind: "CRB"`. Rows with a null provider are INCLUDED —
 * they predate per-report filing and are all merged files.
 */
// Two NOTs under an AND rather than NOT{OR}: `as const` would make the OR a
// readonly tuple, which Prisma's generated where-types reject outright. No
// caller spreads an AND of its own beside this — checked — so the key is free.
export const MERGED_CRB_ONLY = {
  AND: [
    { NOT: { provider: { startsWith: PER_REPORT_PROVIDER } } },
    { NOT: { provider: { startsWith: INTERCHANGE_PROVIDER } } },
  ],
};

/**
 * Prisma `where` fragment: rows that satisfy a `crbRequired` stage.
 *
 * A merged file OR an Interchange bureau file. Both are a real bureau pull on
 * this borrower, recently, that somebody paid for — which is the entire question
 * the gate is asking. Per-report fragments are still excluded: a lone report 16
 * account-count summary is not a credit assessment.
 */
export const CRB_GATE_ROWS = {
  NOT: { provider: { startsWith: PER_REPORT_PROVIDER } },
} as const;

/** True when this row is one Metropol report rather than a merged bureau file. */
export function isPerReportRow(provider: string | null | undefined): boolean {
  return !!provider && provider.startsWith(PER_REPORT_PROVIDER);
}

/** The Metropol report code a per-report row carries, or null. */
export function reportCodeOf(provider: string | null | undefined): number | null {
  if (!isPerReportRow(provider)) return null;
  const n = Number(provider!.slice(PER_REPORT_PROVIDER.length));
  return Number.isFinite(n) ? n : null;
}
