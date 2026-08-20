// ─────────────────────────────────────────────────────────────────────────────
// TURN THE SIX GENERATED PLATES INTO WEB ASSETS.
//
//   npx tsx scripts/optimize-suite-art.ts            # report only, writes nothing
//   npx tsx scripts/optimize-suite-art.ts --write    # encode
//
// The generator hands back ~1.5MB PNGs. PNG is the wrong container for a
// photograph — it is lossless, so it pays full price for film grain nobody can
// see — and the same argument already recorded in optimize-portal-bg.ts applies
// here with more force: THESE SIX LOAD BEFORE ANYTHING ELSE ON A LOGIN PAGE.
// Nine megabytes of door art on conference wi-fi, in front of a room, is a
// visible stagger every time somebody opens a system.
//
// WebP at quality 78 takes the set from ~9.4MB to well under a megabyte with no
// difference anyone can see through the scrim the card sits on.
//
// ── WHY THE SOURCE FOR PEOPLEHUB IS A .jpg ───────────────────────────────────
// Two files arrived for that door. `login-people-2.png` is the better plate but
// carries a "Made with AI" badge burned into the top-right corner; the .jpg is
// clean. On a login page a supervisor is looking at, clean wins — the badge sits
// exactly where the eye lands after the sign-in card. Swap SOURCES below if the
// plate is ever regenerated without it.
// ─────────────────────────────────────────────────────────────────────────────
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import sharp from "sharp";

const DIR = "public/images/suite";
const WRITE = process.argv.includes("--write");

/** Wide enough for a 2560-logical projector after the cover-crop, without upscaling past the source. */
const WIDTH = 2048;

/** target basename (what artwork.ts reads) → source file on disk */
const SOURCES: Record<string, string> = {
  "login-lending": "login-lending.png",
  "login-portal": "login-portal.png",
  "login-analytics": "login-analytics.png",
  "login-desk": "login-desk.png",
  "login-people": "login-people.jpg", // the clean plate — see the note above
  "login-books": "login-books.png",
};

async function main() {
  console.log(`\n\x1b[1mSUITE LOGIN ARTWORK\x1b[0m  ${WRITE ? "encoding" : "\x1b[2mreport only — pass --write to encode\x1b[0m"}\n`);

  let before = 0;
  let after = 0;

  for (const [target, source] of Object.entries(SOURCES)) {
    const src = `${DIR}/${source}`;
    if (!existsSync(src)) {
      console.log(`  \x1b[31m✗\x1b[0m ${target.padEnd(18)} source missing: ${source}`);
      continue;
    }

    const buf = await fs.readFile(src);
    const meta = await sharp(buf).metadata();
    before += buf.length;

    const webp = await sharp(buf)
      .resize({ width: WIDTH, withoutEnlargement: true })
      .webp({ quality: 78, effort: 6 })
      .toBuffer();
    after += webp.length;

    const out = `${DIR}/${target}.webp`;
    if (WRITE) await fs.writeFile(out, webp);

    const saved = 100 - (webp.length / buf.length) * 100;
    console.log(
      `  \x1b[32m✓\x1b[0m ${target.padEnd(18)} ${String(meta.width).padStart(4)}×${String(meta.height).padEnd(5)} ` +
        `${(buf.length / 1024 / 1024).toFixed(2)}MB → ${(webp.length / 1024).toFixed(0)}kB  ` +
        `\x1b[2m${saved.toFixed(0)}% smaller${source !== `${target}.png` ? `  (from ${source})` : ""}\x1b[0m`,
    );
  }

  console.log(
    `\n  set total: ${(before / 1024 / 1024).toFixed(2)}MB → ${(after / 1024).toFixed(0)}kB ` +
      `\x1b[2m(${(100 - (after / before) * 100).toFixed(0)}% smaller)\x1b[0m`,
  );

  if (!WRITE) {
    console.log(`\n\x1b[2m  Nothing written. Re-run with --write.\x1b[0m\n`);
    return;
  }

  console.log(
    `\n  Written. artwork.ts points at the .webp files; the original PNGs can stay\n` +
      `  \x1b[2mon disk as the masters — they are the thing to re-encode from if a plate is\n` +
      `  regenerated, and nothing serves them.\x1b[0m\n`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
