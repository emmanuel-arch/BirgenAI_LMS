// ─────────────────────────────────────────────────────────────────────────────
// MICRO EAZY — the home-screen icon set, cut from the supplied logo.
//
//   npx tsx scripts/make-pwa-icons.ts
//   npx tsx scripts/make-pwa-icons.ts --ground=navy     # dark tile instead of white
//   npx tsx scripts/make-pwa-icons.ts --dry             # measure, write nothing
//
// WHY A SCRIPT AND NOT A HAND-EXPORT. The icon has to be regenerated every time
// the mark is revised, at four sizes, two of them with different safe areas. Doing
// that by hand is how a maskable icon ends up with its arrow cropped off on a
// Samsung and nobody notices until it is on a board member's phone.
//
// THE CROP. The supplied asset is a WORDMARK — monogram on the left, "Micro Eazy"
// to its right, and the tagline on a line of its own underneath. Squashing all of
// that into a 192px square renders the words as three grey smudges. A home-screen
// icon is a 48dp glyph, so it gets the MONOGRAM ALONE: the M, its ascending arrow,
// and the KES coin.
//
// The monogram is not located by a hardcoded rectangle — a re-export at a
// different canvas size would silently shift it. It is found, in two passes, and
// THE ORDER MATTERS:
//
//   1. ROWS first. The artwork splits into horizontal bands separated by empty
//      rows: the lockup (272..705) and the tagline (725..766). Take the top band.
//   2. COLUMNS second, and only within that band. Now the empty-column run
//      between monogram and wordmark appears — 206..687 | gutter | 694..1318.
//
// Scanning columns across the WHOLE canvas finds no gutter at all, because the
// tagline runs underneath both halves and bridges every column. That failure is
// silent: you get a "monogram" that is the entire lockup, scaled to a smudge.
// Hence rows first, always.
//
// THE TWO GROUNDS, and why the icon is not simply the transparent PNG:
//
//   · iOS ignores alpha in an apple-touch-icon and composites what is left onto
//     BLACK. A navy monogram on black is a dark smudge, so the tile must carry its
//     own opaque ground.
//   · Android maskable icons are clipped to whatever shape the launcher likes —
//     circle, squircle, teardrop. Only the central 80% is guaranteed to survive,
//     so the maskable variant is drawn at a smaller mark-to-tile ratio than the
//     plain one. Same mark, different padding; that is the whole difference.
//
// SIZES, and who asks for each:
//   192  Android home screen + the manifest's minimum for installability
//   512  splash screen, app switcher, the Play/Hub listing
//   512  maskable — Android adaptive icon, 80% safe zone
//   180  apple-touch-icon — iOS "Add to Home Screen"
// ─────────────────────────────────────────────────────────────────────────────
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import path from "node:path";

const SRC = "public/brand/micro-eazy/logo-transparent.png";
const OUT_DIR = "public/brand/micro-eazy";

/** Alpha at or above which a pixel counts as artwork — see prep-brand-asset.ts. */
const ALPHA_FLOOR = 12;

/**
 * Share of the tile the mark occupies, per purpose.
 *
 * `any` is generous because nothing clips it. `maskable` must survive a circular
 * mask: the guaranteed-visible region is the central 80% of the tile, and 0.60
 * leaves the mark comfortably inside it rather than exactly on the boundary.
 */
const FILL = { any: 0.78, maskable: 0.6 } as const;

const GROUNDS = {
  white: { r: 255, g: 255, b: 255, alpha: 1 },
  // The wordmark's own navy. A white mark is NOT available, so on a dark ground
  // the navy half of the monogram would disappear — navy is offered for the
  // comparison, not because it is safe with this asset.
  navy: { r: 0x10, g: 0x23, b: 0x63, alpha: 1 },
} as const;

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
const has = (k: string) => process.argv.includes(`--${k}`);

type Run = { start: number; end: number };

/** Runs of consecutive indices whose occupancy is non-zero. */
function runsOf(filled: number[]): Run[] {
  const runs: Run[] = [];
  let s = -1;
  for (let i = 0; i <= filled.length; i++) {
    const on = i < filled.length && filled[i] > 0;
    if (on && s < 0) s = i;
    if (!on && s >= 0) { runs.push({ start: s, end: i - 1 }); s = -1; }
  }
  return runs;
}

