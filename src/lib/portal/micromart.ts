// ─────────────────────────────────────────────────────────────────────────────
// THE EXISTING CUSTOMER'S DOOR — Micromart's own Login, from our server.
//
// ── WHY THIS EXISTS ALONGSIDE /api/portal/pin ────────────────────────────────
// /api/portal/pin is the returning-customer door for people who onboarded
// THROUGH US: it compares a bcrypt hash in our own Borrower table. Micromart's
// book predates us entirely, and their customers' credentials are not in our
// Postgres and never will be — the password in their pocket was minted by
// Micromart's `sp_restBorrowerPin` and SMS'd from Micromart's own outbox.
//
// So there was no door for the one group that matters most on day one: the
// entire existing book. This is that door. It does not copy, cache or re-hash
// anybody's password; it asks Micromart's own API the same question their own
// app asks, and believes the answer.
//
// ── WHY IT RUNS ON THE SERVER AND NOT IN THE APP ─────────────────────────────
// micromart-client-pwa calls this endpoint straight from the browser. We do not,
// for three reasons that all point the same way:
//
//   · The session. A browser-side login gives the app a borrower record and no
//     `lms_borrower` cookie, so every /api/portal/* screen behind it answers
//     401. Minting the cookie requires a server, and the cookie is the whole
//     point — it is what makes this door indistinguishable from the OTP funnel
//     to everything downstream.
//   · The credential. A password typed into our origin should leave it once,
//     to us, over TLS — not fan out to a third host from the handset.
//   · CORS. micromartafrica.co.ke does not send us access-control headers, so
//     the browser could not read the response anyway.
//
// ── SEARCHING THE BOOKS ──────────────────────────────────────────────────────
// Micromart's Login takes an entityId and answers for that book alone; it will
// not tell you which book somebody is on. So, as micromart-client-pwa's
// src/lib/signin.js already worked out, the only way to find out is to ask each
// in turn — and the four answers it distinguishes are all real:
//
//   ok           found in exactly one book.
//   ambiguous    found in more than one. REFUSED, not resolved by picking the
//                first: two records for one person is a data fault, and opening
//                whichever answered first shows somebody a balance that may not
//                be theirs.
//   none         reached every book, matched none. Wrong password, or not a
//                customer.
//   unreachable  reached NONE of them. This is not "none", and conflating the
//                two tells a ten-year customer they are not registered because
//                a network hop failed — which invites them to register again,
//                and a duplicate account is the thing this platform exists to
//                stop creating.
//
// Login has no side effect, so the books are probed in PARALLEL. Reset does
// have one — it mints a password and sends an SMS — so it goes one at a time
// and stops at the first that answers. A customer must never receive two
// different passwords because we were unsure who they were.
// ─────────────────────────────────────────────────────────────────────────────

const API = "https://micromartafrica.co.ke/MicromartAPI/Mobile/Application";

/** Micromart's books, in the order they are searched. 3002 is Micromart Africa
 *  (the SME/field book), 3005 Micromart Fintech (where the app's products live).
 *  3003 (Check off) and 3004 (IPF) are also Micromart but are not served here;
 *  adding one is an entry in this env var and nothing else. */
export function micromartBooks(preferred?: number): number[] {
  const raw = process.env.MICROMART_PORTAL_ENTITY_IDS?.trim();
  const parsed = (raw ? raw.split(",") : [])
    .map((s) => Number(s.trim()))
    // The Int32 ceiling is deliberate: a phone number parsed as an entity id
    // overflows it, and `parseInt("254721797735")` is an MSISDN, not a book.
    .filter((n) => Number.isInteger(n) && n > 0 && n <= 2147483647);
  const books = parsed.length ? parsed : [3002, 3005];
  // The org's own entity first — usually the only one that will match, so the
  // common case resolves on the first answer rather than the second.
  if (preferred && books.includes(preferred)) {
    return [preferred, ...books.filter((b) => b !== preferred)];
  }
  return books;
}

/**
 * What Micromart's Login hands back.
 *
 * ── VERIFIED AGAINST A LIVE RESPONSE, 9 SEP 2026 ───────────────────────────
 * The keys are exactly: message, borrowerId, accountNo, firstName, otherName,
 * token. This type previously declared `fullname` and `phoneNumber`, neither of
 * which their API returns — so the greeting built from `r.data.fullname` was
 * `null` for every customer who has ever used the password door, silently and
 * with no error anywhere.
 */
export type MicromartBorrower = {
  borrowerId: number | string;
  accountNo?: string;
  firstName?: string;
  otherName?: string;
  message?: string;
  /**
   * A bearer token for their OTHER endpoints. AvailableLoanProducts and
   * LoanPreview both want it (their own PWA sends it on each), and Login is the
   * only place it is ever issued — so a request that needs it and does not have
   * it cannot go and get one without the password, which we correctly did not
   * keep.
   *
   * It rides on our borrower session cookie: httpOnly, signed, server-read-only,
   * and expiring on the same one-hour clock. Their API also rotates it via an
   * `X-New-Token` response header, which we do not currently follow — a rotation
   * we ignore simply means the original stays valid for its own lifetime, and
   * the customer re-authenticates when our cookie expires anyway.
   */
  token?: string;
};

