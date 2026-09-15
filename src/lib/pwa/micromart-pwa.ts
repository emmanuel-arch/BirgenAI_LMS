// ─────────────────────────────────────────────────────────────────────────────
// THE MICROMART CUSTOMER PWA'S LOAN ROAD — quote and apply WITH A CHOSEN PERIOD.
//
// Micromart's customer PWA (portal.servicesuitecloud.com) talks to Micromart's
// public API for everything. That API cannot do one thing the lender's own
// officer portal does: let the customer choose how many weeks to repay over.
// Verified 15 Sep 2026 with a real 3005 session — LoanPreview returned 10 weekly
// instalments for every spelling of a period field (selectedPeriod, period,
// repaymentPeriod, installments), so LoanApplicationValidation would book every
// loan at the product's ceiling: 82.5% interest on a 10-week Micro Eazy.
//
// So these two calls run the SAME procedures ServiceSuite-Portal's
// /Loans/application runs, over the relay:
//
//   quote   sp_LoanCalculator @SelectedPeriod               (read)
//   apply   sp_ValidateLoanApplication, then sp_InsertLoan
//           @SelectedPeriod via postLoan()                  (write, LMS_POSTING_ENABLED)
//
// sp_InsertLoan takes the workflow from the PRODUCT (Products.WorkflowId, or
// repeatWorkflowId for a repeat borrower) and parks the loan at its first stage —
// for every Micromart Fintech product that is workflow 1022, "Micro Eazy":
// Risk → Customer Service. apply reads the new loan back to prove it.
//
// ── WHO IS ASKING ───────────────────────────────────────────────────────────
// The customer is proven by the Micromart session they already hold, never by
// an id in the request: the bearer token goes to Micromart's own
// LoanApplicationPreview, which answers only for a valid, unexpired token (a
// tampered one is a 401) and names the borrower it belongs to. Verified: using
// the token does not rotate or invalidate it, so this check does not sign the
// customer out of their own app. The borrower must be on 3005 — this road is
// Micromart Fintech only, like the PWA.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";
import { mssql, runReadOnlyQuery } from "@/lib/enterprise/mssql";
import { getOrg, getPostingOrg } from "@/lib/enterprise/connections";
import { postLoan } from "@/lib/lms/servicesuite";

const MICROMART_API = "https://micromartafrica.co.ke/MicromartAPI/Mobile/Application";

/** The one book this road serves. */
export const PWA_ENTITY_ID = 3005;

export type PwaCustomer = { borrowerId: number; accountNo: string; loanLimit: number; savings: number };

type Fail = { ok: false; status: number; reason: string; message: string };

const readOrg = () => getOrg("micromart")!;
const q = (sql: string, params: { name: string; type: unknown; value: unknown }[], maxRows = 50) =>
  runReadOnlyQuery(readOrg(), sql, params as never, { timeoutMs: 25_000, maxRows }).then((r) => r.rows);

// A slider drags through many quotes; one Micromart round trip per token is enough.
const customerCache = new Map<string, { at: number; customer: PwaCustomer }>();
const CUSTOMER_TTL_MS = 2 * 60_000;

