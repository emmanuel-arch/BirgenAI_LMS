// ─────────────────────────────────────────────────────────────────────────────
// The rights vocabulary — every permission the console understands.
//
// Grammar is `resource.action`: `.view` admits you to the screen (and puts it on
// the sidebar); `.manage` / a verb (`decide`, `collect`, `resolve`, `tune`,
// `parse`) authorises the writes. A Role stores a plain array of these keys in
// Role.rights; `["*"]` means everything. The nav registry (src/lib/nav) and the
// API guards (src/lib/rbac/authz) both consume THIS list, so a menu item and the
// route behind it can never disagree about who may pass.
//
// ServiceSuite ancestry, deliberately improved: there, rights only decided which
// menus rendered and the controllers trusted anyone signed in. Here the same key
// that shows the menu is enforced server-side on the route.
// ─────────────────────────────────────────────────────────────────────────────

export const ALL_RIGHTS = [
  // Borrower book
  "borrowers.view", // see the borrower list + Customer-360
  "borrowers.create", // register a borrower / run KYC checks
  "borrowers.manage", // (reserved) edit identity fields, reallocate portfolios
  // Origination
  "applications.view", // see the applications queue
  "applications.decide", // act on a stage: approve, refer, decline, offers, security
  "loans.view", // see booked loans + statements
  "loans.apply", // (reserved) console-assisted application on a borrower's behalf
  // Money rails
  "disbursements.view", // see the maker-checker queue
  "disbursements.manage", // initiate/confirm disbursements (tiers still apply)
  "float.view", // see the float ledger + balance
  "float.manage", // top up / adjust float
  "repayments.view", // see active-loan collections + receipts
  "repayments.collect", // trigger STK requests, allocate receipts
  "reconciliation.view", // see the exceptions queue
  "reconciliation.resolve", // resolve/ignore exceptions, re-apply payments
  // Collections (item 14 — reserved so roles can be prepared ahead of the build)
  "collections.view",
  "collections.manage",
  // Intelligence
  "intelligence.view", // early-warning watchlist, portfolio risk
  "intelligence.tune", // edit model weights (Premium's model-tuning)
  "documents.view", // see parsed documents
  "documents.parse", // upload + parse (metered)
  "documents.manage", // delete documents
  "reports.view", // portfolio report, loan statements
  // Field operations
  "field.view", // visits roster, map, routes
  "field.manage", // create visits, dispatch/allocate agents
  // Catalogue & process
  "products.view",
  "products.manage",
  "workflows.view",
  "workflows.manage",
  "branches.view", // (reserved) branch tree
  "branches.manage",
  // People & access
  "team.view",
  "team.manage",
  "roles.view",
  "roles.manage",
  // Organization
  "branding.manage", // logo, colors, portal appearance
  "settings.view", // integrations status (masked)
  "settings.manage", // vault credentials (Daraja, SMS, CRB, KYC)
  "billing.view",
  "billing.manage", // checkout, package changes, SMS top-ups
  // Comms (item 15 — reserved)
  "sms.view",
  "sms.manage",
  // AI
  "riri.use",
] as const;

export type Right = (typeof ALL_RIGHTS)[number];

export const ALL_RIGHTS_SET: ReadonlySet<string> = new Set(ALL_RIGHTS);

/** The admin-everything grant. Stored verbatim in Role.rights. */
export const WILDCARD = "*";

/**
 * What a staff member with NO role could do before rights enforcement existed —
 * i.e. every console surface that only asked for a session, verbatim. Staff with
 * `roleId: null` resolve to exactly this set so the RBAC rollout changes nothing
 * for them until an admin assigns real roles. verify-rbac asserts this list
 * against the historical guard map; do not "tidy" it.
 */
export const LEGACY_DEFAULT_RIGHTS: Right[] = [
  "borrowers.view",
  "borrowers.create",
  "applications.view",
  "applications.decide",
  "loans.view",
  "disbursements.view",
  "disbursements.manage",
  "float.view",
  "repayments.view",
  "repayments.collect",
  "reconciliation.view",
  "reconciliation.resolve",
  "intelligence.view",
  "documents.view",
  "documents.parse",
  "reports.view",
  "field.view",
  "field.manage",
  "products.view",
  "workflows.view",
  "billing.view",
  "riri.use",
];

/**
 * Rights that were admin-gated (`hasAdminAccess`) before roles existed. The
 * complement of LEGACY_DEFAULT_RIGHTS among non-reserved rights. Used by tests
 * and by the role editor to badge "administrative" abilities.
 */
export const ADMIN_ONLY_RIGHTS: Right[] = [
  "products.manage",
  "workflows.manage",
  "team.view",
  "team.manage",
  "roles.view",
  "roles.manage",
  "branding.manage",
  "settings.view",
  "settings.manage",
  "float.manage",
  "billing.manage",
  "intelligence.tune",
  "documents.manage",
];

