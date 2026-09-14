// ─────────────────────────────────────────────────────────────────────────────
// THE FEDERATION — this estate's published maps, and the secret its hand-offs sign with.
//
// Riri Ecosystem AI plan §06 and Sprint 3. Two manifests are published from here:
//
//   lms  the lender console's SYSTEM_SCREENS, served to signed-in staff only. The
//        plan's decision stands: a partner's Riri does NOT get our console's map —
//        it names every right and every implication of our software.
//   app  the customer app's screens, served to anyone — they describe what a
//        borrower can see, which is public by construction.
//
// A hand-off link is signed with RIRI_HANDOFF_SECRET when it is set, otherwise with
// a key derived from NEXTAUTH_SECRET under its own label, so it can never be
// replayed as a session token and a deployment works before anyone sets a new
// variable.
// ─────────────────────────────────────────────────────────────────────────────
import { SYSTEM_SCREENS } from "./system-map";
import { APP_SCREENS, APP_MAP_VERSION } from "./portal/app-map";
import type { RiriMapManifest } from "./core/destination";
import type { RiriScreen } from "./core/context";

/** Bump when the console map changes shape or content materially. */
export const LMS_MAP_VERSION = 41;

export const PORTAL_BASE = () => (process.env.PORTAL_APP_URL ?? "https://portal.servicesuitecloud.com").replace(/\/$/, "");
export const CONSOLE_BASE = () => (process.env.CONSOLE_APP_URL ?? "https://lms.servicesuitecloud.com").replace(/\/$/, "");

export function lmsManifest(): RiriMapManifest {
  const screens: RiriScreen[] = SYSTEM_SCREENS.map((s) => ({
    id: s.id, href: s.href, title: s.title, purpose: s.purpose, does: s.does, asks: s.asks,
    implications: s.implications, right: s.right, contextual: s.contextual,
  }));
  return { system: "lms", base: CONSOLE_BASE(), version: LMS_MAP_VERSION, title: "the lending console", screens };
}

export function appManifestPublic(): RiriMapManifest {
  return { system: "app", base: PORTAL_BASE(), version: APP_MAP_VERSION, title: "the Micro Eazy app", screens: APP_SCREENS };
}

export function handoffSecret(): string | null {
  const own = process.env.RIRI_HANDOFF_SECRET?.trim();
  if (own) return own;
  const auth = process.env.NEXTAUTH_SECRET?.trim();
  return auth ? `riri-handoff:v1:${auth}` : null;
}