/** The Micromart session behind this request, or why there is none. */
export async function verifyCustomer(req: Request): Promise<{ ok: true; customer: PwaCustomer } | Fail> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token || token.length < 20) return { ok: false, status: 401, reason: "session", message: "Please sign in again." };

  const key = createHash("sha256").update(token).digest("hex");
  const hit = customerCache.get(key);
  if (hit && Date.now() - hit.at < CUSTOMER_TTL_MS) return { ok: true, customer: hit.customer };

  let row: Record<string, unknown> | undefined;
  try {
    const res = await fetch(`${MICROMART_API}/LoanApplicationPreview`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 401 || res.status === 403) return { ok: false, status: 401, reason: "session", message: "Your session has ended. Please sign in again." };
    if (!res.ok) return { ok: false, status: 502, reason: "unreachable", message: "We could not reach Micromart just now. Please try again." };
    const data = await res.json();
    row = (Array.isArray(data) ? data[0] : data?.Table?.[0]) as Record<string, unknown> | undefined;
  } catch {
    return { ok: false, status: 502, reason: "unreachable", message: "We could not reach Micromart just now. Please try again." };
  }

  const borrowerId = Number(row?.ID);
  if (!Number.isInteger(borrowerId) || borrowerId <= 0) return { ok: false, status: 401, reason: "session", message: "Please sign in again." };

  // The book, from Micromart's own table — not from anything the handset sent.
  const [b] = await q(`SELECT EntityId, AccountNo, AccountStatus FROM Borrowers WHERE ID = @id`, [{ name: "id", type: mssql.Int, value: borrowerId }], 1);
  if (!b || Number(b.EntityId) !== PWA_ENTITY_ID) {
    return { ok: false, status: 403, reason: "entity", message: "This app serves Micromart Fintech customers. Please contact customer support on 0740961275." };
  }

  const customer: PwaCustomer = {
    borrowerId,
    accountNo: String(b.AccountNo ?? row?.AccountNo ?? ""),
    loanLimit: Number(row?.LoanLimit ?? 0),
    savings: Number(row?.Savings ?? 0),
  };
  customerCache.set(key, { at: Date.now(), customer });
  return { ok: true, customer };
}

export type PwaProduct = {
  id: number;
  name: string;
  minPrincipal: number;
  maxPrincipal: number;
  /** The product's ceiling, in its own repayment unit. */
  repaymentPeriod: number;
  /** DurationOptions: 1 day · 2 week · 3 month. */
  repaymentPeriodType: number;
  unit: string;
  workflowId: number | null;
  /** The officer portal offers the choice only on USSD/mobile products with more than one period. */
  periodChoice: boolean;
};

/** A product this road may quote and book: on 3005, active. */
export async function servedProduct(productId: number): Promise<PwaProduct | null> {
  if (!Number.isInteger(productId) || productId <= 0) return null;
  const [p] = await q(
    `SELECT P.ID, P.ProductName, P.MinPrincipal, P.MaxPrincipal, P.RepaymentPeriod, P.RepaymentPeriodType,
            D.duratioName AS unit, P.WorkflowId, P.IsUssdMobileEnabled
       FROM Products P LEFT JOIN DurationOptions D ON D.ID = P.RepaymentPeriodType
      WHERE P.ID = @pid AND P.EntityId = @eid AND P.IsActive = 1`,
    [
      { name: "pid", type: mssql.Int, value: productId },
      { name: "eid", type: mssql.Int, value: PWA_ENTITY_ID },
    ],
    1,
  );
  if (!p) return null;
  const period = Math.max(1, Number(p.RepaymentPeriod) || 1);
  return {
    id: Number(p.ID),
    name: String(p.ProductName ?? "").trim(),
    minPrincipal: Number(p.MinPrincipal ?? 0),
    maxPrincipal: Number(p.MaxPrincipal ?? 0),
    repaymentPeriod: period,
    repaymentPeriodType: Number(p.RepaymentPeriodType) || 2,
    unit: String(p.unit ?? "Week").trim() || "Week",
    workflowId: p.WorkflowId != null ? Number(p.WorkflowId) : null,
    periodChoice: Boolean(p.IsUssdMobileEnabled) && period > 1,
  };
}

