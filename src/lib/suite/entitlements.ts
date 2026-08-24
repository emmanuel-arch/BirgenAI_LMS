// ─────────────────────────────────────────────────────────────────────────────
// WHICH SYSTEMS THIS LENDER BOUGHT — the commercial boundary.
//
// ── THREE QUESTIONS, NOT ONE ─────────────────────────────────────────────────
// There are now three separate gates in front of a system, and conflating any
// two of them is what makes access control impossible to explain to the person
// on the receiving end:
//
//   ENTITLED  — did this ORGANISATION buy this system?      ← this file
//               Set by the platform admin at /platform. Commercial.
//   VISIBLE   — is it part of THIS PERSON's working life?
//               Set per person by their administrator (StaffUser.access).
//   ENTERED   — do they hold the right that opens it?
//               Set by their role. See lib/rbac/authz.
//
// They compose in that order and they compose by AND. A system the org did not
// buy is not on anybody's launcher whatever their role says, and turning it off
// here is the one switch that takes a door away from an entire company at once.
//
// ── WHY NULL MEANS EVERYTHING ────────────────────────────────────────────────
// `Org.systems` is nullable and null means "all of them". That is the same
// posture as Role.dataScope defaulting to ORG and StaffUser.access defaulting to
// nothing-denied: adding this column had to change NOTHING for the
// organisations that existed before it. An allow-list defaulting to empty would
// have emptied every launcher in the estate on the deploy that introduced it,
// and the first anyone would have known is a lender saying the product is gone.
//
// An EMPTY ARRAY is therefore a real and distinct value — "this lender has no
// systems" — and it is reachable deliberately from the platform board. It is not
// the same as null and must never be normalised into one.
//
// ── WHY UNKNOWN IDS ARE DROPPED ──────────────────────────────────────────────
// The stored value is JSON written by a UI that shipped at some point in the
// past. If a system id is ever renamed, a row still carrying the old id must
// resolve to "that system is off", not to a crash and not to a wildcard. So the
// parse intersects with SUITE_APPS and silently drops what it does not
// recognise — the launcher then shows one fewer tile, which is a visible and
// recoverable state, rather than 500ing on the first screen anybody sees.
// ─────────────────────────────────────────────────────────────────────────────
import { SUITE_APPS } from "./apps";

/** Every system id the platform knows about, in launcher order. */
export const ALL_SYSTEM_IDS: readonly string[] = SUITE_APPS.map((a) => a.id);

const KNOWN = new Set(ALL_SYSTEM_IDS);

/**
 * Parse `Org.systems` into the set of ids the organisation holds.
 *
 * Returns null when the column is null — meaning "every system", which callers
 * must distinguish from an empty set. Use {@link entitledSystems} unless you
 * specifically need to tell those two apart (the platform editor does).
 */
export function parseSystems(raw: unknown): ReadonlySet<string> | null {
  if (raw == null) return null;
  if (!Array.isArray(raw)) return null; // a malformed value reads as "unrestricted", never as "locked out"
  const ids = raw.filter((v): v is string => typeof v === "string" && KNOWN.has(v));
  return new Set(ids);
}

/**
 * The resolved set of systems this organisation may see. Null → all of them.
 *
 * This is the function every product surface should call. It never returns null
 * and never throws, so a caller cannot accidentally treat "unrestricted" as
 * "nothing".
 */
export function entitledSystems(raw: unknown): ReadonlySet<string> {
  return parseSystems(raw) ?? new Set(ALL_SYSTEM_IDS);
}

/** Has this organisation bought this system? */
export function isEntitled(raw: unknown, systemId: string): boolean {
  return entitledSystems(raw).has(systemId);
}

/**
 * Normalise a set of ids on the way IN, for the platform editor.
 *
 * Order follows SUITE_APPS rather than the order the checkboxes were clicked, so
 * the stored value of two lenders with the same systems is byte-identical and a
 * diff of the column means something.
 */
export function normaliseSystems(ids: readonly string[]): string[] {
  const wanted = new Set(ids);
  return ALL_SYSTEM_IDS.filter((id) => wanted.has(id));
}

/** True if every known system is present — the platform board renders this as "all". */
export function isAllSystems(ids: readonly string[]): boolean {
  return ALL_SYSTEM_IDS.every((id) => ids.includes(id));
}
