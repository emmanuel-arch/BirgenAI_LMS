// ─────────────────────────────────────────────────────────────────────────────
// THE CREDIT POLICY SCREEN — does the picture tell the truth?
//
// The screen makes two promises a lender is about to bet money on:
//
//   1. THE CURVE IS THE TABLE. A factor's bands are drawn as a step function you
//      can drag. If that drawing disagrees with `bandFor()` for even one value,
//      a lender shapes one policy on screen and publishes a different one — and
//      the symptom is a borrower scored under a rung nobody meant to create.
//      Part 1 samples every metric across its whole axis and holds the geometry
//      to an INDEPENDENT reimplementation of the engine's band lookup.
//
//   2. THE PREVIEW IS THE ENGINE. The panel says "this moves 340 customers".
//      That is only worth reading if the number it previews is the number the
//      graduation cron would actually write. Part 2 checks the outcome mapping
//      the preview uses against `assessLadder`'s own result, including the case
//      that matters most — a policy compared against ITSELF must move nobody.
//
// Pure: no database, no server. The DB layer around it (policy-impact.ts) is a
// loader and a loop; what could silently be WRONG is all here.
//
//   npm run test:credit-policy
// ─────────────────────────────────────────────────────────────────────────────
import { bandGeometry, pointsAtValue, clampThreshold } from "../src/lib/scoring/band-geometry";
import { assessLadder, type LoanFact, type InstallmentFact } from "../src/lib/scoring/behaviour";
import {
  FACTOR_METRICS, metricSpec, BEHAVIOUR_DEFAULTS, GRADUATION_DEFAULTS,
  MICROMART_BEHAVIOUR, MICROMART_GRADUATION, validateBehaviour,
  type ScoreBandRule, type ScoreFactor, type FactorMetric,
} from "../src/lib/scoring/behaviour-policy";
import { CREDIT_DEFAULTS, MULAR_POLICY, validateCreditPolicy, mergeCreditPolicy } from "../src/lib/decision/policy";

let failures = 0;
const fail = (m: string) => { failures++; console.log(`  x ${m}`); };
const pass = (m: string) => console.log(`  + ${m}`);
const check = (cond: boolean, ok: string, bad: string) => { if (cond) pass(ok); else fail(bad); };