type Attempt =
  | { entityId: number; ok: true; reachable: true; data: MicromartBorrower }
  | { entityId: number; ok: false; reachable: boolean; message: string };

/** One book, one attempt. Never throws — the caller needs every result. */
async function attemptLogin(phone: string, password: string, entityId: number): Promise<Attempt> {
  try {
    const res = await fetch(`${API}/Login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ AccountNumber: phone, password, entityId }),
      // Their API is on a link that is occasionally slow. Long enough to be
      // fair to it, short enough that a borrower is not left on a spinner.
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      let message = "";
      try {
        const body = (await res.json()) as { message?: string };
        message = body?.message ?? "";
      } catch {
        /* a non-JSON error body is still a refusal, just an unhelpful one */
      }
      return { entityId, ok: false, reachable: true, message };
    }

    const data = (await res.json()) as MicromartBorrower | null;
    // A 200 with no borrower is a refusal wearing a success code. Trusting the
    // status alone would sign somebody in against an empty record.
    if (!data || !data.borrowerId) {
      return { entityId, ok: false, reachable: true, message: (data as { message?: string })?.message ?? "" };
    }
    return { entityId, ok: true, reachable: true, data };
  } catch {
    // Timeout, DNS, TLS, refused connection — all "we did not get an answer",
    // which is emphatically not "the password is wrong".
    return { entityId, ok: false, reachable: false, message: "" };
  }
}

export type SignInResult =
  | { kind: "ok"; entityId: number; data: MicromartBorrower }
  | { kind: "ambiguous"; entityIds: number[] }
  | { kind: "none"; message: string }
  | { kind: "unreachable" };

/** Sign in across every book, in parallel. See the header on why that is safe. */
export async function micromartSignIn(
  phone: string,
  password: string,
  preferred?: number,
): Promise<SignInResult> {
  const books = micromartBooks(preferred);
  const results = await Promise.all(books.map((id) => attemptLogin(phone, password, id)));

  const hits = results.filter((r): r is Extract<Attempt, { ok: true }> => r.ok);
  if (hits.length === 1) return { kind: "ok", entityId: hits[0].entityId, data: hits[0].data };
  if (hits.length > 1) return { kind: "ambiguous", entityIds: hits.map((h) => h.entityId) };

  // Nothing matched. Was that an answer, or was it silence?
  if (!results.some((r) => r.reachable)) return { kind: "unreachable" };

  // `.filter` with a type predicate, not `.find` with a boolean one: a boolean
  // predicate narrows `r` INSIDE the callback but hands back the un-narrowed
  // union, so reading `.message` off the result is a type error even though the
  // callback just proved the property is there. Same shape as `hits` above.
  const refusals = results.filter((r): r is Extract<Attempt, { ok: false }> => !r.ok);
  const message = refusals.find((r) => r.message)?.message ?? "";
  return { kind: "none", message };
}

export type ResetResult =
  | { kind: "ok"; entityId: number }
  | { kind: "none" }
  | { kind: "unreachable" };

/**
 * Ask Micromart to mint a new password and SMS it.
 *
 * ── THIS IS THE DELIVERY PATH THAT ACTUALLY WORKS TODAY ──────────────────────
 * Our own outbox leg (lib/sms/servicesuite.ts) writes the row into
 * Notifications.dbo.SMS directly, and it is complete — but it needs the SQL
 * relay armed for writes, and the relay answers `"writes": false`. Micromart's
 * ResetPassword does the same INSERT from THEIR side, where the write is local
 * and always permitted. So this reaches a real handset now, under Micromart's
 * own sender id, with no change to anybody's deployment.
 *
 * Sequential, stopping at the first book that accepts — see the header.
 */
export async function micromartResetPassword(phone: string, preferred?: number): Promise<ResetResult> {
  let reachedSomething = false;

  for (const entityId of micromartBooks(preferred)) {
    try {
      const res = await fetch(`${API}/ResetPassword`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // `password: phone` mirrors what micromart-client-pwa sends. Their
        // endpoint ignores it and mints its own; sending anything else would be
        // a difference between the two apps for no reason.
        body: JSON.stringify({ AccountNumber: phone, password: phone, entityId }),
        signal: AbortSignal.timeout(20_000),
      });
      reachedSomething = true;
      if (res.ok) return { kind: "ok", entityId };
    } catch {
      /* try the next book; the flag records that none answered */
    }
  }

  return reachedSomething ? { kind: "none" } : { kind: "unreachable" };
}
