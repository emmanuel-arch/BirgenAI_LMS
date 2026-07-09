// ─────────────────────────────────────────────────────────────────────────────
// Model tuning — the weights behind Portfolio Early Warning, made editable.
//
// Every lender's book behaves differently. A 14-day delinquency at a Nairobi
// market-stall lender is normal breathing; at a payroll lender it is an alarm. So
// the risk engine's weights stop being magic numbers in a source file and become
// a per-org profile a Credit Manager can move — with the numbers explained, the
// effect previewed against their real book before it is saved, and every change
// attributed and audited.
//
// Three rules make that safe rather than reckless:
//
//   1. DEFAULT_WEIGHTS reproduce the engine's original behaviour EXACTLY. An org
//      that never touches this page is scored today the way it was yesterday, and
//      a regression test asserts the numbers have not moved.
//   2. Every weight is bounded. A Credit Manager cannot set "days past due" to
//      zero and make an arrears book look healthy, nor drive one factor to 100 and
//      let it swamp the rest. `validate` clamps and reports what it clamped.
//   3. Nothing here changes what a borrower OWES. Tuning changes who an officer is
//      told to call first. It cannot alter a schedule, a balance or a decision that
//      has already been made — the early-warning engine is advisory by design.
//
// The weights are not a model in the machine-learning sense and this file does not
// pretend otherwise. They are a documented, defensible scoring policy, which is
// exactly what a regulator asks a lender to produce for an adverse action.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";
import { runWithOrg } from "@/lib/db/context";

export type Weights = {
  // In-life arrears — the dominant signal. Points added at each severity step.
  dpdOver60: number;
  dpd31to60: number;
  dpd8to30: number;
  dpd1to7: number;
  missed3Plus: number;
  missed2: number;
  paidRatioUnder50: number;
  paidRatioUnder75: number;
  // Origination signal (the closed ML loop).
  modelPdHigh: number; // pd ≥ pdHighAt
  modelPdElevated: number; // pd ≥ pdElevatedAt
  creditScoreUnder500: number;
  creditScoreUnder600: number;
  // Structural risk.
  firstCycle: number;
  kycUnverified: number;
  largeExposure: number;
};

export type Thresholds = {
  /** riskScore at or above which a borrower is HIGH. */
  highBand: number;
  /** riskScore at or above which a borrower is ELEVATED. */
  elevatedBand: number;
  /** Below this score, and with no arrears, a borrower is not surfaced at all. */
  surfaceAt: number;
  /** Model PD at or above which "high model PD" applies. */
  pdHighAt: number;
  pdElevatedAt: number;
  /** Balance above this multiple of the book's average counts as large exposure. */
  largeExposureMultiple: number;
  /** Days past due at or above which the recommended action is a field visit. */
  fieldVisitAtDpd: number;
};

export type TuningConfig = { weights: Weights; thresholds: Thresholds };

/**
 * The engine's original numbers, unchanged. Do not "improve" these casually — an
 * org on defaults gets scored by them, and `verify-tuning` fails if they move.
 */
export const DEFAULT_WEIGHTS: Weights = {
  dpdOver60: 55,
  dpd31to60: 42,
  dpd8to30: 28,
  dpd1to7: 14,
  missed3Plus: 12,
  missed2: 7,
  paidRatioUnder50: 12,
  paidRatioUnder75: 6,
  modelPdHigh: 12,
  modelPdElevated: 6,
  creditScoreUnder500: 12,
  creditScoreUnder600: 6,
  firstCycle: 8,
  kycUnverified: 8,
  largeExposure: 6,
};

export const DEFAULT_THRESHOLDS: Thresholds = {
  highBand: 65,
  elevatedBand: 38,
  surfaceAt: 20,
  pdHighAt: 0.25,
  pdElevatedAt: 0.15,
  largeExposureMultiple: 1.5,
  fieldVisitAtDpd: 31,
};

export const DEFAULT_CONFIG: TuningConfig = { weights: DEFAULT_WEIGHTS, thresholds: DEFAULT_THRESHOLDS };

