// ─────────────────────────────────────────────────────────────────────────────
// Origination credit scorer (Engine v2) — the HONEST approve/decline model.
//
// Distinct from behavioral.ts (v1, the in-life monitor used by Portfolio Early-
// Warning). This computes POINT-IN-TIME (as-of NOW) features from ServiceSuite —
// borrower prior-loan history + agent/product/unit track record + application terms
// — and calls the deployed v2 engine (ORIGINATION_SCORER_URL). No in-life leakage.
//
// At live inference "as-of now" has no future, so current aggregates are correct.
// Missing/unavailable columns are sent as -1 (the model was trained with fillna(-1)).
// ─────────────────────────────────────────────────────────────────────────────

import { runReadOnlyQuery, mssql } from "@/lib/enterprise/mssql";
import type { OrgDef } from "@/lib/enterprise/connections";

/** Normalise a base or full URL to the /predict endpoint. Empty ⇒ unset. */
function toPredict(raw: string): string {
  if (!raw) return "";
  return /\/predict\/?$/.test(raw) ? raw : `${raw.replace(/\/$/, "")}/predict`;
}

/** v2 = the bespoke Micromart-trained origination engine (38 features). */
export function originationScorerUrl(): string {
  return toPredict(process.env.ORIGINATION_SCORER_URL || "");
}
/** v3 = the pooled, lender-agnostic engine (29 features, per-lender calibration). */
export function pooledScorerUrl(): string {
  return toPredict(process.env.ORIGINATION_POOLED_URL || "");
}
/** Configured if EITHER engine is reachable. */
export function isOriginationConfigured(): boolean {
  return !!originationScorerUrl() || !!pooledScorerUrl();
}

// Lenders that have their OWN bespoke model (data-rich). Everyone else → pooled v3.
const V2_LENDERS = new Set<string>(["micromart"]);

/** Pick the engine for a lender: bespoke v2 for V2_LENDERS, pooled v3 otherwise, with fallback. */
export function engineForOrg(slug: string): { kind: "v2" | "pooled"; url: string } | null {
  const v2 = originationScorerUrl();
  const pooled = pooledScorerUrl();
  const preferV2 = V2_LENDERS.has(slug);
  if (preferV2 && v2) return { kind: "v2", url: v2 };
  if (!preferV2 && pooled) return { kind: "pooled", url: pooled };
  if (v2) return { kind: "v2", url: v2 };       // fallback
  if (pooled) return { kind: "pooled", url: pooled };
  return null;
}

// The pooled model's 29-feature set is a subset of the v2 38 (with Gender→gender_m).
// Sending the full dict is fine — the pooled service reads only its own keys — but we
// add gender_m which the v2 SQL doesn't emit.
function pooledFeatures(f: Record<string, number>): Record<string, number> {
  return { ...f, gender_m: f.Gender === 1 ? 1 : 0 };
}

// ─── Feature contract (mirrored EXACTLY by the training exports/trainers) ─────
// bad  = open & past-due, OR cleared >30 days late (where a clearance date exists)
// late = max(0, days cleared past ExpectedClearDate) for cleared loans;
//        days past due for open past-due loans; else 0
//
// Servers differ: the shared ServiceSuite DB has Loans.DateCleared; Micromart's
// does not — there the borrower's prior-loan features derive the clearance date
// from loanSchedule MAX(dateofpayment) (cheap for one borrower), while the
// entity-wide agent/product/unit aggregates use the open-past-due-only proxy
// (a schedule join over hundreds of thousands of loans is not viable per request).

