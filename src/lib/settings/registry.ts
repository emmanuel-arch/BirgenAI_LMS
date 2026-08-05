// ─────────────────────────────────────────────────────────────────────────────
// THE SETTINGS REGISTRY — every configurable surface in the console, declared
// once, as data.
//
// This is the first consumer of the Tenant Definition Layer idea (see
// docs/SUPER-LMS-ARCHITECTURE.md §3). The old Settings page was a hand-written
// accordion of seven forms; ServiceSuite's equivalent is worse still — one wide
// table and seven bespoke POST handlers, each with its own 40-line MERGE. In both
// cases a new setting means new UI *and* new plumbing.
//
// Here a settings surface is a ROW in this list. The launcher renders it, the
// drawer renders its fields, one endpoint saves it, and the status chip reads
// itself. Adding "Bank transfer disbursement" tomorrow is one object literal.
//
// TILE KINDS
//   vault  — encrypted per-org credentials. Opens a drawer over the launcher;
//            saves through /api/orgs/integrations; secrets are WRITE-ONLY and the
//            API never returns a stored value, so fields always start blank.
//   link   — a setting that already owns a full screen (branding, roles,
//            products). The tile is a door, not a duplicate form.
// ─────────────────────────────────────────────────────────────────────────────
import {
  Smartphone, Banknote, MessageSquare, Mail, ScanFace, Gauge, Plug,
  Palette, Users2, GitBranch, Package, Building2, KeyRound, Receipt, Crown, Scale,
  type LucideIcon,
} from "lucide-react";
import type { Right } from "@/lib/rbac/rights";

export type FieldSpec = {
  key: string;
  label: string;
  type?: "text" | "password" | "select" | "number";
  options?: string[];
  placeholder?: string;
  /** Help text under the field — what this value actually is, in the lender's terms. */
  help?: string;
  /** Render across both columns (long values: connection strings, from-addresses). */
  wide?: boolean;
};

export type SettingsTile = {
  id: string;
  title: string;
  /** One line on the card. What this does, not what it is called. */
  desc: string;
  icon: LucideIcon;
  /** Groups the launcher into bands. */
  group: "Rails" | "Identity & risk" | "Your platform" | "People & process";
  right?: Right;
} & (
  | {
      kind: "vault";
      /** The IntegrationKind this tile writes. */
      vaultKind: string;
      /** Longer explanation shown at the head of the drawer. */
      blurb: string;
      fields: FieldSpec[];
      /** Shown at the foot of the drawer — the operational detail people ask for. */
      footnote?: string;
    }
  | { kind: "link"; href: string }
);

