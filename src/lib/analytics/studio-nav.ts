// ─────────────────────────────────────────────────────────────────────────────
// THE STUDIO'S OWN NAVIGATION.
//
// Analytics is a SYSTEM now, not a page inside the console, so it gets its own
// menu — same discipline as the console's registry (src/lib/nav/registry.ts):
// serializable, rights-filtered server-side, an entry exists exactly when the
// screen behind it exists.
//
// The modules are ordered the way a lender actually reads a business, which is
// not the order the data model is in:
//
//   1. THE BOOK        what we are owed and whether it is coming back
//   2. THE PEOPLE      who is lending it and who is borrowing it
//   3. THE MACHINE     the funnel, the products, the collections engine
//   4. THE QUESTIONS   the pivot, for everything the first three do not cover
//
// Every module is a PRESET over the same cube (src/lib/analytics/cube.ts). None
// of them can answer something the Explorer cannot; they exist because a named
// screen that opens on the right question beats a blank pivot every time.
// ─────────────────────────────────────────────────────────────────────────────
import type { Right } from "@/lib/rbac/rights";

export type StudioItem = {
  key: string;
  label: string;
  href: string;
  icon: string; // lucide name, resolved client-side
  /** One line under the label in the wide sidebar — what this screen answers. */
  blurb: string;
  right?: Right;
  anyRight?: Right[];
  /** Bridged lenders only (reads the group server directly). */
  bridgedOnly?: boolean;
  ready?: boolean;
  exact?: boolean;
};

export type StudioModule = {
  key: string;
  label: string;
  icon: string;
  items: StudioItem[];
};

export const STUDIO_NAV: StudioModule[] = [
  {
    key: "overview",
    label: "Overview",
    icon: "LayoutDashboard",
    items: [
      {
        key: "home",
        label: "The board view",
        href: "/analytics",
        icon: "Gauge",
        blurb: "Everything on one screen, in the order a board asks for it.",
        exact: true,
      },
      {
        key: "group",
        label: "Group roll-up",
        href: "/analytics/group",
        icon: "Building2",
        blurb: "Every entity you run, side by side. Nowhere else shows this.",
        bridgedOnly: true,
      },
    ],
  },
  {
    key: "book",
    label: "The book",
    icon: "Landmark",
    items: [
      { key: "portfolio", label: "Portfolio", href: "/analytics/portfolio", icon: "Landmark", blurb: "Outstanding, growth, composition and concentration." },
      { key: "risk", label: "Risk & arrears", href: "/analytics/risk", icon: "TriangleAlert", blurb: "PAR, ageing, and where the book is going wrong first." },
      { key: "collections", label: "Collections", href: "/analytics/collections", icon: "HandCoins", blurb: "What fell due, what came in, and who chased it." },
      { key: "cashflow", label: "Cash flow", href: "/analytics/cashflow", icon: "ArrowLeftRight", blurb: "Money out against money in, week by week." },
    ],
  },
  {
    key: "people",
    label: "The people",
    icon: "Users",
    items: [
      { key: "agents", label: "Officers", href: "/analytics/agents", icon: "UserCheck", blurb: "Ranked by whichever definition of \"best\" you choose." },
      { key: "branches", label: "Branches", href: "/analytics/branches", icon: "Building", blurb: "Office against office, on any measure." },
      { key: "regions", label: "Regions", href: "/analytics/regions", icon: "Map", blurb: "The tree rolled up, and the geography behind it." },
      { key: "borrowers", label: "Borrowers", href: "/analytics/borrowers", icon: "Users", blurb: "Who your customers are — age, gender, score, tenure." },
      { key: "cohorts", label: "Cohorts", href: "/analytics/cohorts", icon: "Layers3", blurb: "Whether the customers you took on last quarter behave like the ones before." },
    ],
  },
  {
    key: "machine",
    label: "The machine",
    icon: "Cog",
    items: [
      { key: "funnel", label: "Origination funnel", href: "/analytics/funnel", icon: "Filter", blurb: "Application to disbursement, and where it leaks." },
      { key: "products", label: "Products", href: "/analytics/products", icon: "Package", blurb: "Which shelf sells, and which one comes back bad." },
      { key: "channels", label: "Channels", href: "/analytics/channels", icon: "Radio", blurb: "Portal, console, field and USSD, compared." },
    ],
  },
  {
    key: "explore",
    label: "Explore",
    icon: "Compass",
    items: [
      {
        key: "explorer",
        label: "Pivot explorer",
        href: "/analytics/explorer",
        icon: "Table2",
        blurb: "Any measure, by any dimension, as any chart. The whole cube, unlocked.",
      },
      {
        key: "saved",
        label: "Saved views",
        href: "/analytics/saved",
        icon: "Bookmark",
        blurb: "Your own questions, kept.",
        ready: false,
      },
    ],
  },
];

/** Filter the studio menu for one caller. Mirrors navFor() in the console registry. */
export function studioNavFor(rights: ReadonlySet<string>, opts: { bridged: boolean }): StudioModule[] {
  return STUDIO_NAV.map((mod) => ({
    ...mod,
    items: mod.items.filter((item) => {
      if (item.bridgedOnly && !opts.bridged) return false;
      if (item.right && !rights.has(item.right)) return false;
      if (item.anyRight && !item.anyRight.some((r) => rights.has(r))) return false;
      return true;
    }),
  })).filter((mod) => mod.items.length > 0);
}

/** Flat lookup — used to title a page from its own nav entry, so the two never drift. */
export function studioItem(href: string): StudioItem | undefined {
  for (const mod of STUDIO_NAV) {
    const hit = mod.items.find((i) => i.href === href);
    if (hit) return hit;
  }
  return undefined;
}
