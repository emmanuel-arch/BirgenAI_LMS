// ─────────────────────────────────────────────────────────────────────────────
// What may THIS staff member do, right now?
//
// Rights resolve from the database on every request (30s cache), NOT from the
// session cookie. ServiceSuite froze the menu into the session at login, so a
// permission change only landed after the user signed out — a support call every
// time. Here an admin edits a role (or reassigns a staff member's role, or
// disables them) and the change is live within the cache TTL, cookie untouched.
//
// The lookup goes through the STAFF row, not the role id in the JWT: one query
// returns the live role assignment, its rights, and the staff status, so a
// reassignment or a disable takes effect just as fast as a rights edit.
//
// Cache sits on globalThis for the same reason the entitlements cache does —
// Next bundles each route separately, and a module-level Map would be one cache
// per bundle (see src/lib/billing/entitlements.ts).
// ─────────────────────────────────────────────────────────────────────────────
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Session } from "@/lib/auth";
import { ALL_RIGHTS, ALL_RIGHTS_SET, LEGACY_DEFAULT_RIGHTS, WILDCARD, type Right } from "./rights";

const TTL_MS = 30_000;

const globalForRbac = globalThis as unknown as {
  rightsCache?: Map<string, { at: number; rights: ReadonlySet<string> }>;
};
const cache = (globalForRbac.rightsCache ??= new Map());

const EVERYTHING: ReadonlySet<string> = new Set<string>(ALL_RIGHTS);
const NOTHING: ReadonlySet<string> = new Set();
const LEGACY: ReadonlySet<string> = new Set<string>(LEGACY_DEFAULT_RIGHTS);

/** Normalize a Role.rights JSON value into a usable set. Unknown keys are ignored. */
export function rightsSetFrom(raw: unknown): ReadonlySet<string> {
  if (!Array.isArray(raw)) return NOTHING;
  if (raw.includes(WILDCARD)) return EVERYTHING;
  return new Set(raw.filter((r): r is string => typeof r === "string" && ALL_RIGHTS_SET.has(r)));
}

/**
 * Resolve the caller's rights. Platform impersonation gets everything; staff with
 * no assigned role keep exactly what the console allowed before RBAC existed.
 */
export async function getRights(session: Session): Promise<ReadonlySet<string>> {
  const user = session?.user;
  if (!user?.id || !user.orgId) return NOTHING;
  // A platform admin "acting as" the org is the founder reviewing an org's setup —
  // total control, and the impersonation itself is what got audited.
  if (user.impersonator) return EVERYTHING;

  const key = `staff:${user.id}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.rights;

  // Tenant-scoped read (RLS binds via the session cookie fallback). A vanished or
  // deactivated staff row fails closed; a staff row with no role gets the legacy set.
  let rights: ReadonlySet<string> = NOTHING;
  try {
    const staff = await prisma.staffUser.findUnique({
      where: { id: user.id },
      select: { status: true, role: { select: { rights: true } } },
    });
    if (staff && staff.status === "ACTIVE") {
      rights = staff.role ? rightsSetFrom(staff.role.rights) : LEGACY;
    }
  } catch {
    // Resolver trouble must not 500 every console page. Fall back to the legacy
    // set — the pre-RBAC behavior — rather than locking the whole org out.
    rights = LEGACY;
  }

  cache.set(key, { at: Date.now(), rights });
  return rights;
}

export async function hasRight(session: Session, right: Right): Promise<boolean> {
  return (await getRights(session)).has(right);
}

/**
 * Route guard, `requireFeature` ergonomics: returns a ready-to-send response to
 * refuse, or null to proceed. 401 without a session, 403 naming the missing right
 * so the UI can explain rather than shrug.
 */
export async function requireRight(session: Session, right: Right): Promise<NextResponse | null> {
  if (!session?.user?.orgId) {
    return NextResponse.json({ success: false, message: "Sign in required." }, { status: 401 });
  }
  if (await hasRight(session, right)) return null;
  return NextResponse.json(
    {
      success: false,
      forbidden: true,
      missingRight: right,
      message: "Your role doesn't include this permission. Ask your administrator.",
    },
    { status: 403 },
  );
}

/**
 * Drop every cached rights set. Called on any role or staff write — the blast
 * radius is one org's console re-reading a 30s cache, so precision isn't worth
 * tracking which staff hold which role.
 */
export function invalidateRights(): void {
  cache.clear();
}
