// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT 2 · CONTEXT — where Riri is standing when she is asked.
//
// Riri Ecosystem AI plan, §03. The console already did the hard half of this: the
// browser names a subject by id and the server states every fact about them
// (subject.ts). What was missing is that the SCREEN was never part of the
// question, so an officer looking at a loan still had to say which loan, and a
// customer on the Repay screen asking "what is this?" got an answer about the
// whole app.
//
// ── THE RULE THIS FILE GENERALISES ───────────────────────────────────────────
//
//   The client may NAME an id. It may never STATE a fact.
//
// Every field below is resolved on the server from something the caller cannot
// forge: the session (tenant, actor), the caller's registered surface, and the
// system's own map (screen). The only things a client supplies are a route string
// and an optional subject id — and both are looked up, never believed. A route
// that matches no screen resolves to `null`, not to whatever the client said it
// was.
//
// This file imports nothing. It is part of the core that a partner host
// implements against, and a core that imported Prisma or Next would be a core
// only we could host.
// ─────────────────────────────────────────────────────────────────────────────

/** Which system in the estate is asking. One id per published map. */
export type RiriSystem = "lms" | "app" | "servicesuite" | "interchange" | "hub" | "partner";

/**
 * The client that is calling — not the person. It decides the voice, the tool
 * catalogue and the audience of the corpus, so a customer surface can never
 * retrieve a staff-only pack by asking the right question.
 */
export type RiriSurface = "console-dock" | "customer-dock" | "ussd" | "partner-embed" | "voice";

/** Who retrieves what. Mirrors PackAudience in pack.ts, deliberately. */
export type RiriAudience = "customer" | "staff" | "developer" | "internal";

export const AUDIENCE_OF: Record<RiriSurface, RiriAudience> = {
  "console-dock": "staff",
  "customer-dock": "customer",
  ussd: "customer",
  "partner-embed": "staff",
  voice: "customer",
};

export type RiriLang = "en" | "sw";

/**
 * A screen in any system's map, in the one shape every map shares.
 *
 * `system-map.ts` (console) and `portal/app-map.ts` (customer app) both satisfy
 * this without adapters — that is the test of whether it is a contract or a
 * wish. `right` is a plain string here because a partner's rights are not ours.
 */
export type RiriScreen = {
  id: string;
  /** A real route in that system. `:param` segments match any single segment. */
  href: string;
  title: string;
  purpose: string;
  does: string[];
  asks: string[];
  implications?: string[];
  right?: string;
  contextual?: boolean;
};

/**
 * The resolved descriptor. Built on the server, never accepted from the wire.
 *
 * `consentRef` is carried for Contract 4: a tool about a PERSON refuses without
 * one. The customer's own Riri does not need it for their own record — the
 * proven phone is the consent — but the field travels so the same tool body can
 * be hosted by a partner whose caller is not the data subject.
 */
export type RiriContext = {
  system: RiriSystem;
  surface: RiriSurface;
  audience: RiriAudience;
  /** Tenant id in the host's own terms. Session → org. Never the body. */
  tenant: string;
  /** The lender's name as a customer says it. */
  tenantName: string;
  actor: { kind: "staff" | "customer" | "partner"; id: string | null; name: string | null };
  /** The screen they are on, resolved against the system's map — or null. */
  screen: RiriScreen | null;
  /** The raw route, kept for the log only. Never used as a fact. */
  route: string | null;
  subject: { kind: "borrower"; id: string } | null;
  lang: RiriLang;
  consentRef: string | null;
};

// ── Route → screen ──────────────────────────────────────────────────────────

