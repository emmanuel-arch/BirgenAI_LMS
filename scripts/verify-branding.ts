// Tests for the branding pipeline — palette extraction, transparency detection,
// background removal, brand derivation, and the storage rules that keep
// sensitive bytes out of the public bucket.
//
//   npm run test:branding        (pure — no database, no server, no canvas)
//
// Fixtures are synthesized RGBA arrays, the exact shape a canvas ImageData has,
// so the same functions the browser runs are exercised offline. The scenarios
// mirror the founder's brief: a red Buy-Simu-style logo on white must yield red
// defaults and an offer to remove the background; a transparent logo must not
// be offered removal; a monochrome image must refuse removal rather than erase
// itself.
import {
  type Pixels, hasTransparency, detectUniformBackground, removeBackground,
  extractPalette, deriveBrand, accentSoftFrom, darken, isHexColor, isCssRgba,
  parseHex, rgbToHsl,
} from "@/lib/branding/palette";
import { putBrandLogo, deleteBrandLogo, keyBelongsToOrg, MAX_SIM_LOGO_BYTES, InvalidImageError } from "@/lib/storage/provider";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); }
};

// ── Fixture builders ─────────────────────────────────────────────────────────

function canvas(w: number, h: number, fill: [number, number, number, number]): Pixels {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill[0]; data[i + 1] = fill[1]; data[i + 2] = fill[2]; data[i + 3] = fill[3];
  }
  return { data, width: w, height: h };
}

function rect(img: Pixels, x0: number, y0: number, x1: number, y1: number, c: [number, number, number, number]) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * img.width + x) * 4;
    img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = c[3];
  }
}

/** A vivid red mark filling the middle third of a white card — "Buy Simu on white". */
function redOnWhite(): Pixels {
  const img = canvas(48, 48, [255, 255, 255, 255]);
  rect(img, 12, 12, 36, 36, [225, 29, 72, 255]);
  return img;
}

/** The same red mark on a transparent background. */
function redTransparent(): Pixels {
  const img = canvas(48, 48, [0, 0, 0, 0]);
  rect(img, 12, 12, 36, 36, [225, 29, 72, 255]);
  return img;
}

/** A tiny valid PNG data URL (1×1) for storage tests. */
const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function main() {
  console.log("1. Color plumbing");
  ok("hex round-trips", parseHex("#e11d48")!.r === 225 && isHexColor("#E11D48"));
  ok("bad hex rejected", !isHexColor("#12345") && !isHexColor("red") && !isHexColor(""));
  ok("rgba validator", isCssRgba("rgba(225,29,72,0.12)") && !isCssRgba("rgb(1,2,3)") && !isCssRgba("rgba(1,2,3,2)"));
  ok("accentSoft is the accent at 12%", accentSoftFrom("#e11d48") === "rgba(225,29,72,0.12)");
  const darker = darken("#e11d48");
  const dl = rgbToHsl(parseHex(darker)!.r, parseHex(darker)!.g, parseHex(darker)!.b).l;
  const ol = rgbToHsl(225, 29, 72).l;
  ok("darken lowers lightness, keeps a valid hex", isHexColor(darker) && dl < ol);

  console.log("\n2. Transparency detection");
  ok("white-background logo is NOT transparent", !hasTransparency(redOnWhite()));
  ok("transparent logo IS transparent", hasTransparency(redTransparent()));

  console.log("\n3. Background detection + removal");
  const bg = detectUniformBackground(redOnWhite());
  ok("white background detected", !!bg && bg.r > 250 && bg.g > 250 && bg.b > 250);
  ok("transparent logo has no background to detect", detectUniformBackground(redTransparent()) === null);

  const removed = removeBackground(redOnWhite());
  ok("removal produces a result on red-on-white", removed !== null);
  if (removed) {
    const corner = removed.data[3];
    const centerIdx = ((24 * removed.width) + 24) * 4;
    ok("corners went transparent", corner === 0);
    ok("the red mark survived", removed.data[centerIdx + 3] === 255 && removed.data[centerIdx] === 225);
    ok("original pixels untouched (pure function)", redOnWhite().data[3] === 255);
  }
  ok("monochrome image refuses removal (would erase itself)", removeBackground(canvas(32, 32, [225, 29, 72, 255])) === null);
  // Multi-color background: border pixels disagree → no uniform bg → refuse.
  const noisy = redOnWhite();
  rect(noisy, 0, 0, 24, 4, [30, 60, 200, 255]);
  ok("non-uniform background refuses removal", removeBackground(noisy) === null);

  console.log("\n4. Palette + brand derivation");
  const pal = extractPalette(redOnWhite());
  ok("red-on-white palette leads with the red (white doesn't vote)", pal.length >= 1 && pal[0].color === "#e11d48", pal[0]?.color);
  const brand = deriveBrand(pal)!;
  ok("accent is the logo's red", brand.accent === "#e11d48");
  ok("soft accent derived from it", brand.accentSoft === "rgba(225,29,72,0.12)");
  ok("single-color logo gradients to a darker self", brand.accent2 === darken("#e11d48") && brand.gradient.includes(brand.accent2));

  // Two-color logo: red + a big blue block ⇒ blue becomes the gradient partner.
  const duo = redOnWhite();
  rect(duo, 12, 36, 36, 46, [37, 99, 235, 255]);
  const duoBrand = deriveBrand(extractPalette(duo))!;
  const duoHue = rgbToHsl(parseHex(duoBrand.accent2)!.r, parseHex(duoBrand.accent2)!.g, parseHex(duoBrand.accent2)!.b).h;
  ok("two-color logo picks the second hue as the gradient partner", duoHue > 180 && duoHue < 260, duoBrand.accent2);

  ok("empty palette derives nothing (caller keeps defaults)", deriveBrand([]) === null);
  const bw = extractPalette(canvas(32, 32, [10, 10, 10, 255]));
  ok("near-black logo yields no votes", bw.length === 0);

  console.log("\n5. Storage rules (simulation mode — no key set)");
  ok("test runs in simulation", !process.env.SUPABASE_SERVICE_ROLE_KEY);
  const stored = await putBrandLogo("org-1", PNG_1PX);
  ok("simulation stores the data URL itself", stored === PNG_1PX);
  const big = `data:image/png;base64,${Buffer.concat([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"), Buffer.alloc(MAX_SIM_LOGO_BYTES)]).toString("base64")}`;
  let refused = false;
  try { await putBrandLogo("org-1", big); } catch (e) { refused = e instanceof InvalidImageError; }
  ok("oversized simulation logo refused with a clear error", refused);
  let badImage = false;
  try { await putBrandLogo("org-1", "data:image/png;base64,aGVsbG8="); } catch (e) { badImage = e instanceof InvalidImageError; }
  ok("non-image bytes refused (magic sniff)", badImage);
  await deleteBrandLogo(PNG_1PX); // data-URL logo: nothing to delete, must not throw
  ok("deleting a data-URL logo is a no-op", true);
  ok("org key ownership check still holds", keyBelongsToOrg("org-1/logo-abc.png", "org-1") && !keyBelongsToOrg("org-2/logo-abc.png", "org-1"));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
