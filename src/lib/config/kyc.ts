// ─────────────────────────────────────────────────────────────────────────────
// THE IDENTITY POLICY — where a machine stops and a human starts.
//
// ── WHAT THIS REPLACES ──────────────────────────────────────────────────────
// Five numbers and one rule, hard-coded in the `finalize` branch of
// /api/portal/kyc:
//
//     if ((s.idQualityScore ?? 0) < 70)  flags.push("low-id-quality");
//     if ((s.faceMatchScore ?? 0) < 80)  flags.push("face-mismatch");
//     if (s.iprsMatched !== true)        flags.push("iprs-unmatched");
//     const faceReview = face >= 80 && face < 92;
//     status = flags.length ? "FAILED" : faceReview ? "PENDING_REVIEW" : "VERIFIED";
//
// Two things were wrong with it, and the second is the serious one.
//
// It was not configurable. Every lender on the platform shared one set of
// thresholds, and a lender whose customers photograph worn cards in bad light
// could not loosen a quality gate without a deploy.
//
// And FAILED WAS A DEAD END. A blurry photograph, a card whose portrait the
// matcher scored 79, a registry that did not answer — all three landed the
// customer on a terminal state with no queue, no notification and no way to ask.
// That is a machine making an adverse decision about a person's identity with no
// human anywhere in the loop, which is exactly the thing a regulator asks about
// and exactly what the founder asked for: every extreme case reviewable.
//
// ── THE MODEL ───────────────────────────────────────────────────────────────
// Each signal produces a BAND, and the lender maps each band to an OUTCOME:
//
//   pass    proceed, no human involved
//   review  a person looks (PENDING_REVIEW) — the customer is told, and a
//           conversation is opened so they can ask
//   refuse  terminal (FAILED)
//
// So "ID is not clear" can be a refusal at one lender and a review at another,
// and neither of them needs us.
//
// ── THE ONE THING THAT IS NOT CONFIGURABLE ──────────────────────────────────
// A lender may not map a signal to `pass` when the underlying check DID NOT RUN.
// Loosening a threshold is a commercial risk decision that belongs to the
// lender; declaring that an unanswered registry counts as a match is a statement
// about a fact, and it is not theirs to make. `iprsUnmatched` therefore allows
// only `review` and `refuse` — see clampOutcome().
//
// This mirrors the split in lib/journey/steps.ts on the app side: WHO DOES THE
// WORK and HOW MUCH CEREMONY is configurable; WHETHER THE CHECK HAPPENED is not.
// ─────────────────────────────────────────────────────────────────────────────
import type { ConfigIssue } from "./borrower";

export type Outcome = "pass" | "review" | "refuse";

/** Every signal the pipeline can raise, in the order a customer meets them. */
export const KYC_SIGNALS = [
  {
    key: "idQualityLow",
    label: "ID photo is not clear",
    blurb: "The capture scored below the quality floor — glare, blur, a cropped corner.",
    allowed: ["review", "refuse"] as Outcome[],
    /** What the customer is told. Kept beside the policy so a lender who changes
     *  the outcome cannot leave a message describing the old one. */
    customerSays: "The photo of your ID was not clear enough for us to read confidently.",
    fixable: true,
  },
  {
    key: "faceNoMatch",
    label: "Face does not match the ID",
    blurb: "Below the no-match floor. The selfie and the portrait on the card are different people, or the capture failed badly.",
    allowed: ["review", "refuse"] as Outcome[],
    customerSays: "Your selfie and the photo on your ID did not match closely enough.",
    fixable: true,
  },
  {
    key: "faceBorderline",
    label: "Face match is borderline",
    blurb: "Between the review floor and the auto-pass ceiling. Good enough to be plausible, not good enough to be certain.",
    allowed: ["pass", "review", "refuse"] as Outcome[],
    customerSays: "Your selfie is close to the photo on your ID, but we want a person to confirm it.",
    fixable: false,
  },
  {
    key: "nameBorderline",
    label: "Name partially matches the registry",
    blurb: "A subset match — people drop a name, and the card and the registry rarely carry the same number of them.",
    allowed: ["pass", "review", "refuse"] as Outcome[],
    customerSays: "The name on your ID is close to the one on the national register, but not identical.",
    fixable: false,
  },
  {
    key: "iprsUnmatched",
    label: "Registry did not confirm the ID",
    blurb: "IPRS returned no match, or could not be reached. NOT the same as a mismatch — and it can never be waved through.",
    // `pass` is deliberately absent. See the header.
    allowed: ["review", "refuse"] as Outcome[],
    customerSays: "We could not confirm your ID against the national register.",
    fixable: false,
  },
  {
    key: "livenessFailed",
    label: "Liveness check did not pass",
    blurb: "The selfie did not read as a live person — a photograph of a photograph, or a still held to the camera.",
    allowed: ["review", "refuse"] as Outcome[],
    customerSays: "We could not confirm the selfie was taken live.",
    fixable: true,
  },
] as const;

