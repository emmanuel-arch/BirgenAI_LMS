// ─────────────────────────────────────────────────────────────────────────────
// STUDIO SCOPE — which database answers, and for which books.
//
// ── THE BUG THIS FILE EXISTS TO FIX ──────────────────────────────────────────
// Every studio surface asked Postgres. For a NATIVE lender that is right: their
// book lives in our Postgres and nowhere else. For Micromart it was catastrophic
// and silent — their Postgres row holds 199 loans, so the board view greeted the
// room with "There is no open book in this cut" while the real book, one relay
// hop away, held 275,605 loans and KES 350.5M outstanding.
//
// Nothing threw. Postgres answered correctly; it was simply asked about the
// wrong book. So the fix is not a try/catch, it is making "which book" an
// explicit, resolved value that every query carries.
//
// ── THE THREE STATES, AND WHY THE THIRD IS NOT AN ERROR ──────────────────────
//   · POSTGRES   — a native lender. Unchanged, and the overwhelming majority.
//   · LIVE       — a bridged lender whose ServiceSuite connection is reachable
//                  (directly on the tailnet, or through the SQL relay).
//   · UNAVAILABLE— a bridged lender we CANNOT reach. This is its own state and
//                  not a fallback to Postgres, because falling back is exactly
//                  what produced the original bug: a real answer to the wrong
//                  question is worse than a named refusal.
//
// ── ENTITY LENSES ────────────────────────────────────────────────────────────
// A lens is one book in the cut. One lens is an ordinary read. Two lenses can be
// COMBINED (summed into a single figure) or SPLIT (every measure broken out per
// entity, drawn side by side). Split is not more expensive: it is the same query
// with `GROUP BY EntityId` added — measured at 152ms against 149ms for a single
// entity over twelve months of Micromart's book.
// ─────────────────────────────────────────────────────────────────────────────
import { getOrg, getEntityId, isOrgConfigured, type OrgDef } from "@/lib/enterprise/connections";
import { realmsFor, type Realm } from "@/lib/suite/realms";

/**
 * How a book's arrears are computed. Declared per entity, never guessed, and
 * carried all the way to the screen so a comparison can say which is which.
 *
 * ── WHY TWO STRATEGIES ───────────────────────────────────────────────────────
 * Every PAR figure in this suite comes from CollectBox.CollectionTracker. A live
 * count on 29 Aug 2026 found 95,799 tracked loans and **every single one of them
 * is EntityId 3002**. The tracker does not cover the fintech book, has never
 * covered it, and asking it about 3005 returns zero rows — which would render as
 * a book with no arrears rather than a book with no data.
 *
 * So the fintech book's arrears are DERIVED from the loan's own dates. The two
 * numbers are not interchangeable and must never be silently mixed: on 3002 the
 * tracker says 60,924 loans / KES 232.4M over 30 days while the derived rule
 * says 51,590 / KES 273.6M. Both are defensible; they measure different things.
 */
export type ArrearsBasis = "tracker" | "derived";

/**
 * Which entities the CollectBox tracker actually covers.
 *
 * A declared list rather than a runtime probe: probing would add a round trip to
 * every page load to re-learn a fact that changes when somebody deploys a
 * collections floor, not when a user clicks. When Micromart's floor is extended
 * to the fintech book, add 3005 here.
 */
const TRACKED_ENTITIES = new Set<number>([3002]);

export function arrearsBasis(entityId: number): ArrearsBasis {
  return TRACKED_ENTITIES.has(entityId) ? "tracker" : "derived";
}

/** One book in the cut. */
export type EntityLens = {
  /** ServiceSuite EntityId. */
  id: number;
  /** The realm id, when this lens came from a realm ("sme", "fintech", …). */
  realmId: string | null;
  /** Short, for a chip or a series name. */
  label: string;
  /** The book's full name. */
  name: string;
  /** Accent for this lens's series in a split chart. */
  accent: string;
  basis: ArrearsBasis;
};

export type LiveScope = {
  org: OrgDef;
  /** One or more books. Never empty. */
  lenses: EntityLens[];
  /** true ⇒ every measure is broken out per lens instead of summed. */
  split: boolean;
};

export type StudioScope = {
  orgId: string;
  orgSlug: string;
  /** Non-null ⇒ read ServiceSuite. Null ⇒ Postgres, or nothing at all. */
  live: LiveScope | null;
  /**
   * Set ONLY when the org's book is known to live elsewhere and we cannot reach
   * it. A page that sees this must say so rather than draw an empty chart.
   */
  unavailable: string | null;
};

