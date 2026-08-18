// ─────────────────────────────────────────────────────────────────────────────
// PRINT THE SIX IMAGE PROMPTS, AND WHERE EACH FILE GOES.
//
//   npm run art:prompts
//
// The prompts live in src/lib/suite/artwork.ts next to the code that renders
// them, so they cannot drift from the paths the login pages actually read. This
// just prints them in a form that can be pasted into an image tool.
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ARTWORK, ARTWORK_DIR, HOUSE_STYLE } from "../src/lib/suite/artwork";

const root = process.cwd();

console.log("\n\x1b[1mTHE SIX LOGIN ARTWORKS\x1b[0m");
console.log(`\nSave every file into \x1b[1m${ARTWORK_DIR}\x1b[0m (create the folder if it is not there).`);
console.log("Until a file exists its door falls back to a gradient in the same accent, so");
console.log("nothing looks half-built while you are still generating them.\n");
console.log("\x1b[2mOne shared house style is prepended to all six. That is the important part:");
console.log("six beautiful images in six unrelated styles look worse together than six plain");
console.log("ones that match.\x1b[0m\n");
console.log("─".repeat(78));

ARTWORK.forEach((a, i) => {
  const abs = join(root, "public", a.file.replace(/^\/images/, "images").replace(/^images/, "images"));
  const onDisk = existsSync(join(root, "public", a.file.slice(1)));
  console.log(`\n\x1b[1m${i + 1}. ${a.name}\x1b[0m   \x1b[2maccent ${a.accent}\x1b[0m`);
  console.log(`   save as:  \x1b[1m${a.file.slice(1)}\x1b[0m   ${onDisk ? "\x1b[32m✓ present\x1b[0m" : "\x1b[33m· not yet generated\x1b[0m"}`);
  console.log(`   mood:     \x1b[2m${a.mood}\x1b[0m`);
  console.log(`\n   \x1b[36mPROMPT\x1b[0m`);
  // Wrap at 74 so it copies cleanly out of a terminal.
  for (const line of wrap(a.prompt, 74)) console.log(`   ${line}`);
  console.log(`\n${"─".repeat(78)}`);
});

console.log(`
\x1b[1mNotes that matter more than the wording\x1b[0m

  · Every prompt reserves the LEFT THIRD as near-empty dark space. That is where
    the sign-in card sits. An image with its subject on the left produces a
    beautiful picture and an unreadable login page.

  · Each is ONE hue on near-black. Resist adding a second colour: the six read as
    a set precisely because each is monochrome in its own accent, and the accent
    is the same one that system wears in its sidebar and on the launcher.

  · Ask for 2560x1600. They are served as full-bleed backgrounds and will be seen
    on projectors.

  · Export as PNG. If a file lands over ~1.5MB, run it through a compressor —
    these load before anything else on the page.

\x1b[2mRe-print this any time:  npm run art:prompts\x1b[0m
`);

function wrap(s: string, w: number): string[] {
  const words = s.split(/\s+/);
  const out: string[] = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length > w) { out.push(line.trim()); line = word; }
    else line += ` ${word}`;
  }
  if (line.trim()) out.push(line.trim());
  return out;
}

void HOUSE_STYLE; void ARTWORK_DIR;
