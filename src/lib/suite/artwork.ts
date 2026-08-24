// ─────────────────────────────────────────────────────────────────────────────
// THE SIX DOORS — each system's login artwork.
//
// ── WHY EACH SYSTEM GETS ITS OWN ─────────────────────────────────────────────
// Everything else in this suite is deliberately identical: the same rail, the
// same canvas, the same type scale, the lender's mark in the same corner. That
// consistency is the argument — a person who learns one system has learned six.
//
// The login page is the ONE place that must differ, and for a reason that is not
// decoration. A satellite is a product with its own name and its own subdomain;
// arriving at desk.birgenai.com and seeing the lending console's front door would
// say "this is one system wearing six hats", which is the opposite of the claim.
// The door is where each product asserts it is a product.
//
// ── HOW THE ARTWORK BEHAVES ──────────────────────────────────────────────────
// Each image is a dim, abstract, low-contrast photograph or render in the
// system's own accent family. It sits under a scrim, so the sign-in card is
// always legible regardless of what the image does in that corner — the same
// discipline as the console canvas: type never touches artwork whose contrast
// nobody has checked.
//
// The file is OPTIONAL. Until it exists, the door falls back to a generated
// gradient in the same accent, and nothing looks broken or half-built. Drop the
// PNG in and it appears; delete it and the gradient returns.
//
// ── GENERATING THEM ──────────────────────────────────────────────────────────
// `prompt` is the exact text to give an image generator, and `file` is where the
// result goes. Both live here rather than in a document so they cannot drift
// apart from the code that renders them. `npm run art:prompts` prints them.
// ─────────────────────────────────────────────────────────────────────────────

export type Artwork = {
  /** SUITE_APPS id. */
  id: string;
  name: string;
  accent: string;
  /** Public path. Optional on disk — the gradient covers its absence. */
  file: string;
  /** Fallback gradient, used until the file exists. */
  gradient: string;
  /** One line describing the mood, for whoever regenerates it later. */
  mood: string;
  /** The generation prompt, verbatim. */
  prompt: string;
};

/**
 * Shared across all six prompts so the set reads as one commission rather than
 * six unrelated pictures. This is the single most important part: six beautiful
 * images in six unrelated styles look worse together than six plain ones that
 * match.
 */
export const HOUSE_STYLE =
  "Abstract architectural photography, shot on a full-frame camera with a 35mm lens at f/8. "
  + "Deep near-black background (#0b0a10) occupying at least 60% of the frame. A single soft "
  + "directional light source from the upper left. Fine film grain. No text, no letters, no "
  + "numbers, no logos, no watermarks, no people, no faces, no hands. No UI, no screens, no "
  + "charts, no dashboards. Composition weighted to the RIGHT THIRD so the left third stays "
  + "near-empty and dark for a sign-in card to sit on. Muted, desaturated, cinematic. "
  + "Photorealistic, not illustrative. 2560x1600, landscape.";

