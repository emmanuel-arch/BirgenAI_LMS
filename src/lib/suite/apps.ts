// ─────────────────────────────────────────────────────────────────────────────
// THE CONNECTED SUITE — "BirgenAI ID".
//
// The CEO's ask: show the lending platform sitting alongside a HR system, an
// accounting system and a call-centre system — each its OWN product with its OWN
// login page — yet a user signs in ONCE and every system knows them.
//
// In this demo the satellites live in the same app, so the session genuinely
// carries across (real SSO, not a mock). In production they are separate
// deployments federated by a shared identity token; the experience is identical,
// and that is the point being sold: BirgenAI ID is the spine the rest plugs into.
// ─────────────────────────────────────────────────────────────────────────────
import type { ComponentType, CSSProperties } from "react";
import { Landmark, Users2, Calculator, Headphones } from "lucide-react";

export type SuiteIcon = ComponentType<{ className?: string; style?: CSSProperties }>;

export type SuiteApp = {
  id: string;
  name: string;
  short: string;
  tagline: string;
  accent: string;
  icon: SuiteIcon;
  href: string;
  /** true = this LMS itself (the anchor of the suite). */
  system: boolean;
  modules: string[];
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
    accent: "#2a78d6",
    icon: Landmark,
    href: "/console",
    system: true,
    modules: ["Borrowers", "Loans", "Payments", "Collections", "Intelligence"],
  },
  {
    id: "hr",
    name: "PeopleHub HR",
    short: "HR",
    tagline: "Employees, payroll and leave for the whole lender — one directory.",
    accent: "#6d28d9",
    icon: Users2,
    href: "/suite/hr",
    system: false,
    modules: ["Employees", "Payroll", "Leave", "Performance"],
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
    accent: "#0f766e",
    icon: Calculator,
    href: "/suite/accounting",
    system: false,
    modules: ["Chart of Accounts", "Journals", "Invoices", "P&L"],
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
    accent: "#be123c",
    icon: Headphones,
    href: "/suite/callcenter",
    system: false,
    modules: ["Live Queue", "Dispositions", "Agents", "SLA"],
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
