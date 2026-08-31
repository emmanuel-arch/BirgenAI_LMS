// ─────────────────────────────────────────────────────────────────────────────
// SKINS — the wallpaper a system stands on, in each theme.
//
// ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
// The console has always sat on a photograph and looked like a product; the five
// satellites sat on a flat grey and looked like admin panels. Making them match
// meant putting the same artwork under all of them — and the moment that was
// true, two bugs became one bug with one place to fix it:
//
//   1. LIGHT MODE, DARK RAIL. The satellites drew a near-black navigation rail
//      flush to the screen edge on a pale page. It is the single loudest thing
//      wrong with those screens: white is not white and dark is not dark, so
//      neither theme is actually a theme. (Fixed in SuiteShell, not here.)
//
//   2. DARK MODE, LIGHT WALLPAPER. The dark theme flipped every token and every
//      surface, and then painted `white-background.png` — a photograph of pale
//      grey waves — across the whole viewport behind them. Dark cards floating
//      on a white floor. The theme was doing its job and the floor was not,
//      because the floor was a hard-coded string in a component.
//
// A wallpaper is therefore not a class name any more. It is a SKIN: a pair of
// faces, one per theme, that always move together. There is no way to express
// "light image, no dark image" by accident, which is exactly how (2) happened.
//
// ── WHAT AN ORG ADMIN DOES ───────────────────────────────────────────────────
// Drop two files into `public/themes/<id>/` — `light.jpg` and `dark.jpg` — add a
// row to CUSTOM_SKINS below, and it appears in every system's appearance menu on
// the next render. No rebuild of anything else, no component touched. See
// public/themes/README.md for the sizing and contrast brief.
//
// ── THE CONTRACT EVERY SKIN MUST HONOUR ──────────────────────────────────────
// A skin is a FLOOR, never a feature. Nothing readable is ever laid on it: every
// surface above it is a `.panel` or a `.canvas` with its own background, so the
// picture can be as busy as it likes and no sentence is at its mercy. That is
// the same rule the console settled on and it is why the artwork is allowed to
// be a photograph at all.
//
// `ground` is load-bearing, not a fallback colour: it is what the image is
// COMPOSITED ONTO at `opacity`. A dark skin is a dark ground showing through a
// dimmed picture, which is why the same photograph can serve both themes.
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
   * from the system, not the skin, so one skin gives six differently-coloured
   * floors without six files.
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

/**
 * The skins that ship with the suite. Every one has been looked at in BOTH
 * themes — that is the entry requirement, and the reason the list is short.
 */
export const BUILT_IN_SKINS: Skin[] = [
  {
    id: "linen",
    name: "Linen",
    blurb: "Soft grey waves. The lending console's own floor since day one.",
    // The proven one. This exact image under this exact treatment is what the
    // console has shipped with, and it is the reference every other system is
    // now being held to.
    light: { image: "/images/white-background.png", ground: LIGHT_GROUND, opacity: 1, wash: 0.16 },
    // The console had NO answer here and painted the light plate regardless.
    // A blue mesh at a fifth of its strength over near-black is the same
    // gesture — texture you feel rather than read — in the other direction.
    dark: { image: "/images/suite/conny-schneider-xuTJZ7uD7PI-unsplash.jpg", ground: DARK_GROUND, opacity: 0.2, wash: 0.3 },
  },
  {
    id: "web",
    name: "Web",
    blurb: "A dense filament mesh. Reads as a network without drawing one.",
    light: { image: "/images/suite/analytics.jpg", ground: LIGHT_GROUND, opacity: 0.26, wash: 0.18 },
    dark: { image: "/images/suite/robynne-o-HOrhCnQsxnQ-unsplash.jpg", ground: DARK_GROUND, opacity: 0.34, wash: 0.26 },
  },
  {
    id: "plain",
    name: "Plain",
    blurb: "No photograph. The system's own colour, and nothing else.",
    // Not a degraded mode. It is the fastest floor in the set (no image request
    // at all), it is the one that survives a bad projector, and on a branch
    // machine that cannot composite a full-screen picture at 60fps it is the
    // one that should be chosen deliberately rather than fallen back into.
    light: { image: null, ground: "#f7f7f6", opacity: 0, wash: 0.22 },
    dark: { image: null, ground: "#0b0e14", opacity: 0, wash: 0.34 },
  },
];

/**
 * ── THE DROP-IN SLOT ─────────────────────────────────────────────────────────
 * Yours go here. Two files under `public/themes/<id>/`, one row below, done.
 *
 *   {
 *     id: "harbour",
 *     name: "Harbour",
 *     blurb: "Cold morning water.",
 *     light: { image: "/themes/harbour/light.jpg", ground: "#f2f4f6", opacity: 0.5, wash: 0.16 },
 *     dark:  { image: "/themes/harbour/dark.jpg",  ground: "#0c1016", opacity: 0.3, wash: 0.3 },
 *   }
 *
 * A skin whose files are not there yet renders its `ground` and its wash, which
 * is a finished-looking floor rather than a broken one — so a half-delivered
 * theme never reads as a half-finished product.
 */
export const CUSTOM_SKINS: Skin[] = [];

export const SKINS: Skin[] = [...BUILT_IN_SKINS, ...CUSTOM_SKINS];

export const DEFAULT_SKIN = "linen";

/**
 * Which skin a system opens on before anybody has chosen. Analytics keeps the
 * filament web it was designed against; everything else stands on the console's
 * floor, because "the same product" is the entire argument being made.
 */
export const SKIN_DEFAULTS: Record<string, string> = {
  analytics: "web",
};

export const skinFor = (id: string | null | undefined): Skin =>
  SKINS.find((s) => s.id === id) ?? SKINS.find((s) => s.id === DEFAULT_SKIN) ?? SKINS[0];

export const defaultSkinFor = (systemId: string): string => SKIN_DEFAULTS[systemId] ?? DEFAULT_SKIN;

/** Where a system's chosen skin is remembered. Per system, on purpose — the
 *  founder's ask was that a person can dress each one differently. */
export const skinStorageKey = (systemId: string) => `suite:skin:${systemId}`;
