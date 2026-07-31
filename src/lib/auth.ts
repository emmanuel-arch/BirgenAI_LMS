// ─────────────────────────────────────────────────────────────────────────────
// Staff auth — signed JWT session cookie (jose), org-scoped.
//
// Replaces the Phase-1 stub behind the SAME exports (auth, hasAdminAccess) so
// the ported funnel routes are untouched. The borrower funnel stays anonymous
// (phone identity inside the wizard); this session is for STAFF consoles.
// Implemented first-party (jose + httpOnly cookie) rather than next-auth beta,
// which does not yet certify Next 16 — the seam makes a later swap trivial.
// ─────────────────────────────────────────────────────────────────────────────
import { cookies } from "next/headers";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { cookieDomain } from "@/lib/suite/hosts";

/** Also read by the Prisma client to resolve the RLS tenant (db/session-tenant.ts). */
export const SESSION_COOKIE = "lms_session";
const COOKIE = SESSION_COOKIE;
const MAX_AGE_S = 60 * 60 * 12; // 12h — lending consoles shouldn't idle for days

export type SessionUser = {
  id: string;
  name?: string | null;
  email?: string | null;
  role?: string | null; // role TITLE (e.g. "Org Admin")
  roleId?: string | null; // drives the rights resolver (src/lib/rbac); absent on pre-RBAC cookies
  orgId?: string;
  orgSlug?: string;
  tiers?: { initiator: boolean; authorizer: boolean; validator: boolean };
  /** Set only on sessions minted by a platform admin "acting as" this org. */
  impersonator?: { platformAdminId: string; name: string };
};

export type Session = { user?: SessionUser } | null;

function secret(): Uint8Array {
  const s = process.env.NEXTAUTH_SECRET?.trim();
  if (!s) throw new Error("NEXTAUTH_SECRET is not configured.");
  return new TextEncoder().encode(s);
}

/** Read + verify the session cookie. Null for anonymous (the funnel's normal state). */
export async function auth(): Promise<Session> {
  try {
    const jar = await cookies();
    const token = jar.get(COOKIE)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, secret());
    const u = payload.user as SessionUser | undefined;
    return u?.id ? { user: u } : null;
  } catch {
    return null; // expired/tampered/missing secret — treat as signed out
  }
}

/**
 * The cookie's identity: name, path and DOMAIN.
 *
 * Shared by the setter and the clearer on purpose. A cookie is identified by the
 * triple (name, domain, path); clearing it with a different domain than it was set
 * with does not delete it, it writes a SECOND, empty cookie beside the live one —
 * and the browser keeps sending the original. That is a signed-out user who is
 * still signed in, which is the worst possible way to get this wrong.
 *
 * `domain` is undefined outside production (see lib/suite/hosts.ts), which makes
 * the cookie host-only — the safe default, and exactly right for a single-deployment
 * demo where every system shares a host anyway.
 */
function cookieIdentity() {
  const domain = cookieDomain();
  return { name: COOKIE, path: "/", ...(domain ? { domain } : {}) };
}

/**
 * Issue the session cookie (call from a route handler after verifying credentials).
 *
 * Scoped to the parent domain in production, which is the mechanism the whole
 * connected suite rests on: one sign-in at lms.birgenai.com is honoured at
 * people.birgenai.com because the browser sends the same cookie to both.
 */
export async function createSession(user: SessionUser): Promise<void> {
  const token = await new SignJWT({ user } as JWTPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_S}s`)
    .sign(secret());
  const jar = await cookies();
  jar.set({
    ...cookieIdentity(),
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE_S,
  });
}

/**
 * Sign out — of every system at once.
 *
 * Because the cookie is one domain-scoped cookie rather than five host-scoped ones,
 * clearing it here clears it for the whole suite. That is what makes the launcher's
 * promise true rather than aspirational.
 */
export async function destroySession(): Promise<void> {
  const jar = await cookies();
  jar.set({ ...cookieIdentity(), value: "", httpOnly: true, maxAge: 0 });
}

/** Org-admin surfaces (vault, users, manual backfill trigger). */
export function hasAdminAccess(session: Session): boolean {
  const role = session?.user?.role?.toLowerCase() ?? "";
  return role.includes("admin");
}
