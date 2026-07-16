// ─────────────────────────────────────────────────────────────────────────────
// Riri's lineup — the three intelligences a lender talks to.
//
//   • support   — how this platform works. Free, ungated, never metered.
//   • assistant — Riri 2.5: knows who you are, your role, your book, and the customer
//                 on your screen, and remembers what she told you last week.
//   • analytics — Riri 2.5 Max: talks to your live book. A canonical question runs a
//                 pre-vetted metric; a novel one is written as SQL by a model, guarded,
//                 and shown. Exports to Excel/PDF.
//
// WHY THREE AND NOT FOUR. There used to be `analyst` (the metric layer) and `max` (a
// keyword-matched corpus wearing a PRO badge). They are the same product — "ask my
// book a question" — split down the middle by an implementation detail, and the half
// sold as frontier reasoning could not reason at all. A CFO who catches that once
// never trusts the tier again. Analytics is now one tier that routes: catalogue first,
// model second, SQL always shown.
//
// This mirrors ServiceSuite's own AI Intelligence module (Knowledge / Assistant /
// Analytics) on purpose — the lenders we are selling to already have that vocabulary.
// Riri 2.0 (the grounded per-lender knowledge base) is borrower-facing and lives on the
// portal, not in this staff dock.
//
// Icons come from the founder's approved contextual set (LifeBuoy/Bot/Gauge) — no
// lucide "Sparkles" family.
// ─────────────────────────────────────────────────────────────────────────────

export type RiriModelId = "support" | "assistant" | "analytics";

export type RiriModel = {
  id: RiriModelId;
  /** Full display name in the switcher. */
  name: string;
  /** One-word tag rendered as a chip beside the name. */
  tag: string;
  /** Short "what this model is for" line. */
  blurb: string;
  /** lucide icon name (resolved in the client). */
  icon: "Gauge" | "Bot" | "LifeBuoy";
  /** Badge shown on the model: LIVE DATA vs a simulated/premium capability. */
  badge: "LIVE DATA" | "SIMULATED" | "PRO";
  /** Premium tier gets the subtle sheen treatment. */
  pro?: boolean;
  /** Starter prompts shown on an empty conversation for this model. */
  suggestions: string[];
};

export const RIRI_MODELS: Record<RiriModelId, RiriModel> = {
  support: {
    id: "support",
    name: "Riri Support",
    tag: "2.0",
    blurb: "Knows this platform inside out — how to do anything, and why something is blocked.",
    icon: "LifeBuoy",
    badge: "LIVE DATA",
    suggestions: [
      "What do I do next?",
      "How do I apply for a loan for a customer?",
      "Why can't I disburse this loan?",
      "Who can see whose customers?",
      "How do I upgrade my package?",
    ],
  },
  assistant: {
    id: "assistant",
    name: "Riri Assistant",
    tag: "2.5",
    blurb: "Knows you, your role and the customer on your screen — and remembers what she told you.",
    icon: "Bot",
    badge: "LIVE DATA",
    // Written for the person, not the platform. The old set ("Design a 30-day business
    // loan product") was a product manager's day; these are an officer's.
    suggestions: [
      "Who should I chase first today?",
      "Can I give this customer a top-up?",
      "What did you tell me last week?",
      "How do I say no to them without losing them?",
      "Is my book drifting?",
    ],
  },
  analytics: {
    id: "analytics",
    name: "Riri Analytics",
    tag: "2.5 Max",
    blurb: "Talks to your live book — by period, product or borrower. Shows her SQL. Exports to Excel or PDF.",
    icon: "Gauge",
    badge: "LIVE DATA",
    pro: true,
    // A period, a slice, a ranking, a trend — the shape of what the metric layer can do,
    // plus one that deliberately falls through to text-to-SQL.
    suggestions: [
      "What's my outstanding loan book?",
      "What's my PAR 30 by product?",
      "How much did we collect last month?",
      "Top 5 borrowers by balance",
      "Disbursements over time",
    ],
  },
};

export const RIRI_MODEL_IDS: RiriModelId[] = ["support", "assistant", "analytics"];

export function isRiriModel(v: unknown): v is RiriModelId {
  return v === "support" || v === "assistant" || v === "analytics";
}

/**
 * Old ids, still out in the world.
 *
 * `copilot` and `analyst` are in every officer's localStorage and in ~every row of
 * RiriQueryLog. Dropping them would silently reset a saved preference to Support and
 * make historical usage unreadable, so they are translated rather than forgotten.
 * `max` folds into analytics — the tier it should always have been part of.
 */
const LEGACY: Record<string, RiriModelId> = {
  copilot: "assistant",
  analyst: "analytics",
  max: "analytics",
};

/** Read any id — current or historical — as a current one. */
export function normaliseModelId(v: unknown): RiriModelId | null {
  if (isRiriModel(v)) return v;
  if (typeof v === "string" && v in LEGACY) return LEGACY[v];
  return null;
}
