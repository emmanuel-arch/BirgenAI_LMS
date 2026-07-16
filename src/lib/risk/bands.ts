// ─────────────────────────────────────────────────────────────────────────────
// THE FOUR RISK BANDS — one vocabulary, spoken by every engine.
//
// A customer is scored by more than one thing in this product, and until now each
// spoke its own dialect: the thin-file cruncher answers on a 300–900 scale, the
// behavioural engine (ported from ServiceSuite's sp_CreditScoringAndGraduation)
// answers 0–100, and the early-warning scan answers WATCH/ELEVATED/HIGH. Three
// scales, three vocabularies, and an officer left to translate between them in their
// head — which is where a bad loan gets written.
//
// So: one set of FOUR bands, and every engine maps into it. What a band means, what
// colour it is, what it implies about default, and what it earns you at graduation is
// decided ONCE, here.
//
// WHY FOUR AND NOT THREE. ServiceSuite had three (Minor / Moderate / Major), and the
// gap between them is too wide to act on: a customer at 78 and a customer at 99 were
// both "Minor risk" and both graduated 30%, though one of them has never missed a
// day and the other has. The top band is split, so that flawlessness is worth
// something — which is the whole point of a graduation ladder.
//
// PD IS DERIVED, NOT INVENTED. The probability of default shown on the Customer-360
// is read off the model's own `pd` where we have one (the cruncher emits it), and
// only falls back to the band's midpoint when we do not. A made-up number rendered
// to two decimal places is worse than no number at all, so the UI is told which of
// the two it is looking at.
// ─────────────────────────────────────────────────────────────────────────────

export type RiskBandKey = "PRIME" | "STRONG" | "WATCH" | "HIGH";

export type RiskBand = {
  key: RiskBandKey;
  label: string;
  /** What it means, in the words an officer would use to a colleague. */
  meaning: string;
  /** Lowest score (of 900) that lands in this band. */
  minScore: number;
  /** Lowest BEHAVIOURAL score (of 100) that lands in this band. */
  minBehavioural: number;
  /** Typical default probability across this band — the fallback when a model gives none. */
  pdMin: number;
  pdMax: number;
  /** What a clean record in this band earns at graduation (percent of the last principal). */
  graduationPercent: number;
  /** Tailwind-free tokens: the UI owns the gradient, this owns the decision. */
  from: string;
  to: string;
  ink: string;
  soft: string;
  /** lucide icon name — resolved by the component. */
  icon: string;
};

/**
 * THE LADDER. Ordered best → worst, which is also the order the UI reads them in.
 *
 * The score cuts are on the 900 scale the cruncher already emits; the behavioural cuts
 * are on the 0–100 scale the stored procedure used, so a lender migrating from
 * ServiceSuite sees the same customers in the same places (their >76 "Minor risk" is
 * this ladder's STRONG floor, and their ≤50 "Major risk" is this ladder's HIGH).
 */
export const RISK_BANDS: RiskBand[] = [
  {
    key: "PRIME",
    label: "Prime",
    meaning: "Pays on time, every time. Lend to them and increase their limit.",
    minScore: 750,
    minBehavioural: 86,
    pdMin: 0.005,
    pdMax: 0.03,
    graduationPercent: 30,
    from: "#059669",
    to: "#34d399",
    ink: "#065f46",
    soft: "rgba(5,150,105,0.12)",
    icon: "ShieldCheck",
  },
  {
    key: "STRONG",
    label: "Strong",
    meaning: "Reliable. The odd late day, nothing that costs you money.",
    minScore: 650,
    minBehavioural: 71,
    pdMin: 0.03,
    pdMax: 0.09,
    graduationPercent: 20,
    from: "#0284c7",
    to: "#38bdf8",
    ink: "#075985",
    soft: "rgba(2,132,199,0.12)",
    icon: "TrendingUp",
  },
  {
    key: "WATCH",
    label: "Watch",
    meaning: "Pays, but late and in pieces. Lend carefully and keep them close.",
    minScore: 550,
    minBehavioural: 51,
    pdMin: 0.09,
    pdMax: 0.25,
    graduationPercent: 10,
    from: "#d97706",
    to: "#fbbf24",
    ink: "#92400e",
    soft: "rgba(217,119,6,0.12)",
    icon: "AlertTriangle",
  },
  {
    key: "HIGH",
    label: "High risk",
    meaning: "Misses installments. Do not increase their limit; work the account.",
    minScore: 0,
    minBehavioural: 0,
    pdMin: 0.25,
    pdMax: 0.9,
    graduationPercent: 0, // A high-risk customer does not graduate. That is the point.
    from: "#e11d48",
    to: "#fb7185",
    ink: "#9f1239",
    soft: "rgba(225,29,72,0.12)",
    icon: "OctagonAlert",
  },
];

export const BAND_BY_KEY: ReadonlyMap<RiskBandKey, RiskBand> = new Map(RISK_BANDS.map((b) => [b.key, b]));

/** Cluster a 300–900 credit score (the cruncher's scale). */
export function bandForScore(score: number | null | undefined): RiskBand | null {
  if (score == null || !Number.isFinite(score)) return null;
  return RISK_BANDS.find((b) => score >= b.minScore) ?? RISK_BANDS[RISK_BANDS.length - 1];
}

/** Cluster a 0–100 behavioural score (the graduation engine's scale). */
export function bandForBehavioural(score: number | null | undefined): RiskBand | null {
  if (score == null || !Number.isFinite(score)) return null;
  return RISK_BANDS.find((b) => score >= b.minBehavioural) ?? RISK_BANDS[RISK_BANDS.length - 1];
}

/**
 * The probability this account defaults.
 *
 * `modelPd` is the model's own number and always wins — it was computed from THIS
 * customer's features, not from the company they keep. The band midpoint is only a
 * stand-in for a customer no model has scored yet, and the caller is told which it
 * got so the screen can say "estimated from their band" rather than implying a
 * precision that does not exist.
 */
export function defaultProbability(
  band: RiskBand | null,
  modelPd?: number | null,
): { pd: number; source: "model" | "band" } | null {
  if (modelPd != null && Number.isFinite(modelPd) && modelPd > 0 && modelPd < 1) {
    return { pd: modelPd, source: "model" };
  }
  if (!band) return null;
  return { pd: (band.pdMin + band.pdMax) / 2, source: "band" };
}

/** Legacy band strings written by older engines, mapped into the one ladder. */
export function normaliseBandName(raw: string | null | undefined): RiskBandKey | null {
  const s = (raw ?? "").trim().toUpperCase();
  if (!s) return null;
  if (s === "PRIME" || s === "STRONG" || s === "WATCH" || s === "HIGH") return s;
  // ServiceSuite's vocabulary.
  if (s.startsWith("MINOR")) return "PRIME";
  if (s.startsWith("MODERATE")) return "WATCH";
  if (s.startsWith("MAJOR")) return "HIGH";
  // The early-warning scan's.
  if (s === "ELEVATED") return "WATCH";
  if (s === "LOW") return "STRONG";
  return null;
}