/** Principal and period checked against the product and the customer's limit. */
export function checkTerms(product: PwaProduct, customer: PwaCustomer, principal: number, period: number): Fail | null {
  if (!Number.isFinite(principal) || principal <= 0) return { ok: false, status: 400, reason: "amount", message: "Enter the amount you would like to borrow." };
  if (principal < product.minPrincipal) {
    return { ok: false, status: 400, reason: "amount", message: `The smallest ${product.name} loan is Ksh ${product.minPrincipal.toLocaleString("en-KE")}.` };
  }
  const ceiling = Math.min(product.maxPrincipal > 0 ? product.maxPrincipal : Infinity, customer.loanLimit > 0 ? customer.loanLimit : Infinity);
  if (principal > ceiling) {
    return { ok: false, status: 400, reason: "amount", message: `You can borrow up to Ksh ${ceiling.toLocaleString("en-KE")} on ${product.name}.` };
  }
  const max = product.repaymentPeriod;
  if (!Number.isInteger(period) || period < 1 || period > max || (!product.periodChoice && period !== max)) {
    return {
      ok: false, status: 400, reason: "period",
      message: product.periodChoice ? `${product.name} is repaid over 1 to ${max} ${product.unit.toLowerCase()}s.` : `${product.name} is repaid over ${max} ${product.unit.toLowerCase()}${max === 1 ? "" : "s"}.`,
    };
  }
  return null;
}

/** Today in Nairobi, as the date the lender's server stamps a loan with. */
function nairobiToday(): string {
  return new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
}

const toCents = (v: unknown) => Math.round(Number(v) * 100);
/** DECIMAL(18,2) assignment: round half away from zero. */
const roundCents = (x: number) => Math.sign(x) * Math.round(Math.abs(x));

/** SQL Server DATEADD on a calendar date (month steps clamp to the month's last day). */
function dateAdd(unit: number, n: number, ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (unit === 3) {
    const target = new Date(Date.UTC(y, m - 1 + n, 1));
    const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(d, last));
    return target.toISOString().slice(0, 10);
  }
  const days = unit === 1 ? n : 7 * n;
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const dmy = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;

export type PwaQuote = {
  /** The same columns Micromart's LoanPreview answers with, so the PWA renders it unchanged. */
  Table: Record<string, unknown>[];
  Table1: { InstallmentNumber: number; InstallmentPrinciple: number; InstallmentInterest: number; InstallmentAmount: number; InstallmentAmountFormated: string; DueDate: string; DueDateFormated: string }[];
  period: number;
};

/**
 * sp_LoanCalculator with the customer's period.
 *
 * The relay carries a procedure's FIRST result set only, and the schedule is the
 * second. It is rebuilt here from the first with the procedure's own loop
 * (sp_LoanCalculator lines 294–346, read 15 Sep 2026): the loan amount in equal
 * instalments of InstallmentAmount until it is repaid, the first due one unit
 * after the borrow date and each next one a unit after the last.
 */
