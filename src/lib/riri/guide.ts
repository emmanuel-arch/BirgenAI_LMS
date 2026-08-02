// ─────────────────────────────────────────────────────────────────────────────
// THE GUIDE — answers composed from the system map.
//
// knowledge.ts answers the questions somebody wrote a paragraph for. This answers
// everything else the console can do: fifty screens' worth of "what is this for,
// what can I do here, what happens when I touch it, and where is the door".
//
// The composition rule is the honest one: a guide answer says WHAT THE MAP KNOWS
// and no more. It never writes a walkthrough it does not have — if the map holds
// four verbs and two consequences, the answer is four verbs and two consequences.
// The failure this avoids is the one that kills support assistants: a confident
// six-step path to a button that does not exist, which the user cannot tell apart
// from a real one until they are standing on the wrong screen blaming the software.
//
// Three shapes come out of here:
//
//   NAVIGATION  — "take me to where we write our credit policy". Resolve to one
//                 screen or refuse. This is the shape Autopilot is allowed to act on.
//   CAPABILITY  — "what is the credit policy screen for?" — purpose, verbs, and the
//                 implications, which is the half nobody documents and everybody needs.
//   CONCEPT     — "who can see whose customers?" — not a place at all. Answering a
//                 model question with a link answers a different question.
// ─────────────────────────────────────────────────────────────────────────────
import {
  findScreens, findConcepts, resolveDestination, screenById, screensFor,
  type Access, type SystemScreen, type ScreenHit,
} from "./system-map";
import { cheapestPlanWith } from "@/lib/billing/plans";
import type { SupportLang } from "./knowledge";

export type GuideAction = { kind: "navigate"; label: string; href: string };

export type GuideAnswer = {
  answer: string;
  actions: GuideAction[];
  suggestions: string[];
  /** Which map entry answered — for the query log. */
  sourceId: string;
  /** navigate | capability | concept — for the badge on the turn. */
  shape: "navigate" | "capability" | "concept";
};

// ── Framing, in both voices ───────────────────────────────────────────────────
// Same discipline as support.ts: one table, so neither language can gain a
// sentence the other lacks.
const G = {
  en: {
    takingYou: (title: string) => `**${title}**`,
    onIt: (title: string) => `Open ${title}`,
    whatYouDo: "What you do there",
    worthKnowing: "Worth knowing",
    notYours: (title: string) =>
      `**${title}** exists, but it isn't on your access — it needs a permission your role doesn't hold. An administrator at your lender can grant it in Roles & Rights, or do the thing for you.`,
    notOnPackage: (title: string) => `**${title}** isn't on your package yet.`,
    comesWith: (plan: string, price: string) =>
      `It comes with **${plan}** (KES ${price}/mo). Your loan book keeps working exactly as it does now either way.`,
    notAvailable: "It isn't available on any package yet.",
    seePackages: "See packages",
    alsoTry: "You might also mean",
    related: "Next you'd usually want",
  },
  sw: {
    takingYou: (title: string) => `**${title}**`,
    onIt: (title: string) => `Fungua ${title}`,
    whatYouDo: "Unachofanya hapo",
    worthKnowing: "Ya kufahamu",
    notYours: (title: string) =>
      `**${title}** ipo, lakini haiko kwenye ruhusa zako — inahitaji ruhusa ambayo jukumu lako halina. Msimamizi wa shirika lako anaweza kuikupatia katika Roles & Rights, au akufanyie mwenyewe.`,
    notOnPackage: (title: string) => `**${title}** bado haiko kwenye kifurushi chako.`,
    comesWith: (plan: string, price: string) =>
      `Huja na **${plan}** (KES ${price}/mwezi). Kitabu chako cha mikopo kinaendelea kufanya kazi vilevile.`,
    notAvailable: "Bado haipatikani kwenye kifurushi chochote.",
    seePackages: "Ona vifurushi",
    alsoTry: "Labda unamaanisha",
    related: "Kinachofuata kwa kawaida",
  },
} as const;

/**
 * Is this person asking to be MOVED, or asking to be told?
 *
 * It matters because the two deserve different answers and only one of them is
 * something Autopilot may act on. "How do I create a credit policy" wants the steps;
 * "take me to the credit policy" wants the screen and nothing else in the way.
 */
const NAV_INTENT =
  /\b(take me|go to|open|navigate|show me the|where is|where do i (find|go)|jump to|launch|bring up|nipeleke|nifungulie|niko wapi|iko wapi|fungua|nenda)\b/i;

export const isNavigationIntent = (q: string): boolean => NAV_INTENT.test(q);

/** The screen, said properly: purpose, verbs, consequences, door. */
function describe(screen: SystemScreen, lang: SupportLang, includeDoor = true): string {
  const g = G[lang];
  const lines: string[] = [`**${screen.title}** — ${screen.purpose}`];

  if (screen.does.length) {
    lines.push("", `${g.whatYouDo}:`, ...screen.does.map((d) => `- ${d}`));
  }
  if (screen.implications?.length) {
    lines.push("", `${g.worthKnowing}:`, ...screen.implications.map((i) => `- ${i}`));
  }
  if (includeDoor) { /* the action button carries the door; no sentence needed */ }
  return lines.join("\n");
}

