// ─────────────────────────────────────────────────────────────────────────────
// FEDERATION HOSTS — where each system actually lives, and which labels a lender
// may never be given.
//
// Phase 7 turns the suite from "five routes in one deployment" into five real
// origins. Two things have to be true for that, and neither was:
//
//   1. THE SESSION COOKIE MUST BE SCOPED TO THE PARENT DOMAIN. A cookie set on
//      lms.servicesuitecloud.com with no `domain` attribute is HOST-ONLY — the
//      browser will not send it to peoplehub.servicesuitecloud.com. Single
//      sign-on across the suite worked in development purely because all six
//      systems were the same host. See cookieDomain() and lib/auth.ts.
//
//   2. THE SATELLITE LABELS MUST BE RESERVED. Lender portals already live on
//      subdomains, and proxy.ts decides "is this a lender?" from the first
//      label. Without reserving them, a lender who signs up as "connectdesk"
//      would take connectdesk.servicesuitecloud.com out from under the
//      call-centre — and the two reserved lists that existed (src/proxy.ts and
//      api/orgs/route.ts) already disagreed with each other, so adding to one
//      would not have been enough. There is now ONE list and both read it.
//
// Origins come from the environment, with the in-app route as the fallback. That
// is what lets the same code serve the demo (one deployment, /suite/hr) and
// production (peoplehub.servicesuitecloud.com) without a branch anywhere in the UI.
// ─────────────────────────────────────────────────────────────────────────────
import { SUITE_APPS, type SuiteApp } from "./apps";
import { SATELLITE_LABELS, BORROWER_PORTAL_HOST } from "./labels";

/**
 * Labels that are PLATFORM surfaces, never a lender slug.
 *
 * Three groups, and each is here for its own reason:
 *   · infrastructure — www/api/cdn and friends
 *   · platform surfaces — the console, the admin, the sign-in doors
 *   · the suite satellites — derived from SUITE_APPS below, so adding a system to
 *     the launcher reserves its subdomain automatically rather than requiring
 *     someone to remember a second edit.
 */
const INFRA_LABELS = ["www", "api", "cdn", "static", "mail", "smtp", "ns", "localhost"] as const;
const PLATFORM_LABELS = [
  "lms", "app", "admin", "console", "hub", "birgenai", "platform", "login", "onboard", "demo", "auth", "id", "status",
  // The consumer app's own host (blueprint D1). Reserved for the same reason the
  // satellites are, but the consequence is worse: a lender who took this slug
  // would not merely shadow a platform page, they would own the address the
  // INSTALLED Micro Eazy app launches into — start_url and scope are both "/" on
  // this host, so every home-screen icon already in customers' hands would open
  // onto that lender's portal. An installed base cannot be un-pointed.
  "microeazy",
  // The BORROWER PWA's host — portal.servicesuitecloud.com, a separate Vercel
  // project from this one (see ecosystem/registry.json → pwa.deploy).
  //
  // It is reserved here even though this deployment never serves it, and that is
  // the point: reservation is decided when a lender picks a slug, which happens
  // in THIS app. Without the entry a lender signing up as "portal" would be
  // handed a subdomain that DNS already points at the borrower app — the two
  // would fight for the host, and the winner would be whichever project last
  // claimed the domain in Vercel. Exactly the collision that took
  // microeazy.servicesuitecloud.com off the air.
  //
  // "app" is already on this list above and stays there: it was the PWA's
  // previous label, it still resolves to the legacy IIS box, and it must not be
  // handed out either.
  "portal",
] as const;

// The satellite labels come from ./labels, which is also what the edge proxy
// reads to decide what a bare host serves. Deriving them here from SUITE_APPS
// instead would work right up until a subdomain was renamed in one file only.

export const RESERVED_LABELS: ReadonlySet<string> = new Set<string>([
  ...INFRA_LABELS,
  ...PLATFORM_LABELS,
  ...SATELLITE_LABELS,
]);

/** May a lender be given this subdomain label? */
export function isReservedLabel(label: string): boolean {
  return RESERVED_LABELS.has((label ?? "").trim().toLowerCase());
}

/**
 * The parent domain the session cookie is scoped to, e.g. ".servicesuitecloud.com".
 *
 * Unset in development (and in preview builds) on purpose: a cookie with a
 * `domain` of ".localhost" is rejected by browsers, and one scoped to
 * ".vercel.app" would be shared with every other tenant of that domain — which is
 * the opposite of a security boundary. Absent means host-only, which is the safe
 * default and exactly what a single-deployment demo needs.
 */