/** Every book this lender has, in display order. */
export function lensesFor(orgSlug: string, opts: { accents?: Record<string, string> } = {}): EntityLens[] {
  const realms = realmsFor(orgSlug);
  if (realms.length) {
    return realms.map((r: Realm) => ({
      id: r.entityId,
      realmId: r.id,
      label: r.label,
      name: r.name,
      accent: r.brand?.accent ?? opts.accents?.[r.id] ?? "#4E4442",
      basis: arrearsBasis(r.entityId),
    }));
  }
  // A bridged lender with a single book still belongs on the live path — the
  // original bug was never specific to multi-entity lenders, it just showed up
  // there first because those are the two with the biggest books.
  const org = getOrg(orgSlug);
  if (!org) return [];
  const id = getEntityId(org);
  return [{ id, realmId: null, label: org.name, name: org.name, accent: "#4E4442", basis: arrearsBasis(id) }];
}

/**
 * Which connection ANALYTICS reads through — the organisation's own, always.
 *
 * ── THIS DELIBERATELY IGNORES Realm.connection, AND HERE IS WHY ──────────────
 * A realm names a connection because POSTING needs one: an approved loan must be
 * booked into the fintech ledger through the credential that owns it, and
 * `micromart-fintech` exists as a separate entry for exactly that.
 *
 * Reading is a different question. Both Micromart books live on the SAME SQL
 * Server — verified by a direct read on 29 Aug 2026 that returned 3002, 3003 and
 * 3005 from one connection — and the ENTITY is what scopes a read, not the
 * credential. Using the realm's connection here had two consequences, both
 * discovered by the live test rather than by reasoning:
 *
 *   · A combined cut collapsed to ONE book, because the two lenses named
 *     different OrgDefs and the second was filtered out as unreachable. Side by
 *     side silently became side.
 *   · The relay host has no MICROMART_FINTECH credential, so the fintech read
 *     failed with a 503 even though the data was one entity id away on a
 *     connection that was already open.
 *
 * One connection per organisation, scoped by EntityId. That is the same rule
 * the rest of the suite reads by (lib/suite/ledger.ts, journal.ts).
 */
function connectionFor(orgSlug: string): OrgDef | null {
  return getOrg(orgSlug);
}

export type ScopeRequest = {
  orgId: string;
  orgSlug: string;
  orgMode: string;
  /** Entity ids the reader asked for. Empty ⇒ fall back to `fallbackRealmId`. */
  entityIds: number[];
  /** The console realm, so the studio opens on the book you were already in. */
  fallbackRealmId: string | null;
  split: boolean;
};

/**
 * Resolve a request into the scope every query will carry.
 *
 * Entity ids from the URL are matched against the lender's OWN declared lenses
 * and anything else is dropped — the same allowlist posture as the realm cookie.
 * A hand-typed `?ent=3002` on Axe's studio selects nothing and falls back, rather
 * than reading Micromart's book through Axe's session.
 */
export function resolveScope(req: ScopeRequest): StudioScope {
  const base = { orgId: req.orgId, orgSlug: req.orgSlug };
  const all = lensesFor(req.orgSlug);

  // A native lender's book IS Postgres. Nothing below applies.
  if (!all.length || req.orgMode !== "BRIDGED") {
    return { ...base, live: null, unavailable: null };
  }

  const asked = all.filter((l) => req.entityIds.includes(l.id));
  const fallback = all.find((l) => l.realmId === req.fallbackRealmId) ?? all[0];
  const lenses = asked.length ? asked : [fallback];

  const org = connectionFor(req.orgSlug);
  if (!org) {
    return { ...base, live: null, unavailable: `No connection is declared for ${req.orgSlug}.` };
  }
  if (!isOrgConfigured(org)) {
    return {
      ...base,
      live: null,
      unavailable: `${org.name}'s book is not connected yet. Set ${org.connEnv}, or point this deployment at the SQL relay.`,
    };
  }

  return {
    ...base,
    live: { org, lenses, split: req.split && lenses.length > 1 },
    unavailable: null,
  };
}

/** The entity ids in this scope — what the SQL will filter on. */
export function scopeEntityIds(scope: StudioScope): number[] {
  return scope.live?.lenses.map((l) => l.id) ?? [];
}
