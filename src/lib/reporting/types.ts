// ─────────────────────────────────────────────────────────────────────────────
// WHAT A REPORT IS.
//
// One shape for every report in the system, whether it mirrors something
// ServiceSuite already ships or is one of ours. That uniformity is what lets a
// single browser screen, a single export pipeline and a single naming
// convention serve all of them — and it is why adding a report is one entry in
// definitions.ts rather than a page, a route and a download handler.
// ─────────────────────────────────────────────────────────────────────────────
import type { LiveScope } from "@/lib/analytics/scope";

/** How a column is rendered, aligned, totalled and written into Excel. */
export type ColumnFormat = "text" | "money" | "count" | "percent" | "date" | "days";

export type ReportColumn = {
  key: string;
  label: string;
  format: ColumnFormat;
  /** Sum this column in a totals row. Only ever set on additive measures. */
  total?: boolean;
  /** Hidden by default in the table; still exported. Keeps a 22-column report readable. */
  secondary?: boolean;
};

export type ReportCategory = "OPERATIONS" | "RISK" | "COLLECTIONS" | "FINANCE" | "EXECUTIVE";

export type ReportParams = {
  from: Date;
  to: Date;
  /** Org-unit ids to narrow to. Empty = every branch the book has. */
  branchIds: number[];
  officerIds: number[];
  /** Hard row cap. Reports are read on screen and exported in full separately. */
  limit: number;
};

export type ReportRow = Record<string, string | number | null>;

export type ReportDef = {
  id: string;
  name: string;
  category: ReportCategory;
  /** One line: the question this report answers. */
  purpose: string;
  /**
   * The ServiceSuite procedure this stands in for, if any.
   *
   * Recorded rather than implied, because it is the claim a lender will check
   * first — "is this the same report I already run?" — and because the parity
   * script needs to know which of their procedures to hold ours against.
   */
  mirrors: string | null;
  /**
   * Where ours DELIBERATELY differs from theirs, in one sentence.
   *
   * Printed under the table and carried into the export header. A report that
   * quietly disagrees with the one a manager has read for three years destroys
   * trust in everything beside it; a report that says where it differs, and why,
   * is the reason to switch.
   */
  divergence?: string;
  columns: ReportColumn[];
  /** False for a stock report — a snapshot of today that a date range cannot move. */
  ranged: boolean;
  /** Read-only SQL, entity-scoped. Returns rows in the declared column shape. */
  run: (scope: LiveScope, p: ReportParams) => Promise<ReportRow[]>;
};

export type ReportResult = {
  def: ReportDef;
  rows: ReportRow[];
  /** True when the row cap trimmed the result — the UI must say so. */
  truncated: boolean;
  elapsedMs: number;
  /** The books this run covered, for the header and the filename. */
  books: Array<{ id: number; label: string }>;
  params: ReportParams;
};
