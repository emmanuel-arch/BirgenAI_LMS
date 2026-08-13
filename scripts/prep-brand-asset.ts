// PREPARE A STATIC BRAND ASSET for one of the product's logo slots.
//
//   npx tsx scripts/prep-brand-asset.ts public/brand/micro-eazy/logo-transparent.png
//   npx tsx scripts/prep-brand-asset.ts <in.png> --slot=auth --out=public/brand/x/logo-auth.png
//   npx tsx scripts/prep-brand-asset.ts <in.png> --alpha=32   (ghosted mark)
//
// The sibling of scripts/trim-logo.ts. That one fixes a LENDER'S uploaded logo in
// storage and repoints Org.logoUrl; this one fixes a file we ship in `public/`,
// where there is no org row to repoint — the un-branded sign-in mark, a Hub tile,
// an app icon.
//
// IT SOLVES THE SAME TWO PROBLEMS, both documented at length in src/lib/lms/logo.ts:
//
//   1. TRANSPARENT GUTTER. Every surface sizes a logo by its CANVAS, because that
//      is all CSS can see. A mark floating in the middle of a big transparent
//      rectangle therefore renders small with its heading shoved down by air. The
//      gutter has to come out of the file, so this crops to the alpha bounding box
//      and keeps a 4% margin so the mark never touches its own edge.
//
//   2. WEIGHT. A design export is sized for print, not for a 320x140 slot on the
//      first screen a user ever sees. Downscaling to 2x the slot keeps it crisp on
//      retina and stops the sign-in page shipping half a megabyte of PNG.
//
// Never overwrites the source: the export you were given stays exactly as it is.
import sharp from "sharp";
import { statSync } from "node:fs";
import { LOGO_SLOTS, type LogoSlot } from "../src/lib/lms/logo";

/** Padding kept around the artwork, as a share of trimmed height — matches trim-logo.ts. */
const MARGIN = 0.04;
/** Retina. A 320px slot wants a 640px asset; more is waste an image CDN cannot undo. */
const DPR = 2;
/**
 * Alpha below which a pixel is not artwork.
 *
 * NOT 1, and this is the whole reason this script grew its own crop. Design exports
 * routinely carry a faint alpha wash — a soft halo, a flattened drop shadow, a
 * near-invisible background layer — reaching every corner of the canvas. sharp's
 * `trim()` compares against the corner pixel, so one stray pixel at alpha 3 in the
 * far corner makes the whole canvas "not blank" and it crops NOTHING while
 * cheerfully reporting success.
 *
 * That is exactly what happened to the Micro Eazy export: 0.6% of its pixels sat at
 * alpha 1–31, `trim({threshold:1})` reported a 0% gutter, and the mark rendered at
 * 141×63 inside a 205×140 slot — 69% of the sign-in card's logo was air. At alpha 8
 * the real artwork is 1114×495, 35% of the canvas.
 *
 * So the bounding box is computed here, from the alpha channel, at a threshold that
 * means something. 12 keeps genuine anti-aliased edges (which run 40–255) and drops
 * a wash. Override with --alpha= if a mark is deliberately ghosted.
 */
const ALPHA_FLOOR = 12;

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];

/**
 * The tightest rectangle containing every pixel at or above `floor` alpha.
 * Returns null for a fully transparent image rather than a nonsense box.
 */
