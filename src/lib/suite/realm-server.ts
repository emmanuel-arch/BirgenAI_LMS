// ─────────────────────────────────────────────────────────────────────────────
// Realm resolution, server side — the cookie half of src/lib/suite/realms.ts.
//
// Split from realms.ts because that file is imported by the switch itself, and
// the switch is a client component. `next/headers` in a module a client
// component imports is a build error, and the error names the importer rather
// than the import, which is a long way from the cause. The seam keeps the
// declarations shared and the request-time reads here.
//
// The cookie is scoped the same way the session cookie is (see lib/auth.ts) so
// a manager who switches book in the lending console is still in that book when
// they cross to Ledgerly or ConnectDesk. A context that only held for one
// system would be worse than none — it would mean the same person could be
// reading 3002 in one tab and 3005 in another and have nothing on screen to
// tell them apart.
//
// NOT httpOnly, and deliberately: the switch paints the incoming realm's colour
// before the server round-trip completes, and it can only do that if it can
// read what it last set. The value is a realm id from a fixed list, never a
// credential and never an EntityId — there is nothing in it to steal, and
// findRealm() re-validates it against the allowlist on every single read.
// ─────────────────────────────────────────────────────────────────────────────
import { cookies } from "next/headers";
import { cookieDomain } from "@/lib/suite/hosts";
import { findRealm, realmsFor, type Realm } from "./realms";

export const REALM_COOKIE = "lms_realm";

const MAX_AGE_S = 60 * 60 * 24 * 90; // 90 days — a book is a habit, not a session

/**
 * The cookie's identity: name, path and DOMAIN — shared by the setter and the
 * clearer for the reason spelled out in lib/auth.ts. Clearing with a different
 * domain than you set with writes a second cookie beside the live one instead
 * of removing it.
 */
export function realmCookieIdentity() {
  const domain = cookieDomain();
  return { name: REALM_COOKIE, path: "/", ...(domain ? { domain } : {}) };
}

/**
 * Which book this request is standing in.
 *
 * Null for a lender with no second book, which is the signal every caller uses
 * to decide whether the switch exists at all.
 */
export async function activeRealm(orgSlug: string | null | undefined): Promise<Realm | null> {
  if (!realmsFor(orgSlug).length) return null;
  const jar = await cookies();
  return findRealm(orgSlug, jar.get(REALM_COOKIE)?.value ?? null);
}

/**
 * Write the choice. Route handlers only — a Server Component cannot set cookies
 * (headers are already on their way by the time it renders).
 */
export async function setRealmCookie(realmId: string): Promise<void> {
  const jar = await cookies();
  jar.set({
    ...realmCookieIdentity(),
    value: realmId,
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE_S,
  });
}
