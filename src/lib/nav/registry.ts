// ─────────────────────────────────────────────────────────────────────────────
// The navigation registry — the single source of truth for the console menu.
//
// Modeled on ServiceSuite's RightsModules → Rights tree, but kept in CODE, not a
// table: a menu item exists exactly when the screen behind it exists, and a PR
// that adds a screen adds its menu item in the same diff. What IS dynamic is who
// sees what: `navFor(rights, features)` filters this tree per request through
// the caller's role rights (src/lib/rbac) and the org's plan entitlements, so
// two staff of the same lender — or two lenders on different packages — get
// different sidebars from the same registry.
//
// Everything here is serializable (icons are lucide names, resolved to
// components client-side) so a server layout can hand the filtered tree to the
// client shell directly.
// ─────────────────────────────────────────────────────────────────────────────
import type { Feature } from "@/lib/billing/plans";
import type { Right } from "@/lib/rbac/rights";
import { ASSISTANT_NAME } from "@/lib/riri/brand";
import { isDenied } from "@/lib/rbac/module-keys";

export type NavItem = {
  key: string;
  label: string;
  /** Route target. Query-string deep links land on existing screens' filters. */
  href?: string;
  /** Opens the Riri dock instead of navigating (data-riri-open value). */
  open?: "support" | "analyst" | "copilot" | "max";
  icon: string; // lucide icon name — mapped to a component in the client shell
  /** Right that admits the caller. Absent ⇒ visible to every signed-in staff. */
  right?: Right;
  /** Any-of rights: the item shows if the caller holds AT LEAST ONE — used for
   *  per-report access, where the umbrella `reports.view` OR a specific report right
   *  both admit. When both `right` and `anyRight` are set, both must pass. */
  anyRight?: Right[];
  /** Plan feature that must be entitled. Absent ⇒ every plan. */
  feature?: Feature;
  /** false ⇒ rendered as "coming up", not clickable. */
  ready?: boolean;
  /** Match the active state on the exact href (incl. query) instead of prefix. */
  exact?: boolean;
  /**
   * THIS ITEM OPENS A SCREEN IN ANOTHER SYSTEM. The id of a suite app
   * (lib/suite/apps.ts); `href` is then the path INSIDE that system, and the
   * server layout resolves the pair to that system's real origin through
   * deepLinkFor().
   *
   * The field exists because two doors that look identical in a menu are not
   * the same door. Opening ConnectDesk from the LAUNCHER is arriving at a
   * system: it lands on that system's front door, which introduces itself and
   * offers to continue as you. Opening "Recoveries" from THIS sidebar is not
   * arriving anywhere — it is following one thread of work into the screen that
   * holds the rest of it, and a sign-in page in the middle of that is the
   * product forgetting what was just clicked.
   *
   * Entitlement rides along: navFor() drops a cross-system item when the lender
   * has not bought that system, so the console never advertises a door onto a
   * system they do not have.
   */
  system?: string;
};

export type NavModule = {
  key: string;
  label: string;
  icon: string;
  items: NavItem[];
};

