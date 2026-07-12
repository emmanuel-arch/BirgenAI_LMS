// ─────────────────────────────────────────────────────────────────────────────
// The per-org overlay — the lender's own words on top of our definitions.
//
// The catalogue (catalog.ts) says what PAR 30 IS. This says what THIS lender calls
// it, what they hold themselves to, and whether Riri may quote it at all. The split
// matters: a Nairobi market lender who says "delinquency" and a payroll lender who
// says "arrears rate" are asking the same question, and neither should have to learn
// our vocabulary to get an answer. But neither of them gets to redefine the measure
// itself — that would let a lender quietly make their own PAR look better, and PAR
// is a number a regulator reads.
//
// So: synonyms, labels, targets and visibility are the lender's. The arithmetic is
// not. A metricId that does not exist in the code catalogue cannot be saved here.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";
import { runWithOrg } from "@/lib/db/context";
import { METRICS, isMetricId, type MetricSpec } from "./catalog";

export type ResolvedMetric = MetricSpec & {
  /** The lender's word for it, falling back to ours. */
  displayLabel: string;
  /** Our synonyms plus theirs — what the router matches on. */
  allSynonyms: string[];
  enabled: boolean;
  target: number | null;
  targetDirection: "below" | "above" | null;
  /** True when this org has said something about the metric. */
  customised: boolean;
};

export type MetricOverlay = {
  label?: string | null;
  synonyms?: string[];
  enabled?: boolean;
  target?: number | null;
  targetDirection?: "below" | "above" | null;
};

const TTL_MS = 60_000;
// globalThis, not a module const: Next compiles each route and page into its own
// server bundle, so a plain Map is instantiated once PER BUNDLE and a page would go
// on answering with synonyms the API had already replaced. (The bug the entitlements
// cache actually shipped with — see the billing notes.)
const globalForMetrics = globalThis as unknown as {
  ririMetricCache?: Map<string, { at: number; value: ResolvedMetric[] }>;
};
const cache = (globalForMetrics.ririMetricCache ??= new Map());

const DEFAULTS = (spec: MetricSpec): ResolvedMetric => ({
  ...spec,
  displayLabel: spec.label,
  allSynonyms: spec.synonyms,
  enabled: true,
  target: null,
  targetDirection: null,
  customised: false,
});

/**
 * This org's metric vocabulary. Defaults when they have never touched it.
 *
 * Self-scoping (`runWithOrg`) so a cron or a script with no session cookie can still
 * resolve it — the same pattern entitlements and tuning use. A failure to read the
 * overlay falls back to the catalogue rather than taking Riri down: a lender losing
 * their nickname for PAR is an inconvenience, a lender losing PAR is an outage.
 */
export async function metricsFor(orgId: string): Promise<ResolvedMetric[]> {
  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  let value = METRICS.map(DEFAULTS);
  try {
    const rows = await runWithOrg(orgId, () => prisma.metricDefinition.findMany({ where: { orgId } }));
    const by = new Map(rows.map((r) => [r.metricId, r]));
    value = METRICS.map((spec) => {
      const row = by.get(spec.id);
      if (!row) return DEFAULTS(spec);
      const extra = (row.synonyms ?? []).map((s) => s.toLowerCase().trim()).filter(Boolean);
      return {
        ...spec,
        displayLabel: row.label?.trim() || spec.label,
        // Their words come FIRST: when a lender has taught Riri their vocabulary,
        // it should win the routing tie against our generic one.
        allSynonyms: [...extra, ...spec.synonyms],
        enabled: row.enabled,
        target: row.target,
        targetDirection: (row.targetDirection as "below" | "above" | null) ?? null,
        customised: true,
      };
    });
  } catch (err) {
    console.error(`[riri] could not load the metric overlay for ${orgId}; using the catalogue:`, err);
  }

  cache.set(orgId, { at: Date.now(), value });
  return value;
}

export function invalidateMetrics(orgId: string): void {
  cache.delete(orgId);
}

export type OverlayValidation = { ok: true; overlay: MetricOverlay } | { ok: false; reason: string };

/**
 * What a lender is allowed to say about a metric. Deliberately small.
 */
export function validateOverlay(metricId: string, input: unknown): OverlayValidation {
  if (!isMetricId(metricId)) {
    return { ok: false, reason: `There is no metric called "${metricId}".` };
  }
  const raw = (input ?? {}) as MetricOverlay;
  const overlay: MetricOverlay = {};

  if (raw.label !== undefined) {
    const label = String(raw.label ?? "").trim();
    if (label.length > 60) return { ok: false, reason: "A metric name has to be under 60 characters." };
    overlay.label = label || null;
  }

  if (raw.synonyms !== undefined) {
    if (!Array.isArray(raw.synonyms)) return { ok: false, reason: "Synonyms have to be a list of words." };
    const cleaned = [...new Set(
      raw.synonyms
        .map((s) => String(s ?? "").toLowerCase().trim())
        // A one-character synonym would match half the questions ever asked.
        .filter((s) => s.length >= 2 && s.length <= 40),
    )].slice(0, 12);
    overlay.synonyms = cleaned;
  }

  if (raw.enabled !== undefined) overlay.enabled = Boolean(raw.enabled);

  if (raw.target !== undefined) {
    if (raw.target === null || raw.target === ("" as unknown)) overlay.target = null;
    else {
      const t = Number(raw.target);
      if (!Number.isFinite(t)) return { ok: false, reason: "A target has to be a number." };
      if (t < 0) return { ok: false, reason: "A target can't be negative." };
      overlay.target = t;
    }
  }

  if (raw.targetDirection !== undefined) {
    const d = raw.targetDirection;
    if (d !== "below" && d !== "above" && d !== null) {
      return { ok: false, reason: `A target is either "below" or "above" the number.` };
    }
    overlay.targetDirection = d;
  }

  return { ok: true, overlay };
}

/**
 * Persist an overlay. The metricId is checked against the code catalogue first.
 *
 * Self-scoping like `metricsFor`, so a script or a seed with no session cookie can
 * call it. (A request-time caller already has a tenant on the cookie; an explicit
 * scope simply wins over it.)
 */
export async function saveOverlay(orgId: string, metricId: string, input: unknown): Promise<OverlayValidation> {
  const v = validateOverlay(metricId, input);
  if (!v.ok) return v;

  await runWithOrg(orgId, () => prisma.metricDefinition.upsert({
    where: { orgId_metricId: { orgId, metricId } },
    create: {
      orgId,
      metricId,
      label: v.overlay.label ?? null,
      synonyms: v.overlay.synonyms ?? [],
      enabled: v.overlay.enabled ?? true,
      target: v.overlay.target ?? null,
      targetDirection: v.overlay.targetDirection ?? null,
    },
    update: {
      ...(v.overlay.label !== undefined ? { label: v.overlay.label } : {}),
      ...(v.overlay.synonyms !== undefined ? { synonyms: v.overlay.synonyms } : {}),
      ...(v.overlay.enabled !== undefined ? { enabled: v.overlay.enabled } : {}),
      ...(v.overlay.target !== undefined ? { target: v.overlay.target } : {}),
      ...(v.overlay.targetDirection !== undefined ? { targetDirection: v.overlay.targetDirection } : {}),
    },
  }));

  invalidateMetrics(orgId);
  return v;
}

/** How a metric reads against the target the lender set for it, if any. */
export function targetVerdict(m: ResolvedMetric, value: number): "good" | "bad" | null {
  if (m.target == null || !m.targetDirection) return null;
  return m.targetDirection === "below"
    ? (value <= m.target ? "good" : "bad")
    : (value >= m.target ? "good" : "bad");
}
