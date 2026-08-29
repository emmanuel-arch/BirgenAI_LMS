// ─────────────────────────────────────────────────────────────────────────────
// THE REPORT CATALOGUE — the reports Micromart and Axe already read, rebuilt.
//
// ── WHY REBUILT RATHER THAN CALLED ───────────────────────────────────────────
// ServiceSuite ships 49 reports as stored procedures and it would be less work
// to EXEC them. Two things make that impossible and a third makes it undesirable:
//
//   1. THE RELAY REFUSES PROCEDURES. Every `proc` request returns 403 — the
//      relay classes a procedure as a write, which is correct (a procedure can
//      write) and total. Nothing in production can call them.
//
//   2. THEIR REPORTS CANNOT BE ASKED FOR A BOOK. Every procedure takes
//      @userid, @startdate, @enddate, @unit, @agent — and no entity. Each one
//      opens with
//          SET @EntityId = (SELECT EntityID FROM UserMaster WHERE ID=@userid)
//      so it reports on whichever book that ServiceSuite user is CURRENTLY
//      switched into. Run as Morris (9094) they return unit 129, Main Office —
//      the fintech entity — because that is where his row happens to point
//      today. A book selector cannot be built on top of that.
//
//   3. Rebuilding is the only way to answer "is this number right?". Several of
//      theirs are not; see `divergence` on each report below.
//
// So each report here is our own read-only SQL, scoped by EntityId, returning
// the same columns a manager already recognises. `mirrors` names the procedure
// it stands in for so the parity script can hold the two side by side.
//
// SAFETY: same posture as the analytics engine. Values are bound parameters;
// identifiers are never caller-supplied; entity ids are integers from a closed
// allowlist and are the only thing interpolated.
// ─────────────────────────────────────────────────────────────────────────────
import { cbQuery, SC, P } from "@/lib/collectbox/client";
import type { QueryParam } from "@/lib/enterprise/mssql";
import type { LiveScope } from "@/lib/analytics/scope";
import type { ReportDef, ReportParams, ReportRow } from "./types";

const TX = "Transactions.dbo";
const MONEY = (c: string) => `CAST(COALESCE(${c},0) AS decimal(18,2))`;

function ents(scope: LiveScope): string {
  const ids = scope.lenses.map((l) => l.id).filter((n) => Number.isInteger(n));
  if (!ids.length) throw new Error("reporting: no entity in scope");
  return ids.join(",");
}

/** `col IN (@p0,…)` from integer ids, with the parameters to match. */
function inC(col: string, prefix: string, values: number[], params: QueryParam[]): string {
  const ok = values.filter((n) => Number.isInteger(n));
  if (!ok.length) return "";
  const names = ok.map((v, i) => { params.push(P.int(`${prefix}${i}`, v)); return `@${prefix}${i}`; });
  return ` AND ${col} IN (${names.join(",")})`;
}

/** The joins every borrower-shaped report needs. */
const JOINS = `
  JOIN ${SC}.Borrowers b             ON b.ID = l.BorrowerId
  LEFT JOIN ${SC}.Products p         ON p.ID = l.ProductId
  LEFT JOIN ${SC}.OrganizationUnits ou  ON ou.UnitId = b.EntityUnit
  LEFT JOIN ${SC}.OrganizationUnits reg ON reg.UnitId = ou.ParentUnit
  LEFT JOIN ${SC}.UserMaster s       ON s.ID = b.EntityAgent
  LEFT JOIN ${TX}.LoansInArrears ia  ON ia.LoanId = l.id`;

const FULLNAME = `LTRIM(RTRIM(CONCAT(b.firstName, ' ', COALESCE(b.otherName, ''))))`;
const OFFICER = `NULLIF(LTRIM(RTRIM(CONCAT(s.FirstName, ' ', COALESCE(s.OtherName, '')))), '')`;

function scopeWhere(scope: LiveScope, p: ReportParams, params: QueryParam[]): string {
  let w = ` WHERE l.EntityId IN (${ents(scope)})`;
  w += inC("b.EntityUnit", "br", p.branchIds, params);
  w += inC("b.EntityAgent", "of", p.officerIds, params);
  return w;
}

const dateParams = (p: ReportParams): QueryParam[] => [P.date("from", p.from), P.date("to", p.to)];

// ─────────────────────────────────────────────────────────────────────────────