/** bad/late expressions where a DateCleared-style column is on the row. */
function clearedExprs(prefix: string, clearedCol: string) {
  const p = prefix ? `${prefix}.` : "";
  return {
    bad: `CASE WHEN ${p}LoanCleared=0 AND ${p}ExpectedClearDate<GETDATE() THEN 1
      WHEN ${p}LoanCleared=1 AND ${clearedCol} IS NOT NULL AND DATEDIFF(DAY,${p}ExpectedClearDate,${clearedCol})>30 THEN 1 ELSE 0 END`,
    late: `CASE WHEN ${p}LoanCleared=1 AND ${clearedCol} IS NOT NULL AND DATEDIFF(DAY,${p}ExpectedClearDate,${clearedCol})>0 THEN DATEDIFF(DAY,${p}ExpectedClearDate,${clearedCol})
      WHEN ${p}LoanCleared=0 AND ${p}ExpectedClearDate<GETDATE() THEN DATEDIFF(DAY,${p}ExpectedClearDate,GETDATE()) ELSE 0 END`,
  };
}
/** bad/late without any clearance date (open-past-due only). */
function openOnlyExprs(prefix: string) {
  const p = prefix ? `${prefix}.` : "";
  return {
    bad: `CASE WHEN ${p}LoanCleared=0 AND ${p}ExpectedClearDate<GETDATE() THEN 1 ELSE 0 END`,
    late: `CASE WHEN ${p}LoanCleared=0 AND ${p}ExpectedClearDate<GETDATE() THEN DATEDIFF(DAY,${p}ExpectedClearDate,GETDATE()) ELSE 0 END`,
  };
}

/** The 38 model features, computed as-of NOW for a borrower's latest loan (the
 *  application proxy). Agent/unit come from the Borrower; product from the loan. */
