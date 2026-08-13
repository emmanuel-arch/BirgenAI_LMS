// ─────────────────────────────────────────────────────────────────────────────
// LIVE DASHBOARD — the lender's own MainDashboard, read through.
//
// src/lib/dashboard/model.ts was built to mirror ServiceSuite's [dbo].[MainDashboard]
// metric contract exactly (OLB, Clean OLB, PAR, PQS, NPL, dues today, arrears, CPR,
// approval-stage counts…). This module is the other half of that promise: it calls
// the proc and returns a `LiveSnapshot` the model can overlay, so a bridged lender's
// console shows THEIR numbers rather than a simulation of them.
//
// TWO THINGS ABOUT THAT PROC THAT SHAPE THIS CODE.
//
// 1. It is scoped by USER, not by entity: `SELECT @EntityId = EntityID FROM
//    UserMaster WHERE ID = @userid`, and it branches on that user's `Validator`
//    flag to decide whether they see the whole entity, an org-unit subtree, or
//    their own book. We hold no ServiceSuite user identity for our staff, so we
//    resolve an ACTIVE Validator on the target entity and read the whole-book view.
//    That is the figure a console dashboard should show, and it is the same number
//    their own managers see.
//
// 2. Money comes back as FORMATTED CURRENCY STRINGS — FORMAT(@OLB,'c',<culture>)
//    yields "Ksh 566,089.00" under sw-KE. Every amount therefore has to be parsed
//    back into a number, and a parser that silently returns 0 on an unexpected
//    shape would quietly zero a lender's balance sheet on screen. So parseMoney
//    returns undefined instead, and an undefined field stays MODELLED rather than
//    being reported as zero.
// ─────────────────────────────────────────────────────────────────────────────
import { callStoredProc, runReadOnlyQuery, mssql } from "@/lib/enterprise/mssql";
import type { OrgDef } from "@/lib/enterprise/connections";
import type { LiveSnapshot } from "@/lib/dashboard/model";

/**
 * "Ksh 566,089.00" → 566089. "(Ksh 1,200.00)" → -1200 (accounting negatives).
 * Returns undefined for anything it cannot read, so the caller can leave the
 * metric modelled rather than publish a wrong zero.
 */
export function parseMoney(v: unknown): number | undefined {
  if (v == null) return undefined;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  const s = String(v).trim();
  if (!s) return undefined;
  const negative = /^\(.*\)$/.test(s);
  // Strip everything that is not a digit, a separator or a sign, then drop the
  // thousands separators. Currency symbols and non-breaking spaces both go.
  const cleaned = s.replace(/[()]/g, "").replace(/[^\d.,-]/g, "").replace(/,/g, "");
  if (!/\d/.test(cleaned)) return undefined;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return undefined;
  return negative ? -Math.abs(n) : n;
}

/** Plain integer/decimal columns — same "undefined rather than a wrong zero" rule. */
function num(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : undefined;
}

/**
 * An ACTIVE Validator on this entity — the identity whose MainDashboard view is
 * the whole book. Falls back to any Validator, then to any user at all, because a
 * narrower scope is still far better than a simulated dashboard.
 */
export async function resolveDashboardUserId(org: OrgDef, entityId: number): Promise<number | null> {
  const { rows } = await runReadOnlyQuery(
    org,
    `SELECT TOP 1 ID
     FROM Usermaster
     WHERE EntityID = @entityId
     ORDER BY
       CASE WHEN ISNULL(Validator,0) = 1 AND ISNULL(UserStatus,0) = 1 THEN 0
            WHEN ISNULL(Validator,0) = 1 THEN 1
            WHEN ISNULL(UserStatus,0) = 1 THEN 2
            ELSE 3 END,
       ID ASC`,
    [{ name: "entityId", type: mssql.Int, value: entityId }],
    { timeoutMs: 20000, maxRows: 1 },
  );
  const id = rows[0]?.ID;
  return id != null ? Number(id) : null;
}

export type LiveDashboard = {
  snapshot: LiveSnapshot;
  /** Which ServiceSuite user's scope produced these figures. */
  readAs: number;
  /** Metric keys the proc actually answered — the rest stay modelled. */
  provided: string[];
  currencyLabel: string | null;
};

/**
 * Read the lender's dashboard. Read-only: MainDashboard is SELECT-only (verified
 * against the deployed proc), so this cannot move anything in their book.
 */
export async function getLiveDashboard(org: OrgDef, entityId: number): Promise<LiveDashboard | null> {
  const readAs = await resolveDashboardUserId(org, entityId);
  if (readAs == null) return null;

  const rows = await callStoredProc(org, "MainDashboard", [
    { name: "userid", type: mssql.Int, value: readAs },
  ]);
  const r = rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;

  // NOTE the alias typo "TototalDueTodayCount" — it is theirs, in production, and
  // reading the correctly-spelled name instead silently yields undefined.
  const candidate: LiveSnapshot = {
    olb: parseMoney(r.Olb),
    activeLoans: num(r.ActiveLoans),
    par: num(r.PAR),
    totalArrears: parseMoney(r.TotalArrears),
    npl: num(r.NPL),
    nplCount: num(r.Nplcount),
    disbursedCount: num(r.todayDisbursed),
    collectedAmount: parseMoney(r.DuesPaidTodayAmount),
    dueAmount: parseMoney(r.TotalDueTodayAmount),
    dueCount: num(r.TototalDueTodayCount),
    paidAmount: parseMoney(r.DuesPaidTodayAmount),
    paidCount: num(r.DuesPaidTodayCount),
    totalCustomers: num(r.TotalCustomers),
    newCustomers: num(r.NewCustomer),
    atInitiator: num(r.AtInitiator),
    atAuthorizer: num(r.AtAuthorizer),
    atValidator: num(r.AtValidator),
    declinedLoans: num(r.DeclinedLoans),
    // `todayDisbursed` is a COUNT of loans, not an amount — the proc exposes no
    // disbursed VALUE, so disbursedAmount is deliberately left modelled instead of
    // being filled with a count that would render as money.
  };

  // Drop the keys the proc could not answer, so applyLive() overlays only real
  // figures and everything else stays visibly modelled.
  const snapshot: LiveSnapshot = {};
  const provided: string[] = [];
  for (const [k, v] of Object.entries(candidate)) {
    if (typeof v === "number" && Number.isFinite(v)) {
      (snapshot as Record<string, number>)[k] = v;
      provided.push(k);
    }
  }

  // Whatever symbol their culture printed — so our screen says Ksh if theirs does.
  const sample = String(r.Olb ?? "").trim();
  const symbol = sample.replace(/[\d.,\s()-]/g, "") || null;

  return { snapshot, readAs, provided, currencyLabel: symbol };
}
