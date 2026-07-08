// ─────────────────────────────────────────────────────────────────────────────
// Behavioural credit scorer — for borrowers WITH internal repayment history
// (repeat / graduated customers, e.g. taking their 6th loan). Pulls the 31 model
// features from the lender's ServiceSuite DB and calls the deployed scorer
// (/predict). Reused by:
//   • /api/enterprise/credit-score  (officer scores a borrower), and
//   • /api/enterprise/borrower-score (score + persist a TRAINING snapshot), and
//   • /api/lms/apply                 (auto-score repeat borrowers at application).
//
// Distinct from the THIN-FILE scorer (src/lib/statement/scorecard.ts), which scores
// NEW borrowers from M-Pesa cashflow. Repeat borrowers get BOTH — richer training.
// ─────────────────────────────────────────────────────────────────────────────

import { runReadOnlyQuery, mssql } from "@/lib/enterprise/mssql";
import type { OrgDef } from "@/lib/enterprise/connections";

export const BEHAVIORAL_SCORER_URL =
  process.env.CREDIT_SCORER_URL || "https://birgen-ai-agent-529186868469.us-central1.run.app/predict";

// 31-feature pull — the exact query proven in ServiceSuite CreditRiskController.
export const FEATURE_SQL = `
SELECT
  b.ID AS BorrowerId,
  CASE WHEN UPPER(b.Gender)=2 THEN 1 ELSE 0 END AS Gender,
  ISNULL(DATEDIFF(YEAR,b.DOB,GETDATE()),25) AS Age,
  ISNULL(DATEDIFF(DAY,b.CreatedDate,GETDATE()),0) AS AccountAgeDays,
  ISNULL(b.EntityAgent,0) AS EntityAgent, ISNULL(b.EntityUnit,0) AS EntityUnit,
  ISNULL(l.Principal,0) AS Principal, ISNULL(l.Interest,0) AS Interest,
  ISNULL(l.LoanAmount,0) AS LoanAmount, ISNULL(l.LoanBalance,0) AS LoanBalance,
  ISNULL(DATEDIFF(DAY,l.BorrowDate,l.ExpectedClearDate),30) AS LoanTermDays,
  0 AS NumRollovers, ISNULL(l.ChannelUsed,0) AS ChannelUsed, 0 AS ApprovalStage,
  CASE WHEN l.BorrowDate>=DATEADD(DAY,-30,GETDATE()) THEN 1 ELSE 0 END AS IsLoanNew,
  ISNULL(l.ProductId,0) AS ProductId,
  ISNULL(i.NumInstallments,0) AS NumInstallments, ISNULL(i.NumLatePayments,0) AS NumLatePayments,
  ISNULL(i.NumOnTimePayments,0) AS NumOnTimePayments, ISNULL(i.TotalAmountPaid,0) AS TotalAmountPaid,
  ISNULL(i.TotalUnpaidAmount,0) AS TotalUnpaidAmount, ISNULL(i.AvgInstallmentPaid,0) AS AvgInstallmentPaid,
  ISNULL(i.TotalOverpaid,0) AS TotalOverpaid, ISNULL(i.AvgDaysLate,0) AS AvgDaysLate,
  CAST(CASE WHEN ISNULL(i.NumInstallments,0)>0 THEN CAST(i.NumLatePayments AS DECIMAL(10,4))/i.NumInstallments ELSE 0 END AS DECIMAL(10,4)) AS late_payment_rate,
  CAST(CASE WHEN ISNULL(l.LoanAmount,0)>0 THEN CAST(i.TotalAmountPaid AS DECIMAL(10,4))/l.LoanAmount ELSE 0 END AS DECIMAL(10,4)) AS repayment_ratio,
  CAST(CASE WHEN ISNULL(l.LoanAmount,0)>0 THEN CAST(i.TotalUnpaidAmount AS DECIMAL(10,4))/l.LoanAmount ELSE 0 END AS DECIMAL(10,4)) AS arrears_ratio,
  CAST(ISNULL(b.RiskScore,50) AS DECIMAL(10,4)) AS repayment_history_score,
  CAST(ISNULL(i.AvgDaysLate,0) AS DECIMAL(10,4)) AS days_in_arrears_score,
  CAST(ISNULL(b.RiskScore,50) AS DECIMAL(10,4)) AS credit_behavior_score,
  CAST(ISNULL(b.RiskScore,50) AS DECIMAL(10,4)) AS loan_graduation_score
FROM Borrowers b
LEFT JOIN (SELECT TOP 1 * FROM Loans WHERE BorrowerId=@bid AND EntityId=@eid ORDER BY BorrowDate DESC) l ON l.BorrowerId=b.ID
LEFT JOIN (
  SELECT ls.LoanId, COUNT(*) AS NumInstallments, SUM(ISNULL(ls.AmountPaid,0)) AS TotalAmountPaid,
    SUM(CASE WHEN ls.InstallmentAmount>ISNULL(ls.AmountPaid,0) THEN ls.InstallmentAmount-ISNULL(ls.AmountPaid,0) ELSE 0 END) AS TotalUnpaidAmount,
    AVG(ISNULL(ls.AmountPaid,0)) AS AvgInstallmentPaid,
    SUM(CASE WHEN ISNULL(ls.AmountPaid,0)>ls.InstallmentAmount THEN ISNULL(ls.AmountPaid,0)-ls.InstallmentAmount ELSE 0 END) AS TotalOverpaid,
    AVG(CASE WHEN ls.dateofpayment IS NOT NULL THEN DATEDIFF(DAY,ls.ExpectedDueDate,ls.dateofpayment) ELSE DATEDIFF(DAY,ls.ExpectedDueDate,GETDATE()) END) AS AvgDaysLate,
    SUM(CASE WHEN DATEDIFF(DAY,ls.ExpectedDueDate,COALESCE(ls.dateofpayment,GETDATE()))>0 THEN 1 ELSE 0 END) AS NumLatePayments,
    SUM(CASE WHEN DATEDIFF(DAY,ls.ExpectedDueDate,COALESCE(ls.dateofpayment,GETDATE()))<=0 THEN 1 ELSE 0 END) AS NumOnTimePayments
  FROM LoanSchedule ls INNER JOIN Loans l2 ON l2.Id=ls.LoanId
  WHERE l2.BorrowerId=@bid AND l2.EntityId=@eid
    AND l2.Id IN (SELECT TOP 2 Id FROM Loans WHERE BorrowerId=@bid AND EntityId=@eid ORDER BY BorrowDate DESC)
  GROUP BY ls.LoanId
) i ON i.LoanId=l.Id
WHERE b.ID=@bid AND b.EntityId=@eid`;