/** Follow-ups drawn from the map itself, so a suggestion always leads somewhere real. */
function suggestionsFor(screen: SystemScreen): string[] {
  const rel = (screen.related ?? [])
    .map(screenById)
    .filter((s): s is SystemScreen => !!s)
    .slice(0, 2)
    .map((s) => s.asks[0]);
  const own = screen.asks.find((a) => a.split(" ").length > 2 && a !== screen.asks[0]);
  return [...rel, own].filter((x): x is string => !!x).slice(0, 3);
}

/**
 * Answer from the map, or return null and let the caller say it does not know.
 *
 * Order is deliberate. A CONCEPT question that also happens to name a screen
 * ("who can see whose customers" mentions customers) must not be answered by
 * opening the borrower list — so a strong concept hit wins over a weak screen hit,
 * and only over a weak one.
 */
export function answerFromMap(
  question: string,
  access: Access,
  lang: SupportLang = "en",
): GuideAnswer | null {
  const g = G[lang];
  const q = question.trim();

  const screens = findScreens(q, access, 3);
  const concepts = findConcepts(q, 2);
  const topScreen = screens[0];
  const topConcept = concepts[0];

  // ── CONCEPT ────────────────────────────────────────────────────────────────
  // It wins when it is clearly what was asked: either nothing else matched, or it
  // matched harder than the best screen did.
  if (topConcept && (!topScreen || topConcept.score >= topScreen.score)) {
    const c = topConcept.concept;
    const doors = (c.screens ?? [])
      .map(screenById)
      .filter((s): s is SystemScreen => !!s)
      .filter((s) => findScreens(s.title, access, 1)[0]?.permitted !== false)
      .slice(0, 2);
    return {
      answer: `**${c.title}**\n\n${c.body}`,
      actions: doors.map((s) => ({ kind: "navigate" as const, label: g.onIt(s.title), href: s.href })),
      suggestions: doors.map((s) => s.asks[0]).slice(0, 2),
      sourceId: `concept:${c.id}`,
      shape: "concept",
    };
  }

  if (!topScreen || topScreen.score < 18) return null;

  const s = topScreen.screen;

  // ── NOT YOURS ──────────────────────────────────────────────────────────────
  // The screen is real and the answer is who to ask. Never a walkthrough they
  // will fail halfway through, and never silence pretending it does not exist.
  if (!topScreen.permitted) {
    return {
      answer: g.notYours(s.title),
      actions: [],
      suggestions: ["who can see whose customers", "what can my role do"],
      sourceId: `screen:${s.id}`,
      shape: "capability",
    };
  }

  // ── NOT ON THE PACKAGE ─────────────────────────────────────────────────────
  if (!topScreen.entitled && s.feature) {
    const plan = cheapestPlanWith(s.feature);
    return {
      answer:
        `${g.notOnPackage(s.title)}\n\n${s.purpose}\n\n` +
        (plan ? g.comesWith(plan.name, plan.monthlyKes.toLocaleString()) : g.notAvailable),
      actions: [{ kind: "navigate", label: g.seePackages, href: "/console/billing" }],
      suggestions: ["what do the packages include", "how do i upgrade"],
      sourceId: `screen:${s.id}`,
      shape: "capability",
    };
  }

  // ── NAVIGATION ─────────────────────────────────────────────────────────────
  // Short, because someone who said "take me there" does not want a briefing;
  // they want the door and one line confirming it is the right one.
  if (isNavigationIntent(q)) {
    const alts = screens.slice(1).filter((h) => h.permitted && h.entitled && h.score > 20).slice(0, 2);
    const altLine = alts.length
      ? `\n\n${g.alsoTry}: ${alts.map((h) => h.screen.title).join(", ")}.`
      : "";
    return {
      answer: `${g.takingYou(s.title)} — ${s.purpose}${altLine}`,
      actions: [
        { kind: "navigate", label: g.onIt(s.title), href: s.href },
        ...alts.map((h) => ({ kind: "navigate" as const, label: h.screen.title, href: h.screen.href })),
      ],
      suggestions: suggestionsFor(s),
      sourceId: `screen:${s.id}`,
      shape: "navigate",
    };
  }

  // ── CAPABILITY ─────────────────────────────────────────────────────────────
  return {
    answer: describe(s, lang),
    actions: [{ kind: "navigate", label: g.onIt(s.title), href: s.href }],
    suggestions: suggestionsFor(s),
    sourceId: `screen:${s.id}`,
    shape: "capability",
  };
}

/**
 * What this person can actually reach — used by the honest failure, so "I don't
 * know that one" is followed by a real menu of this caller's console rather than a
 * generic list of features half of them cannot open.
 */
export function whatICanHelpWith(access: Access, n = 8): string[] {
  return screensFor(access).slice(0, n).map((s) => s.title);
}

/** Autopilot's question: one destination, or nothing. Re-exported so callers need one import. */
export { resolveDestination };
export type { ScreenHit, Access };