export const NAV_REGISTRY: NavModule[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    icon: "LayoutDashboard",
    items: [{ key: "overview", label: "Overview", href: "/console", icon: "Gauge", exact: true }],
  },
  {
    key: "borrowers",
    label: "Borrowers",
    icon: "Users",
    items: [
      { key: "borrowers-list", label: "Borrowers List", href: "/console/borrowers", icon: "Users", right: "borrowers.view" },
      { key: "borrowers-new", label: "New Borrower", href: "/console/borrowers/new", icon: "UserPlus", right: "borrowers.create" },
      // The gate between a registered customer and their money. Sits under Borrowers
      // because that is where the officer who created the problem will look for it.
      { key: "kyc-queue", label: "KYC Verification", href: "/console/kyc", icon: "ShieldCheck", right: "borrowers.view" },
      // The step AFTER the identity gate: a verified customer's statement becomes a
      // score. It lives here — not under Intelligence — because it is the next thing
      // the onboarding officer does, in order.
      { key: "crunch", label: "Statement Cruncher", href: "/console/crunch", icon: "Calculator", right: "loans.apply", feature: "statement-cruncher" },
      // ── AND WHAT THE CUSTOMER SEES ──────────────────────────────────────
      // Last in the module, because it is the far side of everything above it:
      // the same person, the same loan, rendered in the lender's brand on their
      // own phone. An officer taking a call about "the app" has been guessing at
      // this screen from a description; now they open it.
      //
      // The one cross-link that genuinely leaves the building in every
      // environment — the borrower app is its own deployment on its own host
      // (BORROWER_PORTAL_HOST), not a route we could fall back to.
      { key: "customer-portal", label: "Customer Portal", href: "/", system: "portal", icon: "Smartphone", right: "borrowers.view" },
    ],
  },
  {
    key: "loans",
    label: "Loans",
    icon: "FileText",
    items: [
      { key: "applications", label: "Applications Queue", href: "/console/applications", icon: "FileText", right: "applications.view" },
      // The same applications as a value-weighted funnel board — a lens, not a
      // second source of truth.
      { key: "pipeline", label: "Pipeline", href: "/console/pipeline", icon: "Waypoints", right: "applications.view" },
      { key: "loans-list", label: "Loans List", href: "/console/loans", icon: "Landmark", right: "loans.view" },
      // The people standing behind the money — invited from an application that
      // requires a guarantor, tracked to signature.
      { key: "sureties", label: "Sureties", href: "/console/sureties", icon: "Handshake", right: "applications.view" },
      { key: "loans-apply", label: "Apply for a Borrower", href: "/console/applications/new", icon: "FilePlus2", right: "loans.apply" },
    ],
  },
  {
    key: "payments",
    label: "Payments",
    icon: "Banknote",
    items: [
      // Float lives on the disbursements screen (balance card + top-up); it gets
      // its own screen when treasury grows beyond one ledger.
      { key: "disbursements", label: "Disbursements & Float", href: "/console/disbursements", icon: "Banknote", right: "disbursements.view" },
      { key: "repayments", label: "Repayments", href: "/console/repayments", icon: "HandCoins", right: "repayments.view" },
      // Two tabs, two books: our exceptions queue, and the lender's own parking
      // bay of payments that arrived with a reference nobody could match.
      { key: "reconciliation", label: "Reconciliation", href: "/console/reconciliation", icon: "Scale", right: "reconciliation.view", exact: true },
      { key: "reconciliation-suspended", label: "Suspended Payments", href: "/console/reconciliation?tab=suspended", icon: "Banknote", right: "reconciliation.view", exact: true },
      // ── THE OTHER SIDE OF EVERY PAYMENT ─────────────────────────────────
      // Every disbursement and every fee on the screens above is already a
      // double-entry posting in the lender's journal — that is what Ledgerly
      // reads. The accountant asking "did that payout actually book?" and the
      // officer who made it have been answering the same question in two
      // systems neither of them had both windows for.
      { key: "books-journal", label: "Journal", href: "/books/journal", system: "accounting", icon: "ScrollText", right: "reconciliation.view" },
    ],
  },
  {
    key: "collections",
    label: "Collections",
    icon: "PhoneCall",
    items: [
      { key: "collections-queue", label: "Work Queue", href: "/console/collections", icon: "PhoneCall", right: "collections.view", exact: true },
      { key: "collections-ptp", label: "Promises to Pay", href: "/console/collections?tab=ptp", icon: "CalendarClock", right: "collections.view", exact: true },
      { key: "collections-tickets", label: "Tickets", href: "/console/collections?tab=tickets", icon: "Ticket", right: "collections.view", exact: true },
      // ── WHAT THE FLOOR ACTUALLY BROUGHT IN ──────────────────────────────
      // The three screens above are the work; this is the result of it, and it
      // lives in ConnectDesk because that is where the calls were made and the
      // money is attributed to the agent who earned it. A collections manager
      // reading a work queue with no view of recoveries is reading effort with
      // no view of outcome.
      { key: "desk-recoveries", label: "Recoveries", href: "/desk/recoveries", system: "callcenter", icon: "Coins", right: "collections.view" },
    ],
  },
  {
    key: "intelligence",
    label: "Intelligence",
    icon: "BrainCircuit",
    items: [
      // FIRST, and on every plan. This is the screen that explains why the rest of
      // the module exists: what the platform is learning from this lender's own
      // book, and how far it is from deciding with a model fitted on it. A lender
      // who cannot see that has no reason to keep feeding the loop.
      { key: "closed-loop", label: "Closed ML Loop", href: "/console/intelligence/loop", icon: "Infinity", right: "intelligence.view" },
      { key: "early-warning", label: "Early Warning", href: "/console/intelligence", icon: "Gauge", right: "intelligence.view", feature: "portfolio-scan", exact: true },
      { key: "scoring", label: "Credit Scoring", href: "/console/intelligence/scoring", icon: "Target", right: "intelligence.view", feature: "portfolio-scan" },
      // ANALYTICS STUDIO IS NO LONGER HERE. It was promoted out of this menu and
      // into the connected suite as its own system (/analytics, and
      // analytics.birgenai.com in production) — see src/lib/suite/apps.ts. The
      // entry that remains is a DOOR, not the screen: the people who need the
      // studio most are a GM or a board member, and burying the only view of the
      // whole book four levels inside a loan-officer tool is why nobody senior
      // ever opened it. The old route still resolves and redirects, so existing
      // links and bookmarks keep working.
      // Declared `system` like every other cross-link now, rather than an in-app
      // path with an arrow typed into its label. Two consequences: the studio's
      // own origin is honoured the moment it federates, and the arrow is DRAWN
      // by the sidebar for every door instead of being remembered per entry.
      { key: "analytics", label: "Analytics & Reporting", href: "/analytics", system: "analytics", icon: "ChartNoAxesCombined", anyRight: ["reports.view", "reports.analytics"] },
      { key: "model-tuning", label: "Model Tuning", href: "/console/intelligence/tuning", icon: "SlidersHorizontal", right: "intelligence.tune", feature: "model-tuning" },
      { key: "metrics", label: "Metric Catalogue", href: "/console/intelligence/metrics", icon: "Ruler", right: "metrics.view", feature: "riri" },
      { key: "documents", label: "Document Parser", href: "/console/documents", icon: "ScanLine", right: "documents.view", feature: "document-parser" },
      // ── REPORTING MOVED OUT OF THE CONSOLE ─────────────────────────────────
      // There used to be three entries here — Report Builder, Reports and Income
      // Statement — and between them they were the whole reporting story, told
      // three times in three shapes. Worse, two of them read POSTGRES, which for
      // a bridged lender is a 199-loan shadow of a 275,605-loan book.
      //
      // They are one system now, at /analytics/reports, where a report is
      // scoped to the book you are standing in, read on screen before it is
      // downloaded, and exported with its provenance attached. The old routes
      // redirect, so bookmarks and old links still land somewhere true.
      { key: "reports", label: "Reports", href: "/analytics/reports", system: "analytics", icon: "FileBarChart", anyRight: ["reports.view", "reports.portfolio"] },
      { key: "report-builder", label: "Report Builder", href: "/console/intelligence/reports", icon: "FilePlus2", anyRight: ["reports.view", "reports.builder"], feature: "riri" },
    ],
  },
  {
    // ── THE INTERCHANGE ───────────────────────────────────────────────────────
    //
    // Its own section, and deliberately not a line inside Intelligence: every
    // other entry in this registry reads THIS lender's book, and this one reads
    // what the rest of the market knows. That is a different kind of answer and
    // it should not be filed as if it were another of our own reports.
    //
    // It is also the only module in the console where every item is a door out.
    // The Interchange is a separate deployment with a separate database that
    // authenticates members by Ed25519 node certificate, so a BirgenAI ID means
    // nothing to it — these links land on the exchange's own member gate rather
    // than carrying a session, and that is correct rather than a shortfall. What
    // the deep link still buys is the SCREEN: an officer who wants an exposure
    // check arrives at the exposure check.
    key: "interchange",
    label: "The Interchange",
    icon: "Waypoints",
    items: [
      // First, because it is the question the console cannot answer on its own:
      // what does this borrower already owe everybody else?
      { key: "ix-exposure", label: "Exposure Check", href: "/exposure", system: "interchange", icon: "Scale", right: "borrowers.view" },
      { key: "ix-consent", label: "Consent Register", href: "/consent", system: "interchange", icon: "FileLock2", right: "compliance.view" },
      // Gated like the other two rather than left open. Who else is on the
      // exchange is not a public fact about the market — it is the shape of a
      // lender's counterparties, and a person with no rights at all in this
      // console has no business reading it.
      { key: "ix-directory", label: "Member Directory", href: "/directory", system: "interchange", icon: "Building2", right: "borrowers.view" },
    ],
  },
  {
    key: "field",
    label: "Field Ops",
    icon: "MapPin",
    items: [
      { key: "field-visits", label: "Visits & Routes", href: "/console/field", icon: "MapPin", right: "field.view", feature: "route-planner" },
      // The officer's own radius: where am I, where is my book, who is closest.
      { key: "field-nearby", label: "Customers Near Me", href: "/console/field/nearby", icon: "Navigation", right: "field.view", feature: "route-planner" },
      // The worklist: customers with no pin — invisible to routes, blocked from
      // disbursement — waiting to have their location captured.
      { key: "field-needs-location", label: "Needs Location", href: "/console/field/needs-location", icon: "MapPinOff", right: "field.view", feature: "route-planner" },
      // Dispatch requests land here — the nearest agent says yes and gets a route.
      { key: "field-dispatch", label: "Dispatch Inbox", href: "/console/field/dispatch", icon: "Send", right: "field.view", feature: "route-planner" },
      // Real Nairobi streets: pick a start and a customer, get the route + fare.
      { key: "field-map", label: "Route Map", href: "/console/field/map", icon: "Map", right: "field.view", feature: "route-planner" },
    ],
  },
  {
    key: "comms",
    label: "Comms",
    icon: "MessageSquare",
    items: [
      { key: "sms-campaigns", label: "SMS Campaigns", href: "/console/comms", icon: "MessageSquare", right: "sms.view", exact: true },
      { key: "sms-templates", label: "Message Templates", href: "/console/comms?tab=templates", icon: "FileText", right: "sms.view", exact: true },
      { key: "email-log", label: "Email Log", href: "/console/comms?tab=email", icon: "Mail", right: "sms.view", exact: true },
    ],
  },
  {
    key: "organization",
    label: "Organization",
    icon: "Building2",
    items: [
      // The structure comes first: a lender's offices are the thing everything else —
      // staff, borrowers, loans, and who may see them — is hung off.
      { key: "branches", label: "Structure", href: "/console/branches", icon: "Building2", right: "branches.view" },
      { key: "products", label: "Products", href: "/console/products", icon: "Package", right: "products.view" },
      { key: "charges", label: "Charges", href: "/console/charges", icon: "Coins", right: "products.view" },
      { key: "workflows", label: "Workflows", href: "/console/workflows", icon: "GitBranch", right: "workflows.view" },
      { key: "branding", label: "Branding", href: "/console/settings/branding", icon: "Palette", right: "branding.manage" },
      { key: "settings", label: "Settings & Vault", href: "/console/settings", icon: "Settings2", right: "settings.view", exact: true },
      // Which of Metropol's fourteen reports this lender buys, and what that
      // costs. Its own entry rather than a tab inside the vault because it is a
      // COMMERCIAL decision — the person who signs off bureau spend is rarely the
      // person who pastes in an API key.
      { key: "crb-scrutiny", label: "Bureau Scrutiny", href: "/console/settings/crb", icon: "ShieldCheck", right: "settings.view", feature: "crb" },
      // Every plan. A lender on the smallest package still answers to the ODPC, and
      // a data-protection duty is not a feature we may sell them back.
      { key: "compliance", label: "Compliance & Data", href: "/console/compliance", icon: "FileLock2", right: "compliance.view" },
      // The immutable activity trail — who did what, from where. Same right as
      // compliance: whoever answers to the regulator reads the record.
      { key: "oversight", label: "Oversight", href: "/console/oversight", icon: "ScrollText", right: "compliance.view" },
    ],
  },
  {
    key: "access",
    label: "Access",
    icon: "KeyRound",
    items: [
      { key: "team", label: "Team", href: "/console/team", icon: "Users", right: "team.view" },
      { key: "roles", label: "Roles & Rights", href: "/console/roles", icon: "KeyRound", right: "roles.view" },
      // ── THE SAME PEOPLE, WHERE THEY ARE ACTUALLY KEPT ───────────────────
      // Team is who may sign in HERE. These two are who those people ARE: the
      // relationship officer's book and branch live in PeopleHub, and the
      // collections agent's seat and recovery record live on the ConnectDesk
      // floor. Neither belongs in an access screen — but the manager standing
      // in one, asking "who is this and what do they carry", is now one click
      // from the answer instead of one system away from it.
      { key: "people-officers", label: "Relationship Officers", href: "/people/officers", system: "hr", icon: "UserCheck", right: "team.view" },
      { key: "desk-agents", label: "Agents", href: "/desk/agents", system: "callcenter", icon: "Headphones", right: "team.view" },
    ],
  },
  {
    key: "billing",
    label: "Billing",
    icon: "Crown",
    items: [
      { key: "billing", label: "Package & Usage", href: "/console/billing", icon: "Crown", right: "billing.view" },
    ],
  },
  {
    // The connected-suite launcher — one BirgenAI ID across Lending, HR, Accounting
    // and the Call-Center. No right: every signed-in staffer can reach their systems.
    key: "suite",
    label: "Connected Suite",
    icon: "KeyRound",
    items: [
      { key: "suite-sso", label: "BirgenAI ID / SSO", href: "/suite", icon: "KeyRound" },
    ],
  },
  {
    key: "riri",
    label: ASSISTANT_NAME,
    icon: "Bot",
    items: [
      // TWO DOORS, ONE ASSISTANT. Both of these open the same conversation — there
      // is no longer a model to pick, and the router chooses the engine from the
      // question (src/lib/riri/router.ts). What they still express, correctly, is
      // the BILLING boundary: help is free and ungated, because a lender on the 10k
      // package who cannot get help is a lender who churns, while reading the live
      // book is the thing that is sold. The `open` values are legacy model ids kept
      // so old markup keeps resolving; the OS accepts and ignores them.
      { key: "riri-support", label: "Help & How-to", open: "support", icon: "LifeBuoy" },
      { key: "riri", label: `Ask ${ASSISTANT_NAME}`, open: "analyst", icon: "Bot", right: "riri.use", feature: "riri" },
    ],
  },
];

