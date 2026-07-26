// ─────────────────────────────────────────────────────────────────────────────
// TRIM A LENDER'S LOGO — the fix for "the logo looks small and the heading looks
// shoved down the card".
//
// THE ACTUAL BUG, measured. Mular's stored logo is a 300×200 PNG whose artwork
// occupies only 290×82 in the middle of it: 26% transparent gutter above, 33%
// below. Every surface in the product sizes that file by its CANVAS, because
// that is the only thing CSS can see — so 59% of every logo slot was rendering
// empty space, and the copy underneath was being pushed down by air.
//
// No amount of CSS fixes that. `object-contain` can only letterbox a file; it
// cannot know that the file is mostly nothing. The gutter has to come out of the
// asset. This script does that, in place:
//
//   1. read the org's current logo (stored URL or a local file),
//   2. find the alpha bounding box and crop to it, with a small even margin so
//      the mark never touches its own edge,
//   3. re-upload and repoint Org.logoUrl.
//
// Every surface then gets a tight mark for free — sign-in, sidebar, email,
// statements, reports — because they all read the same field. Nothing in the app
// needs to know this ran.
//
//   npx tsx scripts/trim-logo.ts <org-slug>            # inspect only
//   npx tsx scripts/trim-logo.ts <org-slug> --apply    # crop, upload, repoint
//   npx tsx scripts/trim-logo.ts <org-slug> --apply --file public/lenders/x/logo.png
//
// Idempotent: a mark already tight against its canvas is reported and skipped,
// so re-running it is a no-op rather than a slow erosion of the artwork.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import fs from "node:fs/promises";
import sharp from "sharp";
import { prisma } from "../src/lib/prisma";
import { runAsPlatform } from "../src/lib/db/context";
import { putBrandLogo } from "../src/lib/storage/provider";

/** Padding kept around the artwork, as a share of the trimmed height. */
const MARGIN = 0.04;
/** Gutter below this is already tight — cropping again would just shave artwork. */
const TIGHT_ENOUGH = 0.03;

type Box = { left: number; top: number; width: number; height: number };

/** Alpha bounding box: the smallest rectangle containing every pixel that isn't clear. */
async function inkBox(buf: Buffer): Promise<{ box: Box; canvas: { w: number; h: number } }> {
  const img = sharp(buf).ensureAlpha();
  const { width = 0, height = 0 } = await img.metadata();
  const { data } = await img.raw().toBuffer({ resolveWithObject: true });

  let minX = width, maxX = -1, minY = height, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // 10/255 rather than 0: exported PNGs carry anti-aliasing dust in the
      // gutter, and a single stray alpha=2 pixel would defeat the whole crop.
      if (data[(y * width + x) * 4 + 3] > 10) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error("The image is fully transparent — nothing to trim.");
  return {
    box: { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    canvas: { w: width, h: height },
  };
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

async function main() {
  const slug = (process.argv[2] || "").trim().toLowerCase();
  const apply = process.argv.includes("--apply");
  const fileIdx = process.argv.indexOf("--file");
  const localFile = fileIdx > -1 ? process.argv[fileIdx + 1] : null;

  if (!slug) {
    console.error("Usage: npx tsx scripts/trim-logo.ts <org-slug> [--apply] [--file <path>]");
    process.exit(1);
  }

  const org = await runAsPlatform(() =>
    prisma.org.findUnique({ where: { slug }, select: { id: true, name: true, logoUrl: true, logoScale: true } }),
  );
  if (!org) { console.error(`No org with slug "${slug}".`); process.exit(1); }

  const source = localFile ?? org.logoUrl;
  if (!source) { console.error(`${org.name} has no logo to trim.`); process.exit(1); }

  const buf = localFile
    ? await fs.readFile(localFile)
    : Buffer.from(await (await fetch(source)).arrayBuffer());

  const { box, canvas } = await inkBox(buf);
  const gutter = {
    top: box.top / canvas.h,
    bottom: (canvas.h - (box.top + box.height)) / canvas.h,
    left: box.left / canvas.w,
    right: (canvas.w - (box.left + box.width)) / canvas.w,
  };
  const wasted = 1 - (box.width * box.height) / (canvas.w * canvas.h);

  console.log(`\n${org.name} — ${localFile ?? "stored logo"}`);
  console.log(`  canvas      ${canvas.w}×${canvas.h}`);
  console.log(`  artwork     ${box.width}×${box.height}  at (${box.left}, ${box.top})`);
  console.log(`  gutter      top ${pct(gutter.top)} · bottom ${pct(gutter.bottom)} · left ${pct(gutter.left)} · right ${pct(gutter.right)}`);
  console.log(`  wasted area ${pct(wasted)}`);

  const worst = Math.max(gutter.top, gutter.bottom, gutter.left, gutter.right);
  if (worst <= TIGHT_ENOUGH) {
    console.log(`\n  Already tight (worst gutter ${pct(worst)}). Nothing to do.`);
    return;
  }

  const pad = Math.round(box.height * MARGIN);
  const out = await sharp(buf)
    .extract(box)
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const meta = await sharp(out).metadata();

  console.log(`\n  trimmed →   ${meta.width}×${meta.height}  (aspect ${(meta.width! / meta.height!).toFixed(2)}:1)`);
  console.log(`  file size   ${(buf.length / 1024).toFixed(0)}kB → ${(out.length / 1024).toFixed(0)}kB`);

  if (!apply) {
    console.log(`\n  Dry run. Re-run with --apply to upload it and repoint ${org.name}.`);
    return;
  }

  const dataUrl = `data:image/png;base64,${out.toString("base64")}`;
  const url = await runAsPlatform(() => putBrandLogo(org.id, dataUrl));

  // logoScale ABOVE 100 was always a workaround for exactly this gutter: the mark
  // looked lost in its slot, so someone turned the dial up to compensate for
  // padding baked into the file. With the padding gone the dial is now a
  // magnifier on a correctly-sized mark, and leaving it would overshoot in the
  // opposite direction — so it comes back to neutral in the same transaction.
  const resetScale = org.logoScale > 100;
  await runAsPlatform(() =>
    prisma.org.update({
      where: { id: org.id },
      data: { logoUrl: url, ...(resetScale ? { logoScale: 100 } : {}) },
    }),
  );

  console.log(`\n  ✅ Uploaded and repointed. Every surface now renders the tight mark.`);
  if (resetScale) console.log(`     logoScale ${org.logoScale}% → 100% (it was compensating for the padding).`);
  console.log(`     ${url}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
