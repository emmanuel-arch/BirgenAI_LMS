// ─────────────────────────────────────────────────────────────────────────────
// RUNNING A REPORT — one path, so every report is bounded, timed and provenanced
// the same way.
//
// The row cap matters more than it looks. Micromart's arrears position is 64,238
// loans; the OLB is 70,676. A report screen that tries to render those is a dead
// tab, and one that silently returns the first 500 without saying so is worse —
// somebody totals the column and reports the wrong number to a board. So the cap
// is explicit, the result says whether it bit, and the EXPORT path raises it,
// because a spreadsheet can hold what a table cannot.
// ─────────────────────────────────────────────────────────────────────────────
import type { StudioScope } from "@/lib/analytics/scope";
import { reportById } from "./definitions";
import type { ReportParams, ReportResult, ReportRow } from "./types";

/** What a screen shows. Enough to read and to spot-check; never enough to hang. */
export const SCREEN_ROWS = 500;
/** What a download carries. A spreadsheet holds what a table cannot. */
export const EXPORT_ROWS = 50_000;

export class ReportUnavailable extends Error {
  constructor(message: string) { super(message); this.name = "ReportUnavailable"; }
}

export async function runReport(
  scope: StudioScope,
  id: string,
  params: Omit<ReportParams, "limit"> & { limit?: number },
): Promise<ReportResult> {
  const def = reportById(id);
  if (!def) throw new ReportUnavailable(`No report called "${id}".`);

  // A bridged lender whose book is unreachable gets a NAMED refusal, never an
  // empty table. An empty arrears report reads as "nothing is late".
  if (!scope.live) {
    throw new ReportUnavailable(
      scope.unavailable ?? "This lender's book is not on a ServiceSuite server, so these reports do not apply to it.",
    );
  }

  const limit = Math.min(Math.max(params.limit ?? SCREEN_ROWS, 1), EXPORT_ROWS);
  const p: ReportParams = { ...params, limit };

  const t0 = Date.now();
  const rows = (await def.run(scope.live, p)) as ReportRow[];
  return {
    def,
    rows,
    // Equality is the only honest signal available: the query asked for TOP n
    // and got n, so there may be an n+1. Saying "at least this many" is right.
    truncated: rows.length >= limit,
    elapsedMs: Date.now() - t0,
    books: scope.live.lenses.map((l) => ({ id: l.id, label: l.label })),
    params: p,
  };
}