export function cookieDomain(): string | undefined {
  const raw = process.env.SUITE_COOKIE_DOMAIN?.trim();
  if (!raw) return undefined;
  const d = raw.toLowerCase();
  // A leading dot is the classic way to say "and subdomains"; modern browsers
  // treat `domain=servicesuitecloud.com` identically, but we normalise so the value used to
  // SET and the value used to CLEAR can never differ by a character.
  const normalised = d.startsWith(".") ? d : `.${d}`;
  // Refuse anything that cannot be a real parent domain — a misconfiguration here
  // would silently sign users out (cookie set, never sent back) rather than fail.
  if (normalised === "." || !normalised.includes(".", 1) || normalised.endsWith(".localhost")) return undefined;
  return normalised;
}

/**
 * Where a system lives right now.
 *
 * `SUITE_<ID>_ORIGIN` (e.g. SUITE_HR_ORIGIN=https://peoplehub.servicesuitecloud.com) moves a
 * satellite out of this deployment. Until it is set, the app keeps its in-app
 * route, so a system can be split out one at a time with no code change and no
 * flag-day.
 */
export function originFor(app: SuiteApp): string | null {
  const key = `SUITE_${app.id.toUpperCase()}_ORIGIN`;
  const raw = process.env[key]?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null; // a malformed origin falls back to the in-app route rather than 404ing
  }
}

/** The href the launcher and the switcher should link to for this system. */
export function hrefFor(app: SuiteApp): string {
  const origin = originFor(app);
  if (origin) return `${origin}${app.href.startsWith("/") && app.href !== "/" ? app.href : ""}`;
  // An EXTERNAL system has no in-app route to fall back to. `app.href` is "/" for
  // the Interchange, and returning that would link the launcher tile at this
  // deployment's own root — a door that silently opens onto the wrong building.
  // Its declared production subdomain is the honest answer: it is where the
  // system lives, whether or not SUITE_INTERCHANGE_ORIGIN has been set yet.
  if (app.external) return `https://${app.subdomain}`;
  return app.href;
}

/**
 * Where the BORROWER APP is served from — the deployed PWA, not our copy of it.
 *
 * BORROWER_PORTAL_ORIGIN overrides it (a staging build, or the day the rebuild
 * in `micro-eazy-app` takes the hostname over). The default is the live host,
 * because that is where a lender's customers are today.
 */
function borrowerPortalOrigin(): string {
  const raw = process.env.BORROWER_PORTAL_ORIGIN?.trim();
  if (raw) {
    try {
      const url = new URL(raw);
      if (url.protocol === "https:" || url.protocol === "http:") return url.origin;
    } catch { /* malformed ⇒ the live host, never a broken link */ }
  }
  return `https://${BORROWER_PORTAL_HOST}`;
}

/**
 * A DEEP LINK into another system — its origin plus a path INSIDE it.
 *
 * This is the difference the console's sidebar is built on, and it is worth
 * saying plainly because the two look identical in a menu:
 *
 *   · The LAUNCHER (/suite) sends you to a system's FRONT DOOR. You may be
 *     arriving cold, so the door introduces the system and, if you are already
 *     carrying a BirgenAI ID, offers "continue as…" — see doorHrefFor().
 *   · A SIDEBAR CROSS-LINK sends you to the SCREEN. You are already signed in,
 *     you already know which system you want, and you asked for one specific
 *     view of it. Routing that through a sign-in page is the product forgetting
 *     what you just clicked.
 *
 * Only "/" on a satellite host is rewritten to its door (see labels.ts), so a
 * path lands where it says it will and the session rides along on the shared
 * `.servicesuitecloud.com` cookie. In a single-deployment build the same call
 * returns the plain in-app route — the same screen by a shorter road.
 *
 * Returns null for a system id that does not exist, so a typo in the nav
 * registry drops the item rather than linking at this deployment's own root.
 */