export const SETTINGS_TILES: SettingsTile[] = [
  // ── Rails ──────────────────────────────────────────────────────────────────
  {
    id: "mpesa-stk",
    kind: "vault",
    vaultKind: "MPESA_STK",
    title: "M-Pesa collections",
    desc: "STK push on your paybill or till — how repayments come in.",
    blurb: "Your Daraja app for STK push. Once this is live, an officer can request a repayment straight to the borrower's phone and the receipt posts itself against the loan.",
    icon: Smartphone,
    group: "Rails",
    right: "settings.manage",
    fields: [
      { key: "consumerKey", label: "Consumer key", type: "password" },
      { key: "consumerSecret", label: "Consumer secret", type: "password" },
      { key: "shortCode", label: "Business shortcode", help: "Your paybill or till number." },
      { key: "passkey", label: "Passkey", type: "password" },
      { key: "environment", label: "Environment", type: "select", options: ["production", "sandbox"] },
    ],
    footnote: "C2B paybill confirmations post to /api/mpesa/c2b/<your-subdomain> — BirgenAI registers this with Safaricom during activation.",
  },
  {
    id: "mpesa-b2c",
    kind: "vault",
    vaultKind: "MPESA_B2C",
    title: "M-Pesa disbursement",
    desc: "Pays approved loans straight to the borrower's M-Pesa.",
    blurb: "The B2C side of Daraja. Approved loans queue for maker-checker release and then pay out without anyone re-keying a phone number.",
    icon: Banknote,
    group: "Rails",
    right: "settings.manage",
    fields: [
      { key: "consumerKey", label: "Consumer key", type: "password" },
      { key: "consumerSecret", label: "Consumer secret", type: "password" },
      { key: "shortCode", label: "B2C shortcode" },
      { key: "initiatorName", label: "Initiator name" },
      { key: "securityCredential", label: "Security credential", type: "password", placeholder: "Cert-encrypted initiator password", wide: true },
      { key: "environment", label: "Environment", type: "select", options: ["production", "sandbox"] },
    ],
  },
  {
    id: "sms",
    kind: "vault",
    vaultKind: "SMS",
    title: "SMS provider",
    desc: "Approvals, disbursement receipts, reminders — in your sender ID.",
    blurb: "Transactional SMS. Every message the platform sends on your behalf goes out under your own sender ID and is billed to your own account.",
    icon: MessageSquare,
    group: "Rails",
    right: "settings.manage",
    fields: [
      { key: "provider", label: "Provider", type: "select", options: ["africastalking", "celcom", "custom"] },
      { key: "username", label: "Username / account" },
      { key: "apiKey", label: "API key", type: "password" },
      { key: "senderId", label: "Sender ID", placeholder: "e.g. your brand name", help: "Must already be registered with the provider." },
    ],
  },
  {
    id: "smtp",
    kind: "vault",
    vaultKind: "SMTP",
    title: "Email (SMTP)",
    desc: "Statements and staff mail from your own address.",
    blurb: "Your outbound mail server. Statements, invites and staff credentials are sent from your domain rather than a shared one.",
    icon: Mail,
    group: "Rails",
    right: "settings.manage",
    fields: [
      { key: "host", label: "Host", placeholder: "smtp.zoho.com" },
      { key: "port", label: "Port", type: "number", placeholder: "587" },
      { key: "user", label: "User" },
      { key: "pass", label: "Password", type: "password" },
      { key: "from", label: "From", placeholder: "Lender <no-reply@lender.co.ke>", wide: true },
    ],
  },

  // ── Identity & risk ────────────────────────────────────────────────────────
  {
    id: "kyc",
    kind: "vault",
    vaultKind: "KYC",
    title: "Identity provider",
    desc: "Optional — only if you bring your own KYC vendor.",
    blurb:
      "Identity is verified by the platform as standard: the document is read by Google Vision, the person is confirmed against the national registry (IPRS), and the face is matched to the ID. Those are platform credentials — every lender on BirgenAI verifies against the same registry with the same engine. Fill this in only if you bring your own provider.",
    icon: ScanFace,
    group: "Identity & risk",
    right: "settings.manage",
    fields: [
      { key: "provider", label: "Provider", type: "select", options: ["platform", "custom"] },
      { key: "apiKey", label: "API key", type: "password" },
      { key: "environment", label: "Environment", type: "select", options: ["production", "sandbox"] },
    ],
  },
  {
    id: "credit-policy",
    kind: "link",
    href: "/console/settings/credit",
    title: "Credit policy",
    desc: "Ceilings, affordability, hard stops, the behaviour matrix and the graduation ladder.",
    icon: Scale,
    group: "Identity & risk",
    right: "settings.view",
  },
  {
    id: "crb",
    kind: "vault",
    vaultKind: "CRB",
    title: "Credit bureau",
    desc: "Your CRB subscription, for consented credit checks.",
    blurb: "Your own bureau subscription. Checks run only against a borrower's recorded consent, and every pull is logged against the application that justified it. For Metropol, paste the key pair Metropol issued you and the host/port/version from your onboarding email — leave the legacy username/password blank.",
    icon: Gauge,
    group: "Identity & risk",
    right: "settings.manage",
    fields: [
      { key: "bureau", label: "Bureau", type: "select", options: ["transunion", "metropol", "creditinfo"] },
      { key: "publicKey", label: "Metropol public key", type: "password", help: "X-METROPOL-REST-API-KEY.", wide: true },
      { key: "privateKey", label: "Metropol private key", type: "password", help: "Used to sign every request. Never leaves the server.", wide: true },
      { key: "host", label: "Host", placeholder: "api.metropol.co.ke", help: "No https://, just the hostname." },
      { key: "port", label: "Port", type: "number", placeholder: "5555" },
      { key: "apiVersion", label: "API version", placeholder: "v2_1", help: "The URL version segment Metropol assigned you." },
      { key: "reportDepth", label: "Pull depth", type: "select", options: ["full", "standard", "score"], help: "full = credit file + score + income; standard = file + score; score = score only." },
      { key: "username", label: "Legacy username (other bureaus)" },
      { key: "password", label: "Legacy password (other bureaus)", type: "password" },
      { key: "endpoint", label: "Endpoint override (optional)", wide: true },
    ],
    footnote: "Test the connection from any borrower's Customer 360 → Run CRB check, or run `npm run test:crb` on the server. A live pull shows a green LIVE badge; until keys + version are saved, checks run as a labelled simulation.",
  },
  {
    id: "servicesuite",
    kind: "vault",
    vaultKind: "SERVICESUITE",
    title: "ServiceSuite bridge",
    desc: "Bridged lenders: read + posting connection to your existing system.",
    blurb: "For lenders still running ServiceSuite alongside BirgenAI. Applications originated here post into your existing approval workflow rather than forking your book.",
    icon: Plug,
    group: "Identity & risk",
    right: "settings.manage",
    fields: [
      { key: "connectionString", label: "Connection string", type: "password", placeholder: "Data Source=…;Initial Catalog=Serviceconnect;…", wide: true },
      { key: "entityId", label: "EntityId", type: "number" },
      { key: "createdByUserId", label: "Service account UserMaster.ID", type: "number" },
      { key: "channel", label: "Channel tag", type: "number", placeholder: "7" },
    ],
  },

  // ── Your platform ──────────────────────────────────────────────────────────
  {
    id: "branding",
    kind: "link",
    href: "/console/settings/branding",
    title: "Brand & appearance",
    desc: "Logo, colours and the words your customers read.",
    icon: Palette,
    group: "Your platform",
    right: "settings.view",
  },
  {
    id: "borrowers",
    kind: "link",
    href: "/console/settings/borrowers",
    title: "Borrower settings",
    desc: "KYC fields, account numbering, limits, scoring cadence, onboarding rules.",
    icon: Users2,
    group: "Your platform",
    right: "settings.view",
  },
  {
    id: "products",
    kind: "link",
    href: "/console/products",
    title: "Loan products",
    desc: "Limits, interest, schedule, security and disbursement mode.",
    icon: Package,
    group: "Your platform",
    right: "products.view",
  },
  {
    id: "charges",
    kind: "link",
    href: "/console/charges",
    title: "Fees & charges",
    desc: "What you charge, when it applies, and who it goes to.",
    icon: Receipt,
    group: "Your platform",
    right: "products.view",
  },

  // ── People & process ───────────────────────────────────────────────────────
  {
    id: "structure",
    kind: "link",
    href: "/console/branches",
    title: "Organisation structure",
    desc: "Your regions, branches and who reports to whom.",
    icon: Building2,
    group: "People & process",
    right: "branches.view",
  },
  {
    id: "roles",
    kind: "link",
    href: "/console/roles",
    title: "Team, roles & access",
    desc: "Invite staff, build roles, choose what each role may see.",
    icon: KeyRound,
    group: "People & process",
    right: "roles.view",
  },
  {
    id: "workflows",
    kind: "link",
    href: "/console/workflows",
    title: "Approval workflows",
    desc: "Stage chains, tiers, OTP and finalize amount caps.",
    icon: GitBranch,
    group: "People & process",
    right: "workflows.view",
  },
  {
    id: "billing",
    kind: "link",
    href: "/console/billing",
    title: "Package & billing",
    desc: "Your plan, usage this month, and how you pay for it.",
    icon: Crown,
    group: "People & process",
    right: "billing.view",
  },
];

export const SETTINGS_GROUPS = ["Rails", "Identity & risk", "Your platform", "People & process"] as const;

export const GROUP_BLURB: Record<(typeof SETTINGS_GROUPS)[number], string> = {
  Rails: "How money and messages actually move.",
  "Identity & risk": "How you know who someone is, and whether to lend.",
  "Your platform": "What your product looks like and what it sells.",
  "People & process": "Who works here, and how a decision gets made.",
};
