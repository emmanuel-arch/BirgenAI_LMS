// ─────────────────────────────────────────────────────────────────────────────
// SKINS — the wallpaper a system stands on, in each theme.
//
// ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
// The console has always sat on a photograph and looked like a product; the five
// satellites sat on a flat grey and looked like admin panels. Making them match
// meant putting artwork under all of them — and the moment that was true, two
// bugs became one bug with one place to fix it:
//
//   1. LIGHT MODE, DARK RAIL. The satellites drew a near-black navigation rail
//      flush to the screen edge on a pale page. (Fixed in SuiteShell, not here.)
//
//   2. DARK MODE, LIGHT WALLPAPER. The dark theme flipped every token and every
//      surface, and then painted `white-background.png` — a photograph of pale
//      grey waves — across the whole viewport behind them. Dark cards floating
//      on a white floor. The theme was doing its job and the floor was not,
//      because the floor was a hard-coded string in a component.
//
// A wallpaper is therefore not a class name. It is a SKIN: a pair of faces, one
// per theme, that always move together. There is no way to express "light image,
// no dark image" by accident, which is exactly how (2) happened.
//
// ── ONE PHOTOGRAPH, BOTH THEMES ──────────────────────────────────────────────
// `ground` is load-bearing, not a fallback colour: it is what the image is
// COMPOSITED ONTO at `opacity`. A dark skin is a dark ground showing through a
// dimmed picture, which is why a single file can serve both faces — and why this
// list has fifteen entries and fifteen files rather than thirty.
//
// That is also what makes theme and skin INDEPENDENT choices. Somebody picks the
// picture they want and the brightness they want, separately, and every
// combination is legible by construction. A picker that has to prevent
// combinations is worse than no picker.
//
// ── THE CONTRACT EVERY SKIN MUST HONOUR ──────────────────────────────────────
// A skin is a FLOOR, never a feature. Nothing readable is ever laid on it: every
// surface above it is a `.panel` or a `.canvas` with its own background, so the
// picture can be as busy as it likes and no sentence is at its mercy.
//
// ── WHAT AN ORG ADMIN DOES ───────────────────────────────────────────────────
// Drop a file into `public/themes/`, run `npm run media` (which resizes it,
// converts it to WebP, holds it under 300 KB and generates its blur
// placeholder), and add a row below. See public/themes/README.md.
// ─────────────────────────────────────────────────────────────────────────────

export type SkinFace = {
  /**
   * A path under /public, or null for no photograph at all — the ground and the
   * system's own accent wash then carry the whole surface. Null is a legitimate
   * design, not a missing asset: see the `plain` skin.
   */
  image: string | null;
  /** The flat colour the image is composited onto. Never transparent. */
  ground: string;
  /** How much of the picture survives, 0–1. Below ~0.4 it reads as texture. */
  opacity: number;
  /**
   * How strongly this system's accent washes the corners, 0–1. The accent comes
   * from the system, not the skin, so one skin gives seven differently-coloured
   * floors without seven files.
   */
  wash: number;
};

export type Skin = {
  id: string;
  name: string;
  /** One line in the picker. What it feels like, not what it is a photo of. */
  blurb: string;
  light: SkinFace;
  dark: SkinFace;
};

// ── THE GROUNDS ──────────────────────────────────────────────────────────────
// Two constants rather than repeated hexes, because these are the values the
// token layer already uses (--studio in theme-dark.css) and a skin that drifts
// from them shows as a seam at the edge of the canvas.
const LIGHT_GROUND = "#f4f4f2";
const DARK_GROUND = "#0d1017";

/** Where the pipeline puts them. One place, so a folder rename is one edit. */
const THEME_DIR = "/themes";
const img = (id: string) => `${THEME_DIR}/${id}.webp`;

/**
 * The picker's swatch, not the floor. 480x300 and ~20 KB against a 2560px file
 * at up to 300 KB — and the appearance menu renders EVERY skin at once, so this
 * is the difference between a menu that opens instantly and one that pulls three
 * megabytes to draw fifteen thumbnails.
 */
export const thumbFor = (face: SkinFace): string | null =>
  (face.image ? face.image.replace(/\.webp$/, "-thumb.webp") : null);

