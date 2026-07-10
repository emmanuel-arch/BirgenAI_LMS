// ─────────────────────────────────────────────────────────────────────────────
// Platform (founder-level) sessions — a REAL identity for the /platform board.
//
// Until now the platform console authenticated by pasting PLATFORM_ADMIN_SECRET
// into a password box: no name in the audit log, no way to revoke one person,
// one string owning every tenant. This replaces it with PlatformAdmin accounts
// and a signed cookie.
//
// Deliberately separate from staff auth: different cookie, and the JWT carries
// aud="platform" so a platform token can never be replayed as an org session or
// vice versa. Impersonation (acting inside an org) does NOT reuse this token —
// it mints a normal org-scoped lms_session carrying an `impersonator` claim, so
// every downstream surface sees a familiar session shape and the banner renders.
// ─────────────────────────────────────────────────────────────────────────────
import { cookies } from "next/headers";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";

export const PLATFORM_COOKIE = "platform_session";
const AUDIENCE = "platform";
const MAX_AGE_S = 60 * 60 * 12; // 12h, same posture as staff sessions

export type PlatformSessionUser = {
  id: string;
  name: string;
  email: string;
};

export type PlatformSession = { admin?: PlatformSessionUser } | null;

function secret(): Uint8Array {
  const s = process.env.NEXTAUTH_SECRET?.trim();
  if (!s) throw new Error("NEXTAUTH_SECRET is not configured.");
  return new TextEncoder().encode(s);
}

/** Read + verify the platform cookie. Null when signed out / tampered. */
export async function platformAuth(): Promise<PlatformSession> {
  try {
    const jar = await cookies();
    const token = jar.get(PLATFORM_COOKIE)?.value;
    if (!token) return null;
    // audience: "platform" is the wall between the two session kinds — an org
    // cookie pasted here fails verification, and this token fails auth().
    const { payload } = await jwtVerify(token, secret(), { audience: AUDIENCE });
    const admin = payload.admin as PlatformSessionUser | undefined;
    return admin?.id ? { admin } : null;
  } catch {
    return null;
  }
}

export async function createPlatformSession(admin: PlatformSessionUser): Promise<void> {
  const token = await new SignJWT({ admin } as JWTPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_S}s`)
    .sign(secret());
  const jar = await cookies();
  jar.set(PLATFORM_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_S,
  });
}

export async function destroyPlatformSession(): Promise<void> {
  const jar = await cookies();
  jar.set(PLATFORM_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

/**
 * Break-glass: the legacy typed secret, honored for one release so the founder
 * is never locked out while the accounts bed in. Constant-time compare.
 */
export function legacyBearerOk(authorization: string | null): boolean {
  const secretVal = process.env.PLATFORM_ADMIN_SECRET?.trim();
  const supplied = authorization?.replace(/^Bearer\s+/i, "").trim();
  if (!secretVal || !supplied || supplied.length !== secretVal.length) return false;
  let diff = 0;
  for (let i = 0; i < secretVal.length; i++) diff |= secretVal.charCodeAt(i) ^ supplied.charCodeAt(i);
  return diff === 0;
}
