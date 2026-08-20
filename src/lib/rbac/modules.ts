// ─────────────────────────────────────────────────────────────────────────────
// THE ACCESS CATALOGUE — every system, every module, in one list.
//
// ── THE PROBLEM THIS SOLVES ──────────────────────────────────────────────────
// Rights are ROLE-level and org-wide: give somebody "Collections Supervisor" and
// they get exactly what every other Collections Supervisor gets, in every one of
// the six systems at once. That is the right default and the wrong ceiling. Two
// people can share a title in the lending console and still need different
// halves of ConnectDesk — one works the queue, the other only reads the floor —
// and today the only way to express that is to invent a second role, which
// multiplies roles until nobody can say what any of them mean.
//
// So a person's access is now ROLE, then a per-person adjustment on top.
//
// ── DENY, NOT ALLOW, AND WHY THAT IS NOT LAZINESS ────────────────────────────
// A module is visible unless it has been explicitly turned OFF for that person.
// The alternative — nothing visible until granted — is the stricter-sounding
// design and the wrong one here, for the same reason Role.dataScope defaults to
// ORG: adding this column must change NOTHING for anybody who existed before it.
// An allow-list would empty twenty people's menus the moment it deployed, and
// the first anyone would know is an officer saying the system is broken.
//
// A lender narrows deliberately. That is the whole posture.
//
// ── WHAT A KEY LOOKS LIKE ────────────────────────────────────────────────────
//   "callcenter"        the whole system — the door does not appear on /suite
//   "callcenter:work"   one module inside it — the door opens, that group does not
//
// A colon, not a dot, so these can never be confused with a right key
// (`collections.manage`). They are different vocabularies doing different jobs:
// a right says what you may DO, a module key says what you are SHOWN. Rights
// still gate the routes server-side; hiding a module is not a security boundary
// on its own and is not sold as one.
// ─────────────────────────────────────────────────────────────────────────────

import { NAV_REGISTRY } from "@/lib/nav/registry";
import { DESK_NAV } from "@/lib/desk/nav";
import { STUDIO_NAV } from "@/lib/analytics/studio-nav";
import { PEOPLE_NAV, BOOKS_NAV } from "@/lib/suite/satellites";

export type CatalogItem = { key: string; label: string; right?: string };
export type CatalogModule = { key: string; label: string; icon: string; items: CatalogItem[] };
export type CatalogSystem = {
  /** Matches SuiteApp.id in lib/suite/apps. */
  id: string;
  name: string;
  accent: string;
  /** What this system is for, in one line — shown above its checkboxes. */
  blurb: string;
  modules: CatalogModule[];
};

type AnyNavModule = {
  key: string;
  label: string;
  icon?: string;
  items: { key: string; label: string; right?: string }[];
};

const toModules = (nav: readonly AnyNavModule[]): CatalogModule[] =>
  nav.map((m) => ({
    key: m.key,
    label: m.label,
    icon: m.icon ?? "Square",
    items: m.items.map((i) => ({ key: i.key, label: i.label, ...(i.right ? { right: i.right } : {}) })),
  }));

/**
 * The six systems, in launcher order.
 *
 * Display identity is repeated here rather than imported from SUITE_APPS on
 * purpose: that module carries a lucide component per app, and this catalogue is
 * serialized straight into a client editor. Pulling an icon library through it
 * would put a UI bundle behind an access-control list.
 */
export const ACCESS_CATALOG: CatalogSystem[] = [
  {
    id: "lms",
    name: "Lending Console",
    accent: "#2a78d6",
    blurb: "Originate, score, disburse and collect.",
    modules: toModules(NAV_REGISTRY),
  },
  {
    id: "callcenter",
    name: "ConnectDesk",
    accent: "#be123c",
    blurb: "The collections floor and the call centre.",
    modules: toModules(DESK_NAV),
  },
  {
    id: "analytics",
    name: "Analytics Studio",
    accent: "#7c3aed",
    blurb: "The whole book, drawn.",
    modules: toModules(STUDIO_NAV),
  },
  {
    id: "hr",
    name: "PeopleHub",
    accent: "#6d28d9",
    blurb: "The roster behind the book.",
    modules: toModules(PEOPLE_NAV),
  },
  {
    id: "accounting",
    name: "Ledgerly",
    accent: "#0f766e",
    blurb: "The journal, read live.",
    modules: toModules(BOOKS_NAV),
  },
  {
    id: "portal",
    name: "Customer Portal",
    accent: "#0e7490",
    blurb: "The customer-facing door. Staff do not sign in here.",
    modules: [],
  },
];

// ── The shape stored on StaffUser.access ─────────────────────────────────────

export type StaffAccess = {
  /** System ids and `system:module` keys this person may not see. */
  deny?: string[];
  /** Rights granted to this person beyond their role. Additive, never subtractive. */
  grant?: string[];
};

/** Parse whatever is in the Json column into a shape the app can trust. */
export function parseAccess(raw: unknown): StaffAccess {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined);
  const deny = list(o.deny);
  const grant = list(o.grant);
  return { ...(deny ? { deny } : {}), ...(grant ? { grant } : {}) };
}

export const moduleKey = (systemId: string, module: string) => `${systemId}:${module}`;

/**
 * Is this system, or this module inside it, hidden from the caller?
 *
 * Denying a SYSTEM implies denying everything in it, so a caller asking about a
 * module does not have to ask about its system first and cannot forget to.
 */
export function isDenied(denied: ReadonlySet<string>, systemId: string, module?: string): boolean {
  if (denied.has(systemId)) return true;
  return module != null && denied.has(moduleKey(systemId, module));
}

/** Every key an admin could tick, for validating what the editor posts back. */
export function allAccessKeys(): Set<string> {
  const keys = new Set<string>();
  for (const s of ACCESS_CATALOG) {
    keys.add(s.id);
    for (const m of s.modules) keys.add(moduleKey(s.id, m.key));
  }
  return keys;
}
