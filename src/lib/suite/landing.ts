// ─────────────────────────────────────────────────────────────────────────────
// WHERE A SIGNED-IN STAFF MEMBER LANDS.
//
// This replaces /suite, and the replacement is the point rather than a tidy-up.
//
// ── WHY THE LAUNCHER WENT ────────────────────────────────────────────────────
// Every staff sign-in used to end on a launcher page: a grid of tiles, one per
// system, that the person then clicked through to get where they were already
// going. It was a menu standing between somebody and their work, on the way IN,
// every single morning. Worse, it was the first screen anybody saw of the
// product — so the first impression of a lending platform was a screen with no
// lending on it.
//
// The launcher is not gone; it MOVED. It is the grid in the identity menu at the
// top-right corner of every system (components/shell/IdentityMenu), which is
// where every product in the world puts one and where somebody who wants to
// switch will actually look for it. Switching systems is a thing you do
// occasionally, from inside a system. It is not a toll gate on the front door.
//
// ── SO WHERE DOES SIGN-IN END? ───────────────────────────────────────────────
// In a system. Which one is answered in this order:
//
//   1. THE DOOR THEY KNOCKED ON. Somebody who typed
//      connectdesk.servicesuitecloud.com has already said what they want, and
//      landing them in the lending console instead is the subdomain doing
//      nothing for them. The host decides, where the host names a system.
//   2. THE FIRST SYSTEM THEY HOLD, in launcher order. A collections supervisor
//      who signs in at the LMS host does not hold the console — she is not shown
//      a refusal, she is put on the floor she does work on.
//
// "Hold" is the composed answer: entitled (the org bought it) AND visible (her
// administrator left it switched on for her). See ./access and ./entitlements.
//
// ── TWO OF THE SEVEN ARE NOT LANDINGS ────────────────────────────────────────
// The Customer Portal belongs to borrowers — staff open it to see what a
// customer sees, and nobody should be deposited there by signing in. The
// Interchange is a separate deployment with its own member gate, so this
// application cannot put anybody inside it. Neither has a staff home here, and
// neither is a candidate.
// ─────────────────────────────────────────────────────────────────────────────
import { SUITE_APPS } from "./apps";

/**
 * Each system's HOME in this deployment — the screen you land on, not the door
 * you knock on. Keyed by SuiteApp.id, in launcher order via SUITE_APPS.
 *
 * A system absent from this map has no staff home here (see the note above), and
 * is therefore never a landing however entitled somebody is to it.
 */
const STAFF_HOME: Record<string, string> = {
  lms: "/console",
  analytics: "/analytics",
  hr: "/people",
  accounting: "/books",
  callcenter: "/desk",
};

/**
 * Where somebody with no system at all is sent.
 *
 * It is a real page rather than a redirect back to sign-in: the person IS
 * authenticated, and bouncing them to a login card to tell them their
 * administrator has switched everything off reads as a broken session, which is
 * the wrong support ticket. It is also what keeps this function safe to call
 * from a layout — /console redirecting to /console is an infinite loop, and the
 * only way to guarantee it cannot happen is for the fallback to be somewhere
 * that gates nothing.
 */
export const NO_SYSTEMS = "/no-access";

/** The staff home for one system id, or null where it has none. */
export function homeFor(systemId: string | null | undefined): string | null {
  return (systemId && STAFF_HOME[systemId]) || null;
}

/**
 * The path to put this person on.
 *
 * @param visible  System ids they hold — entitled AND not denied. Pass the
 *                 already-composed answer from visibleSystemIds(); this function
 *                 deliberately does not recompute it, so there is one place
 *                 where "may see" is decided.
 * @param preferred A system id to try first — normally the one the host names.
 *                 Ignored when they do not hold it.
 */
export function staffLanding(visible: readonly string[], preferred?: string | null): string {
  const held = new Set(visible);
  if (preferred && held.has(preferred)) {
    const home = homeFor(preferred);
    if (home) return home;
  }
  // Launcher order, so "their first system" means the same thing here as it does
  // on the grid in the identity menu.
  for (const app of SUITE_APPS) {
    if (!held.has(app.id)) continue;
    const home = homeFor(app.id);
    if (home) return home;
  }
  return NO_SYSTEMS;
}

/**
 * The same decision, for a caller that has been REFUSED by the system it is
 * standing in — a console layout finding this person does not hold `lms`.
 *
 * `except` is dropped from the candidates before the choice is made, which is
 * what stops a refusal redirecting to the page that just refused. Without it a
 * layout that redirects on "you may not be here" would send a person who holds
 * nothing straight back to itself.
 */
export function landingExcept(visible: readonly string[], except: string): string {
  return staffLanding(visible.filter((id) => id !== except));
}
