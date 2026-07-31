// ─────────────────────────────────────────────────────────────────────────────
// FEDERATION HOSTS — where each system actually lives, and which labels a lender
// may never be given.
//
// Phase 7 turns the suite from "five routes in one deployment" into five real
// origins. Two things have to be true for that, and neither was:
//
//   1. THE SESSION COOKIE MUST BE SCOPED TO THE PARENT DOMAIN. A cookie set on
//      lms.birgenai.com with no `domain` attribute is HOST-ONLY — the browser will
//      not send it to people.birgenai.com. Single sign-on across the suite worked
//      in development purely because all five systems were the same host. See
//      cookieDomain() and lib/auth.ts.
//
//   2. THE SATELLITE LABELS MUST BE RESERVED. Lender portals already live on
//      subdomains (mular.birgenai.com), and proxy.ts decides "is this a lender?"
//      from the first label. Without reserving them, a lender who signs up as
//      "desk" would take desk.birgenai.com out from under the call-centre — and
//      the two reserved lists that existed (src/proxy.ts and api/orgs/route.ts)
//      already disagreed with each other, so adding to one would not have been
//      enough. There is now ONE list and both read it.
//
// Origins come from the environment, with the in-app route as the fallback. That
// is what lets the same code serve the demo (one deployment, /suite/hr) and
// production (people.birgenai.com) without a branch anywhere in the UI.
// ─────────────────────────────────────────────────────────────────────────────
import { SUITE_APPS, type SuiteApp } from "./apps";

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
] as const;

/** The first label of each satellite's production host: people, books, desk, my. */
const SATELLITE_LABELS: string[] = SUITE_APPS.map((a) => a.subdomain.split(".")[0]).filter(Boolean);

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
 * The parent domain the session cookie is scoped to, e.g. ".birgenai.com".
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
  // treat `domain=birgenai.com` identically, but we normalise so the value used to
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
 * `SUITE_<ID>_ORIGIN` (e.g. SUITE_HR_ORIGIN=https://people.birgenai.com) moves a
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
  return origin ? `${origin}${app.href.startsWith("/") && app.href !== "/" ? app.href : ""}` : app.href;
}

/** True once a system has been split onto its own origin. */
export const isFederated = (app: SuiteApp): boolean => originFor(app) !== null;

/** The launcher's resolved view of the suite — computed server-side, per request. */
export type ResolvedSuiteApp = { id: string; href: string; federated: boolean };

export function resolveSuite(): ResolvedSuiteApp[] {
  return SUITE_APPS.map((a) => ({ id: a.id, href: hrefFor(a), federated: isFederated(a) }));
}