export const REPORTS: ReportDef[] = [
  // ── OPERATIONS ─────────────────────────────────────────────────────────────
  {
    id: "disbursement",
    name: "Disbursement",
    category: "OPERATIONS",
    purpose: "Every loan released in the period, with who released it and against which product.",
    mirrors: "sp_DisbursmentReport",
    columns: [
      { key: "loanId", label: "Loan", format: "count" },
      { key: "borrower", label: "Customer", format: "text" },
      { key: "account", label: "Account", format: "text" },
      { key: "product", label: "Product", format: "text" },
      { key: "amount", label: "Disbursed", format: "money", total: true },
      { key: "interest", label: "Interest", format: "money", total: true },
      { key: "balance", label: "Balance", format: "money", total: true },
      { key: "branch", label: "Branch", format: "text" },
      { key: "region", label: "Region", format: "text", secondary: true },
      { key: "officer", label: "Officer", format: "text" },
      { key: "borrowDate", label: "Released", format: "date" },
      { key: "dueDate", label: "Due", format: "date", secondary: true },
    ],
    ranged: true,
    async run(scope, p) {
      const params = dateParams(p);
      const where = scopeWhere(scope, p, params);
      return cbQuery<ReportRow>(
        scope.org,
        `SELECT TOP ${p.limit}
                l.id AS loanId, ${FULLNAME} AS borrower, b.AccountNo AS account,
                COALESCE(p.ProductName,'—') AS product,
                ${MONEY("l.LoanAmount")} AS amount,
                ${MONEY("l.Interest")} AS interest,
                ${MONEY("l.LoanBalance")} AS balance,
                COALESCE(ou.UnitTitle,'Unassigned') AS branch,
                COALESCE(reg.UnitTitle, ou.UnitTitle, 'Unassigned') AS region,
                COALESCE(${OFFICER},'Unassigned') AS officer,
                l.BorrowDate AS borrowDate, l.ExpectedClearDate AS dueDate
           FROM ${SC}.Loans l ${JOINS}
           ${where} AND l.BorrowDate >= @from AND l.BorrowDate < @to
          ORDER BY l.BorrowDate DESC`,
        params, { timeoutMs: 90000, maxRows: p.limit },
      );
    },
  },
  {
    id: "olb",
    name: "Outstanding book (OLB)",
    category: "OPERATIONS",
    purpose: "Every loan still carrying a balance — what the lender is owed, right now.",
    mirrors: "sp_OlbReport",
    divergence:
      "A STOCK, so the date range does not filter it. Their OLB report takes a range and applies it, "
      + "which makes the outstanding book appear to change when you pick a different month. An outstanding "
      + "balance is what is open today regardless of when each loan was written.",
    columns: [
      { key: "loanId", label: "Loan", format: "count" },
      { key: "borrower", label: "Customer", format: "text" },
      { key: "account", label: "Account", format: "text" },
      { key: "product", label: "Product", format: "text" },
      { key: "amount", label: "Disbursed", format: "money", total: true },
      { key: "olb", label: "OLB", format: "money", total: true },
      { key: "dpd", label: "Days late", format: "days" },
      { key: "branch", label: "Branch", format: "text" },
      { key: "officer", label: "Officer", format: "text", secondary: true },
      { key: "dueDate", label: "Clear date", format: "date" },
    ],
    ranged: false,
    async run(scope, p) {
      const params: QueryParam[] = [];
      const where = scopeWhere(scope, p, params);
      return cbQuery<ReportRow>(
        scope.org,
        `SELECT TOP ${p.limit}
                l.id AS loanId, ${FULLNAME} AS borrower, b.AccountNo AS account,
                COALESCE(p.ProductName,'—') AS product,
                ${MONEY("l.LoanAmount")} AS amount,
                ${MONEY("l.LoanBalance")} AS olb,
                COALESCE(ia.DaysInArears,0) AS dpd,
                COALESCE(ou.UnitTitle,'Unassigned') AS branch,
                COALESCE(${OFFICER},'Unassigned') AS officer,
                l.ExpectedClearDate AS dueDate
           FROM ${SC}.Loans l ${JOINS}
           ${where} AND l.LoanCleared = 0 AND ${MONEY("l.LoanBalance")} > 0
          ORDER BY ${MONEY("l.LoanBalance")} DESC`,
        params, { timeoutMs: 90000, maxRows: p.limit },
      );
    },
  },
  {
    id: "loans-due",
    name: "Loans due",
    category: "OPERATIONS",
    purpose: "Instalments falling due in the period — the collection list, before it becomes arrears.",
    mirrors: "sp_LoanDueReport",
    columns: [
      { key: "loanId", label: "Loan", format: "count" },
      { key: "borrower", label: "Customer", format: "text" },
      { key: "phone", label: "Phone", format: "text" },
      { key: "installment", label: "Inst.", format: "count" },
      { key: "due", label: "Amount due", format: "money", total: true },
      { key: "paid", label: "Paid", format: "money", total: true },
      { key: "shortfall", label: "Shortfall", format: "money", total: true },
      { key: "dueDate", label: "Due date", format: "date" },
      { key: "product", label: "Product", format: "text", secondary: true },
      { key: "branch", label: "Branch", format: "text" },
      { key: "officer", label: "Officer", format: "text", secondary: true },
    ],
    ranged: true,
    async run(scope, p) {
      const params = dateParams(p);
      const where = scopeWhere(scope, p, params);
      return cbQuery<ReportRow>(
        scope.org,
        `SELECT TOP ${p.limit}
                l.id AS loanId, ${FULLNAME} AS borrower, b.PhoneNumber AS phone,
                sch.entryid AS installment,
                ${MONEY("sch.amounttopay")} AS due,
                ${MONEY("sch.AmountPaid")} AS paid,
                CASE WHEN ${MONEY("sch.amounttopay")} - ${MONEY("sch.AmountPaid")} > 0
                     THEN ${MONEY("sch.amounttopay")} - ${MONEY("sch.AmountPaid")} ELSE 0 END AS shortfall,
                sch.ExpectedDueDate AS dueDate,
                COALESCE(p.ProductName,'—') AS product,
                COALESCE(ou.UnitTitle,'Unassigned') AS branch,
                COALESCE(${OFFICER},'Unassigned') AS officer
           FROM ${SC}.LoanSchedule sch
           JOIN ${SC}.Loans l ON l.id = sch.Loanid
           ${JOINS}
           ${where} AND sch.ExpectedDueDate >= @from AND sch.ExpectedDueDate < @to
          ORDER BY sch.ExpectedDueDate, l.id`,
        params, { timeoutMs: 120000, maxRows: p.limit },
      );
    },
  },
  {
    id: "mpesa",
    name: "M-Pesa payments",
    category: "OPERATIONS",
    purpose: "Every M-Pesa receipt in the period, matched to the loan it settled.",
    mirrors: "sp_MpesaReport",
    divergence:
      "Matched through CustomerStatement.MpesaRef -> Loans, NOT by rebuilding a phone number from the "
      + "M-Pesa account field. Theirs joins Borrowers ON '254' + RIGHT(BillRefNumber, 9) = PhoneNumber, "
      + "which attaches a payment to whoever happens to hold that number — and 13 numbers exist in BOTH "
      + "Micromart books belonging to DIFFERENT people. It also silently drops every payment whose "
      + "reference is an account number rather than a phone.",
    columns: [
      { key: "receipt", label: "Receipt", format: "text" },
      { key: "paidAt", label: "Received", format: "date" },
      { key: "amount", label: "Amount", format: "money", total: true },
      { key: "payer", label: "Paid by", format: "text" },
      { key: "reference", label: "Reference", format: "text" },
      { key: "loanId", label: "Loan", format: "count" },
      { key: "borrower", label: "Customer", format: "text" },
      { key: "balanceAfter", label: "Balance after", format: "money" },
      { key: "branch", label: "Branch", format: "text" },
      { key: "officer", label: "Officer", format: "text", secondary: true },
    ],
    ranged: true,
    async run(scope, p) {
      const params = dateParams(p);
      const params2: QueryParam[] = [];
      const where = scopeWhere(scope, p, params2);
      params.push(...params2);
      return cbQuery<ReportRow>(
        scope.org,
        `SELECT TOP ${p.limit}
                cs.MpesaRef AS receipt, cs.TransactedDate AS paidAt,
                ${MONEY("cs.Amount")} AS amount,
                COALESCE(pay.FirstName,'—') AS payer,
                COALESCE(pay.BillRefNumber,'—') AS reference,
                cs.LoanId AS loanId, ${FULLNAME} AS borrower,
                ${MONEY("cs.LoanBalance")} AS balanceAfter,
                COALESCE(ou.UnitTitle,'Unassigned') AS branch,
                COALESCE(${OFFICER},'Unassigned') AS officer
           FROM ${SC}.CustomerStatement cs
           JOIN ${SC}.Loans l ON l.id = cs.LoanId
           ${JOINS}
           LEFT JOIN ${TX}.payments pay ON pay.TransID = cs.MpesaRef
           ${where} AND cs.TransactedDate >= @from AND cs.TransactedDate < @to
             AND cs.MpesaRef IS NOT NULL AND ${MONEY("cs.Amount")} > 0
          ORDER BY cs.TransactedDate DESC`,
        params, { timeoutMs: 120000, maxRows: p.limit },
      );
    },
  },
  {
    id: "customers",
    name: "List of customers",
    category: "OPERATIONS",
    purpose: "The borrower register for this book, with score, limit and who owns the relationship.",
    mirrors: "sp_ListOfBorrowersReport",
    columns: [
      { key: "borrowerId", label: "ID", format: "count" },
      { key: "borrower", label: "Customer", format: "text" },
      { key: "phone", label: "Phone", format: "text" },
      { key: "nationalId", label: "National ID", format: "text", secondary: true },
      { key: "score", label: "Score", format: "count" },
      { key: "risk", label: "Risk band", format: "text" },
      { key: "limit", label: "Limit", format: "money" },
      { key: "loans", label: "Loans", format: "count", total: true },
      { key: "olb", label: "OLB", format: "money", total: true },
      { key: "branch", label: "Branch", format: "text" },
      { key: "officer", label: "Officer", format: "text", secondary: true },
      { key: "since", label: "Registered", format: "date" },
    ],
    ranged: false,
    async run(scope, p) {
      const params: QueryParam[] = [];
      let where = ` WHERE b.EntityId IN (${ents(scope)})`;
      where += inC("b.EntityUnit", "br", p.branchIds, params);
      where += inC("b.EntityAgent", "of", p.officerIds, params);
      return cbQuery<ReportRow>(
        scope.org,
        `SELECT TOP ${p.limit}
                b.ID AS borrowerId, ${FULLNAME} AS borrower, b.PhoneNumber AS phone,
                b.NationalID AS nationalId,
                CAST(COALESCE(b.CreditScore,0) AS int) AS score,
                COALESCE(NULLIF(LTRIM(RTRIM(b.RiskCategory)),''),'Unscored') AS risk,
                ${MONEY("b.LoanLimit")} AS [limit],
                (SELECT COUNT(*) FROM ${SC}.Loans lx WHERE lx.BorrowerId = b.ID) AS loans,
                (SELECT COALESCE(SUM(${MONEY("lx.LoanBalance")}),0) FROM ${SC}.Loans lx
                  WHERE lx.BorrowerId = b.ID AND lx.LoanCleared = 0) AS olb,
                COALESCE(ou.UnitTitle,'Unassigned') AS branch,
                COALESCE(${OFFICER},'Unassigned') AS officer,
                b.CreatedDate AS since
           FROM ${SC}.Borrowers b
           LEFT JOIN ${SC}.OrganizationUnits ou ON ou.UnitId = b.EntityUnit
           LEFT JOIN ${SC}.UserMaster s ON s.ID = b.EntityAgent
           ${where}
          ORDER BY b.CreatedDate DESC`,
        params, { timeoutMs: 120000, maxRows: p.limit },
      );
    },
  },

  // ── RISK ───────────────────────────────────────────────────────────────────
  {
    id: "arrears",
    name: "Arrears",
    category: "RISK",
    purpose: "Every loan behind on its schedule, worst first, with how far behind and by how much.",
    mirrors: "sp_arrearsLoans",
    divergence:
      "A STOCK of everything currently in arrears, not a slice of the date range. Theirs applies the "
      + "range and returned ONE row for a 30-day window on a book carrying 64,238 loans more than "
      + "30 days past due. Arrears are a position, not an event.",
    columns: [
      { key: "loanId", label: "Loan", format: "count" },
      { key: "borrower", label: "Customer", format: "text" },
      { key: "phone", label: "Phone", format: "text" },
      { key: "dpd", label: "Days late", format: "days" },
      { key: "arrears", label: "In arrears", format: "money", total: true },
      { key: "olb", label: "OLB", format: "money", total: true },
      { key: "amount", label: "Disbursed", format: "money", total: true, secondary: true },
      { key: "product", label: "Product", format: "text", secondary: true },
      { key: "branch", label: "Branch", format: "text" },
      { key: "officer", label: "Officer", format: "text" },
      { key: "dueDate", label: "Was due", format: "date" },
    ],
    ranged: false,
    async run(scope, p) {
      const params: QueryParam[] = [];
      const where = scopeWhere(scope, p, params);
      return cbQuery<ReportRow>(
        scope.org,
        `SELECT TOP ${p.limit}
                l.id AS loanId, ${FULLNAME} AS borrower, b.PhoneNumber AS phone,
                COALESCE(ia.DaysInArears,0) AS dpd,
                ${MONEY("ia.AmountInArrears")} AS arrears,
                ${MONEY("l.LoanBalance")} AS olb,
                ${MONEY("l.LoanAmount")} AS amount,
                COALESCE(p.ProductName,'—') AS product,
                COALESCE(ou.UnitTitle,'Unassigned') AS branch,
                COALESCE(${OFFICER},'Unassigned') AS officer,
                l.ExpectedClearDate AS dueDate
           FROM ${SC}.Loans l ${JOINS}
           ${where} AND l.LoanCleared = 0 AND ${MONEY("l.LoanBalance")} > 0
             AND COALESCE(ia.DaysInArears,0) > 0
          ORDER BY COALESCE(ia.DaysInArears,0) DESC, ${MONEY("l.LoanBalance")} DESC`,
        params, { timeoutMs: 120000, maxRows: p.limit },
      );
    },
  },
  {
    id: "par-branch",
    name: "PAR by branch",
    category: "RISK",
    purpose: "Portfolio at risk per office — where the book is going bad, and how fast.",
    mirrors: "sp_parperbranchReport",
    columns: [
      { key: "branch", label: "Branch", format: "text" },
      { key: "region", label: "Region", format: "text" },
      { key: "loans", label: "Open loans", format: "count", total: true },
      { key: "olb", label: "OLB", format: "money", total: true },
      { key: "par1", label: "PAR 1+", format: "money", total: true, secondary: true },
      { key: "par30", label: "PAR 30", format: "money", total: true },
      { key: "par90", label: "PAR 90", format: "money", total: true },
      { key: "par30Pct", label: "PAR 30 %", format: "percent" },
      { key: "par90Pct", label: "PAR 90 %", format: "percent" },
    ],
    ranged: false,
    async run(scope, p) {
      const params: QueryParam[] = [];
      const where = scopeWhere(scope, p, params);
      const bal = MONEY("l.LoanBalance");
      return cbQuery<ReportRow>(
        scope.org,
        `SELECT TOP ${p.limit}
                COALESCE(ou.UnitTitle,'Unassigned') AS branch,
                COALESCE(reg.UnitTitle, ou.UnitTitle, 'Unassigned') AS region,
                COUNT(*) AS loans,
                SUM(${bal}) AS olb,
                SUM(CASE WHEN COALESCE(ia.DaysInArears,0) > 0  THEN ${bal} ELSE 0 END) AS par1,
                SUM(CASE WHEN COALESCE(ia.DaysInArears,0) > 30 THEN ${bal} ELSE 0 END) AS par30,
                SUM(CASE WHEN COALESCE(ia.DaysInArears,0) > 90 THEN ${bal} ELSE 0 END) AS par90,
                CASE WHEN SUM(${bal}) > 0 THEN 100.0 * SUM(CASE WHEN COALESCE(ia.DaysInArears,0) > 30 THEN ${bal} ELSE 0 END) / SUM(${bal}) ELSE 0 END AS par30Pct,
                CASE WHEN SUM(${bal}) > 0 THEN 100.0 * SUM(CASE WHEN COALESCE(ia.DaysInArears,0) > 90 THEN ${bal} ELSE 0 END) / SUM(${bal}) ELSE 0 END AS par90Pct
           FROM ${SC}.Loans l ${JOINS}
           ${where} AND l.LoanCleared = 0 AND ${bal} > 0
          GROUP BY COALESCE(ou.UnitTitle,'Unassigned'), COALESCE(reg.UnitTitle, ou.UnitTitle, 'Unassigned')
          ORDER BY 6 DESC`,
        params, { timeoutMs: 120000, maxRows: p.limit },
      );
    },
  },
  {
    id: "npl",
    name: "Non-performing loans",
    category: "RISK",
    purpose: "Loans more than 90 days past due — the provisioning line.",
    mirrors: "sp_NplReport",
    columns: [
      { key: "loanId", label: "Loan", format: "count" },
      { key: "borrower", label: "Customer", format: "text" },
      { key: "phone", label: "Phone", format: "text" },
      { key: "dpd", label: "Days late", format: "days" },
      { key: "olb", label: "OLB", format: "money", total: true },
      { key: "arrears", label: "In arrears", format: "money", total: true },
      { key: "branch", label: "Branch", format: "text" },
      { key: "officer", label: "Officer", format: "text" },
      { key: "borrowDate", label: "Released", format: "date", secondary: true },
    ],
    ranged: false,
    async run(scope, p) {
      const params: QueryParam[] = [];
      const where = scopeWhere(scope, p, params);
      return cbQuery<ReportRow>(
        scope.org,
        `SELECT TOP ${p.limit}
                l.id AS loanId, ${FULLNAME} AS borrower, b.PhoneNumber AS phone,
                COALESCE(ia.DaysInArears,0) AS dpd,
                ${MONEY("l.LoanBalance")} AS olb,
                ${MONEY("ia.AmountInArrears")} AS arrears,
                COALESCE(ou.UnitTitle,'Unassigned') AS branch,
                COALESCE(${OFFICER},'Unassigned') AS officer,
                l.BorrowDate AS borrowDate
           FROM ${SC}.Loans l ${JOINS}
           ${where} AND l.LoanCleared = 0 AND ${MONEY("l.LoanBalance")} > 0
             AND COALESCE(ia.DaysInArears,0) > 90
          ORDER BY ${MONEY("l.LoanBalance")} DESC`,
        params, { timeoutMs: 120000, maxRows: p.limit },
      );
    },
  },

  // ── COLLECTIONS ────────────────────────────────────────────────────────────
  {
    id: "collection-rate",
    name: "Collection report",
    category: "COLLECTIONS",
    purpose: "What fell due against what came in, per branch — the collection rate, and its two halves.",
    mirrors: "proc_rptCollectionReportSummary",
    divergence:
      "The rate is COLLECTED / DUE over the same period and the same loans, and both halves are printed "
      + "beside it so the ratio can be checked by eye. Theirs returns a CollectionRate with the "
      + "components in separate columns that do not reconcile to it.",
    columns: [
      { key: "branch", label: "Branch", format: "text" },
      { key: "region", label: "Region", format: "text", secondary: true },
      { key: "due", label: "Fell due", format: "money", total: true },
      { key: "collected", label: "Collected", format: "money", total: true },
      { key: "shortfall", label: "Shortfall", format: "money", total: true },
      { key: "rate", label: "Collection rate", format: "percent" },
      { key: "payments", label: "Payments", format: "count", total: true },
      { key: "payers", label: "Customers paying", format: "count", total: true },
    ],
    ranged: true,
    async run(scope, p) {
      const params = dateParams(p);
      const params2: QueryParam[] = [];
      const where = scopeWhere(scope, p, params2);
      params.push(...params2);
      const e = ents(scope);
      return cbQuery<ReportRow>(
        scope.org,
        `WITH due AS (
           SELECT COALESCE(ou.UnitTitle,'Unassigned') AS branch,
                  COALESCE(reg.UnitTitle, ou.UnitTitle, 'Unassigned') AS region,
                  SUM(${MONEY("sch.amounttopay")}) AS due
             FROM ${SC}.LoanSchedule sch
             JOIN ${SC}.Loans l ON l.id = sch.Loanid
             ${JOINS}
             ${where} AND sch.ExpectedDueDate >= @from AND sch.ExpectedDueDate < @to
            GROUP BY COALESCE(ou.UnitTitle,'Unassigned'), COALESCE(reg.UnitTitle, ou.UnitTitle, 'Unassigned')
         ),
         paid AS (
           SELECT COALESCE(ou.UnitTitle,'Unassigned') AS branch,
                  SUM(${MONEY("cs.Amount")}) AS collected,
                  COUNT(*) AS payments,
                  COUNT(DISTINCT l.BorrowerId) AS payers
             FROM ${SC}.CustomerStatement cs
             JOIN ${SC}.Loans l ON l.id = cs.LoanId
             ${JOINS}
             ${where} AND cs.TransactedDate >= @from AND cs.TransactedDate < @to
               AND ${MONEY("cs.Amount")} > 0
            GROUP BY COALESCE(ou.UnitTitle,'Unassigned')
         )
         SELECT TOP ${p.limit}
                COALESCE(due.branch, paid.branch) AS branch,
                COALESCE(due.region,'—') AS region,
                COALESCE(due.due,0) AS due,
                COALESCE(paid.collected,0) AS collected,
                CASE WHEN COALESCE(due.due,0) - COALESCE(paid.collected,0) > 0
                     THEN COALESCE(due.due,0) - COALESCE(paid.collected,0) ELSE 0 END AS shortfall,
                CASE WHEN COALESCE(due.due,0) > 0
                     THEN 100.0 * COALESCE(paid.collected,0) / due.due ELSE NULL END AS rate,
                COALESCE(paid.payments,0) AS payments,
                COALESCE(paid.payers,0) AS payers
           FROM due FULL OUTER JOIN paid ON paid.branch = due.branch
          WHERE COALESCE(due.due,0) > 0 OR COALESCE(paid.collected,0) > 0
          ORDER BY COALESCE(due.due,0) DESC`,
        params, { timeoutMs: 180000, maxRows: p.limit },
      ).then((rows) => rows.map((r) => ({ ...r, _entities: e })) as ReportRow[]);
    },
  },

  // ── EXECUTIVE (ours) ───────────────────────────────────────────────────────
  {
    id: "vintage",
    name: "Vintage analysis",
    category: "EXECUTIVE",
    purpose:
      "Does the business written last quarter behave like the quarter before it? Each month's intake, "
      + "followed forward — the one report that shows credit standards slipping and dates the slip.",
    mirrors: null,
    columns: [
      { key: "cohort", label: "Month written", format: "text" },
      { key: "loans", label: "Loans", format: "count", total: true },
      { key: "borrowers", label: "Customers", format: "count", total: true },
      { key: "newBorrowers", label: "First-time", format: "count", total: true },
      { key: "disbursed", label: "Disbursed", format: "money", total: true },
      { key: "avgLoan", label: "Average loan", format: "money" },
      { key: "cleared", label: "Cleared", format: "count", total: true },
      { key: "clearedPct", label: "Cleared %", format: "percent" },
      { key: "openBalance", label: "Still open", format: "money", total: true },
      { key: "par30", label: "PAR 30", format: "money", total: true },
      { key: "par30Pct", label: "PAR 30 %", format: "percent" },
    ],
    ranged: true,
    async run(scope, p) {
      const params = dateParams(p);
      const e = ents(scope);
      const bal = MONEY("l.LoanBalance");
      const amt = MONEY("l.LoanAmount");
      return cbQuery<ReportRow>(
        scope.org,
        `WITH firstLoan AS (
           SELECT BorrowerId, MIN(BorrowDate) AS firstAt
             FROM ${SC}.Loans WHERE EntityId IN (${e}) GROUP BY BorrowerId
         )
         SELECT TOP ${p.limit}
                CONVERT(varchar(7), DATEFROMPARTS(YEAR(l.BorrowDate), MONTH(l.BorrowDate), 1), 126) AS cohort,
                COUNT(*) AS loans,
                COUNT(DISTINCT l.BorrowerId) AS borrowers,
                COUNT(DISTINCT CASE WHEN fl.firstAt >= DATEFROMPARTS(YEAR(l.BorrowDate), MONTH(l.BorrowDate), 1)
                                     AND fl.firstAt <  DATEADD(month,1,DATEFROMPARTS(YEAR(l.BorrowDate), MONTH(l.BorrowDate), 1))
                                THEN l.BorrowerId END) AS newBorrowers,
                SUM(${amt}) AS disbursed,
                AVG(${amt}) AS avgLoan,
                SUM(CASE WHEN l.LoanCleared = 1 THEN 1 ELSE 0 END) AS cleared,
                CASE WHEN COUNT(*) > 0 THEN 100.0 * SUM(CASE WHEN l.LoanCleared = 1 THEN 1 ELSE 0 END) / COUNT(*) ELSE 0 END AS clearedPct,
                SUM(CASE WHEN l.LoanCleared = 0 THEN ${bal} ELSE 0 END) AS openBalance,
                SUM(CASE WHEN COALESCE(ia.DaysInArears,0) > 30 THEN ${bal} ELSE 0 END) AS par30,
                CASE WHEN SUM(CASE WHEN l.LoanCleared = 0 THEN ${bal} ELSE 0 END) > 0
                     THEN 100.0 * SUM(CASE WHEN COALESCE(ia.DaysInArears,0) > 30 THEN ${bal} ELSE 0 END)
                          / SUM(CASE WHEN l.LoanCleared = 0 THEN ${bal} ELSE 0 END) ELSE 0 END AS par30Pct
           FROM ${SC}.Loans l
           JOIN firstLoan fl ON fl.BorrowerId = l.BorrowerId
           LEFT JOIN ${TX}.LoansInArrears ia ON ia.LoanId = l.id
          WHERE l.EntityId IN (${e}) AND l.BorrowDate >= @from AND l.BorrowDate < @to
          GROUP BY DATEFROMPARTS(YEAR(l.BorrowDate), MONTH(l.BorrowDate), 1)
          ORDER BY 1 DESC`,
        params, { timeoutMs: 150000, maxRows: p.limit },
      );
    },
  },
  {
    id: "officer-book",
    name: "Officer book",
    category: "EXECUTIVE",
    purpose: "Every relationship officer's book: what they wrote, what they are owed, and what is late.",
    mirrors: "sp_cl_perAgent",
    columns: [
      { key: "officer", label: "Officer", format: "text" },
      { key: "branch", label: "Branch", format: "text" },
      { key: "customers", label: "Customers", format: "count", total: true },
      { key: "loans", label: "Open loans", format: "count", total: true },
      { key: "olb", label: "OLB", format: "money", total: true },
      { key: "written", label: "Written in period", format: "money", total: true },
      { key: "par30", label: "PAR 30", format: "money", total: true },
      { key: "par30Pct", label: "PAR 30 %", format: "percent" },
    ],
    ranged: true,
    async run(scope, p) {
      const params = dateParams(p);
      const params2: QueryParam[] = [];
      const where = scopeWhere(scope, p, params2);
      params.push(...params2);
      const bal = MONEY("l.LoanBalance");
      return cbQuery<ReportRow>(
        scope.org,
        `SELECT TOP ${p.limit}
                COALESCE(${OFFICER},'Unassigned') AS officer,
                COALESCE(ou.UnitTitle,'Unassigned') AS branch,
                COUNT(DISTINCT l.BorrowerId) AS customers,
                SUM(CASE WHEN l.LoanCleared = 0 AND ${bal} > 0 THEN 1 ELSE 0 END) AS loans,
                SUM(CASE WHEN l.LoanCleared = 0 THEN ${bal} ELSE 0 END) AS olb,
                SUM(CASE WHEN l.BorrowDate >= @from AND l.BorrowDate < @to THEN ${MONEY("l.LoanAmount")} ELSE 0 END) AS written,
                SUM(CASE WHEN COALESCE(ia.DaysInArears,0) > 30 AND l.LoanCleared = 0 THEN ${bal} ELSE 0 END) AS par30,
                CASE WHEN SUM(CASE WHEN l.LoanCleared = 0 THEN ${bal} ELSE 0 END) > 0
                     THEN 100.0 * SUM(CASE WHEN COALESCE(ia.DaysInArears,0) > 30 AND l.LoanCleared = 0 THEN ${bal} ELSE 0 END)
                          / SUM(CASE WHEN l.LoanCleared = 0 THEN ${bal} ELSE 0 END) ELSE 0 END AS par30Pct
           FROM ${SC}.Loans l ${JOINS}
           ${where}
          GROUP BY COALESCE(${OFFICER},'Unassigned'), COALESCE(ou.UnitTitle,'Unassigned')
          ORDER BY 5 DESC`,
        params, { timeoutMs: 150000, maxRows: p.limit },
      );
    },
  },
];

export function reportById(id: string): ReportDef | null {
  return REPORTS.find((r) => r.id === id) ?? null;
}

/** Grouped for the browser, in the order a lender reads a business. */
export const CATEGORY_ORDER: Array<ReportDef["category"]> = [
  "OPERATIONS", "RISK", "COLLECTIONS", "FINANCE", "EXECUTIVE",
];