export type ScorerResponse = {
  customer_id: number;
  predicted_default_probability: number;
  credit_score: number;
  risk_band: string;
  top_factors?: Record<string, string>;
};

export type BehavioralFactor = { factor: string; description: string; direction: "increases" | "reduces"; impact: number };

export type BehavioralScore = {
  borrowerId: number;
  features: Record<string, unknown>;
  score: number;
  maxScore: 900;
  pd: number;
  pdPercent: string;
  riskBand: string;
  riskLevel: string;
  tone: "good" | "warn" | "high" | "bad";
  decision: "APPROVE" | "REFER";
  factors: BehavioralFactor[];
  modelVersion: string;
  processingTime: number;
};

function cleanFactorName(name: string): string {
  return name.replace(/_\d+\.?\d*$/, "").replace(/_/g, " ").trim();
}

export function parseFactors(top?: Record<string, string>): BehavioralFactor[] {
  if (!top) return [];
  return Object.entries(top).map(([name, desc]) => {
    const m = desc.match(/\(([-+]?\d+\.?\d*)\)/);
    const impact = m ? Math.abs(parseFloat(m[1])) : 0;
    const direction: "increases" | "reduces" = /increase/i.test(desc) ? "increases" : "reduces";
    return { factor: cleanFactorName(name), description: desc, direction, impact };
  });
}

function bandFromPd(pd: number) {
  if (pd < 0.2) return { level: "Low risk", tone: "good" as const };
  if (pd < 0.5) return { level: "Moderate risk", tone: "warn" as const };
  if (pd < 0.75) return { level: "High risk", tone: "high" as const };
  return { level: "Severe risk", tone: "bad" as const };
}

export class BorrowerNotScorableError extends Error {
  constructor(borrowerId: number) {
    super(`Borrower ${borrowerId} has no loan history to score behaviourally.`);
    this.name = "BorrowerNotScorableError";
  }
}

/** Pull features for a borrower and score them with the behavioural model. */
export async function scoreBorrowerBehavioral(org: OrgDef, entityId: number, borrowerId: number): Promise<BehavioralScore> {
  const started = Date.now();
  const { rows } = await runReadOnlyQuery(
    org,
    FEATURE_SQL,
    [
      { name: "bid", type: mssql.Int, value: borrowerId },
      { name: "eid", type: mssql.Int, value: entityId },
    ],
    { timeoutMs: 20000, maxRows: 1 },
  );
  if (rows.length === 0) throw new BorrowerNotScorableError(borrowerId);
  const features = rows[0];

  const resp = await fetch(BEHAVIORAL_SCORER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(features),
    signal: AbortSignal.timeout(30000),
  });
  if (!resp.ok) throw new Error(`Scorer returned ${resp.status}.`);
  const pred = (await resp.json()) as ScorerResponse;

  const pd = Number(pred.predicted_default_probability) || 0;
  const score = Math.round(Number(pred.credit_score) || 0);
  const b = bandFromPd(pd);

  return {
    borrowerId,
    features,
    score,
    maxScore: 900,
    pd,
    pdPercent: `${(pd * 100).toFixed(1)}%`,
    riskBand: pred.risk_band,
    riskLevel: b.level,
    tone: b.tone,
    decision: pd >= 0.5 ? "REFER" : "APPROVE",
    factors: parseFactors(pred.top_factors),
    modelVersion: process.env.CREDIT_SCORER_VERSION || "behavioral-v1",
    processingTime: Date.now() - started,
  };
}
