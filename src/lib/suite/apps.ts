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
// own subdomain federated by the shared `.birgenai.com` session cookie — the same
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
    subdomain: "lms.birgenai.com",
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
    subdomain: "my.birgenai.com",
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
    subdomain: "analytics.birgenai.com",
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
    tagline: "Employees, payroll and leave for the whole lender — one directory.",
    purpose: "The people behind the book.",
    accent: "#6d28d9",
    icon: Users2,
    href: "/suite/hr",
    subdomain: "people.birgenai.com",
    system: false,
    live: false,
    modules: ["Employees", "Payroll", "Leave", "Performance"],
    handoff: "An officer's approved leave reassigns their collections queue in the LMS.",
    demo: {
      kpis: [
        { label: "Headcount", value: "48" },
        { label: "On leave today", value: "3" },
        { label: "Payroll · this month", value: "KES 4.24M" },
        { label: "Open roles", value: "2" },
      ],
      table: {
        title: "Directory",
        cols: ["Employee", "Role", "Branch", "Status"],
        rows: [
          ["Nancy Wekesa", "Loan Officer", "Kitale East", "Active"],
          ["Collins Barasa", "Loan Officer", "Kitale West", "On leave"],
          ["Mercy Nasimiyu", "Branch Manager", "Endebess", "Active"],
          ["Dennis Simiyu", "Branch Manager", "Kiminini", "Active"],
          ["Faith Nabwera", "Credit Manager", "Head Office", "Active"],
        ],
      },
    },
  },
  {
    id: "accounting",
    name: "Ledgerly Accounting",
    short: "Accounting",
    tagline: "General ledger, journals and statements — the books, kept straight.",
    purpose: "The truth about the money.",
    accent: "#0f766e",
    icon: Calculator,
    href: "/suite/accounting",
    subdomain: "books.birgenai.com",
    system: false,
    live: false,
    modules: ["Chart of Accounts", "Journals", "Invoices", "P&L"],
    handoff: "Loan-book cash and payroll reconcile against the same M-Pesa float ledger.",
    demo: {
      kpis: [
        { label: "Cash & bank", value: "KES 8.63M" },
        { label: "Loans receivable", value: "KES 17.71M" },
        { label: "Payables", value: "KES 2.10M" },
        { label: "Net income · MTD", value: "KES 6.31M" },
      ],
      table: {
        title: "Trial balance (extract)",
        cols: ["Account", "Debit", "Credit"],
        rows: [
          ["1000 · Cash & bank", "8,630,400", "—"],
          ["1200 · Loans receivable", "17,712,000", "—"],
          ["4000 · Interest income", "—", "5,905,000"],
          ["4100 · Fees & processing", "—", "2,400,000"],
          ["2000 · Payables", "—", "2,101,300"],
        ],
      },
    },
  },
  {
    id: "callcenter",
    name: "ConnectDesk Call-Center",
    short: "Call-Center",
    tagline: "Queues, agents and dispositions — every customer conversation, logged.",
    purpose: "Every conversation, on the record.",
    accent: "#be123c",
    icon: Headphones,
    href: "/suite/callcenter",
    subdomain: "desk.birgenai.com",
    system: false,
    live: false,
    modules: ["Live Queue", "Dispositions", "Agents", "SLA"],
    handoff: "A missed installment opens a task here with the borrower's 360 attached.",
    demo: {
      kpis: [
        { label: "In queue", value: "6" },
        { label: "Avg wait", value: "0:42" },
        { label: "Agents online", value: "9" },
        { label: "SLA · today", value: "94%" },
      ],
      table: {
        title: "Live floor",
        cols: ["Agent", "Customer", "Disposition", "Duration"],
        rows: [
          ["Ann M.", "Peter Wafula", "Promise to pay", "3:12"],
          ["Ian K.", "Grace Otieno", "Reached", "1:48"],
          ["Lucy N.", "Samuel Kiptoo", "Follow-up needed", "2:31"],
          ["Victor O.", "Esther Juma", "No answer", "0:22"],
          ["Sharon W.", "Moses Barasa", "Inquiry", "4:05"],
        ],
      },
    },
  },
];

export const suiteApp = (id: string) => SUITE_APPS.find((a) => a.id === id);
export const satelliteApps = SUITE_APPS.filter((a) => !a.system);
