// ─────────────────────────────────────────────────────────────────────────────
// Logo analysis — everything the Brand Studio derives from an uploaded logo.
//
// All pure functions over raw RGBA pixel arrays ({ data, width, height }, the
// shape of a canvas ImageData) so the same code runs in the browser against a
// real canvas and offline in verify-branding against synthesized fixtures.
// No dependencies, no subscriptions: transparency is an alpha scan, background
// removal is a border flood-fill, the palette is a quantized histogram.
// ─────────────────────────────────────────────────────────────────────────────

export type Pixels = { data: Uint8ClampedArray; width: number; height: number };

// ── Color helpers ─────────────────────────────────────────────────────────────

export const hex = (r: number, g: number, b: number): string =>
  `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;

export function parseHex(h: string): { r: number; g: number; b: number } | null {
  const m = /^#([0-9a-f]{6})$/i.exec((h ?? "").trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export const isHexColor = (h: string): boolean => parseHex(h) !== null;

export const isCssRgba = (s: string): boolean =>
  /^rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(0|1|0?\.\d+)\s*\)$/i.test((s ?? "").trim());

export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h: h * 360, s, l };
}

export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const hn = ((h % 360) + 360) % 360 / 360;
  if (s === 0) { const v = Math.round(l * 255); return { r: v, g: v, b: v }; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    let tn = t; if (tn < 0) tn += 1; if (tn > 1) tn -= 1;
    if (tn < 1 / 6) return p + (q - p) * 6 * tn;
    if (tn < 1 / 2) return q;
    if (tn < 2 / 3) return p + (q - p) * (2 / 3 - tn) * 6;
    return p;
  };
  return { r: Math.round(f(hn + 1 / 3) * 255), g: Math.round(f(hn) * 255), b: Math.round(f(hn - 1 / 3) * 255) };
}

const dist2 = (r1: number, g1: number, b1: number, r2: number, g2: number, b2: number) =>
  (r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2;

// ── Transparency ──────────────────────────────────────────────────────────────

/** Does the image already use transparency in any meaningful way? */
export function hasTransparency(img: Pixels): boolean {
  const { data } = img;
  let clear = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250) clear++;
  // A handful of translucent anti-aliasing pixels doesn't count; ≥1% does.
  return clear >= (data.length / 4) * 0.01;
}

// ── Uniform background detection + removal ───────────────────────────────────

/** Mean color of the border pixels IF they agree with each other; else null. */
export function detectUniformBackground(img: Pixels, tolerance = 30): { r: number; g: number; b: number } | null {
  const { data, width, height } = img;
  const samples: [number, number, number][] = [];
  const push = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    if (data[i + 3] < 200) return; // an already-transparent border isn't a background
    samples.push([data[i], data[i + 1], data[i + 2]]);
  };
  const stepX = Math.max(1, Math.floor(width / 16)), stepY = Math.max(1, Math.floor(height / 16));
  for (let x = 0; x < width; x += stepX) { push(x, 0); push(x, height - 1); }
  for (let y = 0; y < height; y += stepY) { push(0, y); push(width - 1, y); }
  if (samples.length < 8) return null;

  const mean = samples.reduce((a, s) => [a[0] + s[0], a[1] + s[1], a[2] + s[2]], [0, 0, 0]).map((v) => v / samples.length);
  const agree = samples.every((s) => dist2(s[0], s[1], s[2], mean[0], mean[1], mean[2]) <= tolerance * tolerance);
  return agree ? { r: mean[0], g: mean[1], b: mean[2] } : null;
}

/**
 * Remove a uniform background by flood-filling from every border pixel that
 * matches it, zeroing alpha as it goes. Returns a NEW pixel array, or null when
 * it refuses: no uniform background, or the fill would erase >90% of the image
 * (the "logo" IS the background color — deleting it deletes the logo).
 */
export function removeBackground(img: Pixels, tolerance = 38): Pixels | null {
  const bg = detectUniformBackground(img);
  if (!bg) return null;

  const { width, height } = img;
  const src = img.data;
  const out = new Uint8ClampedArray(src);
  const seen = new Uint8Array(width * height);
  const queue: number[] = [];
  const tol2 = tolerance * tolerance;

  const tryPush = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = y * width + x;
    if (seen[p]) return;
    const i = p * 4;
    if (dist2(src[i], src[i + 1], src[i + 2], bg.r, bg.g, bg.b) > tol2) return;
    seen[p] = 1;
    queue.push(p);
  };

  for (let x = 0; x < width; x++) { tryPush(x, 0); tryPush(x, height - 1); }
  for (let y = 0; y < height; y++) { tryPush(0, y); tryPush(width - 1, y); }

  let cleared = 0;
  while (queue.length) {
    const p = queue.pop()!;
    out[p * 4 + 3] = 0;
    cleared++;
    const x = p % width, y = (p / width) | 0;
    tryPush(x + 1, y); tryPush(x - 1, y); tryPush(x, y + 1); tryPush(x, y - 1);
  }

  if (cleared > width * height * 0.9) return null; // would erase the logo itself
  return { data: out, width, height };
}

// ── Palette extraction ────────────────────────────────────────────────────────

export type PaletteEntry = { color: string; share: number; saturation: number };

/**
 * Dominant colors: histogram RGB quantized to 4 bits/channel, scored by
 * count × (0.35 + saturation) so a vivid brand red beats a big grey shadow.
 * Near-white, near-black and transparent pixels don't vote — they are paper
 * and ink, not brand.
 */
export function extractPalette(img: Pixels, max = 4): PaletteEntry[] {
  const { data } = img;
  const bins = new Map<number, { count: number; r: number; g: number; b: number }>();
  let voters = 0;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const { s, l } = rgbToHsl(r, g, b);
    if (l > 0.93 || l < 0.07) continue; // paper / ink
    if (s < 0.08 && (l > 0.85 || l < 0.2)) continue; // grey fringe
    voters++;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bin = bins.get(key);
    if (bin) { bin.count++; bin.r += r; bin.g += g; bin.b += b; }
    else bins.set(key, { count: 1, r, g, b });
  }
  if (voters === 0) return [];

  const scored = [...bins.values()]
    .map((bin) => {
      const r = bin.r / bin.count, g = bin.g / bin.count, b = bin.b / bin.count;
      const { s } = rgbToHsl(r, g, b);
      return { r, g, b, count: bin.count, saturation: s, score: bin.count * (0.35 + s) };
    })
    .sort((a, b) => b.score - a.score);

  // Merge near-duplicates (two bins of the same red) before taking the top N.
  const picked: typeof scored = [];
  for (const c of scored) {
    if (picked.length >= max) break;
    if (picked.some((p) => dist2(p.r, p.g, p.b, c.r, c.g, c.b) < 48 * 48)) continue;
    picked.push(c);
  }
  return picked.map((c) => ({ color: hex(c.r, c.g, c.b), share: c.count / voters, saturation: c.saturation }));
}

// ── Brand derivation ──────────────────────────────────────────────────────────

export type DerivedBrand = {
  accent: string;
  accentSoft: string;
  accent2: string;
  /** CSS gradient preview string (135°, accent → accent2). */
  gradient: string;
};

export function accentSoftFrom(accentHex: string, alpha = 0.12): string {
  const c = parseHex(accentHex);
  if (!c) return `rgba(249,115,22,${alpha})`;
  return `rgba(${c.r},${c.g},${c.b},${alpha})`;
}

export function darken(accentHex: string, byL = 0.15): string {
  const c = parseHex(accentHex);
  if (!c) return accentHex;
  const { h, s, l } = rgbToHsl(c.r, c.g, c.b);
  const d = hslToRgb(h, s, Math.max(0.08, l - byL));
  return hex(d.r, d.g, d.b);
}

/**
 * Palette → brand settings. The top color is the accent; the second becomes the
 * gradient's far stop when its hue is genuinely distinct (Δhue > 30°), otherwise
 * the gradient runs accent → darkened accent (single-color logos still get a
 * dignified gradient, e.g. Buy Simu's red → deep red).
 */
export function deriveBrand(palette: PaletteEntry[]): DerivedBrand | null {
  if (palette.length === 0) return null;
  const accent = palette[0].color;
  const a = parseHex(accent)!;
  const aHsl = rgbToHsl(a.r, a.g, a.b);

  let accent2: string | null = null;
  for (const p of palette.slice(1)) {
    const c = parseHex(p.color)!;
    const cHsl = rgbToHsl(c.r, c.g, c.b);
    const dHue = Math.min(Math.abs(cHsl.h - aHsl.h), 360 - Math.abs(cHsl.h - aHsl.h));
    if (dHue > 30 && p.share > 0.08 && cHsl.s > 0.15) { accent2 = p.color; break; }
  }
  accent2 ??= darken(accent);

  return {
    accent,
    accentSoft: accentSoftFrom(accent),
    accent2,
    gradient: `linear-gradient(135deg, ${accent}, ${accent2})`,
  };
}
