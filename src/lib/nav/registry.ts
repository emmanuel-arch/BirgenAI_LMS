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
  open?: "analyst" | "copilot" | "max";
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
      { key: "borrowers-new", label: "New Borrower", href: "/console/borrowers?new=1", icon: "UserPlus", right: "borrowers.create", exact: true },
    ],
  },
  {
    key: "loans",
    label: "Loans",
    icon: "FileText",
    items: [
      { key: "applications", label: "Applications Queue", href: "/console/applications", icon: "FileText", right: "applications.view" },
      { key: "loans-list", label: "Loans List", href: "/console/loans", icon: "Landmark", right: "loans.view" },
      { key: "loans-apply", label: "Apply for a Borrower", href: "/console/applications?apply=1", icon: "FilePlus2", right: "loans.apply", exact: true },
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
      { key: "model-tuning", label: "Model Tuning", href: "/console/intelligence/tuning", icon: "SlidersHorizontal", right: "intelligence.tune", feature: "model-tuning" },
      { key: "metrics", label: "Metric Catalogue", href: "/console/intelligence/metrics", icon: "Ruler", right: "metrics.view", feature: "riri" },
      { key: "documents", label: "Document Parser", href: "/console/documents", icon: "ScanLine", right: "documents.view", feature: "document-parser" },
      { key: "reports", label: "Reports", href: "/console/report", icon: "FileBarChart", right: "reports.view" },
    ],
  },
  {
    key: "field",
    label: "Field Ops",
    icon: "MapPin",
    items: [
      { key: "field-visits", label: "Visits & Routes", href: "/console/field", icon: "MapPin", right: "field.view", feature: "route-planner" },
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
      { key: "products", label: "Products", href: "/console/products", icon: "Package", right: "products.view" },
      { key: "workflows", label: "Workflows", href: "/console/workflows", icon: "GitBranch", right: "workflows.view" },
      { key: "branding", label: "Branding", href: "/console/settings/branding", icon: "Palette", right: "branding.manage" },
      { key: "settings", label: "Settings & Vault", href: "/console/settings", icon: "Settings2", right: "settings.view", exact: true },
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