export type SignalKey = (typeof KYC_SIGNALS)[number]["key"];

export type KycConfig = {
  thresholds: {
    /** Below this, `idQualityLow` fires. 0–100. */
    idQualityFloor: number;
    /** Below this, `faceNoMatch` fires. 0–100. */
    faceNoMatchBelow: number;
    /** At or above this, the face is an auto-match. Between the two, borderline. */
    faceMatchAtOrAbove: number;
    /** Below this, `livenessFailed` fires. 0–100. */
    livenessFloor: number;
  };
  /** Signal → what happens. */
  outcomes: Record<SignalKey, Outcome>;
  review: {
    /**
     * How many times a customer may retake before the case goes to a human
     * regardless. Without a cap, a customer with a genuinely worn card loops
     * forever on "try again in better light" and never reaches a person.
     */
    maxRetakes: number;
    /**
     * Open a conversation when a case is referred. On by default and it is the
     * point of the whole exercise — a referral the customer cannot ask about is
     * a wall with no door. A lender with no staff to answer can switch it off.
     */
    openConversation: boolean;
    /** Hours a referred case may sit before the queue marks it overdue. 0 = never. */
    slaHours: number;
  };
};

export const KYC_DEFAULTS: KycConfig = {
  // The numbers the pipeline already used, preserved exactly, so publishing
  // nothing changes nothing. Every threshold below is the value that was
  // hard-coded before this file existed.
  thresholds: {
    idQualityFloor: 70,
    faceNoMatchBelow: 80,
    faceMatchAtOrAbove: 92,
    livenessFloor: 70,
  },
  // ── THE ONE DELIBERATE CHANGE OF BEHAVIOUR ────────────────────────────────
  // Everything that used to be a terminal FAILED now defaults to `review`.
  // A machine refusing somebody's identity outright, with no queue and no
  // appeal, is not a default any lender should inherit silently — and each of
  // these is far more often a bad photograph than a fraud attempt. A lender who
  // wants the old hard refusal sets `refuse` here, deliberately, with their name
  // on the revision.
  outcomes: {
    idQualityLow: "review",
    faceNoMatch: "review",
    faceBorderline: "review",
    nameBorderline: "review",
    iprsUnmatched: "review",
    livenessFailed: "review",
  },
  review: { maxRetakes: 3, openConversation: true, slaHours: 24 },
};

const num = (v: unknown, fallback: number, lo: number, hi: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback;
};

/**
 * A stored outcome the signal does not permit falls back to the DEFAULT, never
 * to the most permissive option available. A bad config must fail toward more
 * scrutiny, not less — that is the whole reason this clamp exists rather than a
 * plain cast.
 */
function clampOutcome(key: SignalKey, stored: unknown): Outcome {
  const signal = KYC_SIGNALS.find((s) => s.key === key)!;
  const wanted = String(stored ?? "");
  return (signal.allowed as string[]).includes(wanted)
    ? (wanted as Outcome)
    : KYC_DEFAULTS.outcomes[key];
}

export function mergeKycConfig(stored: unknown): KycConfig {
  const s = (typeof stored === "object" && stored ? stored : {}) as Record<string, unknown>;
  const t = (typeof s.thresholds === "object" && s.thresholds ? s.thresholds : {}) as Record<string, unknown>;
  const o = (typeof s.outcomes === "object" && s.outcomes ? s.outcomes : {}) as Record<string, unknown>;
  const r = (typeof s.review === "object" && s.review ? s.review : {}) as Record<string, unknown>;

  const outcomes = {} as Record<SignalKey, Outcome>;
  for (const sig of KYC_SIGNALS) outcomes[sig.key] = clampOutcome(sig.key, o[sig.key]);

  return {
    thresholds: {
      idQualityFloor: num(t.idQualityFloor, KYC_DEFAULTS.thresholds.idQualityFloor, 0, 100),
      faceNoMatchBelow: num(t.faceNoMatchBelow, KYC_DEFAULTS.thresholds.faceNoMatchBelow, 0, 100),
      faceMatchAtOrAbove: num(t.faceMatchAtOrAbove, KYC_DEFAULTS.thresholds.faceMatchAtOrAbove, 0, 100),
      livenessFloor: num(t.livenessFloor, KYC_DEFAULTS.thresholds.livenessFloor, 0, 100),
    },
    outcomes,
    review: {
      maxRetakes: num(r.maxRetakes, KYC_DEFAULTS.review.maxRetakes, 1, 10),
      openConversation:
        typeof r.openConversation === "boolean" ? r.openConversation : KYC_DEFAULTS.review.openConversation,
      slaHours: num(r.slaHours, KYC_DEFAULTS.review.slaHours, 0, 720),
    },
  };
}