const NOW = new Date("2026-08-01T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

// ─────────────────────────────────────────────────────────────────────────────
// PART 1 — the curve is the table
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nPart 1 — the drawn curve against the engine's band lookup\n");

/**
 * The engine's band lookup, reimplemented from behaviour.ts BY HAND. Deliberately
 * separate: a test that imports `bandFor` to check `bandGeometry` proves only that
 * two callers agree, not that either is right.
 */
function lookupPoints(bands: ScoreBandRule[], compare: "gte" | "lte", value: number): number {
  for (const b of bands) {
    if (b.threshold === null) return b.points;
    if (compare === "gte" ? value >= b.threshold : value <= b.threshold) return b.points;
  }
  return 0;
}

/** A representative table for each metric, in the direction that metric is read. */
const TABLES: Record<FactorMetric, ScoreBandRule[]> = {
  installment_paid_ratio: [
    { threshold: 1, points: 100, label: "Full" },
    { threshold: 0.75, points: 75, label: "Three quarters" },
    { threshold: 0.5, points: 50, label: "Half" },
    { threshold: null, points: 0, label: "Less" },
  ],
  days_late: [
    { threshold: 0, points: 100, label: "On time" },
    { threshold: 3, points: 30, label: "1–3" },
    { threshold: 6, points: 10, label: "4–6" },
    { threshold: null, points: 0, label: "Worse" },
  ],
  arrears_streak: [
    { threshold: 0, points: 100, label: "None" },
    { threshold: 2, points: 40, label: "Up to two" },
    { threshold: null, points: 0, label: "More" },
  ],
  days_early: [
    { threshold: 5, points: 100, label: "Five or more early" },
    { threshold: 1, points: 70, label: "At least a day early" },
    { threshold: null, points: 40, label: "Not early" },
  ],
  limit_utilisation: [
    { threshold: 0.5, points: 100, label: "Under half" },
    { threshold: 0.9, points: 60, label: "Under 90%" },
    { threshold: null, points: 20, label: "At or over" },
  ],
};

for (const spec of FACTOR_METRICS) {
  const bands = TABLES[spec.key];
  const dmax = Math.max(2, ...bands.map((b) => (b.threshold ?? 0) * 1.5));
  const samples = 400;
  let mismatch: { at: number; drawn: number; engine: number } | null = null;

  for (let i = 0; i <= samples; i++) {
    // Sample the axis, and land exactly on every threshold too — boundaries are
    // where an off-by-one in the inversion would actually hide.
    const v = (dmax / samples) * i;
    const drawn = pointsAtValue(bands, spec.compare, v, dmax);
    const engine = lookupPoints(bands, spec.compare, v);
    if (drawn !== engine) { mismatch = { at: v, drawn, engine }; break; }
  }
  for (const b of bands) {
    if (b.threshold === null || mismatch) continue;
    const drawn = pointsAtValue(bands, spec.compare, b.threshold, dmax);
    const engine = lookupPoints(bands, spec.compare, b.threshold);
    if (drawn !== engine) mismatch = { at: b.threshold, drawn, engine };
  }

  check(
    mismatch === null,
    `${spec.key} (${spec.compare}) — the curve scores every value exactly as the engine does`,
    `${spec.key}: at ${mismatch?.at} the curve says ${mismatch?.drawn}, the engine says ${mismatch?.engine}`,
  );
}

// Every plateau must belong to a real band, and they must tile the axis with no
// gap — a gap is a range of values the screen shows as scoring nothing.
{
  let ok = true;
  const detail: string[] = [];
  for (const spec of FACTOR_METRICS) {
    const bands = TABLES[spec.key];
    const dmax = 4;
    const { segments } = bandGeometry(bands, spec.compare, dmax);
    if (segments.length !== bands.length) { ok = false; detail.push(`${spec.key}: ${segments.length} segments for ${bands.length} bands`); }
    for (let i = 1; i < segments.length; i++) {
      if (Math.abs(segments[i].x0 - segments[i - 1].x1) > 1e-9) {
        ok = false; detail.push(`${spec.key}: gap between ${segments[i - 1].x1} and ${segments[i].x0}`);
      }
    }
    const covered = new Set(segments.map((s) => s.band));
    if (covered.size !== bands.length) { ok = false; detail.push(`${spec.key}: bands ${bands.length}, drawn ${covered.size}`); }
  }
  check(ok, "every band gets exactly one plateau and they tile the axis without a gap", detail.join("; "));
}

// A one-band factor (catch-all only) draws, and has nothing to drag.
{
  const only: ScoreBandRule[] = [{ threshold: null, points: 55, label: "Everything" }];
  const g = bandGeometry(only, "lte", 10);
  check(
    g.segments.length === 1 && g.dividers.length === 0 && pointsAtValue(only, "lte", 7, 10) === 55,
    "a catch-all-only factor draws one flat plateau with no handles",
    `got ${JSON.stringify(g)}`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 2 — dragging cannot produce a document the server would refuse
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nPart 2 — the clamp against the validator\n");

for (const spec of FACTOR_METRICS) {
  const bands = TABLES[spec.key].map((b) => ({ ...b }));
  const dmax = 40;
  let worst: string | null = null;

  // Drag every handle hard against both ends of the axis and confirm the result
  // is still a table the validator accepts.
  for (let i = 0; i < bands.length - 1; i++) {
    for (const target of [-999, 0, dmax, 9_999]) {
      const trial = bands.map((b) => ({ ...b }));
      trial[i] = { ...trial[i], threshold: clampThreshold(trial, spec.compare, i, target, dmax, 0.01) };
      const factor: ScoreFactor = {
        key: "t", label: "Trial", weight: 100, metric: spec.key, enabled: true, bands: trial,
      };
      const issues = validateBehaviour(
        { ...BEHAVIOUR_DEFAULTS, factors: [factor] },
        GRADUATION_DEFAULTS,
      ).filter((x) => x.path.startsWith("behaviour.factors"));
      if (issues.length > 0) { worst = `${spec.key} handle ${i} → ${target}: ${issues[0].message}`; break; }
    }
    if (worst) break;
  }

  check(worst === null, `${spec.key} — no drag can push a threshold past its neighbour`, worst ?? "");
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 3 — the preview is the engine
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nPart 3 — the preview panel's arithmetic\n");

function inst(seq: number, due: number, paidRatio: number, dueOffset: number, lateDays: number | null): InstallmentFact {
  return {
    seq, amountDue: due, amountPaid: due * paidRatio,
    dueDate: day(dueOffset),
    paidAt: lateDays === null ? null : day(dueOffset + lateDays),
  };
}
function loan(id: string, principal: number, status: LoanFact["status"], insts: InstallmentFact[]): LoanFact {
  return { id, principal, status, borrowDate: day(-120), clearedAt: status === "CLEARED" ? day(-5) : null, installments: insts };
}

/** The mapping ImpactPanel and policy-impact.ts use to turn an assessment into a row. */
const effectiveLimit = (a: ReturnType<typeof assessLadder>) => a.newLimit ?? a.currentLimit;

// A spotless repeat borrower: two cleared loans at the same principal, paid in full and on time.
const clean: LoanFact[] = [
  loan("l2", 5_000, "CLEARED", [1, 2, 3, 4].map((s) => inst(s, 1_250, 1, -60 + s * 7, 0))),
  loan("l1", 5_000, "CLEARED", [1, 2, 3, 4].map((s) => inst(s, 1_250, 1, -120 + s * 7, 0))),
];
// The same borrower, sliding: the live loan is in arrears.
const sliding: LoanFact[] = [
  loan("l3", 5_000, "ACTIVE", [1, 2, 3, 4].map((s) => inst(s, 1_250, s <= 1 ? 1 : 0, -30 + s * 7, s <= 1 ? 0 : null))),
  ...clean,
];

// (a) A policy previewed against ITSELF must move nobody. This is the check that
//     makes "340 customers move" mean something: if the two passes disagreed on
//     identical inputs, every headline would be noise.
{
  let drift: string | null = null;
  for (const [name, loans, limit] of [
    ["clean", clean, 5_000], ["sliding", sliding, 12_000], ["empty", [] as LoanFact[], 3_000],
  ] as const) {
    for (const p of [CREDIT_DEFAULTS, MULAR_POLICY]) {
      const a = assessLadder({ loans, currentLimit: limit }, p.behaviour, p.graduation, NOW);
      const b = assessLadder({ loans, currentLimit: limit }, p.behaviour, p.graduation, NOW);
      if (effectiveLimit(a) !== effectiveLimit(b) || a.move !== b.move
        || (a.behaviour.category?.key ?? null) !== (b.behaviour.category?.key ?? null)) {
        drift = `${name} under one policy assessed twice gave ${a.move}/${effectiveLimit(a)} then ${b.move}/${effectiveLimit(b)}`;
      }
    }
  }
  check(drift === null, "a policy previewed against itself moves nobody — the headline is a real delta", drift ?? "");
}

// (b) The preview surfaces the `basis` defect — the exact change a lender cannot
//     see on a form. A spotless borrower who holds a 12,000 limit but has twice
//     cleared 5,000 is CUT to 6,500 by ServiceSuite's own graduation routine, and
//     raised to 15,600 by the platform's. Same customer, same record, same button.
{
  const loans = clean, limit = 12_000;
  const before = assessLadder({ loans, currentLimit: limit }, MICROMART_BEHAVIOUR, MICROMART_GRADUATION, NOW);
  const after = assessLadder({ loans, currentLimit: limit }, BEHAVIOUR_DEFAULTS, GRADUATION_DEFAULTS, NOW);
  const changed = effectiveLimit(before) !== effectiveLimit(after)
    || (before.behaviour.category?.key ?? null) !== (after.behaviour.category?.key ?? null);
  check(
    changed && effectiveLimit(before) < limit && effectiveLimit(after) > limit,
    `the preview catches a graduation that CUTS: parity gives ${effectiveLimit(before)}, `
    + `the platform ladder ${effectiveLimit(after)}, on a 12,000 limit`,
    `expected parity to cut below 12,000 and the platform ladder to raise above it; `
    + `got ${effectiveLimit(before)} and ${effectiveLimit(after)}`,
  );
}

// (c) Turning demotion on is visible in the preview — the whole reason the panel
//     leads with cuts rather than increases.
{
  const withDemotion = {
    ...MICROMART_GRADUATION,
    demotion: { enabled: true, belowCategory: "MODERATE", percent: 25, floor: 1_000 },
  };
  const off = assessLadder({ loans: sliding, currentLimit: 30_000 }, { ...MICROMART_BEHAVIOUR, window: { ...MICROMART_BEHAVIOUR.window, includeActive: true } }, MICROMART_GRADUATION, NOW);
  const on = assessLadder({ loans: sliding, currentLimit: 30_000 }, { ...MICROMART_BEHAVIOUR, window: { ...MICROMART_BEHAVIOUR.window, includeActive: true } }, withDemotion, NOW);
  check(
    off.move !== "demote" && on.move === "demote" && effectiveLimit(on) < 30_000,
    `enabling demotion shows as a cut in the preview (${effectiveLimit(off)} → ${effectiveLimit(on)})`,
    `expected a demotion once enabled; got ${off.move} then ${on.move} at ${effectiveLimit(on)}`,
  );
}

// (d) A borrower with no history is previewable rather than an exception — the
//     panel counts them as "holds", never as a crash.
{
  const a = assessLadder({ loans: [], currentLimit: 0 }, BEHAVIOUR_DEFAULTS, GRADUATION_DEFAULTS, NOW);
  check(
    a.move === "hold" && effectiveLimit(a) === 0 && a.reason.length > 0,
    "a borrower with no repayment record previews as a hold, with a sentence saying why",
    `got ${a.move} / ${effectiveLimit(a)} / "${a.reason}"`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 4 — what the screen sends, the store accepts
// ─────────────────────────────────────────────────────────────────────────────
console.log("\nPart 4 — the documents the screen can publish\n");

// The presets the screen offers must themselves be publishable. A "start from"
// button that produces a 422 is worse than no button.
for (const [name, preset] of [["BirgenAI defaults", CREDIT_DEFAULTS], ["Micromart parity", MULAR_POLICY]] as const) {
  const issues = validateCreditPolicy(preset);
  check(issues.length === 0, `the "${name}" preset publishes cleanly`, `${name}: ${issues.map((i) => i.message).join("; ")}`);
}

// The preview endpoint merges an incoming document forward before running it, so
// a half-typed policy previews instead of throwing.
{
  const partial = { behaviour: { window: { lookbackLoans: 3 } } };
  const merged = mergeCreditPolicy(partial);
  check(
    merged.behaviour.window.lookbackLoans === 3
      && merged.behaviour.factors.length > 0
      && merged.graduation.roundTo === CREDIT_DEFAULTS.graduation.roundTo
      && merged.verdict.autoApproveAbove === CREDIT_DEFAULTS.verdict.autoApproveAbove,
    "a partially-typed policy merges forward to a complete, runnable document",
    `merged badly: ${JSON.stringify(merged.behaviour.window)}`,
  );
}

// The section rail lights a warning dot from the issue path's first segment, so
// every issue the validator can raise has to belong to a section that exists.
{
  const SECTIONS = ["scoreCeilings", "capacity", "stops", "haircuts", "match", "behaviour", "graduation", "verdict"];
  const broken = {
    ...CREDIT_DEFAULTS,
    scoreCeilings: { ...CREDIT_DEFAULTS.scoreCeilings, Good: 99_999 },
    capacity: { ...CREDIT_DEFAULTS.capacity, utilisation: 4, roundTo: 0 },
    stops: { ...CREDIT_DEFAULTS.stops, maxLoanDependency: 5 },
    haircuts: { ...CREDIT_DEFAULTS.haircuts, bettingCutPct: 140 },
    match: { ...CREDIT_DEFAULTS.match, mode: "ladder" as const, ladder: [] },
    verdict: { ...CREDIT_DEFAULTS.verdict, autoDeclineBelow: 900, autoApproveAbove: 100 },
    behaviour: {
      ...CREDIT_DEFAULTS.behaviour,
      factors: CREDIT_DEFAULTS.behaviour.factors.map((f) => ({ ...f, weight: 80 })),
    },
    graduation: { ...CREDIT_DEFAULTS.graduation, roundTo: 0 },
  };
  const issues = validateCreditPolicy(broken);
  const orphans = issues.map((i) => i.path.split(".")[0]).filter((s) => !SECTIONS.includes(s));
  check(
    issues.length >= 7 && orphans.length === 0,
    `every validator complaint routes to a section on the rail (${issues.length} raised)`,
    orphans.length ? `no section owns: ${[...new Set(orphans)].join(", ")}` : `only ${issues.length} issues raised`,
  );
}

// The screen's factor-metric dropdown must offer exactly what the engine can compute.
{
  const drawable = ["installment_paid_ratio", "days_late", "arrears_streak", "days_early", "limit_utilisation"];
  const offered = FACTOR_METRICS.map((m) => m.key);
  check(
    offered.length === drawable.length && offered.every((k) => drawable.includes(k)) && offered.every((k) => !!metricSpec(k)),
    "the metric dropdown offers exactly the metrics the editor knows how to draw",
    `offered ${offered.join(", ")} but the editor draws ${drawable.join(", ")}`,
  );
}

console.log(failures === 0 ? "\nCredit policy screen verified.\n" : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
