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

const COOKIE = "lms_session";
const MAX_AGE_S = 60 * 60 * 12; // 12h — lending consoles shouldn't idle for days

export type SessionUser = {
  id: string;
  name?: string | null;
  email?: string | null;
  role?: string | null; // role TITLE (e.g. "Org Admin")
  orgId?: string;
  orgSlug?: string;
  tiers?: { initiator: boolean; authorizer: boolean; validator: boolean };
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

/** Issue the session cookie (call from a route handler after verifying credentials). */
export async function createSession(user: SessionUser): Promise<void> {
  const token = await new SignJWT({ user } as JWTPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_S}s`)
    .sign(secret());
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_S,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

/** Org-admin surfaces (vault, users, manual backfill trigger). */
export function hasAdminAccess(session: Session): boolean {
  const role = session?.user?.role?.toLowerCase() ?? "";
  return role.includes("admin");
}