export function buildAsofFeatureSql(hasDateCleared: boolean): string {
  // Borrower prior loans: accurate cleared-late via DateCleared, or via the
  // loan's schedule MAX(dateofpayment) on servers without it.
  const prior = hasDateCleared ? clearedExprs("pl", "pl.DateCleared") : clearedExprs("pl", "SC.d");
  // loanSchedule has no index on Loanid on the schedule-less servers — a per-row
  // APPLY would full-scan it once per prior loan. One set-based semi-join = one scan.
  const priorFrom = hasDateCleared
    ? `FROM Loans pl`
    : `FROM Loans pl LEFT JOIN (
        SELECT s.Loanid, MAX(s.dateofpayment) AS d FROM loanSchedule s
        WHERE s.Loanid IN (SELECT id FROM Loans WHERE BorrowerId=@bid AND EntityId=@eid)
        GROUP BY s.Loanid
      ) SC ON SC.Loanid=pl.id`;
  // Entity-wide aggregates: cheap row-local expressions only.
  const agg2 = hasDateCleared ? clearedExprs("L2", "L2.DateCleared") : openOnlyExprs("L2");
  const agg3 = hasDateCleared ? clearedExprs("L3", "L3.DateCleared") : openOnlyExprs("L3");
  const agg4 = hasDateCleared ? clearedExprs("L4", "L4.DateCleared") : openOnlyExprs("L4");

  return `
DECLARE @agent INT=(SELECT TOP 1 ISNULL(EntityAgent,0) FROM Borrowers WHERE ID=@bid AND EntityId=@eid);
DECLARE @unit INT=(SELECT TOP 1 ISNULL(EntityUnit,0) FROM Borrowers WHERE ID=@bid AND EntityId=@eid);
SELECT
  ISNULL(L.LoanAmount,0) AS LoanAmount, ISNULL(L.Principal,0) AS Principal, ISNULL(L.Interest,0) AS Interest,
  CASE WHEN ISNULL(L.Principal,0)>0 THEN CAST(L.Interest AS FLOAT)/L.Principal*100 ELSE -1 END AS interest_rate,
  ISNULL(DATEDIFF(DAY,L.BorrowDate,L.ExpectedClearDate),-1) AS loan_term_days,
  CASE WHEN ISNULL(b.LoanLimit,0)>0 THEN CAST(L.LoanAmount AS FLOAT)/b.LoanLimit ELSE -1 END AS loan_to_limit_ratio,
  ISNULL(L.ProductId,-1) AS ProductId, ISNULL(L.Loantype,-1) AS Loantype, ISNULL(L.IsLoanNew,0) AS IsLoanNew,
  ISNULL(DATEDIFF(YEAR,b.DOB,GETDATE()),-1) AS age,
  CASE WHEN UPPER(LEFT(ISNULL(CAST(b.Gender AS VARCHAR(12)),''),1))='M' THEN 1 WHEN UPPER(LEFT(ISNULL(CAST(b.Gender AS VARCHAR(12)),''),1))='F' THEN 0 ELSE ISNULL(TRY_CONVERT(FLOAT,b.Gender),-1) END AS Gender,
  ISNULL(DATEDIFF(DAY,b.CreatedDate,GETDATE()),-1) AS account_age_days,
  ISNULL(b.LoanLimit,-1) AS LoanLimit, ISNULL(b.PreviousLoanLimit,-1) AS PreviousLoanLimit,
  CASE WHEN ISNULL(b.PreviousLoanLimit,0)>0 THEN CAST(b.LoanLimit AS FLOAT)/b.PreviousLoanLimit ELSE -1 END AS loan_size_escalation,
  ISNULL(L.ChannelUsed,-1) AS ChannelUsed,
  CASE WHEN ISNULL(L.GuarantorID,0)>0 THEN 1 ELSE 0 END AS has_guarantor,
  ISNULL(MONTH(L.BorrowDate),-1) AS loan_month, ISNULL(DATEPART(QUARTER,L.BorrowDate),-1) AS loan_quarter,
  ISNULL(DATEDIFF(DAY,L.BorrowDate,L.LoanDisbursmentDate),-1) AS days_to_disbursement,
  CASE WHEN ISNULL(L.collectionAgentID,0)>0 THEN 1 ELSE 0 END AS has_collection_agent,
  ISNULL(TRY_CONVERT(INT,b.IsRegfeePaid),0) AS IsRegfeePaid, ISNULL(b.GraduationCount,0) AS GraduationCount,
  ISNULL(P.prior_loans,0) AS asof_prior_loans, ISNULL(P.clear_rate,-1) AS asof_prior_clear_rate,
  ISNULL(P.avg_late,-1) AS asof_prior_avg_late, ISNULL(P.avg_repay,-1) AS asof_prior_avg_repay,
  ISNULL(P.rollover_rate,-1) AS asof_prior_rollover_rate, ISNULL(P.penalty_rate,-1) AS asof_prior_penalty_rate,
  ISNULL(P.max_late,-1) AS asof_prior_max_late,
  CASE WHEN ISNULL(P.avg_amt,0)>0 THEN CAST(L.LoanAmount AS FLOAT)/P.avg_amt ELSE -1 END AS asof_amt_vs_prior,
  ISNULL(P.days_since_last,-1) AS asof_days_since_last,
  ISNULL(AG.def_rate,-1) AS asof_agent_default_rate, ISNULL(AG.avg_late,-1) AS asof_agent_avg_late,
  ISNULL(PR.def_rate,-1) AS asof_product_default_rate, ISNULL(PR.avg_late,-1) AS asof_product_avg_late,
  ISNULL(UN.def_rate,-1) AS asof_unit_default_rate,
  CASE WHEN ISNULL(P.prior_loans,0)>0 THEN 1 ELSE 0 END AS has_history
FROM Borrowers b
OUTER APPLY (SELECT TOP 1 * FROM Loans WHERE BorrowerId=@bid AND EntityId=@eid ORDER BY BorrowDate DESC) L
OUTER APPLY (
  SELECT COUNT(*) AS prior_loans,
    1-CAST(SUM(bad) AS FLOAT)/NULLIF(COUNT(*),0) AS clear_rate,
    AVG(CAST(late AS FLOAT)) AS avg_late, MAX(late) AS max_late,
    AVG(CASE WHEN LoanAmount>0 THEN CAST(LoanAmount-LoanBalance AS FLOAT)/LoanAmount ELSE 0 END) AS avg_repay,
    AVG(CAST(ISNULL(IsRolledOver,0) AS FLOAT)) AS rollover_rate,
    AVG(CASE WHEN ISNULL(Penalty,0)>0 THEN 1.0 ELSE 0.0 END) AS penalty_rate,
    AVG(CAST(LoanAmount AS FLOAT)) AS avg_amt, DATEDIFF(DAY,MAX(BorrowDate),L.BorrowDate) AS days_since_last
  FROM (SELECT pl.LoanAmount,pl.LoanBalance,pl.BorrowDate,pl.IsRolledOver,pl.Penalty,
      ${prior.bad} AS bad,
      ${prior.late} AS late
    ${priorFrom}
    WHERE pl.BorrowerId=@bid AND pl.EntityId=@eid AND pl.id<>L.id) prior
) P
OUTER APPLY (SELECT CAST(SUM(bad) AS FLOAT)/NULLIF(COUNT(*),0) AS def_rate, AVG(CAST(late AS FLOAT)) AS avg_late FROM
  (SELECT ${agg2.bad} AS bad,
     ${agg2.late} AS late
   FROM Loans L2 JOIN Borrowers b2 ON b2.ID=L2.BorrowerId WHERE b2.EntityAgent=@agent AND L2.EntityId=@eid AND L2.isApproved=1) a) AG
OUTER APPLY (SELECT CAST(SUM(bad) AS FLOAT)/NULLIF(COUNT(*),0) AS def_rate, AVG(CAST(late AS FLOAT)) AS avg_late FROM
  (SELECT ${agg3.bad} AS bad,
     ${agg3.late} AS late
   FROM Loans L3 WHERE L3.ProductId=L.ProductId AND L3.EntityId=@eid AND L3.isApproved=1) p) PR
OUTER APPLY (SELECT CAST(SUM(bad) AS FLOAT)/NULLIF(COUNT(*),0) AS def_rate FROM
  (SELECT ${agg4.bad} AS bad
   FROM Loans L4 JOIN Borrowers b4 ON b4.ID=L4.BorrowerId WHERE b4.EntityUnit=@unit AND L4.EntityId=@eid AND L4.isApproved=1) u) UN
WHERE b.ID=@bid AND b.EntityId=@eid`;
}

