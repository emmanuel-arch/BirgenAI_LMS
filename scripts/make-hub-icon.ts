// Build a square app-store tile from a lender's wordmark.
//
// App tiles are square; lender marks almost never are (Mular's is ~3.4:1). Both
// obvious shortcuts destroy the brand: `fit: cover` crops the wordmark to
// "Mula", and `fit: fill` squashes it. So the mark is CONTAINED inside a padded
// square on white — white because these tiles declare backgroundColor #FFFFFF,
// and the marks are dark artwork designed against letterhead.
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const SIZE = 512;
const PAD = 56;

async function main() {
  const [src, out] = process.argv.slice(2);
  if (!src || !out) {
    console.error("Usage: npx tsx scripts/make-hub-icon.ts <logo.png> <out.png>");
    process.exit(1);
  }
  const buf = await fs.readFile(src);
  const meta = await sharp(buf).metadata();

  const inner = await sharp(buf)
    .resize({ width: SIZE - PAD * 2, height: SIZE - PAD * 2, fit: "inside", withoutEnlargement: false })
    .toBuffer();

  await fs.mkdir(path.dirname(out), { recursive: true });
  await sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
    .composite([{ input: inner, gravity: "center" }])
    .png({ compressionLevel: 9 })
    .toFile(out);

  const o = await sharp(out).metadata();
  console.log(`${meta.width}×${meta.height}  →  ${o.width}×${o.height}   ${out}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
