// ─────────────────────────────────────────────────────────────────────────────
// APPLYING AT MICROMART — the write path that needs no relay.
//
// Separate from ./micromart.ts on purpose: that file is the DOOR (who is this
// person, let them in), this one is the TRANSACTION (put a loan in their book).
// They share a base URL and nothing else, and the second is the one with a
// safety gate on it.
//
// ── WHY THIS ROAD AND NOT sp_InsertLoan ─────────────────────────────────────
// lib/lms/servicesuite.ts can post a loan with `sp_InsertLoan`, and it is
// correct code. It also cannot run from here: Micromart's SQL Server is a
// Tailscale address with no internet route, so every write goes through the SQL
// relay — and the relay answers `"writes": false` by design. Arming it is a
// change on the relay host, not in this repository.
//
// Micromart's own public API performs the identical insert from THEIR side,
// where the write is local and always permitted. These are the same three calls
// their existing PWA makes (micromart-client-pwa/src/pages/LoanApplication.jsx):
//
//   AvailableLoanProducts       the real shelf for a book — live rates and fees
//   LoanPreview                 the schedule and up-front charges (Bearer auth)
//   LoanApplicationValidation   THE INSERT. Returns a real LoanID and drops the
//                               loan into the product's own approval workflow.
//
// Despite its name, `LoanApplicationValidation` is not a dry run — it is how
// their app applies for a loan, and a 200 from it means a row exists in
// Micromart's live book, visible to their officers. Everything here treats it
// as the irreversible act it is.
//
// ── THE SHADOW GATE ─────────────────────────────────────────────────────────
// MICROMART_APPLY_ENABLED must be exactly "true" before that call leaves this
// process. Off — the default — the request is composed in full, validated
// against the live shelf and the live schedule, and RETURNED rather than sent.
// So the entire path can be walked end to end against real products and real
// numbers without depositing test applications in a lender's production queue
// for their officers to find and clean up.
//
// Deliberately a DIFFERENT switch from LMS_POSTING_ENABLED. That one governs
// sp_InsertLoan through the relay; this governs the public API. One flag over
// both would mean arming a road nobody has tested in order to use the one that
// works.
// ─────────────────────────────────────────────────────────────────────────────

const API = "https://micromartafrica.co.ke/MicromartAPI/Mobile/Application";

/** True only when live applications have been explicitly armed. */
export function isMicromartApplyArmed(): boolean {
  return process.env.MICROMART_APPLY_ENABLED === "true";
}

/**
 * One row from AvailableLoanProducts.
 *
 * ── VERIFIED AGAINST A LIVE RESPONSE, ENTITY 3005, 9 SEP 2026 ──────────────
 * Not inferred. The shape below is what their API actually returned for
 * Micro Eazy (30219) and Micro Eazy Monthly (30220), and two fields in the
 * earlier draft of this type were wrong in ways that compiled perfectly:
 *
 *   `InterestTypeValue` IS NOT THE METHOD. It is the formatted RATE — "8.25%",
 *   "22.00%". A mapper testing it for /reduc/ (as this one did) returns "flat"
 *   for every product ever, including a genuinely reducing-balance one. The
 *   method is `methodName` ("Flat rate") with `InterestMethod` as the numeric
 *   backstop.
 *
 *   `InterestRate` IS ALREADY PER PERIOD. Micro Eazy returns 8.25 with
 *   `InterestPeriodName: "Week"` over `RepaymentPeriod: 10` — that is 8.25% a
 *   week, totalling the 82.5% our own row records as a whole-term rate. The
 *   earlier mapper divided by the term and would have advertised 0.825%/week:
 *   a real loan at a tenth of its real price, on the screen a customer accepts
 *   from.
 *
 * `MinPrincipalFormated` is their spelling, not a typo here.
 */
export type MicromartProduct = {
  ID: number;
  ProductName?: string;
  ProductDesc?: string;
  MinPrincipal?: number | string;
  MaxPrincipal?: number | string;
  MinPrincipalFormated?: string;
  MaxPrincipalFormated?: string;
  /** Already per `InterestPeriodName`. Do not divide by the term. */
  InterestRate?: number | string;
  /** The formatted rate — "8.25%". NOT the interest method. */
  InterestTypeValue?: string;
  /** 1 = flat. The numeric form of `methodName`. */
  InterestMethod?: number;
  /** "Flat rate" | "Reducing balance" — the method, in their words. */
  methodName?: string;
  /** The unit the RATE is quoted in: "Week", "Month". */
  InterestPeriodName?: string;
  RepaymentPeriod?: number | string;
  /** The unit the TERM is counted in. Usually equal to InterestPeriodName,
   *  but a separate field and not safe to substitute for it. */
  RepaymentPeriodName?: string;
  MinCreditScore?: number | null;
  /** 1 = on the shelf. Their endpoint can return retired products. */
  IsActive?: number;
  statusTitle?: string;
};

