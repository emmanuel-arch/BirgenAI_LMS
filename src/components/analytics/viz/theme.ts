// ─────────────────────────────────────────────────────────────────────────────
// THE STUDIO'S VISUAL LANGUAGE — one file, so no chart invents its own.
//
// Every value here is the house dataviz system, already in use by the console's
// Analysis Studio charts. It is reproduced in one module rather than re-declared
// per chart because the whole point of a categorical order is that it is FIXED:
// a series must keep its hue when a filter changes the series count, and that is
// only true if there is one list.
//
// ── THE PALETTE, AND WHY THIS ORDER ──────────────────────────────────────────
// Eight hues, validated (OKLab ΔE, ×100) on the light surface #fcfcfb:
//   · lightness band       all 8 inside L 0.43–0.77                    PASS
//   · chroma floor         all 8 ≥ 0.1                                 PASS
//   · CVD separation       worst adjacent pair ΔE 9.1 (protan)         PASS
//   · normal-vision floor  worst adjacent pair ΔE 19.6                 PASS
//   · contrast vs surface  aqua/yellow/magenta below 3:1               WARN
//
// The contrast WARN is not dismissable — it OBLIGES relief. Ours is structural:
// every chart in this studio ships a "the numbers" table beneath it, so no value
// is ever gated behind a hue a reader cannot resolve. That is also just good
// practice: a chart you cannot check is a chart you should not act on.
//
// ── THE THREE-SLOT CAP ───────────────────────────────────────────────────────
// The eight-slot order clears the gates on the ADJACENT pairlist — stacks, bars,
// grouped columns, lines — where only neighbours must be told apart. Forms where
// every pair is simultaneously on screen (scatter, bubble, treemap, donut) cap at
// THREE, because past three no ordering of these eight clears the all-pairs
// floor. CATEGORICAL_ALL_PAIRS is that capped list, and the chart kit uses it for
// exactly those forms rather than leaving the choice to whoever writes the next
// screen.
// ─────────────────────────────────────────────────────────────────────────────

/** The fixed categorical order. Slot index IS the identity — never cycle it. */
export const CATEGORICAL = [
  "#2a78d6", // 1 blue
  "#eb6834", // 2 orange
  "#1baf7a", // 3 aqua
  "#eda100", // 4 yellow
  "#e87ba4", // 5 magenta
  "#008300", // 6 green
  "#4a3aa7", // 7 violet
  "#e34948", // 8 red
] as const;

/** Safe for forms where every pair is compared at once (scatter, donut, treemap). */
export const CATEGORICAL_ALL_PAIRS = CATEGORICAL.slice(0, 3);

/** Sequential: ONE hue, light → dark. Magnitude, never identity. */
export const SEQUENTIAL = [
  "#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec",
  "#5598e7", "#3987e5", "#2a78d6", "#256abf", "#1c5cab",
  "#184f95", "#104281", "#0d366b",
] as const;

/**
 * Ordinal ramp — discrete ordered marks (funnel stages, tiers).
 * Starts at step 250 because anything lighter drops under 2:1 on the light
 * surface and the first stage of a funnel would recede into the page.
 */
export const ORDINAL = SEQUENTIAL.slice(3);

/** Diverging: two poles that read as opposite, with a NEUTRAL grey midpoint. */
export const DIVERGING = {
  low: ["#0d366b", "#256abf", "#3987e5", "#86b6ef", "#cde2fb"],
  mid: "#f0efec",
  high: ["#fbd5d5", "#f19d9c", "#e77070", "#e34948", "#b32f2e"],
} as const;

/**
 * STATUS — reserved. Never reused as "series 4", and never shipped as colour
 * alone: a status mark always carries a label or an icon beside it.
 */
export const STATUS = {
  good: "#0ca30c",
  warning: "#fab219",
  serious: "#eb6834",
  critical: "#d03b3b",
  neutral: "#898781",
} as const;

/** Text and furniture. Text NEVER wears a series colour. */
export const INK = {
  primary: "#0b0b0b",
  secondary: "#52514e",
  muted: "#898781",
  faint: "#b4b2ab",
  grid: "#e1e0d9",
  surface: "#ffffff",
} as const;

/** Mark specs, fixed across every chart in the studio. */
export const MARK = {
  /** Bars are capped, never filling their slot — the leftover band is air. */
  barMaxWidth: 24,
  barRadius: [4, 4, 0, 0] as [number, number, number, number],
  barRadiusH: [0, 4, 4, 0] as [number, number, number, number],
  lineWidth: 2,
  dotRadius: 4,
  /** Ring in the surface colour, so a dot stays legible where marks overlap. */
  dotRingWidth: 2,
  areaOpacity: 0.1,
  /** The 2px surface gap that separates touching marks. */
  gap: 2,
} as const;

/** The colour a series in slot `i` gets. Wraps only after the token ceiling. */
export const hueAt = (i: number, allPairs = false): string => {
  const list = allPairs ? CATEGORICAL_ALL_PAIRS : CATEGORICAL;
  return list[i % list.length];
};

/**
 * A sequential step for a 0..1 magnitude.
 *
 * `floor` keeps the lightest step off the surface for ORDINAL use; leave it at 0
 * for true sequential encoding, where "near zero recedes" is the correct reading.
 */
export function seqAt(t: number, floor = 0): string {
  const ramp = floor > 0 ? ORDINAL : SEQUENTIAL;
  const clamped = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  return ramp[Math.min(ramp.length - 1, Math.round(clamped * (ramp.length - 1)))];
}

/** A diverging step for a −1..+1 value. Zero is the neutral grey, never a hue. */
export function divAt(t: number): string {
  if (!Number.isFinite(t) || Math.abs(t) < 0.04) return DIVERGING.mid;
  const arm = t < 0 ? DIVERGING.low : DIVERGING.high;
  const mag = Math.min(1, Math.abs(t));
  // The low arm runs dark→light, so it is indexed from the end.
  const idx = Math.min(arm.length - 1, Math.round(mag * (arm.length - 1)));
  return t < 0 ? arm[arm.length - 1 - idx] : arm[idx];
}

/**
 * Ink or white for a label sitting INSIDE a coloured fill.
 *
 * The one sanctioned exception to "text never wears the data colour" is a label
 * on top of a mark, and it must still clear contrast — so the choice is computed
 * from the fill's relative luminance rather than picked by eye.
 */
export function inkOn(hex: string): string {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.45 ? INK.primary : "#ffffff";
}

/** Status colour for a quality ratio, with the direction of "good" respected. */
export function toneFor(value: number, thresholds: { good: number; warn: number }, goodDirection: "up" | "down"): string {
  if (goodDirection === "down") {
    if (value <= thresholds.good) return STATUS.good;
    if (value <= thresholds.warn) return STATUS.warning;
    return STATUS.critical;
  }
  if (value >= thresholds.good) return STATUS.good;
  if (value >= thresholds.warn) return STATUS.warning;
  return STATUS.critical;
}

/** Shared axis / grid props so no two charts differ by an accident. */
export const AXIS = {
  tick: { fontSize: 10, fill: INK.muted },
  axisLine: { stroke: INK.grid },
  tickLine: false as const,
};

export const GRID = {
  stroke: INK.grid,
  strokeDasharray: "0", // hairline SOLID — never dashed
  vertical: false,
};
