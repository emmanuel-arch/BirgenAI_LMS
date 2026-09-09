// ─────────────────────────────────────────────────────────────────────────────
// THE LIMIT LADDER, READ FROM THE LENDER'S OWN BOOK.
//
// /api/portal/ladder reads `prisma.graduationEvent` — OUR table, written by OUR
// graduation cron. For a BRIDGED lender that table is empty and always will be,
// because their ladder is climbed inside ServiceSuite by
// `dbo.sp_CreditScoringAndGraduation` and recorded in `dbo.LoanGraduationHistory`.
// So the Ladder screen has been telling all 17,022 Micromart customers that they
// have no limit history — the same shape of gap that put Home and Repay on
// sample data.
//
// Their table happens to carry the same columns ours does (previous limit, new
// limit, score, category, percentage, cleared count, and both sub-scores), so
// this is a mapping rather than a redesign.
//
// ── ONE RUNG PER MOVEMENT, NOT ONE PER CRON RUN ─────────────────────────────
// The procedure recomputes `NewLoanLimit` from the LAST CLEARED PRINCIPAL and
// never from the current limit, and its eligibility gate never stops matching.
// So it re-graduates the same borrower to the same number every night and
// records a row each time. On 9 Sep 2026 that table held 1,211,692 rows for
// 6,687 borrowers on entity 3005 alone; borrower 22 had 192 rows describing
// TWO actual movements.
//
// Rendering it raw would show a customer ~190 identical rungs, which does not
// read as a history — it reads as a broken screen. So consecutive rows that
// repeat the previous row's (PreviousLimit, NewLimit) pair are collapsed, and a
// row that moved nothing at all is dropped outright. The date kept is the FIRST
// occurrence, which is when the limit actually moved.
//
// sql/micromart/sp_CreditScoringAndGraduation.fixed.sql stops the repetition at
// source. This collapse still has to exist afterwards, because the eight months
// of rows already written do not go away when the procedure is fixed.
//
// ── THEIR GraduationCount IS NOT A COUNT OF GRADUATIONS ─────────────────────
// `Borrowers.GraduationCount` is incremented once per run by the same statement
// that re-applies the unchanged limit, so it counts nightly cron runs. Borrower
// 22 reads 193 against two real movements. It is NOT passed through: the screen
// says "Reviews passed", and 193 would be a plainly false statement about a
// customer with two. The count of collapsed rungs is used instead.
// ─────────────────────────────────────────────────────────────────────────────
import { runReadOnlyQuery, mssql, type QueryParam } from "@/lib/enterprise/mssql";
import type { OrgDef } from "@/lib/enterprise/connections";
import { MICROMART_GRADUATION } from "@/lib/scoring/behaviour-policy";

/** Newest first, and never unbounded — the route's own cap. */
const DEFAULT_MAX = 24;

export interface BridgedRung {
  id: string;
  at: string;
  previousLimit: number;
  newLimit: number;
  change: number;
  direction: "up" | "down" | "flat";
  move: string;
  clearedLoans: number;
  provenPrincipal: number;
  graduationPercent: number | null;
  riskBand: string | null;
  cappedByCeiling: boolean;
}

export interface BridgedLadder {
  rungs: BridgedRung[];
  current: {
    limit: number | null;
    /** Real movements, NOT their GraduationCount. See the header. */
    graduationCount: number;
    riskBand: string | null;
    clearedLoans: number;
    activeLoans: number;
  };
  /** How many raw rows the collapse stood for, for the console and for logs. */
  rawRows: number;
}

export type LadderResult =
  | { ok: true; ladder: BridgedLadder }
  | { ok: false; reason: "unreachable"; message: string };

/**
 * Collapse repeated rows into rungs, newest first.
 *
 * `LAG` is ordered by (GraduationDate, Id): the procedure stamps every row in a
 * run with the same GETDATE(), so date alone leaves ties and a non-deterministic
 * window — which would make the collapse keep or drop a rung depending on the
 * plan the server happened to choose.
 */
const RUNGS_SQL = `
;WITH Ordered AS (
    SELECT h.Id, h.PreviousLimit, h.NewLimit, h.RiskScore, h.RiskCategory,
           h.GraduationPercentage, h.ClearedLoansCount, h.GraduationDate,
           ROW_NUMBER() OVER (PARTITION BY h.BorrowerId ORDER BY h.GraduationDate, h.Id) AS seq,
           LAG(h.NewLimit)      OVER (PARTITION BY h.BorrowerId ORDER BY h.GraduationDate, h.Id) AS PrevNewLimit,
           LAG(h.PreviousLimit) OVER (PARTITION BY h.BorrowerId ORDER BY h.GraduationDate, h.Id) AS PrevPrevLimit
      FROM dbo.LoanGraduationHistory h
     WHERE h.BorrowerId = @b AND h.EntityId = @e
)
SELECT TOP (@n)
       Id, GraduationDate, PreviousLimit, NewLimit, RiskScore, RiskCategory,
       GraduationPercentage, ClearedLoansCount
  FROM Ordered
 WHERE NewLimit <> PreviousLimit
   AND (seq = 1 OR PrevNewLimit <> NewLimit OR PrevPrevLimit <> PreviousLimit)
 ORDER BY GraduationDate DESC, Id DESC`;