/**
 * Their endpoints answer as a bare array on some routes and as a `{ Table: [] }`
 * DataSet on others — the serialisation ServiceSuite has always used. Both are
 * accepted rather than guessed at, because guessing wrong yields an empty shelf
 * and an empty shelf renders as "no products available", which is
 * indistinguishable from a lender having none.
 */
function rowsOf(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  const table = (data as { Table?: unknown })?.Table;
  return Array.isArray(table) ? table : [];
}

export type Reachability = { ok: false; reachable: boolean; message: string };

/**
 * The live shelf for one book.
 *
 * Micro Eazy (30219), Micro Eazy Monthly (30220) and Micro Chap Chap (30221)
 * live on entity 3005. Reading them rather than hard-coding them is the point: a
 * rate Micromart changes in their own UI reaches the app without a deploy, and
 * an app quoting a rate the lender has moved off is a mis-selling problem, not a
 * stale-cache problem.
 */
export async function micromartProducts(args: {
  entityId: number;
  /** Their `PhoneNumber` field, which their own app fills with the session's
   *  account/user id rather than a formatted msisdn. */
  phoneNumber: string;
  /** From Login. Their PWA sends it on every call to this endpoint. */
  token?: string;
}): Promise<{ ok: true; products: MicromartProduct[] } | Reachability> {
  try {
    const res = await fetch(`${API}/AvailableLoanProducts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(args.token ? { Authorization: `Bearer ${args.token}` } : {}),
      },
      // The exact envelope their own app sends. `RequestFlag: 0` is theirs and
      // is passed through rather than reasoned about — an undocumented flag
      // copied faithfully is safer than one omitted on the assumption it is a
      // default.
      body: JSON.stringify({
        PhoneNumber: String(args.phoneNumber ?? ""),
        EntityId: args.entityId,
        RequestFlag: 0,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    // A 401 here means their token has expired, which is a real answer and not
    // an outage — the caller falls back to the local shelf rather than retrying.
    if (!res.ok) return { ok: false, reachable: true, message: `Micromart answered ${res.status}.` };
    return { ok: true, products: rowsOf(await res.json()) as MicromartProduct[] };
  } catch {
    return { ok: false, reachable: false, message: "Could not reach Micromart." };
  }
}

/** The shape /api/lms/products hands the wizard. */
export type ShelfProduct = {
  /** A LOCAL Product uuid where one exists, else "ss:<their id>". */
  id: string;
  serviceSuiteProductId: number;
  name: string;
  description: string | null;
  minPrincipal: number;
  maxPrincipal: number;
  interestRate: number;
  interestUnit: string;
  interestMethod: string;
  repaymentPeriod: number;
  repaymentUnit: string;
  minCreditScore: number | null;
  disbursementMode: string | null;
  /** True when this product exists only in the lender's book, not ours. */
  liveOnly: boolean;
};

const n = (v: unknown, fallback = 0): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
};

/**
 * Their row → our shape.
 *
 * ── THE RATE IS TAKEN AS GIVEN, NOT DERIVED ─────────────────────────────────
 * `InterestRate` arrives already expressed per `InterestPeriodName`, which is
 * exactly the pair our own `Product` type wants (`interestRate` + `interestUnit`
 * — "as published, per interestUnit, NOT per term"). There is no arithmetic to
 * do, and doing some anyway is how the previous draft turned 8.25% a week into
 * 0.825% a week.
 *
 * Whole-term restatement is the LOCAL row's problem, because our column stores
 * "term" rates that have to be divided down. Live rows never need it.
 */
export function toShelfProduct(p: MicromartProduct): ShelfProduct {
  // The rate's own unit, which is NOT necessarily the repayment unit. They
  // coincide on both Micro Eazy products; they are separate fields and a
  // product priced monthly but repaid weekly would be misquoted by conflating
  // them. Falls back to the repayment unit only when the rate's own is absent.
  const interestUnit =
    (p.InterestPeriodName ?? p.RepaymentPeriodName ?? "").toLowerCase() || "week";

  // `methodName` first, `InterestMethod` (1 = flat) as the numeric backstop.
  // Never `InterestTypeValue` — that is the formatted rate.
  const method =
    /reduc/i.test(p.methodName ?? "") || (p.InterestMethod != null && p.InterestMethod !== 1)
      ? "reducing"
      : "flat";

  return {
    id: `ss:${p.ID}`,
    serviceSuiteProductId: p.ID,
    name: p.ProductName?.trim() || `Product ${p.ID}`,
    // ProductDesc is an internal shorthand on their side — "ME", "MEM" — not a
    // sentence for a customer. Two characters under a product name reads as a
    // rendering fault, so it is dropped and the screen falls back to describing
    // the terms it already has.
    description: (p.ProductDesc ?? "").trim().length > 12 ? p.ProductDesc!.trim() : null,
    minPrincipal: n(p.MinPrincipal, 0),
    maxPrincipal: n(p.MaxPrincipal, 0),
    interestRate: n(p.InterestRate, 0),
    interestUnit,
    interestMethod: method,
    repaymentPeriod: n(p.RepaymentPeriod, 0),
    repaymentUnit: (p.RepaymentPeriodName ?? "").toLowerCase() || interestUnit,
    minCreditScore: p.MinCreditScore != null ? n(p.MinCreditScore, 0) : null,
    disbursementMode: null,
    liveOnly: true,
  };
}

/** On the shelf today. Their endpoint returns retired products too, and a
 *  customer must not be offered one their own workflow will refuse. */
export function isSellable(p: MicromartProduct): boolean {
  if (p.IsActive != null) return Number(p.IsActive) === 1;
  if (p.statusTitle) return /active/i.test(p.statusTitle);
  // Neither field present — the endpoint changed shape. Showing it is the safer
  // failure: a customer sees a product the lender may refuse, rather than the
  // shelf silently emptying itself.
  return true;
}

/** Their DataSet, passed through. The caller reads what it needs rather than
 *  this file inventing a normalised type it has no way to verify. */
export type MicromartSchedule = { Table?: Record<string, unknown>[]; [k: string]: unknown };

/**
 * The schedule and the up-front charges for a principal on a product.
 *
 * Bearer-authenticated with the token Login returned, exactly as their PWA does
 * it. Read-only and free of side effects, so it is safe to call on every change
 * of the amount slider.
 */
export async function micromartLoanPreview(args: {
  token: string;
  productId: number;
  principal: number;
}): Promise<{ ok: true; schedule: MicromartSchedule } | Reachability> {
  try {
    const res = await fetch(`${API}/LoanPreview`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${args.token}` },
      body: JSON.stringify({ productId: args.productId, principal: args.principal }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { ok: false, reachable: true, message: `Micromart answered ${res.status}.` };
    return { ok: true, schedule: (await res.json()) as MicromartSchedule };
  } catch {
    return { ok: false, reachable: false, message: "Could not reach Micromart." };
  }
}

/** Exactly what the insert would be asked to do. Assembled always, sent only
 *  when armed — so the shadow branch can hand it back for inspection. */
export type MicromartApplyRequest = {
  borrowerAccount: string;
  borrowedAmount: number;
  borrowerId: number | string;
  entityId: number;
  productId: number;
  borrowerType: number;
};

export type ApplyResult =
  /** A row now exists in Micromart's live book. */
  | { kind: "posted"; loanId: string; message: string }
  /** Composed and deliberately NOT sent. `request` is byte-for-byte what would go. */
  | { kind: "shadowed"; request: MicromartApplyRequest }
  /** Their API answered and refused. A real answer, not an outage. */
  | { kind: "refused"; message: string }
  /** We never got an answer. NOT the same as a refusal — see below. */
  | { kind: "unreachable" };

/**
 * Put the loan into Micromart's own approval workflow.
 *
 * ── NOT IDEMPOTENT, AND NEVER RETRIED ───────────────────────────────────────
 * Their endpoint offers no request id, so there is nothing a second call could
 * be deduplicated against. A timeout is therefore reported as `unreachable` and
 * left alone: the request may well have been received and committed, and
 * retrying turns one customer's application into two loans nobody can tell
 * apart. Recovering from `unreachable` is a human reading their book, which is
 * cheap; recovering from a double-posted loan is not.
 */
export async function micromartApply(req: MicromartApplyRequest): Promise<ApplyResult> {
  if (!isMicromartApplyArmed()) return { kind: "shadowed", request: req };

  try {
    const res = await fetch(`${API}/LoanApplicationValidation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
      // Longer than the read calls. Abandoning this one early does not undo a
      // row their server may already have committed — it only costs us the loan
      // id we would track it by.
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) return { kind: "refused", message: `Micromart answered ${res.status}.` };

    const data = (await res.json()) as { code?: number; loanID?: number | string; Response?: string };
    // Their convention, and their own app reads it identically: the HTTP 200
    // carries an application-level code, and only `200` WITH a loan id is a
    // success. A 200 without one is a refusal wearing a success code.
    if (Number(data?.code) === 200 && data.loanID != null) {
      return { kind: "posted", loanId: String(data.loanID), message: data.Response ?? "Applied." };
    }
    return { kind: "refused", message: data?.Response ?? "Micromart declined the application." };
  } catch {
    return { kind: "unreachable" };
  }
}
