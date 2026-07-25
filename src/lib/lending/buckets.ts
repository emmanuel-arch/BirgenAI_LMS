// ─────────────────────────────────────────────────────────────────────────────
// The product ladder a Mular customer graduates up: INUKA → KUZA → FADHILI.
// A "bucket" is a principal band; interest scales with the tenor (6.25%/week).
// These constants mirror scripts/seed-mular-buckets.ts — the two must agree, so
// the match engine only ever offers products the catalogue actually holds.
// ─────────────────────────────────────────────────────────────────────────────
export type TierKey = "INUKA" | "KUZA" | "FADHILI";

export type Tier = {
  key: TierKey;
  label: string;
  min: number;
  max: number;
  /** Processing charge on this tier — flat KES, or a percent of principal. */
  processing: { percent: boolean; amount: number };
  blurb: string;
};

export const TIERS: Tier[] = [
  { key: "INUKA", label: "Inuka", min: 1000, max: 5000, processing: { percent: false, amount: 500 }, blurb: "First rung — small, fast, builds a record." },
  { key: "KUZA", label: "Kuza", min: 6000, max: 10000, processing: { percent: false, amount: 500 }, blurb: "The growth tier — for a proven repayer." },
  { key: "FADHILI", label: "Fadhili", min: 11000, max: 1_000_000, processing: { percent: true, amount: 5 }, blurb: "Top tier — the reward for a clean ladder." },
];

export const WEEKS = [4, 5, 6, 7, 8] as const;

/** Interest is a flat percentage of principal for the whole term: 25% at 4wk … 50% at 8wk. */
export const interestForWeeks = (w: number) => +(6.25 * w).toFixed(2);

export const tierOf = (key: TierKey) => TIERS.find((t) => t.key === key)!;

/** Which tier a starting limit lands the customer in, snapping gaps down to the tier below. */
export function tierForLimit(limit: number): Tier | null {
  if (limit >= TIERS[2].min) return TIERS[2]; // FADHILI 11k+
  if (limit >= TIERS[1].min) return TIERS[1]; // KUZA 6k–10k (10001–10999 snaps here)
  if (limit >= TIERS[0].min) return TIERS[0]; // INUKA 1k–5k (5001–5999 snaps here)
  return null;
}

/** Round a raw limit into a tier's band and to a clean step. */
export function snapLimitToTier(raw: number, tier: Tier): number {
  const step = tier.key === "INUKA" ? 500 : 1000;
  const capped = Math.min(raw, tier.max);
  return Math.max(tier.min, Math.round(capped / step) * step);
}
