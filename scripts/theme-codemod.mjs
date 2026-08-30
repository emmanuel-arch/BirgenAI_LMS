// ─────────────────────────────────────────────────────────────────────────────
// THE THEME CODEMOD — one pass, reviewable rules, reversible by `git checkout`.
//
// The suite was written light-only: ~4,100 hard-coded Tailwind zinc/white
// utilities that do not respond to a token change. This rewrites them onto the
// semantic ramp declared in src/app/theme-dark.css, whose LIGHT values are
// byte-identical to the Tailwind defaults being replaced.
//
// That identity is the safety property, and it is what makes a diff this size
// reviewable: in light mode this script is a no-op. If a light screenshot moves,
// a rule below is wrong — not the theme.
//
//   node scripts/theme-codemod.mjs --dry     report only, write nothing
//   node scripts/theme-codemod.mjs           apply
//
// ── THE THREE JUDGEMENT CALLS ───────────────────────────────────────────────
// Everything here is mechanical except three decisions, which are the reason
// this is a script with rules rather than a global find-and-replace:
//
// 1. `bg-zinc-900` WITHOUT an opacity modifier is not ink — it is a deliberate
//    dark control on a light page (the primary button, the active nav pill).
//    Inverting it with the ramp would make it white-on-white. It becomes
//    `bg-invert`: "the opposite of the page, whatever the page is."
//
// 2. `bg-zinc-900/5` WITH a small opacity IS ink — a tint, a hover wash, a chip.
//    Those must flip, so they join the ramp. The cut is at 30%: below it the
//    value is a tint over the page, above it the value is a SCRIM meant to be
//    dark in both themes (modal backdrops, image overlays), and scrims are left
//    exactly as they are.
//
// 3. `text-white` is only ink when it is sitting on one of those dark controls.
//    Most of the 522 uses are on brand-coloured surfaces set from `var(--brand)`
//    and must stay white in both themes. So it is rewritten ONLY on lines that
//    also carry a no-opacity `bg-zinc-8/9xx`, and it is the last rule to run so
//    it can key off `bg-invert` rather than guessing again.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = new URL("../src", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const DRY = process.argv.includes("--dry");
const EXTS = new Set([".tsx", ".ts", ".jsx", ".js"]);

/** Utility prefixes that take the ash ramp verbatim. */
const RAMP_PREFIXES = ["text", "border", "ring", "divide", "fill", "stroke", "shadow", "from", "via", "to", "decoration", "outline", "caret", "accent"];

/** The scrim cut. At or below this the value is a tint over the page and flips;
 *  above it the value is an overlay meant to stay dark in both themes. */
const SCRIM_AT = 30;

const rules = [];

/** A rule that rewrites `<prefix>-zinc-<n>` (any variant prefix, any opacity)
 *  onto `<prefix>-ash-<n>`. */
for (const p of RAMP_PREFIXES) {
  rules.push({
    name: `${p}-zinc-* → ${p}-ash-*`,
    // (?<![\w-]) so `text-` does not match inside `placeholder:text-` incorrectly —
    // it SHOULD match there, and does, because ":" is not [\w-]. It is `-` that
    // must be excluded, so `bg-zinc-900` is never eaten by the `to-` rule.
    re: new RegExp(`(?<![\\w-])${p}-zinc-(50|100|200|300|400|500|600|700|800|900|950)(?![\\w-])`, "g"),
    to: (_m, n) => `${p}-ash-${n}`,
  });
}

rules.push(
  {
    name: "bg-white → bg-paper",
    re: /(?<![\w-])bg-white(?![\w-])/g,
    to: () => "bg-paper",
  },
  {
    // Judgement call 2 — tints flip, scrims do not. Runs BEFORE the no-opacity
    // rule so it claims the `/n` forms first.
    // Opacity is written two ways in this codebase and BOTH have to be read:
    // `/5` (Tailwind's own scale, percent) and `/[0.05]` (an arbitrary value, a
    // fraction). 161 of the tints use the bracket form — missing them leaves a
    // 5%-black wash on a near-black page, which is not subtle, it is invisible.
    name: "bg-zinc-9xx/<tint> → bg-ash-9xx/<tint>  (scrims untouched)",
    re: /(?<![\w-])bg-zinc-(900|950)\/(\[[0-9.]+\]|\d{1,3})(?![\w-])/g,
    to: (m, n, op) => {
      const frac = op.startsWith("[") ? Number(op.slice(1, -1)) : Number(op) / 100;
      return Number.isFinite(frac) && frac <= SCRIM_AT / 100 ? `bg-ash-${n}/${op}` : m;
    },
  },
  {
    // Judgement call 1 — the deliberate dark control.
    name: "bg-zinc-900|950 → bg-invert  (no opacity)",
    re: /(?<![\w-])bg-zinc-(?:900|950)(?![\w\-/])/g,
    to: () => "bg-invert",
  },
  {
    // Its hover shade. Kept distinct or the button stops responding to a hover.
    name: "bg-zinc-800 → bg-invert-2  (no opacity)",
    re: /(?<![\w-])bg-zinc-800(?![\w\-/])/g,
    to: () => "bg-invert-2",
  },
  {
    name: "bg-zinc-50..700 → bg-ash-*",
    re: /(?<![\w-])bg-zinc-(50|100|200|300|400|500|600|700)(?![\w-])/g,
    to: (_m, n) => `bg-ash-${n}`,
  },
);

/** Judgement call 3. Line-scoped, and last. */
const WHITE_ON_INVERT = {
  name: "text-white → text-invert-fg  (only beside a dark control)",
  lineScoped: true,
};

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (EXTS.has(extname(p))) out.push(p);
  }
  return out;
}

const counts = Object.fromEntries([...rules, WHITE_ON_INVERT].map((r) => [r.name, 0]));
const files = walk(ROOT);
let touched = 0;

for (const file of files) {
  const before = readFileSync(file, "utf8");
  let after = before;

  for (const r of rules) {
    after = after.replace(r.re, (...args) => {
      const out = r.to(...args);
      if (out !== args[0]) counts[r.name]++;
      return out;
    });
  }

  // Line-scoped pass. A dark control and its label are written in one class
  // string, and a class string is one line in this codebase often enough that
  // the remainder is quicker to eyeball than to parse. Anything missed stays
  // `text-white`, which is still legible on `bg-invert` in light and is caught
  // in the dark screenshot sweep.
  after = after
    .split("\n")
    .map((line) => {
      if (!/bg-invert(?![\w-])|bg-invert-2(?![\w-])/.test(line)) return line;
      return line.replace(/(?<![\w-])text-white(?![\w-])/g, () => {
        counts[WHITE_ON_INVERT.name]++;
        return "text-invert-fg";
      });
    })
    .join("\n");

  if (after !== before) {
    touched++;
    if (!DRY) writeFileSync(file, after, "utf8");
  }
}

const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(DRY ? "\n  DRY RUN — nothing written\n" : "\n  APPLIED\n");
for (const [name, n] of Object.entries(counts)) {
  if (n) console.log(`  ${String(n).padStart(5)}  ${name}`);
}
console.log(`\n  ${total} replacements across ${touched} of ${files.length} files\n`);