const CURRENT_SQL = `
SELECT b.LoanLimit, b.RiskCategory,
       (SELECT COUNT(*) FROM Serviceconnect.dbo.Loans l
         WHERE l.BorrowerId = b.ID AND l.EntityId = @e AND l.LoanCleared = 1)          AS ClearedLoans,
       (SELECT COUNT(*) FROM Serviceconnect.dbo.Loans l
         WHERE l.BorrowerId = b.ID AND l.EntityId = @e AND l.LoanCleared = 0
           AND ISNULL(l.isApproved, 0) = 1)                                            AS ActiveLoans,
       (SELECT COUNT(*) FROM dbo.LoanGraduationHistory h
         WHERE h.BorrowerId = b.ID AND h.EntityId = @e)                                AS RawRows
  FROM Serviceconnect.dbo.Borrowers b
 WHERE b.ID = @b AND b.EntityId = @e`;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * What the customer had actually repaid to earn this rung.
 *
 * Their history table does not store it, but the procedure's own formula
 * determines it exactly:
 *
 *     NewLimit = P + min(P × pct/100, cap)      where P = last cleared principal
 *
 * Invert it. Assume the cap did not bind, so P = NewLimit / (1 + pct/100); if
 * that P would have earned MORE than the cap, the assumption was wrong and the
 * cap bound, so P = NewLimit − cap.
 *
 * This is derived, not stored, and it is only as true as the formula. It is
 * worth deriving because the screen says "after N loans cleared and KSh X
 * repaid in full", and KSh 0 there is a worse answer than the right one.
 * Returns 0 when the percentage is missing, which is the honest failure.
 */
export function provenPrincipalFor(newLimit: number, pct: number | null): { principal: number; capped: boolean } {
  const cap = MICROMART_GRADUATION.capPerStep;
  if (!pct || pct <= 0 || newLimit <= 0) return { principal: 0, capped: false };
  const r = pct / 100;
  const uncapped = newLimit / (1 + r);
  if (cap > 0 && uncapped * r > cap) {
    return { principal: Math.round((newLimit - cap) * 100) / 100, capped: true };
  }
  return { principal: Math.round(uncapped * 100) / 100, capped: false };
}

export async function micromartLadder(args: {
  org: OrgDef;
  entityId: number;
  borrowerId: number;
  max?: number;
}): Promise<LadderResult> {
  const { org, entityId, borrowerId, max = DEFAULT_MAX } = args;
  const p = (): QueryParam[] => [
    { name: "b", type: mssql.Int, value: borrowerId },
    { name: "e", type: mssql.Int, value: entityId },
  ];

  try {
    const [rungRes, curRes] = await Promise.all([
      runReadOnlyQuery(org, RUNGS_SQL, [...p(), { name: "n", type: mssql.Int, value: max }], { timeoutMs: 20_000 }),
      runReadOnlyQuery(org, CURRENT_SQL, p(), { timeoutMs: 20_000 }),
    ]);

    const rungs: BridgedRung[] = rungRes.rows.map((r) => {
      const previousLimit = num(r.PreviousLimit);
      const newLimit = num(r.NewLimit);
      const pct = r.GraduationPercentage == null ? null : num(r.GraduationPercentage);
      const { principal, capped } = provenPrincipalFor(newLimit, pct);
      return {
        id: String(r.Id),
        at: new Date(r.GraduationDate as string).toISOString(),
        previousLimit,
        newLimit,
        change: Math.round((newLimit - previousLimit) * 100) / 100,
        direction: newLimit > previousLimit ? "up" : newLimit < previousLimit ? "down" : "flat",
        // Their book records no verb, so it is derived from the movement. Their
        // procedure only ever graduates; a fall is a side effect of the limit
        // being recomputed from a smaller principal, which is still a fall the
        // customer is entitled to see named.
        move: newLimit > previousLimit ? "graduate" : newLimit < previousLimit ? "lower" : "review",
        clearedLoans: Math.round(num(r.ClearedLoansCount)),
        provenPrincipal: principal,
        graduationPercent: pct,
        riskBand: (r.RiskCategory as string | null) ?? null,
        cappedByCeiling: capped,
      };
    });

    const cur = curRes.rows[0] ?? null;
    return {
      ok: true,
      ladder: {
        rungs,
        current: {
          limit: cur?.LoanLimit == null ? null : num(cur.LoanLimit),
          // Movements, not cron runs. See the header.
          graduationCount: rungs.length,
          riskBand: (cur?.RiskCategory as string | null) ?? null,
          clearedLoans: Math.round(num(cur?.ClearedLoans)),
          activeLoans: Math.round(num(cur?.ActiveLoans)),
        },
        rawRows: Math.round(num(cur?.RawRows)),
      },
    };
  } catch (e) {
    // Degrade, never throw: the Ladder screen is a "how did I get here" screen,
    // and a relay outage must not take down a customer's whole session.
    return { ok: false, reason: "unreachable", message: e instanceof Error ? e.message : String(e) };
  }
}
