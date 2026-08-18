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
 * they have 5+ fully-cleared loans and no currently-active loan.
 *
 * MATCHED BY PHONE ONLY, and that is a security property, not an omission. This
 * used to also match `b.NationalID = @nationalId` as an ALTERNATIVE — so a
 * caller who supplied a stranger's ID number was handed that stranger's
 * `borrowerId`, which `apply` then passed to `postLoan()`. A national ID is a
 * claim for KYC to verify, never a lookup key on a borrower-facing route. The
 * phone arrives from the OTP session cookie and cannot be asserted.
 */
/** Digits-only phone (borrowers type 07XX XXX XXX, DB stores 2547XXXXXXXX). */
const cleanPhone = (p: string) => p.replace(/\D/g, "");

export async function checkGraduation(
  org: OrgDef,
  entityId: number,
  phone: string,
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
        OR RIGHT(REPLACE(b.PhoneNumber, ' ', ''), 9) = RIGHT(@phone, 9))
    ORDER BY b.ID DESC`;

  const { rows } = await runReadOnlyQuery(
    org,
    sql,
    [
      { name: "entityId", type: mssql.Int, value: entityId },
      { name: "phone", type: mssql.VarChar(32), value: phone },
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

/** Matched by phone only — see checkGraduation for why the ID is not a key here. */
export async function getCustomer360(
  org: OrgDef,
  entityId: number,
  phone: string,
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
        OR RIGHT(REPLACE(b.PhoneNumber, ' ', ''), 9) = RIGHT(@phone, 9))
    ORDER BY b.ID DESC`;

  const { rows } = await runReadOnlyQuery(
    org,
    sql,
    [
      { name: "entityId", type: mssql.Int, value: entityId },
      { name: "phone", type: mssql.VarChar(32), value: phone },
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

// ── The lender's borrower book, read through rather than copied ──────────────
// A BRIDGED lender's customers are NOT mirrored into Postgres: tenancy.ts resolves
// them live, so the console can never show a stale copy of someone else's book.
// Micromart's Fintech entity (3005) holds 17,017 borrowers and ~59.8k approved
// loans, which is why this pages in the database rather than loading a list.
//
// `total` comes back with every page so the console can say "17,017" without
// counting rows it did not fetch.

export type LiveBorrower = {
  /** ServiceSuite Borrowers.ID. Namespaced because it is NOT an LMS uuid. */
  ref: string; // "ss:<id>"
  serviceSuiteId: number;
  name: string | null;
  phone: string | null;
  nationalId: string | null;
  portraitUrl: string | null;
  creditScore: number | null;
  riskCategory: string | null;
  loanLimit: number | null;
  graduationCount: number;
  hasGeo: boolean;
  kycVerified: boolean;
  accountStatus: string;
  createdAt: string | null;
  loansCount: number;
  activeLoans: number;
  clearedLoans: number;
  olb: number;
  totalBorrowed: number;
  graduated: boolean;
};

export async function listBorrowersLive(
  org: OrgDef,
  entityId: number,
  opts: { q?: string; take?: number; skip?: number } = {},
): Promise<{ borrowers: LiveBorrower[]; total: number }> {
  const take = Math.min(Math.max(opts.take ?? 50, 1), 200);
  const skip = Math.max(opts.skip ?? 0, 0);
  const q = (opts.q ?? "").trim();
  const digits = q.replace(/\D/g, "");
  // Phones are stored 2547XXXXXXXX; searches arrive as 07XX…, +2547…, 7XX… —
  // match on the last 9 digits so every format finds the same customer.
  const phone9 = digits.length >= 9 ? digits.slice(-9) : digits;

  const filter = `
    b.EntityId = @entityId
    AND (@q = '' OR (
      (@phone9 <> '' AND RIGHT(REPLACE(b.PhoneNumber,' ',''), 9) LIKE '%' + @phone9 + '%')
      OR b.NationalID LIKE '%' + @q + '%'
      OR b.firstName LIKE '%' + @q + '%'
      OR b.otherName LIKE '%' + @q + '%'
      OR LTRIM(RTRIM(ISNULL(b.firstName,'') + ' ' + ISNULL(b.otherName,''))) LIKE '%' + @q + '%'
    ))`;

  const params: QueryParam[] = [
    { name: "entityId", type: mssql.Int, value: entityId },
    { name: "q", type: mssql.VarChar(120), value: q },
    { name: "phone9", type: mssql.VarChar(32), value: phone9 },
    { name: "skip", type: mssql.Int, value: skip },
    { name: "take", type: mssql.Int, value: take },
  ];

  const [page, counted] = await Promise.all([
    runReadOnlyQuery(
      org,
      `SELECT b.ID, b.firstName, b.otherName, b.PhoneNumber, b.NationalID, b.borrowerPhoto,
              b.CreditScore, b.RiskCategory, b.LoanLimit, ISNULL(b.GraduationCount,0) AS GraduationCount,
              b.Latitude, b.Longitude, b.KycVerification, b.AccountStatus, b.CreatedDate,
              s.LoansCount, s.ActiveLoans, s.ClearedLoans, s.Olb, s.TotalBorrowed
       FROM Borrowers b
       OUTER APPLY (
         SELECT COUNT(*) AS LoansCount,
                SUM(CASE WHEN l.LoanCleared = 0 AND l.LoanBalance > 0 THEN 1 ELSE 0 END) AS ActiveLoans,
                SUM(CASE WHEN l.LoanCleared = 1 THEN 1 ELSE 0 END) AS ClearedLoans,
                ISNULL(SUM(CASE WHEN l.LoanCleared = 0 THEN l.LoanBalance ELSE 0 END), 0) AS Olb,
                ISNULL(SUM(l.LoanAmount), 0) AS TotalBorrowed
         FROM Loans l WHERE l.BorrowerId = b.ID AND l.isApproved = 1
       ) s
       WHERE ${filter}
       ORDER BY b.ID DESC
       OFFSET @skip ROWS FETCH NEXT @take ROWS ONLY`,
      params,
      { timeoutMs: 45000, maxRows: take },
    ),
    runReadOnlyQuery(
      org,
      `SELECT COUNT(*) AS total FROM Borrowers b WHERE ${filter}`,
      params,
      { timeoutMs: 45000, maxRows: 1 },
    ),
  ]);

  const num = (v: unknown): number | null => {
    const x = Number(v);
    return v == null || !Number.isFinite(x) ? null : x;
  };
  const str = (v: unknown): string | null => (v == null ? null : String(v).trim() || null);

  const borrowers: LiveBorrower[] = page.rows.map((r) => {
    const activeLoans = Number(r.ActiveLoans ?? 0);
    const clearedLoans = Number(r.ClearedLoans ?? 0);
    // Their photos are Google Drive fileIds with link-visible sharing, so the
    // thumbnail endpoint serves them without credentials (same as Customer 360).
    const photoId = String(r.borrowerPhoto ?? "").trim();
    return {
      ref: `ss:${Number(r.ID)}`,
      serviceSuiteId: Number(r.ID),
      name: `${String(r.firstName ?? "").trim()} ${String(r.otherName ?? "").trim()}`.trim() || null,
      phone: str(r.PhoneNumber),
      nationalId: str(r.NationalID),
      portraitUrl: photoId ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(photoId)}&sz=w480` : null,
      creditScore: num(r.CreditScore),
      riskCategory: str(r.RiskCategory),
      loanLimit: num(r.LoanLimit),
      graduationCount: Number(r.GraduationCount ?? 0),
      hasGeo: str(r.Latitude) != null && str(r.Longitude) != null,
      kycVerified: Number(r.KycVerification ?? 0) === 1,
      accountStatus: Number(r.AccountStatus ?? 0) === 1 ? "ACTIVE" : Number(r.AccountStatus ?? 0) === 2 ? "IN-ACTIVE" : "PENDING",
      createdAt: r.CreatedDate ? new Date(r.CreatedDate as string).toISOString() : null,
      loansCount: Number(r.LoansCount ?? 0),
      activeLoans,
      clearedLoans,
      olb: Number(r.Olb ?? 0),
      totalBorrowed: Number(r.TotalBorrowed ?? 0),
      graduated: clearedLoans >= 5 && activeLoans === 0,
    };
  });

  return { borrowers, total: Number(counted.rows[0]?.total ?? 0) };
}

/**
 * Book-level counts for the header strip. Computed in the lender's database
 * because they describe the WHOLE book, and a figure derived from the page on
 * screen ("0 of 50 pinned") would be a different, misleading claim.
 */
export type BorrowerBookStats = {
  total: number;
  active: number;
  needsLocation: number;
  scored: number;
  withOpenLoan: number;
};

export async function getBorrowerBookStats(org: OrgDef, entityId: number): Promise<BorrowerBookStats> {
  const { rows } = await runReadOnlyQuery(
    org,
    // SQL Server will not aggregate over a subquery, so "has an open loan" comes
    // from a JOIN rather than a per-row EXISTS. That is also far cheaper: the
    // grouped set scans only OPEN loans (38 of them on this book) instead of
    // probing once per borrower across 17k rows.
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN b.AccountStatus = 1 THEN 1 ELSE 0 END) AS active,
            SUM(CASE WHEN b.Latitude IS NULL OR LTRIM(RTRIM(b.Latitude)) = ''
                      OR b.Longitude IS NULL OR LTRIM(RTRIM(b.Longitude)) = ''
                     THEN 1 ELSE 0 END) AS needsLocation,
            SUM(CASE WHEN b.CreditScore IS NOT NULL THEN 1 ELSE 0 END) AS scored,
            SUM(CASE WHEN ISNULL(ol.OpenLoans, 0) > 0 THEN 1 ELSE 0 END) AS withOpenLoan
     FROM Borrowers b
     LEFT JOIN (
       SELECT l.BorrowerId, COUNT(*) AS OpenLoans
       FROM Loans l
       WHERE l.EntityId = @entityId AND l.isApproved = 1 AND l.LoanCleared = 0 AND l.LoanBalance > 0
       GROUP BY l.BorrowerId
     ) ol ON ol.BorrowerId = b.ID
     WHERE b.EntityId = @entityId`,
    [{ name: "entityId", type: mssql.Int, value: entityId }],
    { timeoutMs: 60000, maxRows: 1 },
  );
  const r = rows[0] ?? {};
  return {
    total: Number(r.total ?? 0),
    active: Number(r.active ?? 0),
    needsLocation: Number(r.needsLocation ?? 0),
    scored: Number(r.scored ?? 0),
    withOpenLoan: Number(r.withOpenLoan ?? 0),
  };
}

// ── FIELD OPS: the customers with no location on file ────────────────────────
//
// A borrower with no pin never appears on a route and, once the location gate is
// on, cannot be disbursed to. On Micromart's Micro Eazy book that is not an
// exception list — it is EVERY customer: 17,017 of 17,017, verified against all
// three coordinate columns this schema carries (see UNPINNED below). There is no
// address text to fall back on either; 7,252 of the 7,254 non-empty
// PhysicalAddress values are the literal string "N/A".
//
// So the worklist cannot be "here are the stragglers". It has to be a CAMPAIGN,
// and a campaign needs two things this book can actually supply:
//
//   1. TRIAGE. 38 of them have money out right now (the whole KES 566,089 book) —
//      live exposure at an address nobody has. 16,977 more have cleared history
//      and a standing loan limit, so each one hits the location gate the next time
//      they borrow: KES 110.8m of approved limit sits behind it. 2 have never
//      borrowed. Those three tiers are the order of work, not a filter.
//
//   2. OWNERSHIP. Every one of the 17,017 already carries an EntityAgent, and all
//      169 distinct agents resolve to a named user. One impossible list becomes
//      169 officer queues of 1–622 customers. That is the difference between a
//      number on a slide and work that can start on Monday.
//
// NOTE ON THE AGENT JOIN: it is `ON ag.ID = b.EntityAgent` with no entity
// predicate on the user, deliberately. Micromart's officers are registered under
// EntityID 3002 while their Micro Eazy customers sit in 3005 — the same
// cross-entity split that POSTING_TARGETS exists for. Adding `AND ag.EntityID =
// @entityId` would silently blank all 169 names.

/** Everything the field worklist needs about one unpinned customer. */
export type LiveNeedsLocation = {
  /** Namespaced — a ServiceSuite id, not an LMS uuid. Feeds the resolve route. */
  ref: string; // "ss:<id>"
  serviceSuiteId: number;
  name: string | null;
  phone: string | null;
  nationalId: string | null;
  portraitUrl: string | null;
  /** Order of work, computed in the lender's database so paging can honour it. */
  tier: NeedsLocationTier;
  openLoans: number;
  olb: number;
  clearedLoans: number;
  loanLimit: number | null;
  creditScore: number | null;
  riskCategory: string | null;
  graduationCount: number;
  kycVerified: boolean;
  /** Days until the soonest open loan is due. Negative = already past due. */
  dueInDays: number | null;
  lastClearedAt: string | null;
  /** The lender's OWN officer assignment — the shard key for the campaign. */
  agentId: number | null;
  agentName: string | null;
  createdAt: string | null;
};

export type NeedsLocationTier = "MONEY_OUT" | "REPEAT" | "DORMANT";
const TIERS: readonly NeedsLocationTier[] = ["MONEY_OUT", "REPEAT", "DORMANT"];

/**
 * UNPINNED, in one place because three different queries below must agree.
 *
 * This schema carries TWO coordinate pairs: `Latitude`/`Longitude` as varchar(100)
 * (what the officer app writes) and `onboardingLatitude`/`onboardingLongitude` as
 * decimal (what the registration flow writes). A customer is pinned if EITHER pair
 * is usable, so "unpinned" is the absence of both — checking only the varchar pair
 * would report someone as needing a visit when their pin was captured at signup.
 * Both are empty across all of entity 3005, but that is a fact about this book
 * today, not a licence to read one column.
 */
const UNPINNED = `
  (b.Latitude IS NULL OR LTRIM(RTRIM(b.Latitude)) = '' OR b.Longitude IS NULL OR LTRIM(RTRIM(b.Longitude)) = '')
  AND (b.onboardingLatitude IS NULL OR b.onboardingLatitude = 0 OR b.onboardingLongitude IS NULL OR b.onboardingLongitude = 0)`;

/** The pinned test, positive form — for the stats roll-up. */
const PINNED_CASE = `
  CASE WHEN (b.Latitude IS NOT NULL AND LTRIM(RTRIM(b.Latitude)) <> '' AND b.Longitude IS NOT NULL AND LTRIM(RTRIM(b.Longitude)) <> '')
         OR (b.onboardingLatitude IS NOT NULL AND b.onboardingLatitude <> 0 AND b.onboardingLongitude IS NOT NULL AND b.onboardingLongitude <> 0)
       THEN 1 ELSE 0 END`;

/** Open loans per borrower — entity-scoped, grouped once rather than probed per row. */
const OPEN_LOANS_JOIN = `
  LEFT JOIN (
    SELECT l.BorrowerId, COUNT(*) AS OpenLoans, SUM(l.LoanBalance) AS Olb, MIN(l.ExpectedClearDate) AS NextDue
    FROM Loans l
    WHERE l.EntityId = @entityId AND l.isApproved = 1 AND l.LoanCleared = 0 AND l.LoanBalance > 0
    GROUP BY l.BorrowerId
  ) o ON o.BorrowerId = b.ID`;

const CLEARED_LOANS_JOIN = `
  LEFT JOIN (
    SELECT l.BorrowerId, COUNT(*) AS ClearedLoans
    FROM Loans l
    WHERE l.EntityId = @entityId AND l.isApproved = 1 AND l.LoanCleared = 1
    GROUP BY l.BorrowerId
  ) c ON c.BorrowerId = b.ID`;

/** The tier expression, written against base columns so it is safe in ORDER BY. */
const TIER_CASE = `
  CASE WHEN ISNULL(o.OpenLoans, 0) > 0 THEN 'MONEY_OUT'
       WHEN ISNULL(c.ClearedLoans, 0) > 0 THEN 'REPEAT'
       ELSE 'DORMANT' END`;

export async function listNeedsLocationLive(
  org: OrgDef,
  entityId: number,
  opts: { q?: string; take?: number; skip?: number; tier?: string | null; agentId?: number | null } = {},
): Promise<{ rows: LiveNeedsLocation[]; total: number }> {
  const take = Math.min(Math.max(opts.take ?? 25, 1), 200);
  const skip = Math.max(opts.skip ?? 0, 0);
  const q = (opts.q ?? "").trim();
  const digits = q.replace(/\D/g, "");
  const phone9 = digits.length >= 9 ? digits.slice(-9) : digits;
  // An unrecognised tier means "all", never an empty screen.
  const tier = TIERS.includes(opts.tier as NeedsLocationTier) ? (opts.tier as NeedsLocationTier) : "";
  const agentId = Number.isFinite(Number(opts.agentId)) ? Math.max(Number(opts.agentId), 0) : 0;

  const filter = `
    b.EntityId = @entityId
    AND ${UNPINNED}
    AND (@agentId = 0 OR b.EntityAgent = @agentId)
    AND (@tier = '' OR @tier = ${TIER_CASE})
    AND (@q = '' OR (
      (@phone9 <> '' AND RIGHT(REPLACE(b.PhoneNumber,' ',''), 9) LIKE '%' + @phone9 + '%')
      OR b.NationalID LIKE '%' + @q + '%'
      OR b.firstName LIKE '%' + @q + '%'
      OR b.otherName LIKE '%' + @q + '%'
      OR LTRIM(RTRIM(ISNULL(b.firstName,'') + ' ' + ISNULL(b.otherName,''))) LIKE '%' + @q + '%'
    ))`;

  const params: QueryParam[] = [
    { name: "entityId", type: mssql.Int, value: entityId },
    { name: "q", type: mssql.VarChar(120), value: q },
    { name: "phone9", type: mssql.VarChar(32), value: phone9 },
    { name: "tier", type: mssql.VarChar(16), value: tier },
    { name: "agentId", type: mssql.Int, value: agentId },
    { name: "skip", type: mssql.Int, value: skip },
    { name: "take", type: mssql.Int, value: take },
  ];

  const [page, counted] = await Promise.all([
    runReadOnlyQuery(
      org,
      // ONE ORDER BY serves all three tiers. Money-out rows sort by exposure; the
      // repeat tier has no balance so its Olb is 0 and loan limit decides (the
      // biggest limit is the next one to hit the gate); dormant rows have neither,
      // so newest-first falls out. `b.ID` last keeps deep paging stable — without a
      // unique tiebreak, page 800 of a 17k sort can repeat or skip a row.
      `SELECT b.ID, b.firstName, b.otherName, b.PhoneNumber, b.NationalID, b.borrowerPhoto,
              b.CreditScore, b.RiskCategory, b.LoanLimit, ISNULL(b.GraduationCount,0) AS GraduationCount,
              b.KycVerification, b.CreatedDate, b.LastLoanClearDate, b.EntityAgent,
              ag.FirstName AS AgentFirst, ag.OtherName AS AgentOther,
              ISNULL(o.OpenLoans,0) AS OpenLoans, ISNULL(o.Olb,0) AS Olb, o.NextDue,
              DATEDIFF(day, CAST(GETDATE() AS date), o.NextDue) AS DueInDays,
              ISNULL(c.ClearedLoans,0) AS ClearedLoans,
              ${TIER_CASE} AS Tier
       FROM Borrowers b
       LEFT JOIN UserMaster ag ON ag.ID = b.EntityAgent
       ${OPEN_LOANS_JOIN}
       ${CLEARED_LOANS_JOIN}
       WHERE ${filter}
       ORDER BY CASE WHEN ISNULL(o.OpenLoans,0) > 0 THEN 0
                     WHEN ISNULL(c.ClearedLoans,0) > 0 THEN 1
                     ELSE 2 END ASC,
                ISNULL(o.Olb,0) DESC, ISNULL(b.LoanLimit,0) DESC, b.ID DESC
       OFFSET @skip ROWS FETCH NEXT @take ROWS ONLY`,
      params,
      { timeoutMs: 45000, maxRows: take },
    ),
    runReadOnlyQuery(
      org,
      `SELECT COUNT(*) AS total
       FROM Borrowers b
       ${OPEN_LOANS_JOIN}
       ${CLEARED_LOANS_JOIN}
       WHERE ${filter}`,
      params,
      { timeoutMs: 45000, maxRows: 1 },
    ),
  ]);

  const num = (v: unknown): number | null => {
    const x = Number(v);
    return v == null || !Number.isFinite(x) ? null : x;
  };
  const str = (v: unknown): string | null => (v == null ? null : String(v).trim() || null);

  const rows: LiveNeedsLocation[] = page.rows.map((r) => {
    const photoId = String(r.borrowerPhoto ?? "").trim();
    const agentName = `${String(r.AgentFirst ?? "").trim()} ${String(r.AgentOther ?? "").trim()}`.trim();
    return {
      ref: `ss:${Number(r.ID)}`,
      serviceSuiteId: Number(r.ID),
      name: `${String(r.firstName ?? "").trim()} ${String(r.otherName ?? "").trim()}`.trim() || null,
      phone: str(r.PhoneNumber),
      nationalId: str(r.NationalID),
      portraitUrl: photoId ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(photoId)}&sz=w480` : null,
      tier: (TIERS.includes(String(r.Tier) as NeedsLocationTier) ? String(r.Tier) : "DORMANT") as NeedsLocationTier,
      openLoans: Number(r.OpenLoans ?? 0),
      olb: Number(r.Olb ?? 0),
      clearedLoans: Number(r.ClearedLoans ?? 0),
      loanLimit: num(r.LoanLimit),
      creditScore: num(r.CreditScore),
      riskCategory: str(r.RiskCategory),
      graduationCount: Number(r.GraduationCount ?? 0),
      kycVerified: Number(r.KycVerification ?? 0) === 1,
      dueInDays: num(r.DueInDays),
      lastClearedAt: r.LastLoanClearDate ? new Date(r.LastLoanClearDate as string).toISOString() : null,
      agentId: num(r.EntityAgent),
      agentName: agentName || null,
      createdAt: r.CreatedDate ? new Date(r.CreatedDate as string).toISOString() : null,
    };
  });

  return { rows, total: Number(counted.rows[0]?.total ?? 0) };
}

/**
 * The whole-book picture behind the worklist — one round trip.
 *
 * Every figure describes the ENTIRE book, not the page on screen, because "0% of
 * your customers have a location" and "0 of the 25 rows you can see" are different
 * claims and only the first one is worth a board's attention.
 */
export type NeedsLocationStats = {
  total: number;
  pinned: number;
  unpinned: number;
  /** Live exposure at an address nobody holds. */
  moneyOutCustomers: number;
  moneyOutOlb: number;
  /** Cleared history + a standing limit ⇒ blocked at their next disbursement. */
  repeatCustomers: number;
  repeatLimit: number;
  dormantCustomers: number;
  /** Distinct officer queues the backlog already shards into. */
  agentQueues: number;
  unpinnedKycVerified: number;
  unpinnedScored: number;
  /** Total approved loan limit sitting behind the location gate. */
  limitBehindGate: number;
  /**
   * Distinct customers who took a loan in the trailing 12 months — the rate at
   * which the backlog would drain on its own, since the funnel captures a pin at
   * application. A FACT, not a projection: on this book it is 2,211 of 17,017, so
   * waiting for it would take years. That is the case for a deliberate campaign.
   */
  returning12m: number;
  /** Months in that window with any lending at all (this book paused mid-2026). */
  activeMonths12m: number;
};

export async function getNeedsLocationStats(org: OrgDef, entityId: number): Promise<NeedsLocationStats> {
  const { rows } = await runReadOnlyQuery(
    org,
    `WITH book AS (
       SELECT b.ID, b.LoanLimit, b.CreditScore, b.KycVerification, b.EntityAgent,
              ${PINNED_CASE} AS Pinned,
              ISNULL(o.OpenLoans,0) AS OpenLoans, ISNULL(o.Olb,0) AS Olb,
              ISNULL(c.ClearedLoans,0) AS ClearedLoans
       FROM Borrowers b
       ${OPEN_LOANS_JOIN}
       ${CLEARED_LOANS_JOIN}
       WHERE b.EntityId = @entityId
     )
     SELECT COUNT(*) AS total,
            SUM(Pinned) AS pinned,
            SUM(1 - Pinned) AS unpinned,
            SUM(CASE WHEN Pinned = 0 AND OpenLoans > 0 THEN 1 ELSE 0 END) AS moneyOutCustomers,
            ISNULL(SUM(CASE WHEN Pinned = 0 AND OpenLoans > 0 THEN Olb ELSE 0 END), 0) AS moneyOutOlb,
            SUM(CASE WHEN Pinned = 0 AND OpenLoans = 0 AND ClearedLoans > 0 THEN 1 ELSE 0 END) AS repeatCustomers,
            ISNULL(SUM(CASE WHEN Pinned = 0 AND OpenLoans = 0 AND ClearedLoans > 0 THEN ISNULL(LoanLimit,0) ELSE 0 END), 0) AS repeatLimit,
            SUM(CASE WHEN Pinned = 0 AND OpenLoans = 0 AND ClearedLoans = 0 THEN 1 ELSE 0 END) AS dormantCustomers,
            COUNT(DISTINCT CASE WHEN Pinned = 0 THEN EntityAgent END) AS agentQueues,
            SUM(CASE WHEN Pinned = 0 AND KycVerification = 1 THEN 1 ELSE 0 END) AS unpinnedKycVerified,
            SUM(CASE WHEN Pinned = 0 AND CreditScore IS NOT NULL THEN 1 ELSE 0 END) AS unpinnedScored,
            ISNULL(SUM(CASE WHEN Pinned = 0 THEN ISNULL(LoanLimit,0) ELSE 0 END), 0) AS limitBehindGate,
            (SELECT COUNT(DISTINCT l.BorrowerId) FROM Loans l
              WHERE l.EntityId = @entityId AND l.isApproved = 1
                AND l.BorrowDate >= DATEADD(month, -12, GETDATE())) AS returning12m,
            (SELECT COUNT(DISTINCT FORMAT(l.BorrowDate, 'yyyy-MM')) FROM Loans l
              WHERE l.EntityId = @entityId AND l.isApproved = 1
                AND l.BorrowDate >= DATEADD(month, -12, GETDATE())) AS activeMonths12m
     FROM book`,
    [{ name: "entityId", type: mssql.Int, value: entityId }],
    { timeoutMs: 60000, maxRows: 1 },
  );
  const r = rows[0] ?? {};
  const n = (k: string) => Number(r[k] ?? 0);
  return {
    total: n("total"),
    pinned: n("pinned"),
    unpinned: n("unpinned"),
    moneyOutCustomers: n("moneyOutCustomers"),
    moneyOutOlb: n("moneyOutOlb"),
    repeatCustomers: n("repeatCustomers"),
    repeatLimit: n("repeatLimit"),
    dormantCustomers: n("dormantCustomers"),
    agentQueues: n("agentQueues"),
    unpinnedKycVerified: n("unpinnedKycVerified"),
    unpinnedScored: n("unpinnedScored"),
    limitBehindGate: n("limitBehindGate"),
    returning12m: n("returning12m"),
    activeMonths12m: n("activeMonths12m"),
  };
}

/**
 * The backlog split into the officer queues it ALREADY has.
 *
 * `Borrowers.EntityAgent` is the lender's own relationship-officer assignment, so
 * this is not an allocation we invent — it is the one their book already agrees
 * with. Ordered by money-out first, then caseload, so the queue that matters most
 * is the one at the top.
 */
export type NeedsLocationQueue = {
  agentId: number;
  agentName: string | null;
  customers: number;
  moneyOut: number;
  olb: number;
  limitBehindGate: number;
};

export async function listNeedsLocationQueues(
  org: OrgDef,
  entityId: number,
  take = 200,
): Promise<NeedsLocationQueue[]> {
  const { rows } = await runReadOnlyQuery(
    org,
    `SELECT TOP (@take)
            b.EntityAgent AS agentId,
            LTRIM(RTRIM(ISNULL(MAX(ag.FirstName),'') + ' ' + ISNULL(MAX(ag.OtherName),''))) AS agentName,
            COUNT(*) AS customers,
            SUM(CASE WHEN ISNULL(o.OpenLoans,0) > 0 THEN 1 ELSE 0 END) AS moneyOut,
            ISNULL(SUM(ISNULL(o.Olb,0)), 0) AS olb,
            ISNULL(SUM(ISNULL(b.LoanLimit,0)), 0) AS limitBehindGate
     FROM Borrowers b
     LEFT JOIN UserMaster ag ON ag.ID = b.EntityAgent
     ${OPEN_LOANS_JOIN}
     WHERE b.EntityId = @entityId AND ${UNPINNED}
     GROUP BY b.EntityAgent
     ORDER BY SUM(CASE WHEN ISNULL(o.OpenLoans,0) > 0 THEN 1 ELSE 0 END) DESC, COUNT(*) DESC`,
    [
      { name: "entityId", type: mssql.Int, value: entityId },
      { name: "take", type: mssql.Int, value: Math.min(Math.max(take, 1), 500) },
    ],
    { timeoutMs: 45000, maxRows: 500 },
  );

  return rows.map((r) => ({
    agentId: Number(r.agentId ?? 0),
    agentName: String(r.agentName ?? "").trim() || null,
    customers: Number(r.customers ?? 0),
    moneyOut: Number(r.moneyOut ?? 0),
    olb: Number(r.olb ?? 0),
    limitBehindGate: Number(r.limitBehindGate ?? 0),
  }));
}

/**
 * ONE borrower from the lender's book, by their ServiceSuite id, with the fields
 * needed to seed a local record.
 *
 * Keyed by id and not phone BECAUSE the caller already picked this exact row out of
 * a live list — re-resolving by phone would reintroduce the ambiguity that
 * findBorrowerByPhone exists to refuse. `entityId` still scopes it, so an id from
 * one lender's book can never be read against another's.
 */
export type LiveBorrowerSeed = {
  serviceSuiteId: number;
  firstName: string | null;
  otherName: string | null;
  phone: string | null;
  nationalId: string | null;
  email: string | null;
  dob: string | null; // ISO
  gender: "M" | "F" | null;
  creditScore: number | null;
  riskCategory: string | null;
  loanLimit: number | null;
  previousLoanLimit: number | null;
  graduationCount: number;
  accountNo: string | null;
  createdAt: string | null;
};

export async function getLiveBorrowerById(
  org: OrgDef,
  entityId: number,
  serviceSuiteId: number,
): Promise<LiveBorrowerSeed | null> {
  const { rows } = await runReadOnlyQuery(
    org,
    `SELECT TOP 1 b.ID, b.firstName, b.otherName, b.PhoneNumber, b.NationalID, b.EmailAddress,
            b.DOB, b.Gender, b.CreditScore, b.RiskCategory, b.LoanLimit, b.PreviousLoanLimit,
            ISNULL(b.GraduationCount,0) AS GraduationCount, b.AccountNo, b.CreatedDate
     FROM Borrowers b
     WHERE b.ID = @id AND b.EntityId = @entityId`,
    [
      { name: "id", type: mssql.Int, value: serviceSuiteId },
      { name: "entityId", type: mssql.Int, value: entityId },
    ],
    { timeoutMs: 20000, maxRows: 1 },
  );
  if (rows.length === 0) return null;
  const r = rows[0];

  const num = (v: unknown): number | null => {
    const x = Number(v);
    return v == null || !Number.isFinite(x) ? null : x;
  };
  const str = (v: unknown): string | null => (v == null ? null : String(v).trim() || null);
  const g = Number(r.Gender ?? 0);

  return {
    serviceSuiteId: Number(r.ID),
    firstName: str(r.firstName),
    otherName: str(r.otherName),
    phone: str(r.PhoneNumber),
    nationalId: str(r.NationalID),
    // Their book is full of placeholder emails ("na", "N/A", "sgfwtss") — a value
    // that is not an address is worse than none, because it will be mailed.
    email: (() => {
      const e = str(r.EmailAddress);
      return e && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null;
    })(),
    dob: r.DOB ? new Date(r.DOB as string).toISOString() : null,
    gender: g === 1 ? "M" : g === 2 ? "F" : null,
    creditScore: num(r.CreditScore),
    riskCategory: str(r.RiskCategory),
    loanLimit: num(r.LoanLimit),
    previousLoanLimit: num(r.PreviousLoanLimit),
    graduationCount: Number(r.GraduationCount ?? 0),
    accountNo: str(r.AccountNo),
    createdAt: r.CreatedDate ? new Date(r.CreatedDate as string).toISOString() : null,
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

/**
 * The lender's borrower row a posting will book against, found by verified phone.
 *
 * A PHONE NUMBER IS NOT AN IDENTITY. Probing Micromart's live book on 12 Aug 2026
 * found 13 numbers held by a different borrower in each of entities 3002 and 3005
 * — the founder's own 0758517032 is one of them, sitting on "Emmanuel Birgen"
 * (168346) in 3005 and "Mr Kipleting" (89296) in 3002. The old query took
 * `TOP 1 ... ORDER BY b.ID DESC` and would have booked a loan against whichever
 * of those the entity scope happened to surface.
 *
 * So: fetch every phone match, and when the caller knows a national ID, use it to
 * decide. `ambiguous` is returned rather than a guess whenever identity cannot be
 * established — the caller must stop, because the alternative is lending money to
 * the wrong human being.
 */
export type BorrowerMatch =
  | { kind: "found"; borrowerId: number; name: string }
  | { kind: "none" }
  | { kind: "ambiguous"; reason: string; candidates: { borrowerId: number; name: string; nationalId: string | null }[] };

export async function findBorrowerByPhone(
  org: OrgDef,
  entityId: number,
  phone: string,
  nationalId?: string | null,
): Promise<BorrowerMatch> {
  const digits = cleanPhone(phone);
  const { rows } = await runReadOnlyQuery(
    org,
    `SELECT b.ID AS borrowerId,
            LTRIM(RTRIM(ISNULL(b.firstName,'') + ' ' + ISNULL(b.otherName,''))) AS name,
            b.NationalID AS nationalId
     FROM Borrowers b
     WHERE b.EntityId = @entityId
       AND (b.PhoneNumber = @phone OR RIGHT(REPLACE(b.PhoneNumber, ' ', ''), 9) = RIGHT(@phone, 9))
     ORDER BY b.ID DESC`,
    [
      { name: "entityId", type: mssql.Int, value: entityId },
      { name: "phone", type: mssql.VarChar(32), value: digits },
    ],
    { timeoutMs: 15000, maxRows: 25 },
  );

  const candidates = rows.map((r) => ({
    borrowerId: Number(r.borrowerId),
    name: String(r.name ?? "").trim(),
    nationalId: r.nationalId != null ? String(r.nationalId).trim() || null : null,
  }));
  if (candidates.length === 0) return { kind: "none" };

  const claimed = nationalId?.trim() || null;

  // Several rows on one number: only a national-ID match can pick between them.
  if (candidates.length > 1) {
    if (!claimed) {
      return {
        kind: "ambiguous",
        reason: `${candidates.length} borrowers at the lender share this phone number and no national ID was supplied to tell them apart.`,
        candidates,
      };
    }
    const exact = candidates.filter((c) => c.nationalId === claimed);
    if (exact.length === 1) return { kind: "found", ...exact[0] };
    return {
      kind: "ambiguous",
      reason: exact.length === 0
        ? `${candidates.length} borrowers share this phone number and none carries national ID ${claimed}.`
        : `${exact.length} borrowers share this phone number AND national ID ${claimed}.`,
      candidates,
    };
  }

  // Exactly one row. If both sides state an ID and they disagree, that is a
  // different person reusing a recycled number — never book against it.
  const only = candidates[0];
  if (claimed && only.nationalId && only.nationalId !== claimed) {
    return {
      kind: "ambiguous",
      reason: `The lender's borrower on this phone number carries national ID ${only.nationalId}, not ${claimed}.`,
      candidates,
    };
  }
  return { kind: "found", borrowerId: only.borrowerId, name: only.name };
}

/**
 * Make sure the borrower EXISTS in the posting target before a loan books against
 * them — a pilot customer onboarded on our portal is brand-new to the lender's
 * fintech deployment. Registration goes through the lender's own
 * sp_NewBorrowerRegistration (the same proc their app uses), which normalises the
 * phone to 254XXXXXXXXX, assigns the account number per BorrowerSettings, and
 * returns the new Borrowers.ID (or -1 when the account already exists — in which
 * case we re-find by phone). Gated behind LMS_POSTING_ENABLED like every write.
 */
export async function ensureBorrower(
  org: OrgDef,
  entityId: number,
  args: { phone: string; firstName: string; otherName?: string | null; nationalId?: string | null; email?: string | null },
): Promise<{ ok: true; borrowerId: number; created: boolean } | { ok: false; message: string }> {
  try {
    const existing = await findBorrowerByPhone(org, entityId, args.phone, args.nationalId);
    if (existing.kind === "found") return { ok: true, borrowerId: existing.borrowerId, created: false };
    if (existing.kind === "ambiguous") {
      // Refuse rather than register a duplicate or book against a stranger. This
      // needs a human to reconcile the lender's records.
      return { ok: false, message: `Identity could not be confirmed at the lender: ${existing.reason}` };
    }

    if (!isPostingEnabled()) {
      return { ok: false, message: "ServiceSuite posting is disabled — cannot register the borrower with the lender." };
    }
    const rows = await callStoredProc(org, "sp_NewBorrowerRegistration", [
      { name: "BorrowerFirstName", type: mssql.NVarChar(50), value: (args.firstName || "CUSTOMER").slice(0, 50) },
      { name: "BorrowerOtherName", type: mssql.NVarChar(50), value: (args.otherName || "").slice(0, 50) },
      { name: "NationalID", type: mssql.NVarChar(50), value: args.nationalId?.trim() || null },
      { name: "PhoneNumber", type: mssql.NVarChar(50), value: cleanPhone(args.phone) },
      { name: "EmailAddress", type: mssql.NVarChar(50), value: args.email?.trim().slice(0, 50) || null },
      { name: "EntityId", type: mssql.Int, value: entityId },
    ]);
    const id = rows[0]?.ID != null ? Number(rows[0].ID) : NaN;
    if (Number.isInteger(id) && id > 0) return { ok: true, borrowerId: id, created: true };

    // -1 = the account number (their phone) already exists — find who owns it.
    const found = await findBorrowerByPhone(org, entityId, args.phone, args.nationalId);
    if (found.kind === "found") return { ok: true, borrowerId: found.borrowerId, created: false };
    if (found.kind === "ambiguous") {
      return { ok: false, message: `Identity could not be confirmed at the lender: ${found.reason}` };
    }
    return { ok: false, message: "The lender's system rejected the borrower registration." };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Borrower registration failed." };
  }
}

export type PostResult = { ok: boolean; loanId?: string; code?: string; message: string };

// sp_InsertLoan signatures differ per server, which is why this is probed rather
// than assumed. Probe the proc's parameter list once per org (cached) and send
// only what it takes.
//
// Micromart's live server (100.72.35.56,4230 / Serviceconnect), read 18 Aug 2026:
//   @BorrowerId @Principal @ProductId @Entity @GurantorId @CreatedBy
//   @ActualAssetPrice @BorrowDate @ApplicationType @TransactionRef
//   @SelectedPeriod @SelectedOptionalFeeIds
//
// It takes BOTH @Entity and @TransactionRef. An earlier note here said Micromart
// had no @TransactionRef — that was true of the retired Techcrast test box, not
// of this deployment, and it matters: @TransactionRef is the join key that ties a
// booked loan back to the application that produced it. Without it the outcome
// backfill has to guess by borrower + BorrowDate. Verify with
// `npx tsx scripts/rehearse-micro-eazy.ts`, which prints this list.
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

/**
 * Post a pending loan to ServiceSuite via sp_InsertLoan (gated).
 *
 * `selectedPeriod` is the tenor the CUSTOMER chose, in the product's own repayment
 * unit. It matters on flexible-tenor products: Micromart's Micro Eazy (30219) is
 * 8.25% flat per WEEK with `RepaymentPeriod = 10` as a ceiling, and their live book
 * prices at 4–8 weeks. Omitting it makes sp_InsertLoan fall back to that ceiling —
 * 82.5% interest, the most expensive term available, on every loan we post. Pass it
 * whenever the funnel captured a term; servers whose proc predates the parameter
 * ignore it.
 */
export async function postLoan(
  org: OrgDef,
  args: { borrowerId: number; principal: number; productId: number; applicationId: string; borrowDate?: Date; selectedPeriod?: number | null },
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
    if (accepted.has("@selectedperiod") && args.selectedPeriod != null && Number.isInteger(args.selectedPeriod) && args.selectedPeriod > 0) {
      params.push({ name: "SelectedPeriod", type: mssql.Int, value: args.selectedPeriod });
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
