// ─────────────────────────────────────────────────────────────────────────────
// SCORE THE LOGIN PLATES AGAINST WHAT THEY WERE COMMISSIONED TO BE.
//
//   npm run art:check
//
// ── WHY THIS IS A SCRIPT AND NOT A JUDGEMENT CALL ────────────────────────────
// Every plate in public/images/suite is a beautiful photograph. That was never
// the question. The question is whether each one does the three jobs the door
// needs, and two of those are invisible to the eye that just generated it:
//
//   1. IS THE LEFT THIRD DARK ENOUGH? The sign-in card sits there, on a scrim,
//      in white type. A gorgeous image with its subject on the left is an
//      unreadable login page — and you cannot see this by looking at the plate,
//      because you are looking at the plate rather than at the card on top of it.
//
//   2. IS IT ACTUALLY THIS SYSTEM'S COLOUR? The accent is a CODE: the same hue
//      appears in the sidebar, the launcher tile and the header rule, so by the
//      third screen nobody needs to read the title. A door in the wrong hue
//      teaches the wrong code at the exact moment somebody is learning the
//      suite. This is the failure that shipped: login-books measured 35° (gold)
//      against Ledgerly's 175° (green-teal). It looks superb. It is wrong.
//
//   3. IS THERE ANY COLOUR AT ALL? A near-black plate with four bright
//      rectangles technically satisfies both tests above and still looks like an
//      asset that failed to render. login-people measured 1.1% saturated pixels
//      against 17–28% for the good ones.
//
// So the eye signs off on the composition and this signs off on the rest.
// Exit code is non-zero when a plate fails, so it can gate a release.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { ARTWORK } from "../src/lib/suite/artwork";

/** Mean luma of the left third, as a percentage. The card sits here. */
const MAX_LEFT_LUMA = 6.0;
/** Degrees of hue a plate may sit away from its declared accent. */
const MAX_HUE_DELTA = 30;
/** Percentage of pixels that must carry real chroma. Below this it reads dead. */
const MIN_SAT_PCT = 1.5;
/** Anything narrower than this is being upscaled on a normal desktop. */
const MIN_WIDTH = 1500;

type Rgb = { r: number; g: number; b: number };

function hueOf({ r, g, b }: Rgb): number {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  if (d === 0) return 0;
  let h: number;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

function hexToRgb(hex: string): Rgb {
  return {
    r: parseInt(hex.slice(1, 3), 16) / 255,
    g: parseInt(hex.slice(3, 5), 16) / 255,
    b: parseInt(hex.slice(5, 7), 16) / 255,
  };
}

/** Shortest distance around the colour wheel — 350° and 10° are 20° apart, not 340°. */
function hueDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

async function score(file: string, accent: string) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;

  let leftSum = 0;
  let leftN = 0;
  let sat = 0;
  let total = 0;
  // 36 buckets of 10°. A histogram rather than a mean, because the mean hue of a
  // plate that is half teal and half gold is green — a colour present nowhere in
  // the image.
  const hist = new Array<number>(36).fill(0);

  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      const i = (y * W + x) * C;
      const px = { r: data[i] / 255, g: data[i + 1] / 255, b: data[i + 2] / 255 };
      if (x < W / 3) {
        leftSum += 0.2126 * px.r + 0.7152 * px.g + 0.0722 * px.b;
        leftN++;
      }
      total++;
      const mx = Math.max(px.r, px.g, px.b);
      const mn = Math.min(px.r, px.g, px.b);
      // Both tests matter: a dark pixel can have a high saturation ratio and
      // contribute no visible colour, and a bright grey one has no hue to bucket.
      if (mx - mn > 0.1 && mx > 0.12) {
        sat++;
        hist[Math.floor(hueOf(px) / 10)]++;
      }
    }
  }

  const dominant = hist.indexOf(Math.max(...hist)) * 10 + 5;
  return {
    width: W,
    height: H,
    leftLuma: (leftSum / leftN) * 100,
    satPct: (sat / total) * 100,
    dominantHue: dominant,
    wantHue: hueOf(hexToRgb(accent)),
    delta: hueDelta(dominant, hueOf(hexToRgb(accent))),
  };
}

async function main() {
  let failures = 0;
  let missing = 0;

  console.log(
    `\n${"system".padEnd(12)}${"px".padEnd(12)}${"left".padStart(6)}${"chroma".padStart(9)}` +
      `${"hue".padStart(6)}${"want".padStart(6)}${"Δ".padStart(6)}  verdict`,
  );
  console.log("─".repeat(96));

  for (const art of ARTWORK) {
    const file = join(process.cwd(), "public", art.file.replace(/^\//, ""));
    if (!existsSync(file)) {
      // Not a failure. The door falls back to a gradient in the same accent, by
      // design, so a partly-generated set never looks like a partly-finished
      // product — see lib/suite/artwork.ts.
      missing++;
      console.log(`${art.id.padEnd(12)}${"—".padEnd(12)}${"".padStart(33)}  not generated — gradient fallback`);
      continue;
    }

    const s = await score(file, art.accent);
    const problems: string[] = [];
    if (s.leftLuma > MAX_LEFT_LUMA) problems.push(`left third too bright (${s.leftLuma.toFixed(1)}%) — the card sits here`);
    if (s.delta > MAX_HUE_DELTA) problems.push(`hue is ${s.dominantHue}°, accent is ${s.wantHue.toFixed(0)}° — off by ${s.delta.toFixed(0)}°`);
    if (s.satPct < MIN_SAT_PCT) problems.push(`almost no chroma (${s.satPct.toFixed(1)}%) — reads as a failed asset`);
    if (s.width < MIN_WIDTH) problems.push(`${s.width}px wide — upscaled on a normal desktop`);
    if (problems.length) failures++;

    console.log(
      art.id.padEnd(12) +
        `${s.width}x${s.height}`.padEnd(12) +
        `${s.leftLuma.toFixed(1)}%`.padStart(6) +
        `${s.satPct.toFixed(1)}%`.padStart(9) +
        `${s.dominantHue}°`.padStart(6) +
        `${s.wantHue.toFixed(0)}°`.padStart(6) +
        `${s.delta.toFixed(0)}°`.padStart(6) +
        "  " +
        (problems.length ? `FAIL — ${problems.join("; ")}` : "ok"),
    );
  }

  console.log("─".repeat(96));
  console.log(
    `${ARTWORK.length - missing - failures} ok · ${failures} failing · ${missing} not generated\n` +
      `Regenerate with the prompt in src/lib/suite/artwork.ts, drop the PNG in public/images/suite/,\n` +
      `then: npm run art:optimize -- --write && npm run art:check\n`,
  );
  process.exit(failures > 0 ? 1 : 0);
}

void main();