/**
 * A photograph. Busy, full of detail, and therefore held well back in both
 * themes — a third of its strength in light, a fifth in dark. These numbers are
 * the ones the README's table calls for and they are not taste: they are where
 * body copy on a `.panel` two layers up still clears AA over the worst-case
 * frame of the picture.
 */
const photo = (id: string, light = 0.32, dark = 0.22): Pick<Skin, "light" | "dark"> => ({
  light: { image: img(id), ground: LIGHT_GROUND, opacity: light, wash: 0.16 },
  dark: { image: img(id), ground: DARK_GROUND, opacity: dark, wash: 0.3 },
});

/**
 * A texture or an abstract render. No subject to compete with a figure, so it
 * can be carried much closer to full strength — which is what makes these the
 * quiet ones rather than the weak ones.
 */
const texture = (id: string, light = 0.7, dark = 0.34): Pick<Skin, "light" | "dark"> => ({
  light: { image: img(id), ground: LIGHT_GROUND, opacity: light, wash: 0.14 },
  dark: { image: img(id), ground: DARK_GROUND, opacity: dark, wash: 0.28 },
});

/**
 * The skins that ship with the suite. Every one has been looked at in BOTH
 * themes — that is the entry requirement.
 */
export const BUILT_IN_SKINS: Skin[] = [
  // ── THE QUIET ONES ─────────────────────────────────────────────────────────
  {
    id: "plain",
    name: "Plain",
    blurb: "No photograph. The system's own colour, and nothing else.",
    // Not a degraded mode. It is the fastest floor in the set (no image request
    // at all), it is the one that survives a bad projector, and on a branch
    // machine that cannot composite a full-screen picture at 60fps it is the one
    // that should be chosen deliberately rather than fallen back into.
    light: { image: null, ground: "#f7f7f6", opacity: 0, wash: 0.22 },
    dark: { image: null, ground: "#0b0e14", opacity: 0, wash: 0.34 },
  },
  {
    id: "paper",
    name: "Paper",
    blurb: "Almost nothing. Texture you feel rather than see.",
    ...texture("paper", 0.8, 0.3),
  },
  {
    id: "linen-dark",
    name: "Charcoal",
    blurb: "Almost nothing, in the dark.",
    ...texture("linen-dark", 0.42, 0.36),
  },

  // ── THE ABSTRACTS ──────────────────────────────────────────────────────────
  // Brand-matched renders. No subject, no horizon, nothing that reads as a
  // photograph of somewhere — which is what makes them the safe default for a
  // system whose floor should not be saying anything at all.
  {
    id: "mesh-navy",
    name: "Navy mesh",
    blurb: "A filament network in the brand's own blue.",
    ...texture("mesh-navy", 0.55, 0.34),
  },
  {
    id: "mesh-lime",
    name: "Lime mesh",
    blurb: "The same gesture, in the accent green.",
    ...texture("mesh-lime", 0.5, 0.32),
  },
  {
    id: "gradient",
    name: "Gradient",
    blurb: "A slow colour field. The calmest thing in the list.",
    ...texture("gradient-1", 0.6, 0.34),
  },
  {
    id: "ink",
    name: "Ink",
    blurb: "Deep, and close to black. Built for the dark theme.",
    ...texture("dark-1", 0.3, 0.34),
  },
  {
    id: "slate",
    name: "Slate",
    blurb: "Cold stone. The other dark one.",
    ...texture("dark-2", 0.32, 0.34),
  },

  // ── THE PHOTOGRAPHS ────────────────────────────────────────────────────────
  // Kenya, and the same set the borrower app offers its customers — deliberately
  // the same twelve pictures, so a lender's staff console and their customers'
  // phones are visibly one product rather than two that happen to share a
  // logo.
  {
    id: "nairobi-dawn",
    name: "Nairobi dawn",
    blurb: "The city, early. Steady and institutional.",
    ...photo("nairobi-dawn"),
  },
  {
    id: "savannah",
    name: "Savannah",
    blurb: "Acacia and long light. The one everyone keeps.",
    ...photo("savannah"),
  },
  {
    id: "coast",
    name: "Coast",
    blurb: "Turquoise from above. The cool one.",
    ...photo("coast", 0.28, 0.2),
  },
  {
    id: "tea-fields",
    name: "Tea",
    blurb: "Green rows to the horizon. Order, drawn.",
    ...photo("tea-fields", 0.3, 0.22),
  },
  {
    id: "mount-kenya",
    name: "Mount Kenya",
    blurb: "Cloud and rock. Height without the cliché.",
    ...photo("mount-kenya"),
  },
  {
    id: "market-warm",
    name: "Market",
    blurb: "Cloth and colour, out of focus. Warm and mercantile.",
    ...photo("market-warm", 0.3, 0.2),
  },
  {
    id: "boda-motion",
    name: "Motion",
    blurb: "A street at speed. Movement, blurred.",
    ...photo("boda-motion", 0.34, 0.26),
  },
  {
    id: "sunset-silhouette",
    name: "Dusk",
    blurb: "A tree against orange. The warm dark.",
    ...photo("sunset-silhouette", 0.3, 0.26),
  },
];

