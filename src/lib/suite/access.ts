// ─────────────────────────────────────────────────────────────────────────────
// THE THREE GATES, COMPOSED ONCE.
//
// Six layouts and the launcher all have to answer the same two questions —
// "may this person be in this system at all?" and "which systems belong in the
// switcher?" — and before this file they each answered them by hand. That is the
// shape of bug this codebase has been careful to avoid everywhere else: a rule
// implemented seven times drifts in six of them, and the one that drifts is
// discovered by a lender seeing a system they do not pay for.
//
// So the composition lives here and nothing else performs it:
//
//   ENTITLED (org bought it)  AND  VISIBLE (person's admin left it on)
//
// Rights are the third gate and deliberately NOT folded in. They gate what you
// may DO once inside, they are enforced per route by the existing rights checks,
// and a person who holds no right in a system still legitimately sees its tile
// reading "Request access". Collapsing that into this function would turn a
// useful state into an invisible one.
//
// ── WHY THE LAYOUT GUARD MATTERS MORE THAN THE MENU ──────────────────────────
// Hiding a tile is a courtesy. `requireSystem` is the control: a lender whose
// Ledgerly was switched off can still type /books, and without a server-side
// refusal they would simply be in it. Menu filtering alone has never been an
// access boundary and is not sold as one here.
// ─────────────────────────────────────────────────────────────────────────────
import { isDenied } from "@/lib/rbac/modules";
import { SUITE_APPS } from "./apps";
import { entitledSystems } from "./entitlements";

/**
 * The systems this person, at this organisation, should be shown.
 *
 * `orgSystems` is the raw `Org.systems` column; `denied` is the set from
 * getDeniedModules(). Returns ids in launcher order.
 */
export function visibleSystemIds(orgSystems: unknown, denied: ReadonlySet<string>): string[] {
  const entitled = entitledSystems(orgSystems);
  return SUITE_APPS.filter((a) => entitled.has(a.id) && !isDenied(denied, a.id)).map((a) => a.id);
}

/**
 * May this person be inside this system right now?
 *
 * Call it in the system's layout, above everything else it renders. It is the
 * difference between a system being switched off and a system being hidden.
 */
export function canEnterSystem(orgSystems: unknown, denied: ReadonlySet<string>, systemId: string): boolean {
  return visibleSystemIds(orgSystems, denied).includes(systemId);
}
