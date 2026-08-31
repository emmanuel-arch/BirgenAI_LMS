// ─────────────────────────────────────────────────────────────────────────────
// THE CONNECTED SUITE — "BirgenAI ID".
//
// Six systems, six front doors, one identity. The lending console is the anchor;
// the customer portal, the analytics studio, HR, accounting and the call-centre
// sit beside it as their OWN products with their OWN login pages — yet a user
// signs in ONCE and every system knows them, their org and their branch.
//
// ORDER IS LAYOUT. The launcher renders this array into a three-across grid, so
// the first three entries ARE the top row. That row is the three systems a
// lender actually lives in every day — the console they work the book in, the
// portal their customers see, and the studio their managers read. The bottom row
// is the back office. Reordering this array reorders the launcher; there is no
// second place where the arrangement is decided.
//
// In this build the satellites live in the same deployment, so the session
// genuinely carries across (real SSO, not a mock). In production each moves to its
// own subdomain federated by the shared `.servicesuitecloud.com` session cookie — the same
// mechanism already proven for hub + Movies. The experience is identical, which is
// the point being sold: BirgenAI ID is the spine the rest plugs into.
//
// WHAT CROSSES AND WHAT DOES NOT: identity, org and the branch tree cross. RIGHTS
// DO NOT. An HR manager with full PeopleHub access must not inherit disbursement
// authority in the LMS just because they share an ID — so each app declares the
// right that admits you, and the launcher shows "request access" rather than a
// door that opens onto a 403.
// ─────────────────────────────────────────────────────────────────────────────
import type { ComponentType, CSSProperties } from "react";
import { Landmark, Users2, Calculator, Headphones, Smartphone, ChartNoAxesCombined, Waypoints } from "lucide-react";
import { satelliteHost, INTERCHANGE_HOST } from "./labels";

export type SuiteIcon = ComponentType<{ className?: string; style?: CSSProperties }>;

export type SuiteApp = {
  id: string;
  name: string;
  short: string;
  tagline: string;
  /** What this system is FOR, in the lender's words — shown on the launcher card. */
  purpose: string;
  accent: string;
  icon: SuiteIcon;
  href: string;
  /** The subdomain this system gets when it is split out of this deployment. */
  subdomain: string;
  /** true = this LMS itself (the anchor of the suite). */
  system: boolean;
  /**
   * true = a separate deployment with its own database and its own auth, not a
   * route in this application.
   *
   * The launcher links straight out to it and the branded-door machinery skips
   * it entirely, because there is no BirgenAI ID session to carry: the
   * Interchange authenticates members by Ed25519 node certificate. Pretending
   * otherwise would put a "Continue as Faith" button in front of a door that
   * cannot honour it.
   */
  external?: boolean;
  /**
   * false = this system has no staff sign-in door of its own.
   *
   * True for five of the seven. The Customer Portal is excluded because it
   * belongs to borrowers, and the Interchange because it is external. Both are
   * reachable from the launcher; neither renders /suite/<id>/login.
   */
  door?: boolean;
  /** The right that admits you here. Undefined = every signed-in staff member. */
  right?: string;
  /** Live today vs. shipping — honest labelling on the launcher. */
  live: boolean;
  modules: string[];
  /** One cross-system flow this app takes part in. The federation sales argument. */
  handoff?: string;
  demo?: {
    kpis: { label: string; value: string }[];
    table: { title: string; cols: string[]; rows: string[][] };
  };
};