/**
 * ── THE DROP-IN SLOT ─────────────────────────────────────────────────────────
 * Yours go here. A file in `public/themes/`, `npm run media`, one row below.
 *
 *   { id: "harbour", name: "Harbour", blurb: "Cold morning water.",
 *     ...photo("harbour") }
 *
 * A skin whose file is not there yet renders its `ground` and its wash, which is
 * a finished-looking floor rather than a broken one — so a half-delivered theme
 * never reads as a half-finished product.
 */
export const CUSTOM_SKINS: Skin[] = [];

export const SKINS: Skin[] = [...BUILT_IN_SKINS, ...CUSTOM_SKINS];

export const DEFAULT_SKIN = "mesh-navy";

/**
 * ── WHICH FLOOR EACH SYSTEM OPENS ON ─────────────────────────────────────────
 * The single most important table in this file, and the reason it is a table at
 * all rather than one shared default.
 *
 * These seven systems share a rail, a canvas, a type scale and a set of
 * controls. That consistency is the argument being made — learn one, you have
 * learned seven — and it is also the thing that makes them impossible to tell
 * apart at a glance. A collections supervisor with ConnectDesk and Ledgerly both
 * open has two tabs that are the same shade of the same grey, and the tell is a
 * word in the corner.
 *
 * The accent already differentiates them, but an accent is a detail: a coloured
 * rule and a coloured icon, at the edges of a mostly-neutral page. The FLOOR is
 * the largest surface on screen, and giving each system its own means the
 * difference is visible from across a room and out of the corner of an eye —
 * which is where tab-recognition actually happens.
 *
 * So each system opens on a skin chosen to agree with what it IS, not merely to
 * be different from its neighbour:
 *
 *   lms         the city at dawn — steady, institutional, load-bearing.
 *   portal      the coast — open, cool, the front door a customer sees.
 *   analytics   the navy mesh — pattern and network, seen from above.
 *   callcenter  motion — many conversations moving at once.
 *   hr          the market — people, warmth, many individuals at work.
 *   accounting  tea rows — exactness, order, everything in its place.
 *   interchange the gradient — deliberately the most neutral floor in the set,
 *               because the Interchange is shared ground between competitors and
 *               must not wear any one lender's character.
 *
 * A person who dislikes any of these changes it, and their choice is remembered
 * per system for ever (see skinStorageKey). This table is only the answer to
 * "before anybody has said".
 */
export const SKIN_DEFAULTS: Record<string, string> = {
  lms: "nairobi-dawn",
  portal: "coast",
  analytics: "mesh-navy",
  callcenter: "boda-motion",
  hr: "market-warm",
  accounting: "tea-fields",
  interchange: "gradient",
};

export const skinFor = (id: string | null | undefined): Skin =>
  SKINS.find((s) => s.id === id) ?? SKINS.find((s) => s.id === DEFAULT_SKIN) ?? SKINS[0];

export const defaultSkinFor = (systemId: string): string => SKIN_DEFAULTS[systemId] ?? DEFAULT_SKIN;

/** Where a system's chosen skin is remembered. Per system, on purpose — the
 *  founder's ask was that a person can dress each one differently. */
export const skinStorageKey = (systemId: string) => `suite:skin:${systemId}`;