export function deepLinkFor(systemId: string, path: string): string | null {
  const app = SUITE_APPS.find((a) => a.id === systemId);
  if (!app) return null;
  const p = path.startsWith("/") ? path : `/${path}`;
  const tail = p === "/" ? "" : p;

  // THE BORROWER APP IS NOT THIS DEPLOYMENT. `portal` is the only system whose
  // production host belongs to a DIFFERENT Vercel project (see
  // BORROWER_PORTAL_HOST), so it must never fall back to an in-app route: this
  // application's "/" is the consumer surface we build, not the one customers
  // have already installed. Staff who open "the customer portal" mean the app
  // their borrowers are actually holding.
  //
  // It reads its OWN variable rather than SUITE_PORTAL_ORIGIN, and the
  // distinction is real: SUITE_PORTAL_ORIGIN is the launcher's tile and points
  // at microeazy.servicesuitecloud.com, which is this deployment's consumer
  // route. Pointing a staff deep-link there would show an officer our copy of
  // the app instead of the one on the customer's phone.
  if (systemId === "portal") return `${borrowerPortalOrigin()}${tail}`;
  // An external system has no in-app route either — its declared production host
  // is the honest answer whether or not an origin has been configured yet.
  if (app.external) return `${originFor(app) ?? `https://${app.subdomain}`}${tail}`;

  const origin = originFor(app);
  return origin ? `${origin}${p}` : p;
}

/** True once a link into this system leaves this origin — i.e. it is a real hop. */
export function leavesDeployment(systemId: string): boolean {
  const app = SUITE_APPS.find((a) => a.id === systemId);
  if (!app) return false;
  return systemId === "portal" || !!app.external || originFor(app) !== null;
}

/**
 * The system's own branded sign-in door.
 *
 * Where a system has been split onto its own origin the door lives over there
 * too — analytics.servicesuitecloud.com serves /suite/analytics/login from its
 * own deployment — so this composes with originFor() rather than always
 * returning a local path.
 *
 * Null for systems that have no staff door: the Customer Portal (borrowers) and
 * the Interchange (external, its own member gate).
 */
export function doorHrefFor(app: SuiteApp): string | null {
  if (app.external || app.door === false) return null;
  const path = `/suite/${app.id}/login`;
  const origin = originFor(app);
  return origin ? `${origin}${path}` : path;
}

/** True once a system has been split onto its own origin. */
export const isFederated = (app: SuiteApp): boolean => originFor(app) !== null;

/** The launcher's resolved view of the suite — computed server-side, per request. */
export type ResolvedSuiteApp = {
  id: string;
  href: string;
  federated: boolean;
  /** This system's branded sign-in page, or null where it has none. */
  door: string | null;
  /** A separate deployment — the launcher leaves the building to reach it. */
  external: boolean;
};

/**
 * @param only  System ids to include — the caller's already-composed answer to
 *              "entitled AND visible" (see lib/suite/access.ts). Omit for every
 *              system, which is what an unauthenticated or platform surface
 *              wants. An EMPTY array is honoured as empty, not treated as "all":
 *              a lender with no systems must not get a full switcher.
 */
export function resolveSuite(only?: readonly string[]): ResolvedSuiteApp[] {
  const apps = only ? SUITE_APPS.filter((a) => only.includes(a.id)) : SUITE_APPS;
  return apps.map((a) => ({
    id: a.id,
    href: hrefFor(a),
    federated: isFederated(a),
    door: doorHrefFor(a),
    external: !!a.external,
  }));
}

/**
 * Resolve every cross-system item in a nav tree to a real link.
 *
 * The registry declares a system id and a path inside it; only the server knows
 * which systems have been split onto their own origins, so the resolution
 * happens here, once per request, and the client shell renders whatever it is
 * handed. `external` is what the sidebar draws the arrow from — and it is
 * derived rather than typed, so a satellite that federates tomorrow starts
 * opening in its own tab without anybody editing a menu.
 *
 * Generic over the item shape so the console's registry and the satellites'
 * own nav trees can both be passed without this file importing either.
 */
export function linkCrossSystem<M extends { items: { href?: string; system?: string }[] }>(
  nav: M[],
): (Omit<M, "items"> & { items: (M["items"][number] & { external?: boolean })[] })[] {
  return nav.map((mod) => ({
    ...mod,
    items: mod.items.map((item) => {
      if (!item.system) return item;
      const href = deepLinkFor(item.system, item.href ?? "/");
      // A system id that resolves to nothing is a typo in the registry. Leave
      // the item's own href alone rather than inventing a link: a door that
      // does not move is easier to notice than one onto the wrong building.
      if (!href) return item;
      return { ...item, href, external: leavesDeployment(item.system) };
    }),
  }));
}