/** What each weight means, in the words an officer would use. Drives the UI. */
export const WEIGHT_LABELS: Record<keyof Weights, { label: string; group: string; help: string }> = {
  dpdOver60: { label: "More than 60 days late", group: "Arrears", help: "The strongest signal there is. A loan this far behind rarely recovers on its own." },
  dpd31to60: { label: "31 to 60 days late", group: "Arrears", help: "Past the point where a reminder is enough." },
  dpd8to30: { label: "8 to 30 days late", group: "Arrears", help: "A missed cycle, not yet a pattern." },
  dpd1to7: { label: "1 to 7 days late", group: "Arrears", help: "Often just a slow week. Weight it lightly." },
  missed3Plus: { label: "Three or more missed installments", group: "Arrears", help: "Repeated misses, independent of how late the oldest one is." },
  missed2: { label: "Two missed installments", group: "Arrears", help: "" },
  paidRatioUnder50: { label: "Less than half of dues paid", group: "Arrears", help: "Measures the trajectory rather than the moment." },
  paidRatioUnder75: { label: "Less than three-quarters paid", group: "Arrears", help: "" },
  modelPdHigh: { label: "High model probability of default", group: "Origination", help: "What the scorer thought at application time, proven against outcomes." },
  modelPdElevated: { label: "Elevated model probability", group: "Origination", help: "" },
  creditScoreUnder500: { label: "Credit score below 500", group: "Origination", help: "" },
  creditScoreUnder600: { label: "Credit score below 600", group: "Origination", help: "" },
  firstCycle: { label: "First-cycle borrower", group: "Structural", help: "No repayment history with you yet — uncertainty, not badness." },
  kycUnverified: { label: "Identity not verified", group: "Structural", help: "Harder to trace, harder to recover from." },
  largeExposure: { label: "Unusually large loan", group: "Structural", help: "Relative to the average balance on your own book." },
};

// ── Bounds ────────────────────────────────────────────────────────────────────
//
// A weight of zero silences a signal; the caps stop any single factor from
// deciding the band alone. Arrears may dominate — it should — but nothing else may.

const WEIGHT_BOUNDS: Record<keyof Weights, [number, number]> = {
  dpdOver60: [0, 70], dpd31to60: [0, 60], dpd8to30: [0, 45], dpd1to7: [0, 30],
  missed3Plus: [0, 25], missed2: [0, 20],
  paidRatioUnder50: [0, 25], paidRatioUnder75: [0, 20],
  modelPdHigh: [0, 25], modelPdElevated: [0, 20],
  creditScoreUnder500: [0, 25], creditScoreUnder600: [0, 20],
  firstCycle: [0, 20], kycUnverified: [0, 20], largeExposure: [0, 20],
};

const THRESHOLD_BOUNDS: Record<keyof Thresholds, [number, number]> = {
  highBand: [40, 95],
  elevatedBand: [10, 80],
  surfaceAt: [0, 60],
  pdHighAt: [0.05, 0.9],
  pdElevatedAt: [0.02, 0.8],
  largeExposureMultiple: [1.1, 5],
  fieldVisitAtDpd: [1, 180],
};

export type ValidationResult = {
  config: TuningConfig;
  /** Fields we had to move, and why. Shown to the person who moved them. */
  adjustments: string[];
};

const clamp = (n: number, [lo, hi]: [number, number]) => Math.min(hi, Math.max(lo, n));

/**
 * Take whatever arrived and return something the engine can safely run.
 *
 * Never throws: an unparseable value falls back to the default rather than
 * stopping a Credit Manager mid-edit. What it corrects, it reports.
 */
