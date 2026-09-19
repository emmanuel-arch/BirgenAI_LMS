// ─────────────────────────────────────────────────────────────────────────────
// THE STAFF DOORS' PHOTOGRAPHY — build the web derivatives.
//
//   npx tsx scripts/build-door-art.ts          # report
//   npx tsx scripts/build-door-art.ts --write  # write public/images/doors/*
//
// ── WHY THE SOURCES CANNOT BE SERVED AS THEY ARE ─────────────────────────────
// Both are PNG, and both are SMALLER THAN THE SCREENS THEY COVER:
//
//   counter.png      1983 × 793   (2.50:1)   1.9 MB
//   connectdesk.png  1315 × 793   (1.66:1)   1.5 MB
//
// A 1920 × 1080 window covering a 793-tall image scales it up by 1.36–1.44×, and
// the browser does that with a cheap bilinear filter chosen for speed on every
// image on the page. That upscale is exactly what "the loan officer is not
// sharp" looks like: soft edges on her face and mush on the LOAN OFFICER
// nameplate, on the one screen every member of staff sees every morning.
//
// So the resample happens HERE instead, once, with a filter picked for quality
// rather than for speed, and with an unsharp mask applied AFTER the enlargement
// — which is the order that matters. Sharpening before scaling throws away the
// halos it just created; sharpening after is what restores the acutance the
// interpolation cost. The browser then draws a picture that is already bigger
// than the window and only ever scales it DOWN, which every renderer does well.
//
// Serving ~2 MB of PNG on a sign-in page is its own problem — that is a second
// of blank screen on a Nairobi 4G connection before anybody can type. WebP at
// q82 on photographic content lands around a tenth of it with no visible
// difference under a scrim.
//
// ── THE SOURCES LIVE IN TWO DIFFERENT REPOSITORIES ───────────────────────────
// counter.png was delivered into the Interchange console's media folder. It is
// read across the repo boundary rather than copied by hand, so a re-export of
// the artwork is picked up by re-running this script instead of by remembering
// that a second copy exists. The build OUTPUT is committed; the sources are not
// this app's to own.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import sharp from "sharp";

const WRITE = process.argv.includes("--write");
const OUT_DIR = join(process.cwd(), "public", "images", "doors");

type Job = {
  /** Which lender this photograph belongs to — the org slug. */
  org: string;
  /** SuiteApp id — matches lib/suite/doors.ts. */
  id: string;
  /** Absolute or repo-relative source. */
  from: string;
  /** Path under public/images/doors, as "<org>/<system>.webp". */
  to: string;
  /** Long edge of the derivative. Enough to cover a 2560-wide window. */
  width: number;
};

const JOBS: Job[] = [
  {
    org: "micromart",
    id: "lms",
    // Delivered into the Interchange console's media folder on 18 Sep 2026.
    from: resolve(process.cwd(), "..", "interchange", "apps", "interchange-console", "public", "media", "counter.png"),
    to: "micromart/lms.webp",
    width: 2800,
  },
  {
    org: "micromart",
    id: "callcenter",
    from: join(process.cwd(), "public", "images", "connectdesk.png"),
    to: "micromart/callcenter.webp",
    width: 2400,
  },
];

const kb = (n: number) => `${Math.round(n / 1024)} KB`;

async function main() {
  console.log(`\n\x1b[1mStaff door photography\x1b[0m — ${WRITE ? "\x1b[33mwriting\x1b[0m" : "\x1b[2mreport only\x1b[0m"}\n`);
  if (WRITE) mkdirSync(OUT_DIR, { recursive: true });

  for (const job of JOBS) {
    if (!existsSync(job.from)) {
      console.log(`  \x1b[31m✗ ${job.id}\x1b[0m  source missing: ${job.from}`);
      continue;
    }
    const src = sharp(job.from);
    const meta = await src.metadata();
    const inSize = statSync(job.from).size;
    const scale = job.width / (meta.width ?? job.width);
    const height = Math.round((meta.height ?? 0) * scale);

    console.log(`  \x1b[1m${job.id}\x1b[0m`);
    console.log(`    in   ${meta.width}×${meta.height}  ${kb(inSize)}  ${meta.format}`);
    console.log(`    out  ${job.width}×${height}  (${scale.toFixed(2)}×)  → images/doors/${job.to}`);

    if (!WRITE) continue;

    const out = join(OUT_DIR, job.to);
    mkdirSync(dirname(out), { recursive: true });
    await sharp(job.from)
      // lanczos3: the sharpest of the practical resampling kernels, and the one
      // whose ringing an unsharp mask afterwards is designed to live with.
      //
      // WIDTH ONLY, AND NO `fit`. `fit: "fill"` with a width and no height does
      // not mean "fill the width" — it means "do not preserve the aspect ratio",
      // so it stretched 1983×793 to 2800×793 and served a loan officer 1.4×
      // wider than she is. Width alone lets sharp derive the height, which is
      // the one behaviour that cannot distort anybody.
      .resize({ width: job.width, kernel: sharp.kernel.lanczos3 })
      // Unsharp mask AFTER the enlargement — sigma just over a pixel so it acts
      // on edges (a face, a nameplate, the lettering on a wall) and not on the
      // grain and skin texture a larger radius would crawl all over.
      .sharpen({ sigma: 1.1, m1: 0.6, m2: 2.4 })
      .webp({ quality: 82, effort: 6 })
      .toFile(out);

    const outSize = statSync(out).size;
    console.log(`    \x1b[32mwritten\x1b[0m  ${kb(outSize)}  (${Math.round((1 - outSize / inSize) * 100)}% smaller)\n`);
  }

  if (!WRITE) console.log(`\n  \x1b[2mNothing written. Re-run with --write.\x1b[0m\n`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n\x1b[31m" + (e instanceof Error ? e.message : String(e)) + "\x1b[0m\n");
    process.exit(1);
  });