/** Reserved for modules not yet built — grantable, but nothing consumes them yet. */
export const RESERVED_RIGHTS: Right[] = [
  "borrowers.manage",
  "loans.apply",
  "collections.view",
  "collections.manage",
  "branches.view",
  "branches.manage",
  "sms.view",
  "sms.manage",
];

/**
 * How the role editor groups the checkboxes — mirrors the sidebar's modules so
 * "choosing menus for a role" and "granting rights" are visibly the same act.
 * verify-rbac asserts every right appears in exactly one group.
 */
export const RIGHT_GROUPS: { key: string; label: string; rights: Right[] }[] = [
  { key: "borrowers", label: "Borrowers", rights: ["borrowers.view", "borrowers.create", "borrowers.manage"] },
  { key: "loans", label: "Loans", rights: ["applications.view", "applications.decide", "loans.view", "loans.apply"] },
  { key: "payments", label: "Payments", rights: ["disbursements.view", "disbursements.manage", "float.view", "float.manage", "repayments.view", "repayments.collect", "reconciliation.view", "reconciliation.resolve"] },
  { key: "collections", label: "Collections", rights: ["collections.view", "collections.manage"] },
  { key: "intelligence", label: "Intelligence & Reports", rights: ["intelligence.view", "intelligence.tune", "documents.view", "documents.parse", "documents.manage", "reports.view"] },
  { key: "field", label: "Field Ops", rights: ["field.view", "field.manage"] },
  { key: "organization", label: "Organization", rights: ["products.view", "products.manage", "workflows.view", "workflows.manage", "branches.view", "branches.manage", "branding.manage", "settings.view", "settings.manage"] },
  { key: "access", label: "Team & Access", rights: ["team.view", "team.manage", "roles.view", "roles.manage"] },
  { key: "billing", label: "Billing", rights: ["billing.view", "billing.manage"] },
  { key: "comms", label: "Comms", rights: ["sms.view", "sms.manage"] },
  { key: "riri", label: "Riri AI", rights: ["riri.use"] },
];

/**
 * Plain-language captions for the role editor — every right explained in the
 * words a lender's admin would use, not ours.
 */
export const RIGHT_LABELS: Record<Right, string> = {
  "borrowers.view": "Can see the borrower list and each borrower's full profile",
  "borrowers.create": "Can register new borrowers and run KYC checks",
  "borrowers.manage": "Can edit borrower details and reallocate portfolios (coming up)",
  "applications.view": "Can see the loan applications queue",
  "applications.decide": "Can approve, refer or decline applications and manage offers",
  "loans.view": "Can see booked loans and print statements",
  "loans.apply": "Can submit an application on a borrower's behalf (coming up)",
  "disbursements.view": "Can see the disbursement queue",
  "disbursements.manage": "Can initiate and confirm disbursements (approval tiers still apply)",
  "float.view": "Can see the float balance and ledger",
  "float.manage": "Can top up or adjust the float",
  "repayments.view": "Can see repayments and receipts",
  "repayments.collect": "Can send payment requests (STK) and allocate receipts",
  "reconciliation.view": "Can see the reconciliation exceptions queue",
  "reconciliation.resolve": "Can resolve or ignore reconciliation exceptions",
  "collections.view": "Can see the collections work queues (coming up)",
  "collections.manage": "Can log calls, record promises-to-pay and manage tickets (coming up)",
  "intelligence.view": "Can see the early-warning watchlist and portfolio risk",
  "intelligence.tune": "Can change the risk model's weights",
  "documents.view": "Can see parsed documents",
  "documents.parse": "Can upload and parse documents (each parse is billed)",
  "documents.manage": "Can delete documents",
  "reports.view": "Can view and print portfolio reports",
  "field.view": "Can see field visits, routes and the agent roster",
  "field.manage": "Can create visits and dispatch field agents",
  "products.view": "Can see the loan products list",
  "products.manage": "Can create and edit loan products",
  "workflows.view": "Can see approval workflows",
  "workflows.manage": "Can create and edit approval workflows",
  "branches.view": "Can see the branch structure (coming up)",
  "branches.manage": "Can create and edit branches (coming up)",
  "team.view": "Can see the staff list",
  "team.manage": "Can invite staff, set approval tiers and assign roles",
  "roles.view": "Can see roles and what each one may do",
  "roles.manage": "Can create and edit roles and their permissions",
  "branding.manage": "Can change the logo, colors and portal appearance",
  "settings.view": "Can see integration status (credentials stay masked)",
  "settings.manage": "Can update vault credentials (M-Pesa, SMS, CRB, KYC)",
  "billing.view": "Can see the package and this month's usage",
  "billing.manage": "Can pay, change packages and buy SMS credits",
  "sms.view": "Can see SMS templates and campaigns (coming up)",
  "sms.manage": "Can compose and send SMS campaigns (coming up)",
  "riri.use": "Can talk to Riri, the console AI",
};
