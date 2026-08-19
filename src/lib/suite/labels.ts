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
  /** What the bare host serves, as an in-app path. */
  path: string;
};

export const SATELLITE_HOSTS: readonly SatelliteHost[] = [
  { id: "lms", label: "lms", path: "/console" },
  // The consumer app's own door, not the generic portal root: this host is what
  // the INSTALLED Micro Eazy app launches into.
  { id: "portal", label: "microeazy", path: "/microeazy" },
  { id: "analytics", label: "analytics", path: "/analytics" },
  { id: "hr", label: "peoplehub", path: "/people" },
  { id: "accounting", label: "ledgerly", path: "/books" },
  { id: "callcenter", label: "connectdesk", path: "/desk" },
] as const;

/** The production host for a system id, e.g. "connectdesk.servicesuitecloud.com". */
export function satelliteHost(id: string): string {
  const s = SATELLITE_HOSTS.find((h) => h.id === id);
  if (!s) throw new Error(`No satellite host declared for suite app "${id}" in lib/suite/labels.ts.`);
  return `${s.label}.${SUITE_DOMAIN}`;
}

/** What a bare host should serve, or null if this label is not one of the six. */
export function pathForLabel(label: string): string | null {
  return SATELLITE_HOSTS.find((h) => h.label === label)?.path ?? null;
}

/** Every reserved satellite label. */
export const SATELLITE_LABELS: readonly string[] = SATELLITE_HOSTS.map((h) => h.label);
