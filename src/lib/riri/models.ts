// ─────────────────────────────────────────────────────────────────────────────
// Riri's model lineup — the three intelligences a lender can talk to.
//
//   • analyst  — talks to YOUR live book (real semantic-metric engine; no creds)
//   • copilot  — role-aware operations co-pilot (simulation-first LLM → live)
//   • max      — frontier strategic reasoning (PRO tier; simulation-first → live)
//
// Shared client+server registry so the switcher chips, the API router and the
// billing meter all agree on the same ids. Icons are chosen from the founder's
// approved contextual set (Gauge/Bot/Crown) — no lucide "Sparkles" family.
// ─────────────────────────────────────────────────────────────────────────────

export type RiriModelId = "analyst" | "copilot" | "max";

export type RiriModel = {
  id: RiriModelId;
  /** Full display name in the switcher. */
  name: string;
  /** One-word tag rendered as a chip beside the name. */
  tag: string;
  /** Short "what this model is for" line. */
  blurb: string;
  /** lucide icon name (resolved in the client). */
  icon: "Gauge" | "Bot" | "Crown";
  /** Badge shown on the model: LIVE data vs a simulated/premium capability. */
  badge: "LIVE DATA" | "SIMULATED" | "PRO";
  /** Premium tier gets the subtle sheen treatment (simulated subscription). */
  pro?: boolean;
  /** Starter prompts shown on an empty conversation for this model. */
  suggestions: string[];
};

export const RIRI_MODELS: Record<RiriModelId, RiriModel> = {
  analyst: {
    id: "analyst",
    name: "Riri Analyst",
    tag: "2.5",
    blurb: "Talks to your live loan book — OLB, PAR, disbursed, collected, outcomes.",
    icon: "Gauge",
    badge: "LIVE DATA",
    suggestions: [
      "What's my outstanding loan book?",
      "How much did we collect this month?",
      "What's my PAR 30 right now?",
      "Top 5 borrowers by balance",
      "How many applications are waiting?",
      "What's my default rate?",
    ],
  },
  copilot: {
    id: "copilot",
    name: "Riri Copilot",
    tag: "2.5",
    blurb: "Your operations co-pilot — how to run workflows, collections, KYC, pricing.",
    icon: "Bot",
    badge: "SIMULATED",
    suggestions: [
      "How do I bring down my PAR 30?",
      "Design a 30-day business loan product",
      "Set up a two-tier approval workflow",
      "Write an arrears reminder SMS",
    ],
  },
  max: {
    id: "max",
    name: "Riri Max",
    tag: "3.0",
    blurb: "Frontier reasoning — portfolio strategy, risk memos, scenario analysis.",
    icon: "Crown",
    badge: "PRO",
    pro: true,
    suggestions: [
      "Draft a board-ready portfolio risk memo",
      "Should I expand my average loan size?",
      "Model the impact of a 2% rate cut",
      "Where is my biggest concentration risk?",
    ],
  },
};

export const RIRI_MODEL_IDS: RiriModelId[] = ["analyst", "copilot", "max"];

export function isRiriModel(v: unknown): v is RiriModelId {
  return v === "analyst" || v === "copilot" || v === "max";
}