export function validate(input: unknown): ValidationResult {
  const raw = (input ?? {}) as Partial<TuningConfig>;
  const adjustments: string[] = [];

  const weights = { ...DEFAULT_WEIGHTS };
  for (const key of Object.keys(DEFAULT_WEIGHTS) as (keyof Weights)[]) {
    const v = Number(raw.weights?.[key]);
    if (!Number.isFinite(v)) continue; // absent or nonsense → keep the default
    const bounded = clamp(Math.round(v), WEIGHT_BOUNDS[key]);
    if (bounded !== v) adjustments.push(`${WEIGHT_LABELS[key].label} was limited to ${bounded}.`);
    weights[key] = bounded;
  }

  const thresholds = { ...DEFAULT_THRESHOLDS };
  for (const key of Object.keys(DEFAULT_THRESHOLDS) as (keyof Thresholds)[]) {
    const v = Number(raw.thresholds?.[key]);
    if (!Number.isFinite(v)) continue;
    const bounded = clamp(v, THRESHOLD_BOUNDS[key]);
    if (bounded !== v) adjustments.push(`${key} was limited to ${bounded}.`);
    thresholds[key] = bounded;
  }

  // The bands must stay ordered, or a borrower could be both HIGH and not ELEVATED.
  if (thresholds.elevatedBand >= thresholds.highBand) {
    thresholds.elevatedBand = Math.max(THRESHOLD_BOUNDS.elevatedBand[0], thresholds.highBand - 5);
    adjustments.push(`"Elevated" must sit below "High" — it was moved to ${thresholds.elevatedBand}.`);
  }
  if (thresholds.surfaceAt >= thresholds.elevatedBand) {
    thresholds.surfaceAt = Math.max(0, thresholds.elevatedBand - 5);
    adjustments.push(`The watchlist cut-off must sit below "Elevated" — it was moved to ${thresholds.surfaceAt}.`);
  }
  if (thresholds.pdElevatedAt >= thresholds.pdHighAt) {
    thresholds.pdElevatedAt = Math.max(THRESHOLD_BOUNDS.pdElevatedAt[0], thresholds.pdHighAt - 0.05);
    adjustments.push(`Elevated PD must sit below high PD — it was moved to ${thresholds.pdElevatedAt.toFixed(2)}.`);
  }

  // Arrears must be able to reach HIGH on their own, or the watchlist stops
  // watching the thing it exists to watch.
  if (weights.dpdOver60 < thresholds.highBand / 2) {
    adjustments.push(
      `A 60-day arrear now scores ${weights.dpdOver60}, less than half of "High" (${thresholds.highBand}). Badly late loans may never be flagged.`,
    );
  }

  return { config: { weights, thresholds }, adjustments };
}

export const isDefault = (c: TuningConfig): boolean =>
  JSON.stringify(c) === JSON.stringify(DEFAULT_CONFIG);

// ── Loading ───────────────────────────────────────────────────────────────────
//
// Hung off globalThis, not a module const: Next compiles each route and page into
// its own server bundle, so a plain Map is instantiated once PER BUNDLE and the
// page would go on scoring with a profile the API had already replaced. (The same
// trap the entitlements cache fell into.)

const TTL_MS = 60_000;
const globalForTuning = globalThis as unknown as { tuningCache?: Map<string, { at: number; value: TuningConfig }> };
const cache = (globalForTuning.tuningCache ??= new Map());

/**
 * This org's scoring policy. Defaults when never tuned.
 *
 * Self-scoping (`runWithOrg`) so it can be called from a cron, a script or a test
 * with no session cookie to resolve the tenant from — the same pattern entitlements
 * uses. Validated on the way out, so a row edited straight in the database still
 * cannot push a weight past its ceiling.
 */
export async function tuningFor(orgId: string): Promise<TuningConfig> {
  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  let value = DEFAULT_CONFIG;
  try {
    const row = await runWithOrg(orgId, () => prisma.tuningProfile.findUnique({ where: { orgId } }));
    if (row) value = validate({ weights: row.weights, thresholds: row.thresholds }).config;
  } catch (err) {
    // A tuning read must never take the watchlist down with it — but it must also
    // not fail silently, or an org would be scored on defaults it never chose.
    console.error(`[tuning] could not load policy for ${orgId}, falling back to defaults:`, err);
  }
  cache.set(orgId, { at: Date.now(), value });
  return value;
}

export function invalidateTuning(orgId: string): void {
  cache.delete(orgId);
}
