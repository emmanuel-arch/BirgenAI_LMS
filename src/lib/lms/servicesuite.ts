// ─────────────────────────────────────────────────────────────────────────────
// lms → ServiceSuite integration (read eligibility, post a pending loan).
//
// Posting uses the SAME sp_InsertLoan the ServiceSuite UI uses, so a portal loan
// is a first-class loan the lender's officers see and approve — never a shadow
// record. The loan enters the product's workflow at its ROOT stage with
// isApproved = 0; point the lms products' Products.WorkflowId at the "BirgenAI
// Hub" ApprovalWorkflow (see servicesuite/birgenai_workflow.sql) so it lands in
// the BirgenAI stages.
//
// SAFETY: posting is OFF unless LMS_POSTING_ENABLED='true'. Until then the portal
// records every application in BirgenAI's DB (the training pipeline) but writes
// nothing to the lender's loan book. Tag carried into ServiceSuite:
//   • TransactionRef = the lms application id (join key for outcome tracking)
//   • ChannelUsed (= @ApplicationType) = LMS_SERVICESUITE_CHANNEL (default 1)
// ─────────────────────────────────────────────────────────────────────────────

import { callStoredProc, runReadOnlyQuery, execNonQuery, mssql, type QueryParam } from "@/lib/enterprise/mssql";
import { getEntityId, type OrgDef } from "@/lib/enterprise/connections";

export function isPostingEnabled(): boolean {
  return process.env.LMS_POSTING_ENABLED === "true";
}

/** Separate gate for writing the BirgenAI score back to ServiceSuite Borrowers.CreditScore. */
export function isScoreWritebackEnabled(): boolean {
  return process.env.SCORE_WRITEBACK_ENABLED === "true";
}

/**
 * Persist the BirgenAI behavioural score onto the borrower's ServiceSuite record
 * (Borrowers.CreditScore) so officers see it. Gated; returns rows affected (0 if disabled).
 */
export async function writeBorrowerCreditScore(org: OrgDef, entityId: number, borrowerId: number, score: number): Promise<number> {
  if (!isScoreWritebackEnabled()) return 0;
  return execNonQuery(
    org,
    "UPDATE Borrowers SET CreditScore = @score WHERE ID = @bid AND EntityId = @eid",
    [
      { name: "score", type: mssql.Int, value: Math.round(score) },
      { name: "bid", type: mssql.Int, value: borrowerId },
      { name: "eid", type: mssql.Int, value: entityId },
    ],
    { timeoutMs: 15000 },
  );
}

const CHANNEL = Number(process.env.LMS_SERVICESUITE_CHANNEL || 1);
// A ServiceSuite UserMaster.ID to attribute portal-originated loans to (a service
// account / virtual "BirgenAI" officer). Required for posting.
const POSTING_USER_ID = Number(process.env.LMS_SERVICESUITE_CREATED_BY || 0);

export type Graduation = {
  borrowerId: number;
  borrowerName: string;
  clearedLoans: number;
  activeLoans: number;
  graduated: boolean; // 5+ cleared loans AND no active arrears
};

/**
 * Graduated-customer check (read-only). A borrower qualifies for self-service if
 * they have 5+ fully-cleared loans and no currently-active loan. Matched by phone
 * (and optionally national ID) within the entity.
 */
/** Digits-only phone (borrowers type 07XX XXX XXX, DB stores 2547XXXXXXXX). */
const cleanPhone = (p: string) => p.replace(/\D/g, "");

export async function checkGraduation(
  org: OrgDef,
  entityId: number,
  phone: string,
  nationalId?: string,
): Promise<Graduation | null> {
  phone = cleanPhone(phone);
  const sql = `
    SELECT TOP 1
      b.ID AS borrowerId,
      LTRIM(RTRIM(ISNULL(b.firstName,'') + ' ' + ISNULL(b.otherName,''))) AS borrowerName,
      (SELECT COUNT(*) FROM Loans l WHERE l.BorrowerId = b.ID AND l.isApproved = 1 AND l.LoanCleared = 1) AS clearedLoans,
      (SELECT COUNT(*) FROM Loans l WHERE l.BorrowerId = b.ID AND l.isApproved = 1 AND l.LoanCleared = 0) AS activeLoans
    FROM Borrowers b
    WHERE b.EntityId = @entityId
      AND (b.PhoneNumber = @phone
        OR RIGHT(REPLACE(b.PhoneNumber, ' ', ''), 9) = RIGHT(@phone, 9)
        OR (@nationalId <> '' AND b.NationalID = @nationalId))
    ORDER BY b.ID DESC`;

  const { rows } = await runReadOnlyQuery(
    org,
    sql,
    [
      { name: "entityId", type: mssql.Int, value: entityId },
      { name: "phone", type: mssql.VarChar(32), value: phone },
      { name: "nationalId", type: mssql.VarChar(32), value: nationalId || "" },
    ],
    { timeoutMs: 15000, maxRows: 1 },
  );
  if (rows.length === 0) return null;

  const r = rows[0];
  const clearedLoans = Number(r.clearedLoans) || 0;
  const activeLoans = Number(r.activeLoans) || 0;
  return {
    borrowerId: Number(r.borrowerId),
    borrowerName: String(r.borrowerName || "").trim(),
    clearedLoans,
    activeLoans,
    graduated: clearedLoans >= 5 && activeLoans === 0,
  };
}

