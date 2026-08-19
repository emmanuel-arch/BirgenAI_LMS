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
import { Landmark, Users2, Calculator, Headphones, Smartphone, ChartNoAxesCombined } from "lucide-react";
import { satelliteHost } from "./labels";

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
    tagline: "Originate, score, disburse and collect — the core BirgenAI platform.",
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
    name: "Analytics Studio",
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
    tagline: "The journal Micromart already keep — read, for the first time.",
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
    tagline: "Micromart's live collections floor — 93,000 cases, 26 agents, every conversation on the record.",
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
];

export const suiteApp = (id: string) => SUITE_APPS.find((a) => a.id === id);
export const satelliteApps = SUITE_APPS.filter((a) => !a.system);
