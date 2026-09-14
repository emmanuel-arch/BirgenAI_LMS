// ─────────────────────────────────────────────────────────────────────────────
// THE CUSTOMER'S POSITION, READ FROM THE LENDER'S BOOK OVER SQL.
//
// ── WHY HOME SAID "WE COULD NOT REACH MICROMART" TO EVERYBODY ON THE CODE DOOR ─
// Home read the balance through Micromart's public AccountPreview, and that
// endpoint needs the bearer token only the PASSWORD door ever receives. A
// customer who came in by SMS code — every new customer, and any existing one
// who chose the code — held no token, so the branch that reads the book never
// ran, `bookSource` stayed "unavailable", and the screen told them their lender
// was down. It was not down: the console was reading the same book, live, over
// the relay, in the same minute.
//
// So the book is read the way the console reads it — keyed SQL through the
// relay — and the public API is only the fallback for a password session whose
// SQL read failed. One road for the counter and the app means the two can never
// show a customer different figures.
//
// ── WHO THEY ARE IN THE BOOK ────────────────────────────────────────────────
// The ServiceSuite id is the right key wherever we hold it: on the session (the
// password door learnt it), or on our Borrower row (the console resolved them).
// Only when neither exists is the phone matched — the same predicate the
// console's Customer-360 and the enrolment check already run — and the answer is
// cached, because Borrowers has no phone index and Home is opened often.
//
// A phone that matches two live records on one book is NOT resolved by picking
// one. Showing somebody a balance that may be a stranger's is a data-protection
// incident; it is reported as ambiguous and the screen says so.
//
// ── WHAT IT NEVER READS ─────────────────────────────────────────────────────
// loanSchedule (a 1.95M-row heap with no index on Loanid) and CustomerStatement
// (3.5M rows, no index). Every read here is on Borrowers by primary key and on
// Loans by the BorrowerId index. Micromart's server is shared with their own
// production systems; see the note in precheck.ts.
// ─────────────────────────────────────────────────────────────────────────────
import { mssql, runReadOnlyQuery } from "@/lib/enterprise/mssql";
import type { OrgDef } from "@/lib/enterprise/connections";

export type BookIdentity =
  | { kind: "found"; borrowerId: number }
  | { kind: "absent" }
  | { kind: "ambiguous"; count: number };

/** A resolved id does not change; a person absent today may be booked tomorrow. */
const FOUND_TTL_MS = 30 * 60_000;
const OTHER_TTL_MS = 5 * 60_000;
const identities = new Map<string, { until: number; value: BookIdentity }>();

/**
 * Which record on `entityId` this phone belongs to. Throws when the book could
 * not be read — "we could not ask" is never reported as "absent", because
 * absent is what sends an existing customer into opening a second account.
 */
export async function findBookBorrower(
  org: OrgDef,
  entityId: number,
  msisdn: string,
  nationalId?: string | null,
): Promise<BookIdentity> {
  const phone = msisdn.replace(/\D/g, "");
  const key = `${entityId}:${phone.slice(-9)}:${nationalId ?? ""}`;
  const hit = identities.get(key);
  if (hit && hit.until > Date.now()) return hit.value;

  const { rows } = await runReadOnlyQuery(
    org,
    `SELECT TOP 5 b.ID AS id, b.NationalID AS nationalId
       FROM Borrowers b
      WHERE b.EntityId = @entity
        AND ISNULL(b.AccountStatus, 1) <> 0
        AND (b.PhoneNumber = @phone OR RIGHT(REPLACE(b.PhoneNumber, ' ', ''), 9) = RIGHT(@phone, 9))
      ORDER BY b.ID DESC`,
    [
      { name: "entity", type: mssql.Int, value: entityId },
      { name: "phone", type: mssql.VarChar(32), value: phone },
    ],
    { timeoutMs: 15_000, maxRows: 5 },
  );

  let value: BookIdentity;
  if (rows.length === 0) value = { kind: "absent" };
  else if (rows.length === 1) value = { kind: "found", borrowerId: Number(rows[0].id) };
  else {
    // Two records on one number. The national ID the customer proved at KYC can
    // settle it; nothing else may.
    const id = (nationalId ?? "").trim();
    const matched = id ? rows.filter((r) => String(r.nationalId ?? "").trim() === id) : [];
    value = matched.length === 1
      ? { kind: "found", borrowerId: Number(matched[0].id) }
      : { kind: "ambiguous", count: rows.length };
  }

  identities.set(key, { until: Date.now() + (value.kind === "found" ? FOUND_TTL_MS : OTHER_TTL_MS), value });
  return value;
}