export async function quoteLoan(product: PwaProduct, principal: number, period: number): Promise<PwaQuote> {
  const borrowDate = nairobiToday();
  const [row] = await q(
    `EXEC dbo.sp_LoanCalculator @productId = @pid, @Principle = @amt, @BorrowDate = @bd, @SelectedPeriod = @per`,
    [
      { name: "pid", type: mssql.Int, value: product.id },
      { name: "amt", type: mssql.Decimal(18, 2), value: principal },
      { name: "bd", type: mssql.NVarChar(10), value: borrowDate },
      { name: "per", type: mssql.Int, value: period },
    ],
    1,
  );
  if (!row) throw new Error("The loan calculator returned nothing.");

  const loan = toCents(row.LoanAmount);
  let each = toCents(row.InstallmentAmount);
  const perPrinciple = roundCents(toCents(row.Principle) / period) / 100;
  const perInterest = roundCents(toCents(row.InterestAmount) / period) / 100;
  const currency = String(row.InstallmentAmountFormated ?? "Ksh ").replace(/[\d.,\s]+$/, "") || "Ksh";
  const money = (cents: number) => `${currency}${currency.endsWith(" ") ? "" : " "}${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const schedule: PwaQuote["Table1"] = [];
  let remaining = loan;
  let due = dateAdd(product.repaymentPeriodType, 1, borrowDate);
  for (let n = 1; remaining > 0 && each > 0 && n <= period + 2; n++) {
    schedule.push({
      InstallmentNumber: n,
      InstallmentPrinciple: perPrinciple,
      InstallmentInterest: perInterest,
      InstallmentAmount: each / 100,
      InstallmentAmountFormated: money(each),
      DueDate: due,
      DueDateFormated: dmy(due),
    });
    remaining -= each;
    if (remaining < 0) { each += remaining; remaining = 0; }
    due = dateAdd(product.repaymentPeriodType, 1, due);
  }

  return { Table: [row], Table1: schedule, period };
}

export type PwaApplyResult =
  | { ok: true; loanId: string; message: string; stage: string | null; workflowId: number | null; selectedPeriod: number | null; approved: boolean }
  | Fail;

/** In-flight applications on this instance, so a double tap is one loan. */
const inFlight = new Set<number>();

/**
 * Validate with the lender's own gate, then book with the chosen period.
 * Never retried: a booking that did not answer may still have been written.
 */
export async function applyLoan(customer: PwaCustomer, product: PwaProduct, principal: number, period: number): Promise<PwaApplyResult> {
  if (inFlight.has(customer.borrowerId)) {
    return { ok: false, status: 409, reason: "in-flight", message: "Your application is already being filed. Please wait a moment." };
  }
  inFlight.add(customer.borrowerId);
  try {
    // The same gate ServiceSuite-Portal's new-loan form runs first: account on
    // this entity, active, no running loan, within the limit, upfront charges
    // covered by savings.
    const [v] = await q(
      `EXEC dbo.sp_ValidateLoanApplication @AccountNo = @acc, @EntityId = @eid, @ProductId = @pid, @Principle = @amt, @BorrowerType = 1, @LoanApplicationType = 1`,
      [
        { name: "acc", type: mssql.VarChar(50), value: customer.accountNo },
        { name: "eid", type: mssql.Int, value: PWA_ENTITY_ID },
        { name: "pid", type: mssql.Int, value: product.id },
        { name: "amt", type: mssql.Decimal(18, 2), value: principal },
      ],
      1,
    );
    if (!v) return { ok: false, status: 502, reason: "unreachable", message: "We could not check your application just now. Please try again." };
    if (String(v.Code) !== "200") return { ok: false, status: 409, reason: "declined", message: String(v.Response ?? "Your application could not be accepted.") };
    if (Number(v.BorrowerId) !== customer.borrowerId) {
      return { ok: false, status: 409, reason: "account", message: "Your account details do not match. Please contact customer support on 0740961275." };
    }

    const org = getPostingOrg("micromart");
    if (!org) return { ok: false, status: 503, reason: "unavailable", message: "Applications are not available just now. Please try again later." };

    const posted = await postLoan(org, {
      borrowerId: customer.borrowerId,
      principal,
      productId: product.id,
      applicationId: `PWA-${Date.now().toString(36)}-${customer.borrowerId}`,
      selectedPeriod: period,
    });
    if (!posted.ok || !posted.loanId) {
      return { ok: false, status: posted.code ? 409 : 502, reason: "declined", message: posted.message || "Your application could not be filed." };
    }

    // Read the loan back: where did it land, and at what period?
    const [l] = await q(
      `SELECT L.ApprovalStage, L.isApproved, L.SelectedPeriod, S.Title, S.WorkflowID
         FROM Loans L LEFT JOIN ApprovalWorkflowStage S ON S.ID = L.ApprovalStage
        WHERE L.id = @id`,
      [{ name: "id", type: mssql.Int, value: Number(posted.loanId) }],
      1,
    ).catch(() => [] as Record<string, unknown>[]);

    return {
      ok: true,
      loanId: posted.loanId,
      message: posted.message,
      stage: l?.Title != null ? String(l.Title).trim() : null,
      workflowId: l?.WorkflowID != null ? Number(l.WorkflowID) : null,
      selectedPeriod: l?.SelectedPeriod != null ? Number(l.SelectedPeriod) : null,
      approved: Number(l?.isApproved) === 1,
    };
  } finally {
    inFlight.delete(customer.borrowerId);
  }
}