export const SUITE_APPS: SuiteApp[] = [
  {
    id: "lms",
    name: "Lending Console",
    short: "Lending",
    // The tagline is the one sentence under the heading on this system's own
    // front door. It says what the system is FOR — never what it is called
    // internally, never a figure, and never the name of one lender.
    tagline: "Originate, score, disburse and collect. The book, every day.",
    purpose: "Where your officers work the book, every day.",
    accent: "#2a78d6",
    icon: Landmark,
    href: "/console",
    subdomain: satelliteHost("lms"),
    system: true,
    live: true,
    modules: ["Borrowers", "Loans", "Payments", "Collections", "Intelligence"],
    handoff: "Every disbursement posts a journal to Ledgerly automatically.",
  },
  {
    id: "portal",
    name: "Customer Portal",
    short: "Portal",
    tagline: "Your borrowers apply, track and repay — in your brand, on their phone.",
    purpose: "The front door your customers see.",
    accent: "#0e7490",
    icon: Smartphone,
    href: "/",
    subdomain: satelliteHost("portal"),
    system: false,
    // No staff door. This system belongs to BORROWERS: its host is what the
    // installed Micro Eazy app launches into, and a staff sign-in card in front
    // of that would break every home-screen icon already in customers' hands.
    // Staff who need to see what a customer sees open it from the launcher.
    door: false,
    live: true,
    modules: ["Apply", "My loans", "Repay", "Statements"],
    handoff: "A portal application lands in the console queue already scored.",
  },
  {
    // ── ANALYTICS STUDIO ─────────────────────────────────────────────────────
    //
    // Promoted out of the console's Intelligence menu and onto the top row of the
    // suite, because it stopped being a screen and became a system. The reason is
    // not vanity: the people who need it most — a GM, a board member, a regional
    // manager — do not have a reason to open a lending console, and burying the
    // only view of the whole book four levels inside a loan-officer tool is why
    // nobody senior ever saw it.
    //
    // It is `live: true` and has no `demo` block on purpose: unlike HR, Ledgerly
    // and ConnectDesk, this is a REAL surface reading the real book, so it must
    // not fall through to /suite/[app]'s demo renderer.
    id: "analytics",
    name: "Analytics & Reporting",
    short: "Analytics",
    tagline: "Every question you can ask of the book — answered while you ask it.",
    purpose: "The whole business, drawn.",
    accent: "#7c3aed",
    icon: ChartNoAxesCombined,
    href: "/analytics",
    subdomain: satelliteHost("analytics"),
    system: false,
    live: true,
    // The right that admits you. Analytics is a read of the ENTIRE book, so it
    // gates on the reporting right rather than being open to any signed-in user
    // the way the preview satellites are.
    right: "reports.view",
    modules: ["Portfolio", "Agents", "Branches", "Borrowers", "Collections", "Explorer"],
    handoff: "Every figure here is the same aggregate the console's tiles read — one arithmetic, two surfaces.",
  },
  {
    id: "hr",
    name: "PeopleHub HR",
    short: "HR",
    tagline: "The whole roster — officers, agents and branches — from the systems that already know them.",
    purpose: "The people behind the book.",
    accent: "#6d28d9",
    icon: Users2,
    href: "/people",
    subdomain: satelliteHost("hr"),
    system: false,
    // Live since 19 Aug 2026. It reads 1,088 staff out of Serviceconnect's own
    // directory, 32 seats off the CollectBox floor, and the borrower book each
    // officer carries. What it deliberately does NOT show is payroll, leave and
    // appraisals: `AgentPerformanceHistory`, `LoanAgentMetrics` and `UserProfile`
    // all exist and are all EMPTY, so the screen names them rather than
    // inventing a salary. See src/lib/suite/people.ts.
    live: true,
    modules: ["Directory", "Officers", "Branches", "Call floor"],
    handoff: "An officer's book, their branch and their collections seat are one record — joined from three directories that have never been read together.",
  },
  {
    id: "accounting",
    name: "Ledgerly Accounting",
    short: "Accounting",
    // Was "The journal Micromart already keep". This door is served to every
    // lender on the platform, and naming one of them on it is the same class of
    // mistake as hard-coding their colour.
    tagline: "The journal you already keep — read, for the first time.",
    purpose: "The truth about the money.",
    accent: "#0f766e",
    icon: Calculator,
    href: "/books",
    subdomain: satelliteHost("accounting"),
    system: false,
    // Live since 19 Aug 2026, and the least expected of the six: Serviceconnect
    // holds a real double-entry journal — 6.4M postings against an 18-account
    // chart typed INCOME/EXPENSE/LIABILITY/ASSET, written to minutes ago. It has
    // been accumulating for three years with nothing reading it.
    //
    // Ledgerly reports MOVEMENT rather than a balance sheet, because the journal
    // has no opening balances or period closes and a balance derived from it
    // would have no defensible starting point. See src/lib/suite/ledger.ts.
    live: true,
    modules: ["Movement", "Journal", "Chart of Accounts", "Cash flows"],
    handoff: "Every disbursement and every fee is already a double-entry posting in Serviceconnect's journal — this is the first screen to read it.",
  },
  {
    id: "callcenter",
    name: "ConnectDesk Call-Center",
    short: "Call-Center",
    // Was "Micromart's live collections floor — 93,000 cases, 26 agents…".
    // Two problems, and the second is the serious one: it named a single lender
    // on a door every lender sees, and it quoted counts that were typed into
    // this file by hand and are re-read by nothing. A number on a sign-in page
    // that nobody refreshes is a claim that goes stale silently. The launcher
    // carries live figures because it actually queries for them; this does not,
    // so it does not pretend to.
    tagline: "Your live collections floor. Every conversation, on the record.",
    purpose: "Every conversation, on the record.",
    accent: "#be123c",
    icon: Headphones,
    href: "/desk",
    subdomain: satelliteHost("callcenter"),
    system: false,
    // Live since 19 Aug 2026 against CollectBox, the collections database that
    // has sat on the same SQL Server as Serviceconnect for years with no
    // application reading both. Eleven screens; writes disarmed by default.
    live: true,
    modules: ["Live floor", "Work queue", "Promises", "Recoveries", "Fintech bridge"],
    handoff: "A missed instalment opens a case here with the borrower's whole history attached — merged from seven sources across two databases.",
  },
  {
    // ── THE INTERCHANGE ───────────────────────────────────────────────────────
    //
    // The seventh system, and the only one that is not this deployment. It is a
    // separate repository, a separate Vercel project and a separate database,
    // and it is here because a lender BUYS it the same way they buy PeopleHub —
    // it belongs in the launcher and in the platform's per-lender toggles even
    // though no request for it ever reaches this application.
    //
    // `external: true` is what keeps that honest. The launcher links straight
    // out; hrefFor() returns the configured origin rather than an in-app route;
    // and there is no /suite/interchange/login, because the Interchange's own
    // member gate IS the door and a BirgenAI ID session means nothing to it.
    //
    // Set SUITE_INTERCHANGE_ORIGIN to point at it. Until that is set the tile
    // renders with its subdomain and no working link, which is the correct
    // reading of "bought, not yet provisioned".
    id: "interchange",
    name: "The Interchange",
    short: "Interchange",
    tagline: "Query every other lender's exposure in real time — without anybody pooling a book.",
    purpose: "What the rest of the market already knows.",
    accent: "#0891b2",
    icon: Waypoints,
    href: "/",
    subdomain: INTERCHANGE_HOST,
    system: false,
    external: true,
    door: false,
    live: true,
    modules: ["Directory", "Exposure", "Consent", "Score", "Audit"],
    handoff: "An affordability check in the lending console asks the Interchange what this borrower owes elsewhere — and gets an answer without either lender ever seeing the other's book.",
  },
];

export const suiteApp = (id: string) => SUITE_APPS.find((a) => a.id === id);
export const satelliteApps = SUITE_APPS.filter((a) => !a.system);
