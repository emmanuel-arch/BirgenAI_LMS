// ─────────────────────────────────────────────────────────────────────────────
// THE CUSTOMER'S OWN BOOK, READ FROM MICROMART.
//
// ── WHY THIS EXISTS AT ALL ──────────────────────────────────────────────────
// /api/portal/my-loan opens with:
//
//     if (org.mode !== "NATIVE") return { found: false, bridged: true, ... }
//
// Micromart is BRIDGED. So that endpoint has never returned a loan for a
// Micromart customer and never could — their book lives in ServiceSuite, not in
// our Postgres. Home and Repay were therefore rendering sample data not because
// nobody had got round to wiring them, but because there was nothing on our side
// to wire them TO.
//
// The relay can read that book over SQL, but it is a second hop through a
// Tailscale Funnel that has already proved it can collide with the lender's own
// IIS. Their public API answers the same questions directly, with the bearer
// token the customer's own sign-in already produced.
//
// ── VERIFIED AGAINST LIVE RESPONSES, ENTITY 3005, 9 SEP 2026 ───────────────
//   AccountPreview   POST, Bearer, NO BODY. A DataSet: Table[0] is the person
//                    (LoanLimit, CreditScore, status, office, officer),
//                    Table1[0] is the position (Loans, LoanAmount, OLB).
//   Loans            GET ?Limit=&Offset=, Bearer. An array of loan rows.
//
// Both are 405 on the wrong verb, which is how the first probe failed — worth
// stating because "405" reads like a routing fault and is actually a method one.
// ─────────────────────────────────────────────────────────────────────────────

const API = "https://micromartafrica.co.ke/MicromartAPI/Mobile/Application";

/**
 * Their money fields arrive FORMATTED — "Ksh 12,500.00", not 12500.
 *
 * `Number("Ksh 12,500.00")` is NaN, and a NaN that reaches a screen renders as
 * "KSh NaN" beside a real customer's real debt. Everything numeric that comes
 * back as a string goes through here.
 */
export function parseKes(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export type MicromartAccount = {
  borrowerId: number;
  firstName: string | null;
  otherName: string | null;
  accountNo: string | null;
  nationalId: string | null;
  phone: string | null;
  email: string | null;
  /** THEIR `CreditScore` FIELD, WHICH IS NOT A CREDIT SCORE. It is the
   *  customer's average daily sales in shillings, captured at onboarding — a
   *  misnomer in their schema, and a dangerous one to pass through unrenamed:
   *  30000 looks exactly like a plausible score, and nobody reading a screen
   *  would question it. */
  avgDailySales: number | null;
  loanLimit: number;
  /** Outstanding loan balance across the book. */
  outstanding: number;
  loanCount: number;
  borrowedTotal: number;
  status: string | null;
  active: boolean;
  office: string | null;
  officer: string | null;
};

type Row = Record<string, unknown>;
const first = (v: unknown): Row | null => (Array.isArray(v) && v[0] && typeof v[0] === "object" ? (v[0] as Row) : null);
const str = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v);
  return s && s !== "null" ? s : null;
};

export type AccountResult =
  | { ok: true; account: MicromartAccount }
  | { ok: false; reachable: boolean; unauthorised: boolean; message: string };

/**
 * The customer's position, as their lender holds it.
 *
 * A 401 is reported as `unauthorised` rather than as an outage, because it means
 * one specific recoverable thing — the bearer token minted at sign-in has
 * expired — and the caller's correct response is to fall back to what we hold
 * locally, not to tell a customer their lender is down.
 */
export async function micromartAccount(token: string): Promise<AccountResult> {
  try {
    const res = await fetch(`${API}/AccountPreview`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", accept: "text/plain" },
      // No body. Their endpoint reads the borrower off the token, and sending
      // one earns a 400 rather than being ignored.
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 401) {
      return { ok: false, reachable: true, unauthorised: true, message: "Session expired at the lender." };
    }
    if (!res.ok) {
      return { ok: false, reachable: true, unauthorised: false, message: `Micromart answered ${res.status}.` };
    }

    const data = (await res.json()) as { Table?: unknown; Table1?: unknown };
    const person = first(data.Table);
    const position = first(data.Table1);
    if (!person) {
      return { ok: false, reachable: true, unauthorised: false, message: "Micromart returned no account." };
    }

    return {
      ok: true,
      account: {
        borrowerId: Number(person.ID) || 0,
        firstName: str(person.firstName),
        otherName: str(person.otherName),
        accountNo: str(person.AccountNo),
        nationalId: str(person.NationalID),
        phone: str(person.PhoneNumber),
        email: str(person.EmailAddress),
        avgDailySales: person.CreditScore != null ? Number(person.CreditScore) : null,
        loanLimit: parseKes(person.LoanLimit),
        // Their DataSet splits the person from the position. A missing Table1 is
        // a customer with no book yet, which is zero — not unknown.
        outstanding: parseKes(position?.OLB),
        loanCount: Number(position?.Loans ?? 0) || 0,
        borrowedTotal: parseKes(position?.LoanAmount),
        status: str(person.StatusTitle),
        // 1 = ACTIVE in their vocabulary. Read off the numeric field rather than
        // the title, which is free text.
        active: Number(person.AccountStatus) === 1,
        office: str(person.EntityUnitName),
        officer: str(person.EntityAgentName),
      },
    };
  } catch {
    return { ok: false, reachable: false, unauthorised: false, message: "Could not reach Micromart." };
  }
}