// ── Customer 360 — the borrower profile the lender's own LMS shows (Borrower
// 360), rebuilt read-only for the portal's "confirm it's you" step. Mirrors
// ServiceSuite's GetBorrowerDetails + GetBorrowerStats stored procedures:
// Borrowers + Usermaster (agent) + OrganizationUnits/GetOrganizationUnitsBreadcrumb
// (office trail) + LoanGraduationHistory (graduation %) + Loans aggregates.
// Photos are Google Drive fileIds (served via the public thumbnail endpoint).

export type Customer360 = {
  borrowerId: number;
  name: string;
  accountNo: string | null;
  nationalId: string | null;
  phone: string | null;
  email: string | null;
  age: number | null;
  gender: string | null;
  status: string; // ACTIVE | IN-ACTIVE | PENDING
  photoUrl: string | null;
  riskScore: number | null;
  riskCategory: string | null;
  lastScoreUpdate: string | null; // ISO date
  loanLimit: number | null;
  previousLoanLimit: number | null;
  graduationPercentage: number | null;
  agentName: string | null;
  branchName: string | null;
  officeTrail: { unit: string; level: string }[];
  loansCount: number;
  totalBorrowed: number;
  olb: number;
  clearedLoans: number;
  activeLoans: number;
};

export async function getCustomer360(
  org: OrgDef,
  entityId: number,
  phone: string,
  nationalId?: string,
): Promise<Customer360 | null> {
  phone = cleanPhone(phone);
  const sql = `
    SELECT TOP 1
      b.ID, b.firstName, b.otherName, b.AccountNo, b.NationalID, b.PhoneNumber, b.EmailAddress,
      CASE WHEN b.DOB IS NOT NULL THEN DATEDIFF(YEAR, b.DOB, GETDATE()) END AS Age,
      CASE WHEN b.Gender = 1 THEN 'Male' WHEN b.Gender = 2 THEN 'Female' END AS GenderTitle,
      b.RiskScore, b.RiskCategory, b.LastScoreUpdateDate, b.LoanLimit, b.PreviousLoanLimit,
      b.borrowerPhoto,
      CASE WHEN b.AccountStatus = 1 THEN 'ACTIVE' WHEN b.AccountStatus = 2 THEN 'IN-ACTIVE' ELSE 'PENDING' END AS StatusTitle,
      LTRIM(RTRIM(ISNULL(u.FirstName,'') + ' ' + ISNULL(u.OtherName,''))) AS AgentName,
      o.UnitTitle AS BranchName,
      dbo.GetOrganizationUnitsBreadcrumb(b.EntityUnit) AS OfficeTrail,
      lg.GraduationPercentage,
      s.LoansCount, s.TotalBorrowed, s.OLB, s.ClearedLoans, s.ActiveLoans
    FROM Borrowers b
    LEFT JOIN Usermaster u ON b.EntityAgent = u.ID
    LEFT JOIN OrganizationUnits o ON b.EntityUnit = o.UnitId
    OUTER APPLY (SELECT TOP 1 GraduationPercentage FROM LoanGraduationHistory WHERE BorrowerId = b.ID ORDER BY Id DESC) lg
    OUTER APPLY (
      SELECT COUNT(*) AS LoansCount, SUM(LoanAmount) AS TotalBorrowed, SUM(LoanBalance) AS OLB,
             SUM(CASE WHEN LoanCleared = 1 THEN 1 ELSE 0 END) AS ClearedLoans,
             SUM(CASE WHEN LoanCleared = 0 THEN 1 ELSE 0 END) AS ActiveLoans
      FROM Loans WHERE BorrowerId = b.ID AND isApproved = 1
    ) s
    WHERE b.EntityId = @entityId
      AND (b.PhoneNumber = @phone
        OR RIGHT(REPLACE(b.PhoneNumber, ' ', ''), 9) = RIGHT(@phone, 9)
        OR (@nationalId <> '' AND b.NationalID = @nationalId))
    ORDER BY b.ID DESC`;

  const { rows } = await runReadOnlyQuery(
    org,
    sql,
    [
      { name: "entityId", type: mssql.Int, value: entityId },
      { name: "phone", type: mssql.VarChar(32), value: phone },
      { name: "nationalId", type: mssql.VarChar(32), value: (nationalId || "").trim() },
    ],
    { timeoutMs: 30000, maxRows: 1 },
  );
  if (rows.length === 0) return null;
  const r = rows[0] as Record<string, unknown>;

  // Office breadcrumb comes back as JSON [{Unit, Level, rn}], leaf-first (rn=1).
  let officeTrail: { unit: string; level: string }[] = [];
  try {
    const raw = JSON.parse(String(r.OfficeTrail ?? "[]")) as { Unit?: string; Level?: string; rn?: number }[];
    officeTrail = raw
      .sort((a, b) => (b.rn ?? 0) - (a.rn ?? 0))
      .map((x) => ({ unit: String(x.Unit ?? ""), level: String(x.Level ?? "") }))
      .filter((x) => x.unit);
  } catch { /* trail is decorative */ }

  const num = (v: unknown): number | null => (v == null ? null : Number(v));
  const photoId = String(r.borrowerPhoto ?? "").trim();

  return {
    borrowerId: Number(r.ID),
    name: `${String(r.firstName ?? "").trim()} ${String(r.otherName ?? "").trim()}`.trim(),
    accountNo: r.AccountNo != null ? String(r.AccountNo) : null,
    nationalId: r.NationalID != null ? String(r.NationalID) : null,
    phone: r.PhoneNumber != null ? String(r.PhoneNumber) : null,
    email: r.EmailAddress != null ? String(r.EmailAddress) : null,
    age: num(r.Age),
    gender: r.GenderTitle != null ? String(r.GenderTitle) : null,
    status: String(r.StatusTitle ?? "PENDING"),
    // Micromart photos live in Google Drive with link-visible sharing — the
    // thumbnail endpoint serves them without credentials.
    photoUrl: photoId ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(photoId)}&sz=w480` : null,
    riskScore: num(r.RiskScore),
    riskCategory: r.RiskCategory != null ? String(r.RiskCategory) : null,
    lastScoreUpdate: r.LastScoreUpdateDate ? new Date(r.LastScoreUpdateDate as string).toISOString() : null,
    loanLimit: num(r.LoanLimit),
    previousLoanLimit: num(r.PreviousLoanLimit),
    graduationPercentage: num(r.GraduationPercentage),
    agentName: String(r.AgentName ?? "").trim() || null,
    branchName: r.BranchName != null ? String(r.BranchName) : null,
    officeTrail,
    loansCount: Number(r.LoansCount ?? 0),
    totalBorrowed: Number(r.TotalBorrowed ?? 0),
    olb: Number(r.OLB ?? 0),
    clearedLoans: Number(r.ClearedLoans ?? 0),
    activeLoans: Number(r.ActiveLoans ?? 0),
  };
}

export type LmsProduct = {
  id: number;
  name: string;
  description: string | null;
  minPrincipal: number | null;
  maxPrincipal: number | null;
  interestRate: number | null;
  interestUnit: string | null; // e.g. "Month" (from DurationOptions)
  repaymentPeriod: number | null;
  repaymentUnit: string | null; // e.g. "Week"
  minCreditScore: number | null;
};

/**
 * List the lender's ACTIVE loan products for the entity (read-only). Period-type
 * codes are resolved to human labels via the DurationOptions lookup so the
 * borrower sees "3 Months" rather than a raw integer. Ordered by smallest
 * principal first (entry products surface at the top).
 */
export async function listProducts(org: OrgDef, entityId: number): Promise<LmsProduct[]> {
  const sql = `
    SELECT
      P.ID                 AS id,
      P.ProductName        AS name,
      P.ProductDesc        AS description,
      P.MinPrincipal       AS minPrincipal,
      P.MaxPrincipal       AS maxPrincipal,
      P.InterestRate       AS interestRate,
      DIT.duratioName      AS interestUnit,
      P.RepaymentPeriod    AS repaymentPeriod,
      DRT.duratioName      AS repaymentUnit,
      P.MinCreditScore     AS minCreditScore
    FROM Products P
    LEFT JOIN DurationOptions DRT ON DRT.ID = P.RepaymentPeriodType
    LEFT JOIN DurationOptions DIT ON DIT.ID = P.InterestPeriodType
    WHERE P.EntityId = @entityId AND P.IsActive = 1
    ORDER BY P.MinPrincipal ASC, P.ProductName ASC`;

  const { rows } = await runReadOnlyQuery(
    org,
    sql,
    [{ name: "entityId", type: mssql.Int, value: entityId }],
    { timeoutMs: 15000, maxRows: 100 },
  );

  const num = (v: unknown): number | null => {
    const n = Number(v);
    return v == null || !Number.isFinite(n) ? null : n;
  };
  const str = (v: unknown): string | null => (v == null ? null : String(v).trim() || null);

  return rows.map((r) => ({
    id: Number(r.id),
    name: str(r.name) ?? `Product ${r.id}`,
    description: str(r.description),
    minPrincipal: num(r.minPrincipal),
    maxPrincipal: num(r.maxPrincipal),
    interestRate: num(r.interestRate),
    interestUnit: str(r.interestUnit),
    repaymentPeriod: num(r.repaymentPeriod),
    repaymentUnit: str(r.repaymentUnit),
    minCreditScore: num(r.minCreditScore),
  }));
}

export type PostResult = { ok: boolean; loanId?: string; code?: string; message: string };

// sp_InsertLoan signatures differ per server: Micromart's REQUIRES @Entity and has
// no @TransactionRef; the shared server takes @TransactionRef and no @Entity.
// Probe the proc's parameter list once per org (cached) and send only what it takes.
const spParamsCache = new Map<string, Promise<Set<string>>>();
function spInsertLoanParams(org: OrgDef): Promise<Set<string>> {
  let cached = spParamsCache.get(org.slug);
  if (!cached) {
    cached = runReadOnlyQuery(
      org,
      `SELECT p.name FROM sys.parameters p JOIN sys.procedures pr ON pr.object_id = p.object_id WHERE pr.name = 'sp_InsertLoan'`,
      [],
      { timeoutMs: 15000, maxRows: 30 },
    )
      .then((r) => new Set(r.rows.map((x) => String(x.name).toLowerCase())))
      .catch((err) => { spParamsCache.delete(org.slug); throw err; });
    spParamsCache.set(org.slug, cached);
  }
  return cached;
}

/** Post a pending loan to ServiceSuite via sp_InsertLoan (gated). */
export async function postLoan(
  org: OrgDef,
  args: { borrowerId: number; principal: number; productId: number; applicationId: string; borrowDate?: Date },
): Promise<PostResult> {
  if (!isPostingEnabled()) {
    return { ok: false, message: "ServiceSuite posting is disabled (set LMS_POSTING_ENABLED=true after creating the BirgenAI workflow)." };
  }
  if (!POSTING_USER_ID) {
    return { ok: false, message: "LMS_SERVICESUITE_CREATED_BY (a UserMaster.ID for the BirgenAI service account) is not configured." };
  }

  try {
    const accepted = await spInsertLoanParams(org);
    const params: QueryParam[] = [
      { name: "BorrowerId", type: mssql.Int, value: args.borrowerId },
      { name: "Principal", type: mssql.Decimal(18, 2), value: args.principal },
      { name: "ProductId", type: mssql.Int, value: args.productId },
      { name: "CreatedBy", type: mssql.Int, value: POSTING_USER_ID },
      { name: "BorrowDate", type: mssql.DateTime, value: args.borrowDate ?? new Date() },
      { name: "ApplicationType", type: mssql.Int, value: CHANNEL },
    ];
    if (accepted.has("@entity")) {
      params.push({ name: "Entity", type: mssql.Int, value: getEntityId(org) });
    }
    if (accepted.has("@transactionref")) {
      // Join key for outcome tracking where supported; servers without it are
      // linked by borrower + BorrowDate in the outcome backfill instead.
      params.push({ name: "TransactionRef", type: mssql.NVarChar(100), value: args.applicationId });
    }
    const rows = await callStoredProc(org, "sp_InsertLoan", params);

    const r = rows[0] ?? {};
    const code = String(r.Code ?? "");
    const loanId = r.LoanID != null ? String(r.LoanID) : undefined;
    if (code === "200" && loanId) {
      return { ok: true, loanId, code, message: String(r.Response ?? "Loan posted.") };
    }
    return { ok: false, code, message: String(r.Response ?? "ServiceSuite declined the loan.") };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Posting failed." };
  }
}
