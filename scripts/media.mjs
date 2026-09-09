// ─────────────────────────────────────────────────────────────────────────────
// THE MEDIA PIPELINE — every wallpaper an org admin drops into public/themes
// becomes a web asset here, and nowhere else.
//
//   node scripts/media.mjs                     report only, writes nothing
//   node scripts/media.mjs --write              encode
//   node scripts/media.mjs --write --force      re-encode even if up to date
//   node scripts/media.mjs --check              exit 1 if anything is over budget
//   node scripts/media.mjs --write --archive    move the originals out of public/
//
// (The borrower app has the same script, adapted to its own folders, at
// micro-eazy-app/scripts/media.mjs. Two repositories, one idea; if you change
// the strategy here, that is the other place it lives.)
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
// public/themes/README.md invites an administrator to drop a background in and
// add a row to skins.ts. That invitation is the whole feature, and it is also
// how public/themes came to hold 37 MB of JPEG: fifteen wallpapers averaging
// 2.5 MB each, every one of which is painted full-bleed behind a console that a
// branch machine in Mtwapa opens before anybody can do any work.
//
// The README already stated the rule — under 400 KB, prefer WebP. A rule in a
// README is a request. This script is the rule.
//
// ── WHAT IT GUARANTEES ───────────────────────────────────────────────────────
//   · ONE FORMAT (.webp), whatever arrived.
//   · ONE SIZE PER JOB — 2560 for the floor, 480 for the picker swatch. Never
//     enlarged: a 1600px source stays 1600px rather than becoming a soft lie.
//   · A BUDGET, SOLVED FOR. The recipe names the byte budget and the encoder
//     finds the highest quality that fits inside it — see `ladder`.
//   · AN LQIP FOR EVERY FILE, inlined into a generated module, so the floor is
//     never a white rectangle while its photograph is in flight.
//
// ── WHY THE ORIGINALS ARE ARCHIVED AND NOT DELETED ───────────────────────────
// --archive MOVES the source to media-src/ (outside public/, never served)
// rather than removing it. Nothing is deleted by this script, ever.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "..");
const WRITE = process.argv.includes("--write");
const FORCE = process.argv.includes("--force");
const CHECK = process.argv.includes("--check");
const ARCHIVE = process.argv.includes("--archive");

const LQIP_OUT = "src/lib/theme/media.generated.ts";
const ARCHIVE_DIR = "media-src";

const SOURCE_EXT = [".jpg", ".jpeg", ".png", ".webp", ".avif", ".jfif"];

