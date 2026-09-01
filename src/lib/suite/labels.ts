// ─────────────────────────────────────────────────────────────────────────────
// THE SIX HOSTS — one table, read by both halves of the routing.
//
// Two very different places need to agree about "which subdomain is which
// system", and until now only one of them knew:
//
//   · src/proxy.ts       decides what a BARE HOST serves. It runs in the Edge
//                        runtime on every request in the product.
//   · src/lib/suite/apps.ts  declares each system's production subdomain for the
//                        launcher, and hosts.ts derives the RESERVED label list
//                        from it so no lender can be issued one.
//
// They could not simply share apps.ts: SUITE_APPS carries a lucide-react icon
// component per app, and importing React components into the edge proxy pulls a
// UI bundle into the hot path of every request in the application.
//
// So the naming lives HERE, in a file with no imports at all, and both sides
// read it. Adding a system, or renaming a subdomain, is one edit in one place.
//
// ── WHY A BARE HOST MUST REWRITE ─────────────────────────────────────────────
// A supervisor who has been sent connectdesk.servicesuitecloud.com has already
// said what they want. Landing them on the customer portal's root — which is
// what "/" serves in this deployment — and asking them to then find ConnectDesk
// in a launcher is the subdomain doing nothing for them. Worse, in a demo it
// reads as the wrong system opening.
//
// Only "/" is rewritten. Every other path on these hosts is a real route that
// must keep working unchanged, because the six systems are one Next application
// sharing auth, tenancy, the vault and RBAC — the subdomain changes which front
// door you came through, not which routes exist.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The parent domain the suite is served from.
 *
 * Changing this moves all six systems. It is also the value SUITE_COOKIE_DOMAIN
 * must be set to (with a leading dot) for single sign-on to survive the hop
 * between subdomains — see cookieDomain() in ./hosts.
 */
export const SUITE_DOMAIN = "servicesuitecloud.com";

export type SatelliteHost = {
  /** Matches SuiteApp.id in ./apps. */
  id: string;
  /** The first label of the production host. */
  label: string;
  /** The system's home — where you land once you are through the door. */
  path: string;
  /**
   * What the BARE HOST serves: this system's own branded sign-in page.
   *
   * ── WHY A DOOR AND NOT THE SYSTEM ITSELF ─────────────────────────────────
   * Somebody who was sent analytics.servicesuitecloud.com may or may not be
   * carrying a BirgenAI ID session, and the host cannot know which until the
   * request is inside the app. Rewriting straight to /analytics means the
   * person WITH a session gets in silently — which sounds ideal and is
   * actually the bug: they never see which system they just entered, and the
   * person WITHOUT one gets bounced to a generic /login that has forgotten
   * why they came.
   *
   * The door solves both. It carries this system's name, its artwork and its
   * accent, and it renders EITHER "Continue as Faith" (one click, session
   * already held) OR an email-and-password form. Same page, both audiences,
   * and the product asserts itself either way.
   *
   * NULL = no door: the bare host serves `path` directly. That is the
   * consumer app, whose installed start_url is this host and which must never
   * show a staff sign-in card. See the microeazy entry below.
   */
  door: string | null;
};

export const SATELLITE_HOSTS: readonly SatelliteHost[] = [
  { id: "lms", label: "lms", path: "/console", door: "/suite/lms/login" },
  // The consumer app's own door, not the generic portal root: this host is what
  // the INSTALLED Micro Eazy app launches into.
  //
  // `door: null` is deliberate and is the ONE exception to the rule above. This
  // host belongs to BORROWERS, not staff. Its manifest start_url is "/" on this
  // host, so every home-screen icon already in customers' hands opens here — and
  // putting a staff sign-in card in front of that would break the installed app
  // for the entire installed base at once.
  { id: "portal", label: "microeazy", path: "/microeazy", door: null },
  { id: "analytics", label: "analytics", path: "/analytics", door: "/suite/analytics/login" },
  { id: "hr", label: "peoplehub", path: "/people", door: "/suite/hr/login" },
  { id: "accounting", label: "ledgerly", path: "/books", door: "/suite/accounting/login" },
  { id: "callcenter", label: "connectdesk", path: "/desk", door: "/suite/callcenter/login" },
] as const;

/** The production host for a system id, e.g. "connectdesk.servicesuitecloud.com". */
export function satelliteHost(id: string): string {
  const s = SATELLITE_HOSTS.find((h) => h.id === id);
  if (!s) throw new Error(`No satellite host declared for suite app "${id}" in lib/suite/labels.ts.`);
  return `${s.label}.${SUITE_DOMAIN}`;
}

/** This system's home path, or null if this label is not one of the six. */
export function pathForLabel(label: string): string | null {
  return SATELLITE_HOSTS.find((h) => h.label === label)?.path ?? null;
}

/**
 * What a bare host should actually SERVE: the system's own sign-in door, falling
 * back to its home path where it has none (the consumer app). Null if this label
 * is not one of the six.
 *
 * proxy.ts reads this rather than pathForLabel, so "which page does this
 * subdomain open on" is decided in exactly one place.
 */
export function doorForLabel(label: string): string | null {
  const s = SATELLITE_HOSTS.find((h) => h.label === label);
  if (!s) return null;
  return s.door ?? s.path;
}

/**
 * Systems that are part of the suite but are NOT served by this deployment.
 *
 * The Interchange is its own repository, its own Vercel project and its own
 * database, and it authenticates members by Ed25519 node certificate rather than
 * by BirgenAI ID. It appears in the launcher and in the platform's per-lender
 * system toggles like any other system — a lender adds it to their suite — but a
 * request never reaches this application, so it has no entry in SATELLITE_HOSTS
 * and `doorForLabel("interchange")` correctly returns null.
 *
 * Its label is reserved here for the same reason the six are: a lender who
 * signed up with the slug "interchange" would take the address out from under
 * the exchange itself.
 */
export const EXTERNAL_LABELS: readonly string[] = ["interchange", "exchange"];

/**
 * The Interchange's production host. Not derived from SATELLITE_HOSTS because it
 * is not one — see EXTERNAL_LABELS above. `satelliteHost()` would throw for it,
 * and correctly so: nothing in this deployment can route to it.
 */
export const INTERCHANGE_HOST = `interchange.${SUITE_DOMAIN}`;

/** Every reserved suite label — the six served here, plus the external systems. */
export const SATELLITE_LABELS: readonly string[] = [
  ...SATELLITE_HOSTS.map((h) => h.label),
  ...EXTERNAL_LABELS,
];

/**
 * The BORROWER APP's own host — portal.servicesuitecloud.com.
 *
 * Not in SATELLITE_HOSTS, and not `satelliteHost("portal")`, because it is not
 * this deployment. The customer portal a lender's borrowers actually use is a
 * SEPARATE Vercel project (ecosystem/registry.json → `pwa`), live on this host
 * since 1 Sep 2026; `microeazy.servicesuitecloud.com` is this application's own
 * consumer route. Two labels, two projects, because only one Vercel project can
 * hold a hostname.
 *
 * A staff member who opens the portal from the console is going to the thing
 * their CUSTOMERS see, which is the deployed app — not our copy of it.
 */
export const BORROWER_PORTAL_HOST = `portal.${SUITE_DOMAIN}`;