export type MicromartLoan = {
  id: number;
  product: string | null;
  principal: number;
  balance: number;
  status: string | null;
  cleared: boolean;
  borrowDate: string | null;
  dueDate: string | null;
};

/**
 * The customer's loans.
 *
 * ── THE ROW SHAPE IS NOT FULLY KNOWN, AND THAT IS SAID OUT LOUD ────────────
 * The account this was probed against on 9 Sep 2026 has ZERO loans, so `Loans`
 * returned `[]` and the field names of a populated row could not be observed.
 * The mapping below reads several plausible spellings for each value and falls
 * back rather than throwing, so a row that arrives shaped differently degrades
 * to partial data instead of a crash or a NaN.
 *
 * This is a KNOWN GAP, not a finished mapping. Re-probe with an account that
 * holds a loan (scripts/probe-micromart-loans.cjs) and pin the names down.
 */
export async function micromartLoans(
  token: string,
  limit = 20,
): Promise<{ ok: true; loans: MicromartLoan[] } | { ok: false; reachable: boolean; unauthorised: boolean }> {
  try {
    const res = await fetch(`${API}/Loans?Limit=${limit}&Offset=0`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", accept: "text/plain" },
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 401) return { ok: false, reachable: true, unauthorised: true };
    if (!res.ok) return { ok: false, reachable: true, unauthorised: false };

    const data = (await res.json()) as unknown;
    const rows: Row[] = Array.isArray(data)
      ? (data as Row[])
      : Array.isArray((data as { Table?: unknown })?.Table)
        ? ((data as { Table: Row[] }).Table)
        : [];

    const pick = (r: Row, ...keys: string[]): unknown => {
      for (const k of keys) if (r[k] != null) return r[k];
      return null;
    };

    return {
      ok: true,
      loans: rows.map((r) => {
        const status = str(pick(r, "StatusTitle", "LoanStatus", "Status"));
        return {
          id: Number(pick(r, "ID", "Id", "LoanId")) || 0,
          product: str(pick(r, "ProductName", "Product")),
          principal: parseKes(pick(r, "Principal", "LoanAmount", "PrincipalAmount")),
          balance: parseKes(pick(r, "OLB", "Balance", "LoanBalance", "OutstandingBalance")),
          status,
          cleared: /clear|closed|paid|complete/i.test(status ?? "") || Number(pick(r, "LoanCleared")) === 1,
          borrowDate: str(pick(r, "BorrowDate", "LoanDate", "CreatedDate")),
          dueDate: str(pick(r, "DueDate", "MaturityDate", "ExpectedClearDate")),
        };
      }),
    };
  } catch {
    return { ok: false, reachable: false, unauthorised: false };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// REPAYING — an STK push raised on the lender's side.
//
// /api/portal/pay is NATIVE-only: it opens with `if (org.mode !== "NATIVE")` and
// refuses. So the Repay screen has never been able to take a shilling from a
// Micromart customer, because the money has to land in Micromart's book and our
// M-Pesa integration pays into ours.
//
// Their `Repayment` endpoint raises the prompt on their own paybill, against
// their own book, and their existing app has used it in production for years.
//
// ── THE SAME SHADOW GATE, A SEPARATE SWITCH ─────────────────────────────────
// MICROMART_PAY_ENABLED, not MICROMART_APPLY_ENABLED. Filing an application and
// pulling money off somebody's phone are different acts with different blast
// radii, and one flag covering both would mean arming a live debit in order to
// test a form submission.
//
// ── NEVER RETRIED, FOR THE USUAL REASON ─────────────────────────────────────
// A timeout is not evidence the push did not happen. The request may have been
// received, the prompt raised, and the response lost coming back — so a retry is
// a second prompt on a real handset for real money, and the customer cannot tell
// which one is which. `unreachable` is reported and left alone.
// ─────────────────────────────────────────────────────────────────────────────

export function isMicromartPayArmed(): boolean {
  return process.env.MICROMART_PAY_ENABLED === "true";
}

export type RepayResult =
  | { kind: "pushed"; message: string }
  | { kind: "shadowed"; request: { Amount: number; PhoneNumber: string; EntityId: number } }
  | { kind: "refused"; message: string }
  | { kind: "unreachable" };

export async function micromartRepay(args: {
  token: string;
  amount: number;
  phone: string;
  entityId: number;
}): Promise<RepayResult> {
  const request = { Amount: args.amount, PhoneNumber: args.phone, EntityId: args.entityId };
  if (!isMicromartPayArmed()) return { kind: "shadowed", request };

  try {
    const res = await fetch(`${API}/Repayment`, {
      method: "POST",
      headers: { Authorization: `Bearer ${args.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(45_000),
    });
    if (res.status === 401) return { kind: "refused", message: "Your session with the lender expired. Sign in again." };
    if (!res.ok) return { kind: "refused", message: `Micromart answered ${res.status}.` };

    const data = (await res.json()) as { code?: number; Response?: string; message?: string };
    // Their convention: a 200 carries an application-level code, and anything
    // other than 200 in it is a refusal wearing a success status.
    if (data?.code != null && Number(data.code) !== 200) {
      return { kind: "refused", message: data.Response ?? data.message ?? "The lender declined that payment." };
    }
    return { kind: "pushed", message: data?.Response ?? data?.message ?? "Check your phone for the M-PESA prompt." };
  } catch {
    return { kind: "unreachable" };
  }
}