export type BookLoan = {
  id: number;
  product: string | null;
  principal: number;
  balance: number;
  borrowedAt: string | null;
  clearDate: string | null;
};

export type BookPosition = {
  borrowerId: number;
  firstName: string | null;
  otherName: string | null;
  nationalId: string | null;
  loanLimit: number | null;
  /** Sum of LoanBalance on approved, uncleared loans — the console's OLB. */
  outstanding: number;
  openLoans: number;
  loansEver: number;
  clearedLoans: number;
  /** The most recent open loan carrying a balance. */
  activeLoan: BookLoan | null;
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string | null => {
  const s = v == null ? "" : String(v).trim();
  return s && s !== "null" ? s : null;
};
const iso = (v: unknown): string | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

/**
 * One customer's position on one book. Null when the id is not on that entity
 * (moved, or never there). Throws when the book could not be read.
 */
export async function readBookPosition(org: OrgDef, entityId: number, borrowerId: number): Promise<BookPosition | null> {
  if (!Number.isInteger(borrowerId) || borrowerId <= 0) return null;

  const { rows } = await runReadOnlyQuery(
    org,
    // Balances are CAST because the column is not reliably numeric on every
    // row, and a string compared to 0 is how an open loan reads as cleared.
    `SELECT TOP 1
            b.ID, b.firstName, b.otherName, b.NationalID, b.LoanLimit,
            s.loansEver, s.openLoans, s.clearedLoans, s.olb,
            ol.id AS loanId, ol.LoanAmount, ol.LoanBalance, ol.BorrowDate, ol.ExpectedClearDate,
            p.ProductName
       FROM Borrowers b
       OUTER APPLY (
         SELECT COUNT(*) AS loansEver,
                SUM(CASE WHEN ISNULL(l.LoanCleared, 0) = 0
                          AND CAST(COALESCE(l.LoanBalance, 0) AS decimal(18,2)) > 0 THEN 1 ELSE 0 END) AS openLoans,
                SUM(CASE WHEN l.LoanCleared = 1 THEN 1 ELSE 0 END) AS clearedLoans,
                ISNULL(SUM(CASE WHEN ISNULL(l.LoanCleared, 0) = 0
                                THEN CAST(COALESCE(l.LoanBalance, 0) AS decimal(18,2)) ELSE 0 END), 0) AS olb
           FROM Loans l
          WHERE l.BorrowerId = b.ID AND l.isApproved = 1
       ) s
       OUTER APPLY (
         SELECT TOP 1 l.id, l.LoanAmount, l.LoanBalance, l.BorrowDate, l.ExpectedClearDate, l.ProductId
           FROM Loans l
          WHERE l.BorrowerId = b.ID AND l.isApproved = 1
            AND ISNULL(l.LoanCleared, 0) = 0
            AND CAST(COALESCE(l.LoanBalance, 0) AS decimal(18,2)) > 0
          ORDER BY l.BorrowDate DESC, l.id DESC
       ) ol
       LEFT JOIN Products p ON p.ID = ol.ProductId
      WHERE b.ID = @id AND b.EntityId = @entity`,
    [
      { name: "id", type: mssql.Int, value: borrowerId },
      { name: "entity", type: mssql.Int, value: entityId },
    ],
    { timeoutMs: 20_000, maxRows: 1 },
  );

  const r = rows[0];
  if (!r) return null;

  return {
    borrowerId: Number(r.ID),
    firstName: str(r.firstName),
    otherName: str(r.otherName),
    nationalId: str(r.NationalID),
    loanLimit: r.LoanLimit == null ? null : num(r.LoanLimit),
    outstanding: num(r.olb),
    openLoans: num(r.openLoans),
    loansEver: num(r.loansEver),
    clearedLoans: num(r.clearedLoans),
    activeLoan: r.loanId == null
      ? null
      : {
          id: Number(r.loanId),
          product: str(r.ProductName),
          principal: num(r.LoanAmount),
          balance: num(r.LoanBalance),
          borrowedAt: iso(r.BorrowDate),
          clearDate: iso(r.ExpectedClearDate),
        },
  };
}
