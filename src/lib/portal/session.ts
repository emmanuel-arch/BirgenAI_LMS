// ─────────────────────────────────────────────────────────────────────────────
// Borrower session — proof that the caller holds the phone they claim.
//
// Until now the funnel took the borrower's word for it. `phone` arrived in the
// request body, and everything downstream — their Customer-360, their loan
// balance, an STK prompt, a credit application in their name — was built on a
// string anyone could type. This cookie replaces that claim with evidence: it is
// issued only after a code delivered to that number comes back.
//
// Read the phone from HERE, never from the body. That is the whole point.
//
// Bound to one org: a borrower who verified at micromart.birgenai.com holds no
// standing at buysimu.birgenai.com. `borrowerFor(orgId)` enforces it.
//
// Distinct from the staff session (lib/auth.ts) by JWT audience, so neither
// cookie can ever be replayed as the other even though they share a secret.
// ─────────────────────────────────────────────────────────────────────────────
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";

export const BORROWER_COOKIE = "lms_borrower";
const AUDIENCE = "borrower";
/** Long enough to upload a 6-month statement and finish an application. */
const MAX_AGE_S = 60 * 60;

export type BorrowerSession = {
  /** The org this borrower verified against. */
  orgId: string;
  orgSlug: string;
  /** Digits-only msisdn (2547XXXXXXXX) — server-authoritative. */
  phone: string;

  // ── WHO THEY ARE IN THE LENDER'S OWN BOOK ────────────────────────────────
  // Present only when the session was minted by the Micromart password door,
  // which is the only one that learns these — the OTP and PIN doors authenticate
  // against our own Postgres and have no ServiceSuite identity to record.
  //
  // They live on the SESSION rather than on the Borrower row for two reasons.
  // A Micromart customer of ten years may have no Borrower row here at all, so
  // there is nothing to write them to; and `ssEntityId` is a property of the
  // AUTHENTICATION — which of the books answered — not of the person, who may
  // legitimately exist on more than one. Putting it on the row would make the
  // last sign-in overwrite the fact for every other context.
  //
  // The application path (lib/portal/micromart-apply.ts) needs all three, and
  // taking them from a signed one-hour token rather than from a request body is
  // what stops a caller applying for a loan as somebody else.
  /** Micromart's own Borrowers.ID. */
  ssBorrowerId?: number | string;
  /** Their account number, as their Login returned it. */
  ssAccount?: string;
  /** WHICH book answered — 3002 (Africa) or 3005 (Fintech). */
  ssEntityId?: number;
  /**
   * Their bearer token, for the endpoints that require one — the live product
   * shelf and the loan preview.
   *
   * It is a credential and it lives here rather than in the database on purpose:
   * a token at rest in Postgres outlives the session it belongs to and has to be
   * expired by something. On the cookie it expires with everything else, is
   * never readable by script, and is destroyed by signing out.
   */
  ssToken?: string;
};

function secret(): Uint8Array {
  const s = process.env.NEXTAUTH_SECRET?.trim();
  if (!s) throw new Error("NEXTAUTH_SECRET is not configured.");
  return new TextEncoder().encode(s);
}

export async function createBorrowerSession(s: BorrowerSession): Promise<void> {
  const token = await new SignJWT({ ...s } as JWTPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_S}s`)
    .sign(secret());
  const jar = await cookies();
  jar.set(BORROWER_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_S,
  });
}

/** The verified borrower, whichever org they verified against. Null if anonymous. */
export async function readBorrowerSession(): Promise<BorrowerSession | null> {
  try {
    const jar = await cookies();
    const token = jar.get(BORROWER_COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, secret(), { audience: AUDIENCE });
    const { orgId, orgSlug, phone, ssBorrowerId, ssAccount, ssEntityId, ssToken } =
      payload as unknown as BorrowerSession;
    // The ServiceSuite trio is carried through verbatim. It is absent on every
    // session the OTP and PIN doors mint, and callers must treat it as optional
    // rather than assuming the password door was used.
    return orgId && phone
      ? { orgId, orgSlug, phone, ssBorrowerId, ssAccount, ssEntityId, ssToken }
      : null;
  } catch {
    return null; // expired / tampered / wrong audience — treat as anonymous
  }
}

/** The verified borrower for THIS org, or null. The guard every portal route uses. */
export async function borrowerFor(orgId: string): Promise<BorrowerSession | null> {
  const s = await readBorrowerSession();
  return s && s.orgId === orgId ? s : null;
}

export async function destroyBorrowerSession(): Promise<void> {
  const jar = await cookies();
  jar.set(BORROWER_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

/**
 * The 401 every gated portal route returns. `needsOtp` tells the client to send
 * the borrower back to the phone gate rather than show an error.
 */
export function otpRequired(): NextResponse {
  return NextResponse.json(
    { success: false, needsOtp: true, message: "Verify your phone number to continue." },
    { status: 401 },
  );
}

/** 0712 345 678 → 254712345678. The one format the DB and Daraja both speak. */
export function toMsisdn(phone: string): string {
  return `254${phone.replace(/\D/g, "").slice(-9)}`;
}

/** Safaricom 07xx/011x and the rest of the 2547xx / 2541xx space. */
export function isKenyanMsisdn(msisdn: string): boolean {
  return /^254[71]\d{8}$/.test(msisdn);
}

/** 254712345678 → 0712 ••• 678. Shown when resuming a session. */
export function maskMsisdn(msisdn: string): string {
  const local = `0${msisdn.slice(3)}`;
  return `${local.slice(0, 4)} ••• ${local.slice(-3)}`;
}