/**
 * The per-caller sidebar: registry ∩ role rights ∩ plan features. Pure — the
 * offline test suite drives it with synthetic sets.
 */
export function navFor(
  rights: ReadonlySet<string>,
  features: ReadonlySet<string>,
  /** Modules this person was individually told not to see. See lib/rbac/modules. */
  denied: ReadonlySet<string> = EMPTY,
  /**
   * The suite systems this caller may actually reach — `visibleSystemIds()`,
   * which is the org's entitlements minus what this person was denied.
   *
   * Cross-system items are dropped when their system is not in here. Omitting
   * the argument admits every cross-link, which is what the offline test suite
   * and the role editor want: they are asking what the registry CONTAINS, not
   * what one lender bought.
   */
  systems?: ReadonlySet<string>,
): NavModule[] {
  return NAV_REGISTRY.filter((mod) => !isDenied(denied, "lms", mod.key))
    .map((mod) => ({
      ...mod,
      items: mod.items.filter(
        (item) =>
          (!item.right || rights.has(item.right)) &&
          (!item.anyRight || item.anyRight.some((r) => rights.has(r))) &&
          (!item.feature || features.has(item.feature)) &&
          // A door onto a system this lender never bought is worse than no door:
          // it advertises, then 403s. Hiding it is the commercial answer AND the
          // honest one.
          (!item.system || !systems || systems.has(item.system)),
      ),
    }))
    .filter((mod) => mod.items.length > 0);
}

const EMPTY: ReadonlySet<string> = new Set();

/** Right needed to follow a nav item, looked up by key (used by tests + role editor). */
export function navItemByKey(key: string): NavItem | undefined {
  for (const mod of NAV_REGISTRY) {
    const item = mod.items.find((i) => i.key === key);
    if (item) return item;
  }
  return undefined;
}
