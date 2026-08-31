// ─────────────────────────────────────────────────────────────────────────────
// PEOPLEHUB AND LEDGERLY — their identities and their navigation.
//
// Both render the shared SuiteShell, so all that is declared here is what
// differs: a name, an accent, a strap, and a menu. Everything else — the rail,
// the collapse, the drawer, the identity pill, the lender's mark in the corner
// — comes from the same component ConnectDesk and the Analytics & Reporting use.
//
// That is the whole point of having built SuiteShell: adding the fifth and sixth
// systems to the suite is a nav tree and a page, not a chrome.
// ─────────────────────────────────────────────────────────────────────────────

import type { Right } from "@/lib/rbac/rights";
import type { SuiteNavModule } from "@/components/suite/SuiteShell";
import { isDenied } from "@/lib/rbac/modules";

export const PEOPLE_IDENTITY = {
  id: "hr",
  name: "PeopleHub",
  accent: "#6d28d9",
  accent2: "#a78bfa",
  strap: "the roster behind the book",
  // A directory of names and a branch tree. Stretching either to 1560px only
  // makes the eye travel further between a person and the number beside them.
  canvas: "standard",
} as const;

export const ANALYTICS_IDENTITY = {
  id: "analytics",
  name: "Analytics & Reporting",
  accent: "#7c3aed",
  accent2: "#a855f7",
  strap: "reading the live book",
  // Twelve-column reports and a pivot explorer. The one system most often read
  // on a large screen, or thrown at a projector.
  canvas: "wide",
} as const;

export const BOOKS_IDENTITY = {
  id: "accounting",
  name: "Ledgerly",
  accent: "#0f766e",
  accent2: "#2dd4bf",
  strap: "reading the journal, live",
  // The journal is a wide table with both sides of every posting named.
  canvas: "wide",
} as const;

type Item = SuiteNavModule["items"][number] & { right?: Right };
type Module = Omit<SuiteNavModule, "items"> & { items: Item[] };

export const PEOPLE_NAV: Module[] = [
  {
    key: "roster", label: "The roster", icon: "Users",
    items: [
      { key: "home", label: "Directory", href: "/people", icon: "Users", blurb: "Every person on the book, from the systems that already know them.", exact: true },
      { key: "officers", label: "Relationship officers", href: "/people/officers", icon: "UserCheck", blurb: "Who carries which borrowers, and how that book is performing." },
    ],
  },
  {
    key: "structure", label: "Structure", icon: "Building2",
    items: [
      { key: "branches", label: "Branches", href: "/people/branches", icon: "Building", blurb: "The org tree, with the staff and the book at each node." },
    ],
  },
];

export const BOOKS_NAV: Module[] = [
  {
    key: "books", label: "The books", icon: "Calculator",
    items: [
      { key: "home", label: "Movement", href: "/books", icon: "Gauge", blurb: "What moved through the accounts, over a window you choose.", exact: true },
      { key: "journal", label: "Journal", href: "/books/journal", icon: "ScrollText", blurb: "Every posting, newest first, with both sides named." },
    ],
  },
  {
    key: "cash", label: "Cash", icon: "Coins",
    items: [
      { key: "flows", label: "In and out", href: "/books/flows", icon: "ArrowLeftRight", blurb: "Disbursement against collection, day by day." },
    ],
  },
];

export function satelliteNavFor(
  nav: Module[],
  rights: ReadonlySet<string>,
  /** "hr" or "accounting" — which system's deny keys apply to this tree. */
  systemId?: string,
  denied: ReadonlySet<string> = new Set(),
): SuiteNavModule[] {
  return nav
    .filter((m) => !systemId || !isDenied(denied, systemId, m.key))
    .map((m) => ({
      key: m.key, label: m.label, icon: m.icon,
      items: m.items.filter((i) => !i.right || rights.has(i.right)),
    }))
    .filter((m) => m.items.length > 0);
}
