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
  /** Plan feature that must be entitled. Absent ⇒ every plan. */
  feature?: Feature;
  /** false ⇒ rendered as "coming up", not clickable. */
  ready?: boolean;
  /** Match the active state on the exact href (incl. query) instead of prefix. */
  exact?: boolean;
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
    ],
  },
  {
    key: "loans",
    label: "Loans",
    icon: "FileText",
    items: [
      { key: "applications", label: "Applications Queue", href: "/console/applications", icon: "FileText", right: "applications.view" },
      { key: "loans-list", label: "Loans List", href: "/console/loans", icon: "Landmark", right: "loans.view" },
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
      { key: "reconciliation", label: "Reconciliation", href: "/console/reconciliation", icon: "Scale", right: "reconciliation.view" },
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
    ],
  },
  {
    key: "intelligence",
    label: "Intelligence",
    icon: "BrainCircuit",
    items: [
      { key: "early-warning", label: "Early Warning", href: "/console/intelligence", icon: "Gauge", right: "intelligence.view", feature: "portfolio-scan", exact: true },
      { key: "scoring", label: "Credit Scoring", href: "/console/intelligence/scoring", icon: "Target", right: "intelligence.view", feature: "portfolio-scan" },
      { key: "analytics", label: "Analytics Studio", href: "/console/intelligence/analytics", icon: "LineChart", right: "reports.view" },
      { key: "model-tuning", label: "Model Tuning", href: "/console/intelligence/tuning", icon: "SlidersHorizontal", right: "intelligence.tune", feature: "model-tuning" },
      { key: "metrics", label: "Metric Catalogue", href: "/console/intelligence/metrics", icon: "Ruler", right: "metrics.view", feature: "riri" },
      { key: "documents", label: "Document Parser", href: "/console/documents", icon: "ScanLine", right: "documents.view", feature: "document-parser" },
      { key: "report-builder", label: "Report Builder", href: "/console/intelligence/reports", icon: "FilePlus2", right: "reports.view", feature: "riri" },
      { key: "reports", label: "Reports", href: "/console/report", icon: "FileBarChart", right: "reports.view" },
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
      // Every plan. A lender on the smallest package still answers to the ODPC, and
      // a data-protection duty is not a feature we may sell them back.
      { key: "compliance", label: "Compliance & Data", href: "/console/compliance", icon: "FileLock2", right: "compliance.view" },
    ],
  },
  {
    key: "access",
    label: "Access",
    icon: "KeyRound",
    items: [
      { key: "team", label: "Team", href: "/console/team", icon: "Users", right: "team.view" },
      { key: "roles", label: "Roles & Rights", href: "/console/roles", icon: "KeyRound", right: "roles.view" },
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
    key: "riri",
    label: "Riri",
    icon: "Bot",
    items: [
      // Support is FIRST and needs no plan: a lender on the 10k package who cannot get
      // help is a lender who churns. The analytics tiers are the ones that are sold.
      { key: "riri-support", label: "Help & How-to", open: "support", icon: "LifeBuoy" },
      { key: "riri", label: "Ask Riri", open: "analyst", icon: "Bot", right: "riri.use", feature: "riri" },
    ],
  },
];

/**
 * The per-caller sidebar: registry ∩ role rights ∩ plan features. Pure — the
 * offline test suite drives it with synthetic sets.
 */
export function navFor(rights: ReadonlySet<string>, features: ReadonlySet<string>): NavModule[] {
  return NAV_REGISTRY.map((mod) => ({
    ...mod,
    items: mod.items.filter(
      (item) => (!item.right || rights.has(item.right)) && (!item.feature || features.has(item.feature)),
    ),
  })).filter((mod) => mod.items.length > 0);
}

/** Right needed to follow a nav item, looked up by key (used by tests + role editor). */
export function navItemByKey(key: string): NavItem | undefined {
  for (const mod of NAV_REGISTRY) {
    const item = mod.items.find((i) => i.key === key);
    if (item) return item;
  }
  return undefined;
}
