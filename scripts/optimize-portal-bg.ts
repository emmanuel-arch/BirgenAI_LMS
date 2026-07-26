// Turn the raw portal hero art into web assets.
//
// The generated plate arrives as a ~1.8MB PNG. PNG is the wrong container for a
// photograph — it is lossless, so it pays full price for sensor grain nobody can
// see — and this asset loads on the FIRST paint of a funnel whose users are on
// Kenyan mobile data. Two encodes, both at a size that still looks sharp on a 3x
// phone screen: WebP for browsers that take it, JPEG as the universal fallback.
import "dotenv/config";
import fs from "node:fs/promises";
import sharp from "sharp";

const SRC = "public/images/portal-bg.png";
const WIDTH = 1080; // 1080 wide covers every phone at 3x and every desktop after cover-crop

async function main() {
  const src = await fs.readFile(SRC);
  const meta = await sharp(src).metadata();
  console.log(`source  ${meta.width}×${meta.height}  ${(src.length / 1024 / 1024).toFixed(2)}MB`);

  const base = sharp(src).resize({ width: WIDTH, withoutEnlargement: true });

  const jpg = await base.clone().jpeg({ quality: 78, mozjpeg: true, chromaSubsampling: "4:4:4" }).toBuffer();
  await fs.writeFile("public/images/portal-bg.jpg", jpg);

  const webp = await base.clone().webp({ quality: 76, effort: 6 }).toBuffer();
  await fs.writeFile("public/images/portal-bg.webp", webp);

  const j = await sharp(jpg).metadata();
  console.log(`jpeg    ${j.width}×${j.height}  ${(jpg.length / 1024).toFixed(0)}kB  (${(100 - (jpg.length / src.length) * 100).toFixed(0)}% smaller)`);
  console.log(`webp    ${j.width}×${j.height}  ${(webp.length / 1024).toFixed(0)}kB  (${(100 - (webp.length / src.length) * 100).toFixed(0)}% smaller)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