async function alphaBounds(
  input: string,
  floor: number,
): Promise<{ left: number; top: number; width: number; height: number } | null> {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * C + C - 1] >= floor) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  return { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

async function main() {
  const input = process.argv[2];
  if (!input || input.startsWith("--")) throw new Error("Pass the source image path first.");

  const slot = (arg("slot") ?? "auth") as LogoSlot;
  const spec = LOGO_SLOTS[slot];
  if (!spec) throw new Error(`Unknown slot "${slot}". One of: ${Object.keys(LOGO_SLOTS).join(", ")}`);
  const output = arg("out") ?? input.replace(/\.png$/i, `-${slot}.png`);
  if (output === input) throw new Error("Refusing to overwrite the source asset.");

  const alphaFloor = Number(arg("alpha") ?? ALPHA_FLOOR);
  const meta = await sharp(input).metadata();
  const canvasPx = (meta.width ?? 1) * (meta.height ?? 1);
  console.log(`\nsource        ${meta.width}x${meta.height} ${meta.format} · alpha=${meta.hasAlpha} · ${(statSync(input).size / 1024).toFixed(1)} KB`);
  console.log(`slot "${slot}"    caps at ${spec.maxWidth}x${spec.maxHeight}px`);

  // ALWAYS PRINT THE LADDER. A file whose alpha>=1 box is the whole canvas while its
  // alpha>=12 box is a third of it has a faint wash, and that one line of output is
  // the difference between spotting it and shipping a logo that is 69% air.
  console.log(`\nalpha ladder  (where the artwork is, by how opaque a pixel must be)`);
  for (const th of [1, 8, 16, 32, 64]) {
    const b = await alphaBounds(input, th);
    console.log(
      b
        ? `  >=${String(th).padStart(3)}  ${String(b.width).padStart(5)}x${String(b.height).padEnd(5)} at (${b.left},${b.top})  ${((b.width * b.height / canvasPx) * 100).toFixed(1)}% of canvas  aspect ${(b.width / b.height).toFixed(2)}`
        : `  >=${String(th).padStart(3)}  nothing at or above this alpha`,
    );
  }

  const box = await alphaBounds(input, alphaFloor);
  if (!box) throw new Error(`Nothing in ${input} reaches alpha ${alphaFloor}. Lower it with --alpha=.`);
  const artW = box.width;
  const artH = box.height;
  const gutterPct = Math.max(0, 100 - Math.round(((artW * artH) / canvasPx) * 100));
  console.log(`\nartwork bbox  ${artW}x${artH} at alpha>=${alphaFloor} · transparent gutter is ${gutterPct}% of the canvas`);

  // What the slot would render, before vs after — the number that justifies this.
  const fit = (w: number, h: number): [number, number] => {
    const k = Math.min(spec.maxWidth / w, spec.maxHeight / h, 1);
    return [Math.round(w * k), Math.round(h * k)];
  };
  const [rawW, rawH] = fit(meta.width ?? 1, meta.height ?? 1);
  const [trimW, trimH] = fit(artW, artH);
  const visW = Math.round(rawW * (artW / (meta.width ?? 1)));
  const visH = Math.round(rawH * (artH / (meta.height ?? 1)));
  console.log(`renders at    ${rawW}x${rawH}px box as given, of which only ${visW}x${visH}px is visible mark`);
  console.log(`              ${trimW}x${trimH}px cropped — ${Math.round(((trimW * trimH) / Math.max(visW * visH, 1)) * 10) / 10}x the visible area`);

  // TWO PASSES, deliberately. sharp runs its pipeline in a FIXED order — extract,
  // resize, then extend — regardless of the order the calls are written in. Doing
  // this in one chain therefore downscales the artwork first and only then adds the
  // margin, so a 4%-of-artwork border becomes a 15%-of-final-image frame: an early
  // attempt here produced 502x362 with a fat transparent edge instead of 420x280.
  // Pass one crops and pads at full resolution; pass two scales the result.
  const margin = Math.round(artH * MARGIN);
  const padded = await sharp(input)
    .extract(box)
    .extend({ top: margin, bottom: margin, left: margin, right: margin, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  // PALETTE, not truecolor. A logo is a handful of flat brand colours plus their
  // anti-aliased edges, so 256 indexed colours cost almost nothing and save most of
  // the file: 152.8 KB → 40.8 KB on the Micro Eazy mark.
  //
  // Measured before trusting it, and the measurement has a trap worth recording. A
  // naive per-channel diff against the truecolor original reports a mean error of
  // 47/255, which looks catastrophic — but nearly all of it sits in the RGB values
  // UNDERNEATH fully transparent pixels, where the two files store different
  // arbitrary colours behind alpha 0. Nobody can see those. Comparing only pixels
  // that render, weighted by their alpha, the real error is a mean of 1.07/255 and a
  // worst case of 34 on a single edge pixel. At 128 colours it degrades to a mean of
  // 3.42 with visible banding on the edges, so 256 is the floor, not a default.
  await sharp(padded)
    .resize({ width: spec.maxWidth * DPR, height: spec.maxHeight * DPR, fit: "inside", withoutEnlargement: true })
    .png({ palette: true, colours: 256, compressionLevel: 9, effort: 10 })
    .toFile(output);

  const out = await sharp(output).metadata();
  const before = statSync(input).size;
  const after = statSync(output).size;
  console.log(`\nwrote         ${output}`);
  console.log(`              ${out.width}x${out.height}px · ${(after / 1024).toFixed(1)} KB · ${Math.round((1 - after / before) * 100)}% smaller than the source\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(`\n${e instanceof Error ? e.message : e}\n`); process.exit(1); });