/**
 * Locate the monogram: top row-band, then its leftmost column-run.
 * See the header for why the row pass must come first.
 */
async function locateMonogram(input: string, floor: number) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  const alphaAt = (x: number, y: number) => data[(y * W + x) * C + C - 1];

  const rowFilled = new Array<number>(H).fill(0);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (alphaAt(x, y) >= floor) rowFilled[y]++;
  const bands = runsOf(rowFilled);
  if (bands.length === 0) throw new Error(`Nothing in ${input} reaches alpha ${floor}.`);
  const band = bands[0];

  const colFilled = new Array<number>(W).fill(0);
  for (let y = band.start; y <= band.end; y++) for (let x = 0; x < W; x++) if (alphaAt(x, y) >= floor) colFilled[x]++;
  const groups = runsOf(colFilled);
  if (groups.length < 2) {
    throw new Error(
      `Expected a monogram and a wordmark in the top band; found ${groups.length} group(s). ` +
      `Has the lockup changed?`,
    );
  }
  const mono = groups[0];

  // The monogram's OWN vertical extent — it is shorter than the band, which is
  // set by the taller wordmark. Cropping to the band would pad the icon with air.
  let y0 = H, y1 = -1;
  for (let y = band.start; y <= band.end; y++) {
    for (let x = mono.start; x <= mono.end; x++) {
      if (alphaAt(x, y) >= floor) { if (y < y0) y0 = y; if (y > y1) y1 = y; break; }
    }
  }

  return {
    W, H, bands, groups,
    crop: { left: mono.start, top: y0, width: mono.end - mono.start + 1, height: y1 - y0 + 1 },
  };
}

async function main() {
  const groundName = (arg("ground") ?? "white") as keyof typeof GROUNDS;
  const ground = GROUNDS[groundName];
  if (!ground) throw new Error(`--ground must be one of: ${Object.keys(GROUNDS).join(", ")}`);
  const dry = has("dry");

  const m = await locateMonogram(SRC, ALPHA_FLOOR);
  const { crop } = m;
  console.log(`\nsource        ${m.W}x${m.H}`);
  console.log(`row bands     ${m.bands.map((b) => `${b.start}..${b.end}`).join("  ")}   (first = the lockup)`);
  console.log(`col groups    ${m.groups.map((g) => `${g.start}..${g.end}`).join("  ")}   (first = the monogram)`);
  console.log(`monogram      ${crop.width}x${crop.height} at (${crop.left},${crop.top})  aspect ${(crop.width / crop.height).toFixed(2)}`);
  console.log(`ground        ${groundName}`);

  if (dry) {
    console.log("\n--dry: nothing written.\n");
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });

  // Crop the monogram ONCE at full resolution; every size is a resize of this.
  const mono = await sharp(SRC).extract(crop).png().toBuffer();
  const monoW = crop.width;
  const monoH = crop.height;

  const targets: { size: number; purpose: keyof typeof FILL; name: string }[] = [
    { size: 192, purpose: "any", name: "icon-192.png" },
    { size: 512, purpose: "any", name: "icon-512.png" },
    { size: 512, purpose: "maskable", name: "icon-maskable-512.png" },
    { size: 180, purpose: "any", name: "apple-touch-icon.png" },
  ];

  for (const t of targets) {
    // Fit the mark inside its share of the tile, keeping aspect, then centre it.
    const inner = Math.round(t.size * FILL[t.purpose]);
    const k = Math.min(inner / monoW, inner / monoH);
    const w = Math.max(1, Math.round(monoW * k));
    const h = Math.max(1, Math.round(monoH * k));

    const scaled = await sharp(mono).resize(w, h, { fit: "inside" }).png().toBuffer();

    await sharp({
      create: { width: t.size, height: t.size, channels: 4, background: ground },
    })
      .composite([{ input: scaled, left: Math.round((t.size - w) / 2), top: Math.round((t.size - h) / 2) }])
      .png({ palette: true, colours: 256, compressionLevel: 9, effort: 10 })
      .toFile(path.join(OUT_DIR, t.name));

    console.log(`  wrote ${t.name.padEnd(24)} ${t.size}x${t.size}  mark ${w}x${h} (${Math.round(FILL[t.purpose] * 100)}% fill)`);
  }
  console.log("");
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(`\n${e instanceof Error ? e.message : e}\n`);
  process.exit(1);
});
