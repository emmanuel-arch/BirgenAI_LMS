// ─────────────────────────────────────────────────────────────────────────────
// REALMS — one organisation, more than one book.
//
// Micromart is not a lender, it is TWO lenders wearing one name. EntityId 3002
// is the branch business (140k borrowers, officer-led, business and school-fees
// and personal credit) and EntityId 3005 is Micromart Fintech (Micro Eazy —
// 17,016 borrowers migrated out of 3002 on 2 Aug 2026, and no officer anywhere
// in the loop). Same building, same brand, same managers signing in — two books
// that must never be confused for one another. Axe is the same shape.
//
// WHY THIS IS ITS OWN CONCEPT and not a second Org row: the two books share an
// identity, a staff list and a licence. Morris does not "sign out of Micromart
// and into Micromart Fintech" — he is the General Manager of both, all day, and
// the question the console has to answer for him is only ever "which book am I
// standing in right now". That is a CONTEXT, and contexts belong in a cookie
// next to the session, not in the session itself.
//
// ── THE SAFETY PROPERTY ──────────────────────────────────────────────────────
// A realm carries an EntityId, and an EntityId is an identity boundary rather
// than a label: connections.ts records that 13 phone numbers exist in BOTH 3002
// and 3005 belonging to DIFFERENT human beings. Resolving a borrower in the
// wrong realm hands back the wrong person. So the entity ids live HERE, spelled
// out, next to the reason — never derived from whichever OrgDef happened to be
// in scope, and never taken from the client. The cookie names a realm; the
// realm names the entity; the list of realms is fixed at build time. A tampered
// cookie can only ever select something already on this page.
//
// ── BRANDING ─────────────────────────────────────────────────────────────────
// The Micromart mark is exactly two colours — gold #E6B617 and espresso #4E4442,
// sampled off public/lenders/micromart/logo.png. Two colours, two books. The
// fintech realm inherits the organisation's OWN stored brand (the espresso the
// console already wears, unchanged and un-retyped), and the SME realm takes the
// gold. Nobody has to read a label to know which book they are in.
//
// The gold is darkened for the accent because the logo gold cannot carry white
// text: #E6B617 on white is 1.90:1, which fails every threshold there is.
// #8C6512 is the same hue at 5.27:1 — AA for body text, AAA for large. The true
// logo gold survives as the light end of the gradient, where contrast is not a
// question being asked.
// ─────────────────────────────────────────────────────────────────────────────
import type { OrgSlug } from "@/lib/enterprise/connections";

export type RealmId = "sme" | "fintech";

export type RealmBrand = {
  /** Drives --brand. Must carry white text: ≥4.5:1 against #fff. */
  accent: string;
  /** Drives --brand-soft. Translucent wash for fills and chips. */
  accentSoft: string;
  /** The far end of the gradient — decorative, so contrast is not a constraint. */
  accent2: string;
};

export type Realm = {
  id: RealmId;
  /** What the switch itself says. Keep it to one word. */
  label: string;
  /** The book's registered name, shown while switching. */
  name: string;
  /** One line: what this book IS. */
  blurb: string;
  /** The ServiceSuite EntityId this realm reads and books into. */
  entityId: number;
  /**
   * Which configured connection opens a socket for this realm. Both Micromart
   * books now live on the SAME server (Micromart's own box, reachable over the
   * tailnet), so this is not a second machine — it is which env-configured
   * credential is used, and it stays separate because the two entries have
   * different connection strings and either may be rotated alone.
   */
  connection: OrgSlug;
  /**
   * null ⇒ wear the organisation's own stored brand, exactly as it is today.
   *
   * That is deliberate rather than lazy. "Leave the current one alone" is a
   * requirement, and the only way to keep a promise like that permanently is to
   * not copy the values anywhere — a copy drifts the first time somebody edits
   * the org's brand in Settings and forgets this file exists.
   */
  brand: RealmBrand | null;
  /** The realm a user lands in before they have ever chosen. Exactly one per org. */
  isDefault?: true;
};

const MICROMART: Realm[] = [
  {
    id: "sme",
    label: "SME",
    name: "Micromart Africa",
    blurb: "The branch book — officer-led business, school-fees and personal credit.",
    entityId: 3002,
    connection: "micromart",
    brand: {
      accent: "#8C6512",
      accentSoft: "rgba(230,182,23,0.14)",
      accent2: "#E6B617",
    },
  },
  {
    id: "fintech",
    label: "Fintech",
    name: "Micromart Fintech",
    blurb: "Micro Eazy — apply to disbursement with no officer in the loop.",
    entityId: 3005,
    connection: "micromart-fintech",
    brand: null,
    // The console already wears this book's colours and the pilot lives here,
    // so this is where an unchosen user lands: turning the switch on changes
    // nothing about what anybody sees until they press it.
    isDefault: true,
  },
];

/**
 * Declared realms, by org slug.
 *
 * AXE IS NOT HERE YET, and that is the point of the omission rather than an
 * oversight. Axe Capital has the same two-book shape, but only one of its
 * EntityIds has been verified against a live read (3003). Declaring the second
 * from memory would put a manager in a book that may not be theirs, and the
 * failure would be silent — the console would look right and read the wrong
 * ledger. Add the pair here the day the second id is confirmed; the switch
 * turns itself on for Axe at that moment and needs no other edit.
 */
export const REALMS: Record<string, Realm[]> = {
  micromart: MICROMART,
};

/**
 * The realms a lender can switch between — EMPTY unless there is a real choice.
 *
 * A single-book lender gets [] rather than a list of one, so every caller can
 * ask the same question ("are there realms?") instead of each remembering to
 * check the length. One book is not a choice, and a switch with one setting is
 * an invitation to wonder what the other one does.
 */
export function realmsFor(slug: string | null | undefined): Realm[] {
  const list = REALMS[(slug ?? "").trim().toLowerCase()] ?? [];
  return list.length > 1 ? list : [];
}

/** Where a user who has never chosen lands. */
export function defaultRealm(slug: string | null | undefined): Realm | null {
  const list = realmsFor(slug);
  if (!list.length) return null;
  return list.find((r) => r.isDefault) ?? list[0];
}

/**
 * Resolve an untrusted realm id against what this org actually has.
 *
 * The allowlist IS the validation. Anything not on it — a stale cookie from an
 * org that has realms, a hand-edited one, a value from a lender who has none —
 * resolves to the default rather than to an error, because a bad context should
 * put you somewhere safe and obvious, not somewhere broken.
 */
export function findRealm(slug: string | null | undefined, id: string | null | undefined): Realm | null {
  const list = realmsFor(slug);
  if (!list.length) return null;
  return list.find((r) => r.id === id) ?? defaultRealm(slug);
}

export type OrgBrand = { accent: string; accentSoft: string; accent2?: string | null };

/**
 * What a realm is painted in — its own palette, or the org's when it declares
 * none. `accent2` falls back to the accent so a gradient always has two stops
 * and never renders as a flat band by accident.
 */
export function brandFor(realm: Realm | null, org: OrgBrand): RealmBrand {
  if (realm?.brand) return realm.brand;
  return { accent: org.accent, accentSoft: org.accentSoft, accent2: org.accent2 || org.accent };
}