export function validateKycConfig(c: KycConfig): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const bad = (path: string, message: string) => issues.push({ path, message });

  // The two face numbers define three bands, and inverting them silently
  // collapses the middle one — the band where a HUMAN LOOKS. A lender who does
  // that has switched off review while the screen still says it is on.
  if (c.thresholds.faceMatchAtOrAbove <= c.thresholds.faceNoMatchBelow) {
    bad(
      "thresholds.faceMatchAtOrAbove",
      "The auto-match score must be higher than the no-match score, or there is no band left for a person to review.",
    );
  }
  if (c.thresholds.faceMatchAtOrAbove - c.thresholds.faceNoMatchBelow < 5) {
    bad(
      "thresholds.faceMatchAtOrAbove",
      "Leave at least 5 points between the two face scores — a narrower band sends almost nothing to review.",
    );
  }
  if (c.thresholds.idQualityFloor > 90) {
    bad("thresholds.idQualityFloor", "Above 90, ordinary photographs of worn cards will be rejected.");
  }

  for (const sig of KYC_SIGNALS) {
    if (!(sig.allowed as string[]).includes(c.outcomes[sig.key])) {
      bad(`outcomes.${sig.key}`, `"${c.outcomes[sig.key]}" is not available for ${sig.label}.`);
    }
  }

  // A refusal nobody can appeal, with the door to the humans nailed shut.
  const refusing = KYC_SIGNALS.filter((s) => c.outcomes[s.key] === "refuse");
  if (!c.review.openConversation && refusing.length > 0) {
    bad(
      "review.openConversation",
      "You are refusing customers automatically with no way for them to reach anyone. Turn conversations on, or move these to review.",
    );
  }

  return issues;
}

// ── The decision itself ──────────────────────────────────────────────────────

export type Signal = { key: SignalKey; outcome: Outcome; label: string; customerSays: string; fixable: boolean };

export type KycVerdict = {
  status: "VERIFIED" | "PENDING_REVIEW" | "FAILED";
  /** Everything that fired, whatever its outcome. The officer sees all of it. */
  signals: Signal[];
  /** Flag keys, for KycSession.riskFlags — the shape the console queue reads. */
  flags: string[];
  /** True when retaking could plausibly change the answer. Drives the app's
   *  "try again" button, which must not be offered for a registry miss. */
  retakeable: boolean;
};

/**
 * Score a finished session against a lender's policy.
 *
 * Pure — no database, no clock — so it is trivially testable and so the console
 * can show a lender what their proposed thresholds would have done to the last
 * hundred sessions before they publish.
 */
export function decideKyc(
  cfg: KycConfig,
  s: {
    idQualityScore: number | null;
    faceMatchScore: number | null;
    livenessScore: number | null;
    livenessPassed: boolean | null;
    iprsMatched: boolean | null;
    nameVerdict?: "exact" | "strong" | "partial" | "none" | null;
  },
): KycVerdict {
  const fired: Signal[] = [];
  const raise = (key: SignalKey) => {
    const sig = KYC_SIGNALS.find((x) => x.key === key)!;
    const outcome = cfg.outcomes[key];
    // `pass` means the lender has decided this signal is not worth acting on.
    // It is still not RECORDED as fired, because a signal that changes nothing
    // would only clutter the officer's screen with noise they cannot action.
    if (outcome === "pass") return;
    fired.push({ key, outcome, label: sig.label, customerSays: sig.customerSays, fixable: sig.fixable });
  };

  const face = s.faceMatchScore ?? 0;

  if ((s.idQualityScore ?? 0) < cfg.thresholds.idQualityFloor) raise("idQualityLow");

  if (face < cfg.thresholds.faceNoMatchBelow) raise("faceNoMatch");
  else if (face < cfg.thresholds.faceMatchAtOrAbove) raise("faceBorderline");

  // `livenessPassed` is authoritative when the provider set it; the score is the
  // fallback for providers that return one without a verdict. A null-on-both
  // means the check did not run, which is not a failure to report here — the
  // capability flags on the route say whether liveness was available at all.
  if (s.livenessPassed === false || (s.livenessPassed == null && s.livenessScore != null && s.livenessScore < cfg.thresholds.livenessFloor)) {
    raise("livenessFailed");
  }

  if (s.iprsMatched !== true) raise("iprsUnmatched");
  if (s.nameVerdict === "partial") raise("nameBorderline");

  const status =
    fired.some((f) => f.outcome === "refuse") ? "FAILED"
    : fired.some((f) => f.outcome === "review") ? "PENDING_REVIEW"
    : "VERIFIED";

  return {
    status,
    signals: fired,
    flags: fired.map((f) => f.key),
    // Only worth offering when EVERY firing signal is one a better photograph
    // could fix. Offering "try again" against a registry miss sends somebody to
    // retake a photo six times for a problem no photograph can solve.
    retakeable: fired.length > 0 && fired.every((f) => f.fixable),
  };
}