/** Trim a route to a comparable path: no origin, no query, no trailing slash. */
export function normaliseRoute(route: string | null | undefined): string | null {
  if (typeof route !== "string") return null;
  let r = route.trim();
  if (!r) return null;
  try {
    // Accept a full URL from a client that sent location.href.
    if (/^https?:\/\//i.test(r)) r = new URL(r).pathname;
  } catch {
    return null;
  }
  r = r.split("?")[0].split("#")[0];
  if (!r.startsWith("/")) return null;
  if (r.length > 1 && r.endsWith("/")) r = r.slice(0, -1);
  // A route is a short thing. A megabyte "route" is not a screen, it is a probe.
  return r.length <= 200 ? r : null;
}

const segments = (p: string) => p.split("/").filter(Boolean);

/**
 * Does `route` stand on `href`? Static segments must be equal; a `:param` or
 * `[param]` segment matches exactly one segment.
 */
export function routeMatches(href: string, route: string): boolean {
  const a = segments(href);
  const b = segments(route);
  if (a.length !== b.length) return false;
  return a.every((seg, i) => /^(:[\w-]+|\[[\w-]+\])$/.test(seg) || seg === b[i]);
}

/**
 * The screen a route is standing on, or null.
 *
 * The MOST SPECIFIC match wins — the one with the most static segments — so
 * `/messages/new` resolves to a composer entry if one exists before it resolves
 * to `/messages/:threadId`. A route that matches nothing is null, never a guess:
 * "what is this screen?" answered about the wrong screen is worse than "I can't
 * tell which screen you're on".
 */
export function resolveScreen<S extends RiriScreen>(screens: readonly S[], route: string | null | undefined): S | null {
  const r = normaliseRoute(route);
  if (!r) return null;
  let best: S | null = null;
  let bestStatic = -1;
  for (const s of screens) {
    if (!routeMatches(s.href, r)) continue;
    const statics = segments(s.href).filter((seg) => !/^(:|\[)/.test(seg)).length;
    if (statics > bestStatic) {
      best = s;
      bestStatic = statics;
    }
  }
  return best;
}

// ── "What am I looking at?" ─────────────────────────────────────────────────

/**
 * Is this a question ABOUT THE SCREEN rather than about the world?
 *
 * Kept narrow on purpose. "What is this?" on a screen is about the screen; "what
 * is Ratiba?" is not, even though it starts the same way. So the pattern wants a
 * deictic — this, here, page, screen — and nothing specific after it.
 */
const SCREEN_QUESTION =
  /^(?:\s*(?:so|ok|okay|hi|hey|riri)[,!\s]+)?(?:what(?:'s| is| am i looking at| am i seeing| does this (?:page|screen) do)|what(?:'s| is) (?:this|that)(?: (?:page|screen|for))?|where am i|explain (?:this|the) (?:page|screen)|what can i do (?:here|on this (?:page|screen))|help (?:me )?(?:with|on) this (?:page|screen)|hii ni nini|niko wapi|ukurasa huu ni wa nini|skrini hii ni ya nini|nifanye nini hapa)\s*(?:page|screen|here)?\s*[?.!]*\s*$/i;

export const isScreenQuestion = (q: string): boolean => SCREEN_QUESTION.test(q.trim());

/**
 * "Why can't I do this?" — the half of screen awareness that needs the actor.
 * Answered from the difference between the screen's right and the actor's rights,
 * never from a walkthrough.
 */
const WHY_BLOCKED =
  /\b(?:why (?:can'?t|cannot|can i not) i|why is (?:this|it|that) (?:greyed|grayed|disabled|locked|blocked)|i can'?t (?:click|press|open|do) (?:this|that|it)|kwa nini siwezi)\b/i;

export const isWhyBlockedQuestion = (q: string): boolean => WHY_BLOCKED.test(q);

/** The screen, said as an answer — purpose, verbs, consequences. The map's words only. */
export function describeScreen(screen: RiriScreen, lang: RiriLang = "en"): string {
  const L = lang === "sw"
    ? { here: "Uko kwenye", does: "Unachoweza kufanya hapa", know: "Ya kufahamu" }
    : { here: "You're on", does: "What you can do here", know: "Worth knowing" };
  const lines = [`${L.here} **${screen.title}** — ${screen.purpose}`];
  if (screen.does.length) lines.push("", `${L.does}:`, ...screen.does.map((d) => `- ${d}`));
  if (screen.implications?.length) lines.push("", `${L.know}:`, ...screen.implications.map((i) => `- ${i}`));
  return lines.join("\n");
}
