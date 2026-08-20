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
import { parseAccess } from "./modules";

const TTL_MS = 30_000;

const globalForRbac = globalThis as unknown as {
  rightsCache?: Map<string, { at: number; rights: ReadonlySet<string>; denied: ReadonlySet<string> }>;
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
  return (await resolve(session)).rights;
}

/**
 * Which systems and modules this person has been told not to see.
 *
 * Separate from rights on purpose, and the distinction is worth keeping straight:
 * a RIGHT says what somebody may DO and is enforced on the route; a denied module
 * says what they are SHOWN. Hiding ConnectDesk's promises module from a viewer is
 * a tidiness decision, not a security boundary, and the route behind it still
 * checks its own right. Anything that actually matters is gated by a right.
 *
 * Keys are `system` or `system:module` — see src/lib/rbac/modules.ts.
 */
export async function getDeniedModules(session: Session): Promise<ReadonlySet<string>> {
  return (await resolve(session)).denied;
}

/** One read, one cache entry, both answers — they always come from the same row. */
async function resolve(session: Session): Promise<{ rights: ReadonlySet<string>; denied: ReadonlySet<string> }> {
  const user = session?.user;
  if (!user?.id || !user.orgId) return { rights: NOTHING, denied: NOTHING };
  // A platform admin "acting as" the org is the founder reviewing an org's setup —
  // total control, and the impersonation itself is what got audited. He is also
  // the one person who must never be missing a door: no module is hidden from him.
  if (user.impersonator) return { rights: EVERYTHING, denied: NOTHING };

  const key = `staff:${user.id}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return { rights: hit.rights, denied: hit.denied };

  // Tenant-scoped read (RLS binds via the session cookie fallback). A vanished or
  // deactivated staff row fails closed; a staff row with no role gets the legacy set.
  let rights: ReadonlySet<string> = NOTHING;
  let denied: ReadonlySet<string> = NOTHING;
  try {
    const staff = await prisma.staffUser.findUnique({
      where: { id: user.id },
      select: { status: true, access: true, role: { select: { rights: true } } },
    });
    if (staff && staff.status === "ACTIVE") {
      const base = staff.role ? rightsSetFrom(staff.role.rights) : LEGACY;
      const access = parseAccess(staff.access);

      // Grants are ADDITIVE ONLY and still bounded by the rights vocabulary — a
      // per-person grant can top somebody up beyond their role, never invent a
      // permission the system does not define.
      if (access.grant?.length) {
        const merged = new Set(base);
        for (const r of access.grant) if (ALL_RIGHTS_SET.has(r)) merged.add(r);
        rights = merged;
      } else {
        rights = base;
      }

      denied = access.deny?.length ? new Set(access.deny) : NOTHING;
    }
  } catch {
    // Resolver trouble must not 500 every console page. Fall back to the legacy
    // set — the pre-RBAC behavior — rather than locking the whole org out. Nothing
    // is hidden on this path either: a failed read must not silently narrow a menu.
    rights = LEGACY;
    denied = NOTHING;
  }

  cache.set(key, { at: Date.now(), rights, denied });
  return { rights, denied };
}

export async function hasRight(session: Session, right: Right): Promise<boolean> {
  return (await getRights(session)).has(right);
}

/**
 * Per-report access: the umbrella `reports.view` opens every report; otherwise the
 * caller needs the specific report's right. The Report Access Manager grants either.
 */
export async function hasReportAccess(session: Session, specific: Right): Promise<boolean> {
  const r = await getRights(session);
  return r.has("reports.view") || r.has(specific);
}

/**
 * THE ANTI-ESCALATION RULE. May an actor holding `actorRights` grant a role whose
 * rights are `roleRightsRaw`? Only if that role grants NOTHING the actor lacks — you
 * cannot hand out access you do not hold, so you cannot promote anyone (least of all
 * yourself) above your own ceiling. This is the exact hole that lets an "Administrator"
 * tick "Super Admin" out of a dropdown; here the server refuses, and the UI never
 * offers it. A wildcard/everything actor may grant anything.
 */
export function canGrantRights(actorRights: ReadonlySet<string>, roleRightsRaw: unknown): boolean {
  const target = rightsSetFrom(roleRightsRaw);
  for (const r of target) if (!actorRights.has(r)) return false;
  return true;
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