/** Back-compat: the shared-DB (DateCleared-bearing) variant. */
export const ASOF_FEATURE_SQL = buildAsofFeatureSql(true);

// Whether an org's Loans table carries DateCleared (probed once, cached per slug).
const dateClearedCache = new Map<string, Promise<boolean>>();
async function orgHasDateCleared(org: OrgDef): Promise<boolean> {
  let cached = dateClearedCache.get(org.slug);
  if (!cached) {
    cached = runReadOnlyQuery(org,
      `SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Loans' AND COLUMN_NAME='DateCleared'`,
      [], { timeoutMs: 15000, maxRows: 1 },
    ).then((r) => Number(r.rows[0]?.n) > 0)
      .catch((err) => { dateClearedCache.delete(org.slug); throw err; });
    dateClearedCache.set(org.slug, cached);
  }
  return cached;
}

export type OriginationFactor = { feature: string; impact: number; direction: string };
export type OriginationScore = {
  borrowerId: number;
  features: Record<string, number>;
  pd: number;
  pdPercent: string;
  score: number;
  riskBand: string;
  threshold: number;
  decision: "APPROVE" | "REVIEW" | "REFER";
  recommendation: string;
  factors: OriginationFactor[];
  hasHistory: boolean;
  engine: "v2" | "pooled";
  calibrated: boolean;
  modelVersion: string;
  processingTime: number;
};

export class BorrowerNotFoundError extends Error {
  constructor(borrowerId: number) { super(`Borrower ${borrowerId} not found for this entity.`); this.name = "BorrowerNotFoundError"; }
}
export class OriginationNotConfiguredError extends Error {
  constructor() { super("The origination engine is not configured (ORIGINATION_SCORER_URL is unset)."); this.name = "OriginationNotConfiguredError"; }
}

/** Optional application overrides for a not-yet-booked loan (lms). Recomputes derived features. */
export type ApplicationInput = { loanAmount?: number; productId?: number; loanTermDays?: number; interest?: number };