// ─────────────────────────────────────────────────────────────────────────────
// THE RECIPES. One per folder, because the right size for a picture is a
// property of the JOB it does, not of the picture.
// ─────────────────────────────────────────────────────────────────────────────
const RECIPES = [
  {
    dir: "public/themes",
    label: "Skins (the floor every system stands on)",
    // 2560x1600 covers a 1440 laptop at 2x, which is what staff actually use.
    // It is composited onto the skin's `ground` at the skin's `opacity` — often
    // 0.2 to 0.3 in dark — so quality here is generous rather than tight.
    width: 2560,
    height: 1600,
    quality: 80,
    budget: 300_000,
    // The appearance menu draws every skin at once as a 20px swatch and again
    // as a tile. Fifteen full wallpapers to render fifteen thumbnails is the
    // most expensive mistake available on that menu.
    thumb: { suffix: "-thumb", width: 480, height: 300, quality: 66, budget: 40_000 },
  },
  {
    dir: "public/images/suite",
    label: "Front-door plates (indexed only)",
    // ── READ, NEVER RE-ENCODE ──────────────────────────────────────────────
    // These six were produced by scripts/optimize-suite-art.ts, which does one
    // thing this script cannot: it DETECTS and crops the "Made with AI" badge
    // the generator stamps into the top-right corner of some plates. Re-encoding
    // them here from the surviving PNGs would silently undo that crop on the
    // three that need it.
    //
    // So this recipe only reads them, to give each one a blur placeholder. The
    // encoder for these lives in the other script and stays there.
    indexOnly: true,
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

/** `Kericho Tea Fields.JPG` becomes `kericho-tea-fields`. Filenames are
 *  addresses; a space or a capital in one is a 404 waiting for a case-sensitive
 *  host to find it. */
const slug = (name) =>
  name.toLowerCase().replace(/\.[^.]+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

const c = { ok: "\x1b[32m", warn: "\x1b[33m", bad: "\x1b[31m", dim: "\x1b[2m", off: "\x1b[0m" };

/**
 * Pick ONE source per output name.
 *
 * A folder routinely holds `login-books.png` AND `login-books.webp` — somebody
 * converted it once, then a better original arrived. The bigger PICTURE wins
 * (not the bigger file), because that is the one with detail left to give; a tie
 * goes to the non-WebP, which has not already been through a lossy pass.
 */
async function chooseSources(dir, { indexOnly }) {
  const entries = await fs.readdir(dir).catch(() => []);
  const byName = new Map();

  for (const entry of entries) {
    const ext = path.extname(entry).toLowerCase();
    if (!SOURCE_EXT.includes(ext)) continue;
    if (/-thumb\.webp$/i.test(entry)) continue;
    // An index-only folder is asked what it SHIPS, which is the .webp. Letting
    // the 1.8 MB PNG win here would hand the app a blur placeholder sampled
    // from a file no browser ever requests.
    if (indexOnly && ext !== ".webp") continue;

    const name = slug(entry);
    const file = path.join(dir, entry);
    let meta;
    try {
      meta = await sharp(file).metadata();
    } catch {
      console.log(`  ${c.bad}unreadable${c.off} ${entry}`);
      continue;
    }
    const area = (meta.width ?? 0) * (meta.height ?? 0);
    const prev = byName.get(name);
    const better =
      !prev || area > prev.area || (area === prev.area && prev.ext === ".webp" && ext !== ".webp");
    if (better) byName.set(name, { file, entry, ext, area, width: meta.width, height: meta.height });
  }
  return byName;
}

/** A 20px-wide WebP as a data URI, plus the picture's own dominant colour. Both
 *  are inlined into the generated module — no request, paints on frame one. */
async function placeholder(file) {
  const img = sharp(file);
  const [buf, stats, meta] = await Promise.all([
    img.clone().resize(20, null, { fit: "inside" }).blur(1.1).webp({ quality: 40 }).toBuffer(),
    img.clone().stats(),
    img.clone().metadata(),
  ]);
  const { r, g, b } = stats.dominant;
  return {
    lqip: `data:image/webp;base64,${buf.toString("base64")}`,
    dominant: `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`,
    w: meta.width ?? 0,
    h: meta.height ?? 0,
  };
}

/**
 * The ladder, in the order it is climbed down.
 *
 * QUALITY FIRST, THEN SIZE, and that order is the whole judgement here.
 * Dropping quality is free until it is not: somewhere around q50 the blocking
 * artefacts stop being invisible and start being the thing you look at. Past
 * that point the picture simply has more detail than the budget can carry, and
 * the honest fix is fewer pixels rather than worse ones — a 1792px wallpaper
 * stretched by CSS reads as slightly soft, while a 2560px one at q30 reads as
 * broken. Softness is a texture; blocking is a defect.
 *
 * EVERY RUNG MUST COST STRICTLY LESS THAN THE ONE ABOVE IT, or the loop can stop
 * on a worse answer than one it had already seen.
 */
function ladder({ width, quality }) {
  const w = (f) => Math.round(width * f);
  return [
    { width, quality },
    { width, quality: quality - 8 },
    { width, quality: quality - 16 },
    { width: w(0.85), quality: quality - 14 },
    { width: w(0.7), quality: quality - 18 },
    { width: w(0.55), quality: quality - 20 },
    { width: w(0.45), quality: quality - 22 },
    // ── THE LAST RESORT: TAKE THE DETAIL, NOT THE PIXELS ────────────────────
    // A picture that is high-frequency noise edge to edge — a market bokeh, a
    // plantation shot from above — is the one thing WebP cannot compress. And
    // the detail that is expensive is detail nobody will ever see: a skin is
    // composited onto its ground at as little as 20% opacity. A half-pixel blur
    // deletes exactly the information the compositor was going to destroy
    // anyway. It is LAST: anything that can make budget honestly does so above
    // this line and is never touched.
    { width: w(0.45), quality: quality - 22, blur: 0.5 },
    { width: w(0.45), quality: quality - 24, blur: 1 },
  ];
}

async function encode(src, out, recipe) {
  const { height, quality, budget } = recipe;

  // READ THE SOURCE INTO MEMORY FIRST. sharp streams from a path, which on
  // Windows keeps a handle open on the file — and a same-path encode (a .webp
  // source producing a .webp output) then fails the rename with EPERM.
  // Buffering also means the ladder decodes the original once, not once a rung.
  const input = await fs.readFile(src);
  const tmp = `${out}.tmp`;

  const attempt = async ({ width, quality: q, blur }) => {
    const pipeline = sharp(input)
      .rotate()
      .resize({
        width,
        height,
        fit: height ? "cover" : "inside",
        position: "attention",
        withoutEnlargement: true,
      });
    if (blur) pipeline.blur(blur);
    await pipeline.webp({ quality: q, effort: 6, smartSubsample: true }).toFile(tmp);
    await fs.rename(tmp, out);
    return (await fs.stat(out)).size;
  };

  const rungs = budget ? ladder(recipe) : [{ width: recipe.width, quality }];
  let last;
  for (const rung of rungs) {
    const size = await attempt(rung);
    last = { size, ...rung };
    if (!budget || size <= budget) break;
  }
  return last;
}

async function fresh(src, out) {
  if (FORCE || !existsSync(out)) return false;
  const [a, b] = await Promise.all([fs.stat(src), fs.stat(out)]);
  return b.mtimeMs >= a.mtimeMs;
}

// ── The run ──────────────────────────────────────────────────────────────────

async function main() {
  const media = {};
  let breaches = 0;
  let before = 0;
  let after = 0;

  for (const recipe of RECIPES) {
    const dir = path.join(ROOT, recipe.dir);
    if (!existsSync(dir)) {
      console.log(`\n${recipe.label} — ${c.dim}${recipe.dir} does not exist${c.off}`);
      continue;
    }
    const spec = recipe.indexOnly
      ? "index only, never re-encoded"
      : `${recipe.width}px, q${recipe.quality}, budget ${kb(recipe.budget)}`;
    console.log(`\n${c.dim}--${c.off} ${recipe.label} ${c.dim}(${recipe.dir}, ${spec})${c.off}`);

    const sources = await chooseSources(dir, recipe);
    for (const name of [...sources.keys()].sort()) {
      const s = sources.get(name);
      const rel = `${recipe.dir.replace(/^public/, "")}/${name}.webp`;

      if (recipe.indexOnly) {
        media[rel] = await placeholder(s.file);
        console.log(`  ${name.padEnd(26)} ${c.dim}indexed${c.off}`);
        continue;
      }

      const out = path.join(dir, `${name}.webp`);
      before += (await fs.stat(s.file)).size;

      let size = null;
      let usedQuality = recipe.quality;
      let usedWidth = recipe.width;
      if (WRITE) {
        if (await fresh(s.file, out)) size = (await fs.stat(out)).size;
        else ({ size, quality: usedQuality, width: usedWidth } = await encode(s.file, out, recipe));
      }

      if (recipe.thumb && WRITE) {
        const tOut = path.join(dir, `${name}${recipe.thumb.suffix}.webp`);
        let tSize;
        if (await fresh(s.file, tOut)) tSize = (await fs.stat(tOut)).size;
        else ({ size: tSize } = await encode(s.file, tOut, recipe.thumb));
        if (tSize > recipe.thumb.budget) {
          breaches++;
          console.log(`  ${c.warn}thumb over budget${c.off} ${name}${recipe.thumb.suffix}.webp ${kb(tSize)}`);
        }
      }

      media[rel] = await placeholder(WRITE && existsSync(out) ? out : s.file);

      const over = size !== null && size > recipe.budget;
      if (over) breaches++;
      if (size !== null) after += size;

      const spent = [
        usedQuality !== recipe.quality ? `q${usedQuality}` : null,
        usedWidth !== recipe.width ? `${usedWidth}px` : null,
      ].filter(Boolean);
      const tail = size !== null && spent.length ? ` ${c.dim}${spent.join(" ")}${c.off}` : "";
      const verdict =
        size === null ? `${c.dim}would encode${c.off}` : over ? `${c.bad}${kb(size)} OVER${c.off}` : `${c.ok}${kb(size)}${c.off}${tail}`;
      console.log(`  ${name.padEnd(26)} ${c.dim}${(s.ext === ".webp" ? "webp" : s.ext.slice(1)).padEnd(4)} ${`${s.width}x${s.height}`.padStart(11)}${c.off} -> ${verdict}`);

      if (ARCHIVE && WRITE && s.ext !== ".webp") {
        const dest = path.join(ROOT, ARCHIVE_DIR, recipe.dir.replace(/^public\//, ""));
        await fs.mkdir(dest, { recursive: true });
        await fs.rename(s.file, path.join(dest, s.entry));
      }
    }
  }

  if (WRITE) {
    await writeManifest(media);
    console.log(
      `\n${c.ok}wrote${c.off} ${LQIP_OUT} ${c.dim}(${Object.keys(media).length} entries, ${kb(JSON.stringify(media).length)} inline)${c.off}`,
    );
    if (before) {
      console.log(
        `${c.ok}total${c.off} ${kb(before)} in -> ${kb(after)} out ${c.dim}(${(100 - (after / before) * 100).toFixed(0)}% smaller)${c.off}`,
      );
    }
  } else {
    console.log(`\n${c.dim}Dry run. Nothing written. Re-run with --write.${c.off}`);
  }

  if (CHECK && breaches) {
    console.error(`\n${c.bad}${breaches} file(s) over budget.${c.off}`);
    process.exit(1);
  }
}

async function writeManifest(media) {
  const entries = Object.keys(media)
    .sort()
    .map((k) => {
      const m = media[k];
      return `  "${k}": { lqip: "${m.lqip}", dominant: "${m.dominant}", w: ${m.w}, h: ${m.h} },`;
    })
    .join("\n");

  const body = `// GENERATED BY scripts/media.mjs - DO NOT EDIT BY HAND.
//
// One entry per shipped image: a ~20px blurred WebP as a data URI, the picture's
// own dominant colour, and its real dimensions.
//
// WHY THIS IS INLINE RATHER THAN FETCHED. The placeholder's whole job is to be
// on screen during the first frame, before the photograph it stands in for has
// even been requested. A placeholder that is itself a request cannot do that job
// - it arrives in the same round trip as the thing it was covering for.
//
// Re-run \`npm run media\` after dropping a wallpaper into public/themes.
export type MediaMeta = {
  /** A ~20px WebP, base64. Painted blurred and scaled up under the real one. */
  lqip: string;
  /** The picture's own dominant colour - the ground behind it while it loads. */
  dominant: string;
  w: number;
  h: number;
};

export const MEDIA: Record<string, MediaMeta> = {
${entries}
};

/** Never throws on an unknown path: a missing entry means "no placeholder", and
 *  every consumer already survives that - a skin whose file has not been
 *  delivered renders its ground and its accent wash, which is a finished-looking
 *  floor rather than a broken one. */
export const metaFor = (src: string | null | undefined): MediaMeta | null =>
  (src ? MEDIA[src] ?? null : null);
`;
  await fs.writeFile(path.join(ROOT, LQIP_OUT), body, "utf8");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
