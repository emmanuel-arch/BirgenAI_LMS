// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT 5 · DESTINATION — the federated map, and the three rules that do not move.
//
// Riri Ecosystem AI plan, §06. Each system publishes its screens in ONE shape
// (RiriScreen, core/context.ts) at a well-known path; Riri merges them and
// resolves a sentence to `{ system, href }` across the union.
//
// THE THREE RULES — enforced here, in code, rather than in anybody's prompt:
//
//   1. NAVIGATION ONLY. A destination is a place. Nothing in this file can
//      describe a submit, an approval, a payment or a message; the type has no
//      field for one.
//   2. ONE DESTINATION OR NONE. `resolveAcross` returns a single screen, two
//      offered as buttons when two systems tie, or nothing. It never guesses. A
//      wrong jump into another PRODUCT is far more disorienting than a wrong jump
//      inside one — the user did not see the journey.
//   3. A HAND-OFF IS A SIGNED DEEP LINK WITH A REASON. It carries the question
//      that produced it, and lands with a bar: "Riri brought you here from the
//      console because you asked where Ratiba is set up." Somebody who does not
//      recognise where they are must always be able to read why they are there.
//
// Pure: the signing uses Web Crypto, which Node 20+, Vercel and every browser
// share, so a partner host verifies with the same ~20 lines.
// ─────────────────────────────────────────────────────────────────────────────
import type { RiriScreen, RiriSystem } from "./context";

/** What GET /.well-known/riri-map.json returns. */
export type RiriMapManifest = {
  system: RiriSystem;
  /** Absolute origin the hrefs are relative to. */
  base: string;
  /** Bumped when screens change. A consumer caches by it. */
  version: number;
  title: string;
  screens: RiriScreen[];
};

export type Destination = {
  system: RiriSystem;
  systemTitle: string;
  screen: RiriScreen;
  /** Absolute when it crosses a system; relative when it stays home. */
  href: string;
  score: number;
  crossesSystem: boolean;
};

export type Resolution =
  | { kind: "one"; destination: Destination }
  | { kind: "choose"; options: [Destination, Destination] }
  | { kind: "none" };

// ── Scoring — the same discipline as system-map.ts, over any manifest ────────

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9*# ]+/g, " ").replace(/\s+/g, " ").trim();
const words = (s: string) => norm(s).split(" ").filter((w) => w.length > 2);
const STOP = new Set(["the", "and", "for", "you", "your", "take", "open", "show", "where", "how", "can", "what", "this", "that", "with", "nipeleke", "fungua"]);

export function scoreScreen(question: string, screen: RiriScreen): number {
  const q = norm(question);
  if (!q) return 0;
  let best = 0;
  for (const a of screen.asks) {
    const ask = norm(a);
    if (!ask) continue;
    if (q === ask) best = Math.max(best, 60);
    else if (ask.includes(" ") && q.includes(ask)) best = Math.max(best, 30 + ask.length / 4);
    else if (!ask.includes(" ") && ask.length > 3 && q.split(" ").includes(ask)) best = Math.max(best, 16);
  }
  let score = best;
  if (norm(screen.title) && q.includes(norm(screen.title))) score += 26;
  const hay = new Set(words(`${screen.title} ${screen.asks.join(" ")} ${screen.does.join(" ")}`));
  let loose = 0;
  for (const w of words(question)) if (!STOP.has(w) && hay.has(w)) loose += 4;
  score += Math.min(loose, 20);
  if (screen.contextual) score -= 6;
  return score;
}

/** A score below this is two nouns brushing past each other, not a destination. */
export const DESTINATION_FLOOR = 28;
/** Within this many points of each other, two systems are a tie and both are offered. */
const TIE_MARGIN = 6;

/**
 * Resolve a sentence to a place across every manifest the caller may see.
 *
 * `home` is the system the question was asked FROM. A destination at home wins a
 * tie against one elsewhere — crossing a system is the more expensive mistake,
 * so it has to be clearly better to be chosen without asking.
 */
export function resolveAcross(question: string, manifests: RiriMapManifest[], home: RiriSystem): Resolution {
  const all: Destination[] = [];
  for (const m of manifests) {
    for (const screen of m.screens) {
      if (screen.contextual) continue; // needs an id nobody said — never a jump target
      const score = scoreScreen(question, screen);
      if (score < DESTINATION_FLOOR) continue;
      const crossesSystem = m.system !== home;
      all.push({
        system: m.system,
        systemTitle: m.title,
        screen,
        href: crossesSystem ? new URL(screen.href, m.base).toString() : screen.href,
        score: crossesSystem ? score - 4 : score,
        crossesSystem,
      });
    }
  }
  if (!all.length) return { kind: "none" };
  all.sort((a, z) => z.score - a.score);
  const [first, second] = all;
  if (second && second.system !== first.system && first.score - second.score <= TIE_MARGIN) {
    return { kind: "choose", options: [first, second] };
  }
  return { kind: "one", destination: first };
}

// ── The signed hand-off ─────────────────────────────────────────────────────

export type Handoff = {
  /** Where she sent them FROM. */
  from: RiriSystem;
  fromTitle: string;
  /** The system they land in. */
  to: RiriSystem;
  href: string;
  /** Their words, capped. Shown back to them on the bar. */
  question: string;
  /** Issued-at, ms. The link is good for ten minutes — long enough to open, too short to share. */
  iat: number;
};

const HANDOFF_TTL_MS = 10 * 60_000;
const enc = new TextEncoder();

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

/** Constant-time over equal lengths; a length mismatch is simply false. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

/** `payload.signature`, both base64url. */
export async function signHandoff(h: Omit<Handoff, "iat">, secret: string, now = Date.now()): Promise<string> {
  const body: Handoff = { ...h, question: h.question.slice(0, 160), iat: now };
  const payload = b64url(enc.encode(JSON.stringify(body)));
  return `${payload}.${b64url(await hmac(secret, payload))}`;
}

export type HandoffCheck = { ok: true; handoff: Handoff } | { ok: false; reason: "malformed" | "signature" | "expired" };

export async function verifyHandoff(token: string, secret: string, now = Date.now()): Promise<HandoffCheck> {
  const [payload, sig] = (token ?? "").split(".");
  if (!payload || !sig || token.length > 2000) return { ok: false, reason: "malformed" };
  let given: Uint8Array;
  try { given = fromB64url(sig); } catch { return { ok: false, reason: "malformed" }; }
  if (!sameBytes(given, await hmac(secret, payload))) return { ok: false, reason: "signature" };
  let h: Handoff;
  try { h = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as Handoff; } catch { return { ok: false, reason: "malformed" }; }
  if (typeof h.iat !== "number" || now - h.iat > HANDOFF_TTL_MS || h.iat - now > 60_000) return { ok: false, reason: "expired" };
  return { ok: true, handoff: h };
}

/** The sentence on the bar. One place, so both ends of a hand-off say it the same way. */
export const handoffReason = (h: Pick<Handoff, "fromTitle" | "question">): string =>
  `Riri brought you here from ${h.fromTitle} because you asked “${h.question}”.`;