export const ARTWORK: Artwork[] = [
  {
    id: "lms",
    name: "Lending Console",
    accent: "#2a78d6",
    file: "/images/suite/login-lending.webp",
    gradient: "radial-gradient(1200px 700px at 78% 18%, #2a78d633 0%, transparent 62%), radial-gradient(900px 600px at 20% 90%, #1e40af26 0%, transparent 60%), #0b0a10",
    mood: "Steady, institutional, load-bearing. The system the others hang off.",
    prompt:
      `${HOUSE_STYLE} Subject: the underside of a vast concrete colonnade receding into darkness, `
      + `columns lit along one edge by cold blue light (#2a78d6) so the ribs of the structure glow faintly. `
      + `Long perspective lines converging toward the upper right. The feeling is institutional weight and `
      + `permanence — a building that has carried something heavy for a long time. Blue as the only chroma; `
      + `everything else near-monochrome charcoal.`,
  },
  {
    id: "portal",
    name: "Customer Portal",
    accent: "#0e7490",
    file: "/images/suite/login-portal.webp",
    gradient: "radial-gradient(1200px 700px at 78% 18%, #0e749033 0%, transparent 62%), radial-gradient(900px 600px at 20% 90%, #06b6d41f 0%, transparent 60%), #0b0a10",
    mood: "Open, welcoming, human-scale. The front door a customer sees.",
    prompt:
      `${HOUSE_STYLE} Subject: a single doorway standing open in a dark wall, teal-cyan daylight (#0e7490) `
      + `spilling through it across a polished floor, the reflection stretching toward the viewer. Everything `
      + `outside the doorway is unresolved and dark. The feeling is invitation and arrival — one way in, and `
      + `it is open. Teal as the only chroma. Nobody in the frame.`,
  },
  {
    id: "analytics",
    name: "Analytics Studio",
    accent: "#7c3aed",
    file: "/images/suite/login-analytics.webp",
    gradient: "radial-gradient(1200px 700px at 78% 18%, #7c3aed33 0%, transparent 62%), radial-gradient(900px 600px at 20% 90%, #a855f71f 0%, transparent 60%), #0b0a10",
    mood: "Cool, high, observational. Seeing the whole thing at once.",
    prompt:
      `${HOUSE_STYLE} Subject: a long-exposure photograph looking down on a city at night from very high up, `
      + `almost entirely dark, with rivers of violet light (#7c3aed) tracing the arterial roads through it. `
      + `Individual lights are soft points, never legible as windows. The feeling is altitude and pattern — `
      + `structure that only appears from a distance. Violet as the only chroma. No skyline silhouette across `
      + `the left third.`,
  },
  {
    id: "callcenter",
    name: "ConnectDesk Call-Center",
    accent: "#be123c",
    file: "/images/suite/login-desk.webp",
    gradient: "radial-gradient(1200px 700px at 78% 18%, #be123c33 0%, transparent 62%), radial-gradient(900px 600px at 20% 90%, #f43f5e1f 0%, transparent 60%), #0b0a10",
    mood: "Warm, alive, connected. Voices moving through the dark.",
    prompt:
      `${HOUSE_STYLE} Subject: dense bundles of fibre-optic cable curving through darkness, each strand ending `
      + `in a pinpoint of crimson-rose light (#be123c), the bundles braiding together toward the right of the `
      + `frame. Shallow depth of field so the near strands are sharp and the far ones dissolve. The feeling is `
      + `many separate conversations travelling the same path. Crimson as the only chroma.`,
  },
  {
    id: "hr",
    name: "PeopleHub HR",
    accent: "#6d28d9",
    file: "/images/suite/login-people.webp",
    gradient: "radial-gradient(1200px 700px at 78% 18%, #6d28d933 0%, transparent 62%), radial-gradient(900px 600px at 20% 90%, #8b5cf61f 0%, transparent 60%), #0b0a10",
    mood: "Ordered, individual, collective. Many separate things, arranged.",
    // ── REGENERATE THIS ONE ──────────────────────────────────────────────────
    // The plate on disk is the weakest of the six and measurably so: 1.1%
    // saturated pixels against 17–28% for the good ones, at 1344x768 — the
    // lowest resolution in the set. It renders as a black rectangle with four
    // flat purple bars pasted on, which is what "most dark, some glowing"
    // produced when the generator took "most dark" literally.
    //
    // The prompt below is rewritten for that failure specifically: the wall is
    // now shot straight-on-ish with real falloff, MANY compartments are lit
    // rather than four, and the light is described as spilling OUT of them onto
    // the surrounding wood — which is what gives a grid its depth. `npm run
    // art:check` scores the result.
    prompt:
      `${HOUSE_STYLE} Subject: a tall wall of identical dark oak pigeonhole compartments filling the right two `
      + `thirds of the frame and receding into shadow toward the left. Roughly a third of the compartments glow `
      + `from within with warm violet light (#6d28d9), the light spilling out over the wood lip of each one and `
      + `pooling on the floor below, so the grid reads as depth rather than as flat squares. The lit ones are `
      + `scattered irregularly, never in a row or a pattern. Rich violet chroma throughout the lit region — this `
      + `must NOT be a near-black image with a few bright rectangles. Shallow depth of field, sharp at the centre `
      + `of the wall and dissolving at both edges. The feeling is a roster: many individuals, the same shape, each `
      + `its own space, most of them occupied. Violet as the only chroma. No papers, labels or objects legible `
      + `inside the compartments.`,
  },
  {
    id: "accounting",
    name: "Ledgerly Accounting",
    accent: "#0f766e",
    file: "/images/suite/login-books.webp",
    gradient: "radial-gradient(1200px 700px at 78% 18%, #0f766e33 0%, transparent 62%), radial-gradient(900px 600px at 20% 90%, #14b8a61f 0%, transparent 60%), #0b0a10",
    mood: "Exact, balanced, quiet. The truth about the money.",
    // ── REGENERATE THIS ONE ──────────────────────────────────────────────────
    // The plate on disk is a beautiful photograph of the WRONG COLOUR. Its
    // dominant hue measures 35° — gold — against Ledgerly's 175° green-teal, a
    // miss of 140°, the largest in the set by an order of magnitude.
    //
    // The cause is one word. "Antique brass" is a colour instruction as much as
    // a material one, and every generator weights it far above a rim-light
    // qualifier that arrives eleven words later. So the material is now dark
    // blackened steel, the brass is named as something to AVOID, and the teal is
    // stated first and repeated.
    //
    // This matters beyond taste: the accent is a colour CODE. It is the same
    // teal Ledgerly wears in its sidebar, its launcher tile and its header rule,
    // and a gold front door teaches the wrong one at the exact moment somebody
    // is learning the suite. `npm run art:check` scores the result.
    prompt:
      `${HOUSE_STYLE} Subject: a balance scale of dark blackened steel standing in near-darkness, both pans `
      + `empty and perfectly level. Deep green-teal light (#0f766e) rims the beam, the chains and the upper edge `
      + `of both pans, and a soft teal pool of the same colour spreads on the surface beneath it. The metal is `
      + `MATTE DARK GREY-BLACK, not brass, not gold, not bronze, not copper — there must be no warm yellow or `
      + `amber anywhere in the frame. Background falls away entirely to black. Macro-sharp on the pivot, soft `
      + `everywhere else. The feeling is exactness and equilibrium — two sides that agree. Green-teal as the `
      + `only chroma in the image. The scale sits in the right third.`,
  },
];

export const artworkFor = (id: string): Artwork | null => ARTWORK.find((a) => a.id === id) ?? null;

/** Where the files go, relative to the repo root. */
export const ARTWORK_DIR = "public/images/suite/";