/** Compute the 38 as-of features for a borrower from ServiceSuite (read-only). */
export async function buildOriginationFeatures(
  org: OrgDef, entityId: number, borrowerId: number, app?: ApplicationInput,
): Promise<Record<string, number>> {
  const sql = buildAsofFeatureSql(await orgHasDateCleared(org));
  const { rows } = await runReadOnlyQuery(org, sql, [
    { name: "bid", type: mssql.Int, value: borrowerId },
    { name: "eid", type: mssql.Int, value: entityId },
  ], { timeoutMs: 30000, maxRows: 1 });
  if (rows.length === 0) throw new BorrowerNotFoundError(borrowerId);
  const f: Record<string, number> = {};
  for (const [k, v] of Object.entries(rows[0])) f[k] = v == null ? -1 : Number(v);

  // Patch application terms for a new (unbooked) loan and recompute derived features.
  if (app) {
    if (app.loanAmount != null && app.loanAmount > 0) {
      f.LoanAmount = app.loanAmount;
      if (f.LoanLimit > 0) f.loan_to_limit_ratio = app.loanAmount / f.LoanLimit;
      // asof_amt_vs_prior uses the prior-average amount; back it out from the SQL value.
    }
    if (app.productId != null) f.ProductId = app.productId;
    if (app.loanTermDays != null && app.loanTermDays > 0) f.loan_term_days = app.loanTermDays;
    if (app.interest != null && f.Principal > 0) f.interest_rate = (app.interest / f.Principal) * 100;
  }
  return f;
}

function bandDecision(pd: number, threshold: number): { band: string; decision: "APPROVE" | "REVIEW" | "REFER" } {
  if (pd < 0.10) return { band: "LOW", decision: "APPROVE" };
  if (pd < threshold) return { band: pd < 0.20 ? "LOW-MEDIUM" : "MEDIUM", decision: pd < 0.20 ? "APPROVE" : "REVIEW" };
  if (pd < 0.60) return { band: "HIGH", decision: "REFER" };
  return { band: "VERY_HIGH", decision: "REFER" };
}

/** Build features + score a borrower with the deployed v2 origination engine. */
export async function scoreOrigination(
  org: OrgDef, entityId: number, borrowerId: number, app?: ApplicationInput,
): Promise<OriginationScore> {
  const engine = engineForOrg(org.slug);
  if (!engine) throw new OriginationNotConfiguredError();
  const started = Date.now();
  const features = await buildOriginationFeatures(org, entityId, borrowerId, app);

  // The pooled engine takes lender_entity_id (for its calibrator) + a gender_m flag.
  const payload = engine.kind === "pooled"
    ? { customer_id: String(borrowerId), lender_entity_id: entityId, features: pooledFeatures(features) }
    : { customer_id: String(borrowerId), features };

  const resp = await fetch(engine.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });
  if (!resp.ok) throw new Error(`Origination engine returned ${resp.status}.`);
  const pred = await resp.json() as {
    predicted_default_probability?: number; credit_score?: number; risk_band?: string;
    decision_threshold?: number; recommendation?: string; calibrated?: boolean;
    top_factors?: { feature: string; impact: number; direction: string }[];
    model_version?: string;
  };

  const pd = Number(pred.predicted_default_probability) || 0;
  const threshold = Number(pred.decision_threshold) || 0.38;
  const { band, decision } = bandDecision(pd, threshold);
  return {
    borrowerId, features, pd, pdPercent: `${(pd * 100).toFixed(1)}%`,
    score: Math.round(Number(pred.credit_score) || 0),
    riskBand: pred.risk_band || band, threshold, decision,
    recommendation: pred.recommendation || "",
    factors: pred.top_factors ?? [],
    hasHistory: features.has_history === 1,
    engine: engine.kind,
    calibrated: pred.calibrated ?? false,
    modelVersion: pred.model_version || (engine.kind === "pooled" ? "pooled-v3" : "origination-v2"),
    processingTime: Date.now() - started,
  };
}
