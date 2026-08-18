// ─────────────────────────────────────────────────────────────────────────────
// MICRO EAZY — the consumer brand, in one place.
//
// NOT a `LenderBrand`. The registry in src/lib/lms/branding.ts answers "whose
// subdomain am I on?" for a LENDER's white-label portal. Micro Eazy is the other
// thing entirely: BirgenAI's own consumer product, one installed app, whose
// chrome repaints to whichever lender the Exchange awarded the customer
// (blueprint D1). The lender is a variable inside this brand; it is not the brand.
//
// THE COLOURS ARE MEASURED, NOT PICKED. Every hex below came out of
// public/brand/micro-eazy/logo-transparent.png through the repo's own
// extractPalette() — navy 16.5% of the mark, mid-green 8.0%, lime 6.4%. Nobody
// eyeballed them off a screenshot, so they match the logo exactly.
//
// THE ONE CONTRAST RULE THAT SHAPES EVERY SCREEN. White on the brand green is
// 3.90:1 — it fails AA for body text and only scrapes past for large text. So
// green is never a bed for white type. On the navy ground the call-to-action is
// a LIME fill with NAVY text, which measures 6.65:1 and is, not by coincidence,
// the exact relationship the logo already draws: navy "Micro", green "Eazy".
// Where green type must sit on white, use `greenInk` (5.47:1), not `green`.
// ─────────────────────────────────────────────────────────────────────────────

export const MICRO_EAZY = {
  name: "Micro Eazy",
  /** Home-screen label. 12 chars is where Android starts truncating. */
  shortName: "Micro Eazy",
  tagline: "Quick Loans. Better Living.",
  description:
    "Apply in minutes, get a decision you can see the reasons for, and repay from your phone. Funded by licensed Kenyan lenders.",

  colors: {
    /** The mark's dominant. Ground for every immersive surface, and the status bar. */
    navy: "#012863",
    /** The deep end of the hero gradient. */
    navyDeep: "#00043a",
    /** Brand green — fills, graphics, gradients. NEVER a bed for white text. */
    green: "#25950c",
    /** The bright end. Pairs with navy text at 6.65:1 — this is the CTA. */
    lime: "#77c60b",
    /** Darkened green for green TYPE on white: 5.47:1. */
    greenInk: "#1d7a09",
    /** Splash + app shell. Matches the icon tile's own ground so install doesn't flash. */
    paper: "#ffffff",
  },

  icons: {
    any192: "/brand/micro-eazy/icon-192.png",
    any512: "/brand/micro-eazy/icon-512.png",
    maskable512: "/brand/micro-eazy/icon-maskable-512.png",
    appleTouch: "/brand/micro-eazy/apple-touch-icon.png",
    /** The full lockup, for surfaces wide enough to carry it. */
    lockup: "/brand/micro-eazy/logo-transparent.png",
  },
} as const;

/**
 * Decision D2, as a function rather than a constant.
 *
 * "Lender-of-record named on every money screen" is a regulatory position, not a
 * footer style: BirgenAI never lends, so the licensed lender must be named
 * wherever money is discussed. Passing the lender in — instead of hardcoding
 * Micromart — is what makes lender #2 a config change rather than a find-and-
 * replace through the customer app.
 */
export function coBrandLine(lenderName: string | null | undefined): string {
  return lenderName
    ? `Funded and serviced by ${lenderName} · Powered by BirgenAI`
    : "Funded and serviced by licensed Kenyan lenders · Powered by BirgenAI";
}

/** The hero's ground. Used by the install door and every full-bleed surface. */
export const HERO_GRADIENT =
  `linear-gradient(165deg, ${MICRO_EAZY.colors.navy} 0%, ${MICRO_EAZY.colors.navyDeep} 100%)`;
