// ─────────────────────────────────────────────────────────────────────────────
// Per-lender branding for the lms borrower portals (lms/micromart/axe.birgenai.com).
//
// Each lender gets its own logo, accent colour, hero image + tagline so the
// subdomain feels like the lender's own product (white-label), while staying
// "Powered by BirgenAI". Accents are applied via a single CSS variable (--brand)
// so we don't need runtime-dynamic Tailwind classes.
//
// ASSETS (founder to supply — save under public/lenders/<slug>/):
//   logo.png   (square, transparent ~512px)   hero.jpg (wide ~1600×900, optional)
// Colours below are PLACEHOLDERS until each lender confirms brand hex.
// ─────────────────────────────────────────────────────────────────────────────

export type LenderBrand = {
  slug: string;
  name: string;
  logo: string;
  /** wide hero image for the branded landing (optional). */
  hero: string | null;
  /** primary accent (hex) — drives --brand. */
  accent: string;
  /** translucent accent for soft fills (rgba/hex8). */
  accentSoft: string;
  /** optional second gradient stop (logo-derived for DB-branded orgs). */
  accent2?: string | null;
  /** hero headline shown on the lender-scoped landing. */
  tagline: string;
  /** one-line product blurb (chooser + header). */
  blurb: string;
  /** fallback logo if the per-lender asset is missing. */
  fallbackLogo: string;
  /** logo render size relative to its slot, percent (50–200). Padded marks need >100. */
  logoScale?: number;
};

// NOTE: micromart/axe accents are placeholders — confirm with each lender.
export const LENDER_BRANDS: Record<string, LenderBrand> = {
  micromart: {
    slug: "micromart",
    name: "Micromart Africa",
    logo: "/lenders/micromart/logo.png",
    hero: "/lenders/micromart/hero.jpg",
    // Founder direction (Jul 2026): dark brown, NOT the yellow the logo derives to.
    accent: "#78350f",
    accentSoft: "rgba(120,53,15,0.12)",
    accent2: "#451a03",
    tagline: "Grow your business with credit you've earned.",
    blurb: "Business, school-fees & personal loans",
    fallbackLogo: "/images/MicromartLogo.png",
    // The Micromart mark carries generous transparent padding — render it larger.
    logoScale: 150,
  },
  axe: {
    slug: "axe",
    name: "Axe Capital",
    logo: "/lenders/axe/logo.png",
    hero: "/lenders/axe/hero.jpg",
    accent: "#3B82F6", // blue — PLACEHOLDER
    accentSoft: "rgba(59,130,246,0.12)",
    tagline: "Fast, fair credit for traders and earners.",
    blurb: "Quick personal credit & trader advances",
    fallbackLogo: "/images/AxeLogo.png",
  },
  mular: {
    // Mular Credit Ltd — NATIVE org (own Postgres book). Brand hex mirror the DB
    // (accent #003c71 navy, accent2 #50951d green) so the static paint matches
    // what /api/lms/brand later confirms — zero flicker on mular.birgenai.com.
    slug: "mular",
    name: "Mular Credit Ltd",
    logo: "/lenders/mular/logo.png",
    hero: "/lenders/mular/hero.jpg",
    accent: "#003c71", // navy
    accentSoft: "rgba(0,60,113,0.12)",
    accent2: "#50951d", // green
    tagline: "Fueling Ambitions, Building futures",
    blurb: "Trusted by Thousands of People & Businesses",
    fallbackLogo: "/lenders/mular/logo.png",
  },
  buysimu: {
    // Device financing — get a phone (e.g. iPhone) on credit, repay weekly/monthly.
    // Red brand per founder direction (DB stores black; we override to red).
    slug: "buysimu",
    name: "Buy Simu",
    logo: "/lenders/buysimu/logo.png",
    hero: "/lenders/buysimu/hero.jpg",
    accent: "#E11D48", // red
    accentSoft: "rgba(225,29,72,0.12)",
    tagline: "Get the phone you want now — pay in easy instalments.",
    blurb: "Buy a phone on credit · iPhone & more",
    fallbackLogo: "/lenders/buysimu/logo.png",
  },
};

// Generic BirgenAI brand for the un-scoped lms.birgenai.com chooser.
export const DEFAULT_BRAND: LenderBrand = {
  slug: "birgenai",
  name: "BirgenAI Loans",
  logo: "/images/BirgenAI-logo.png",
  hero: null,
  accent: "#F97316",
  accentSoft: "rgba(249,115,22,0.12)",
  tagline: "Credit that understands your cashflow.",
  blurb: "Compare licensed lenders in one place",
  fallbackLogo: "/images/BirgenAI-logo.png",
};

// Guided-demo brand (violet) — resolvable by getBrand("demo") but kept OUT of
// the production lender chooser (BRANDED_LENDERS below).
export const DEMO_BRAND: LenderBrand = {
  slug: "demo",
  name: "Demo Microfinance",
  logo: "/images/BirgenAI-logo.png",
  hero: null,
  accent: "#6d28d9",
  accentSoft: "rgba(109,40,217,0.12)",
  tagline: "Credit that understands your cashflow.",
  blurb: "BirgenAI guided demo lender",
  fallbackLogo: "/images/BirgenAI-logo.png",
};

export function getBrand(slug?: string | null): LenderBrand {
  if (slug === "demo") return DEMO_BRAND;
  if (slug && LENDER_BRANDS[slug]) return LENDER_BRANDS[slug];
  return DEFAULT_BRAND;
}

/** The lenders shown in the chooser (derived from the brand registry). */
export const BRANDED_LENDERS = Object.values(LENDER_BRANDS).map((b) => ({
  slug: b.slug,
  name: b.name,
  logo: b.logo,
  fallbackLogo: b.fallbackLogo,
  blurb: b.blurb,
}));
