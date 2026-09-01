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
 * Prisma `where` fragment: merged bureau files only.
 *
 * Spread it beside `kind: "CRB"`. Rows with a null provider are INCLUDED —
 * they predate per-report filing and are all merged files.
 */
export const MERGED_CRB_ONLY = {
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
