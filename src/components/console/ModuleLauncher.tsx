// The full module grid — every destination in the console as scannable cards.
//
// This used to be the console HOME. It now lives here and is shown only to org
// administrators (the dashboard is the home for everyone else; officers navigate
// via the sidebar). Filtered by the SAME rights + plan features as the nav, so
// the two can never disagree.
import {
  Users, Banknote, Gauge, FileText, Landmark, MessageSquare, Settings2, MapPin, Bot, Package, GitBranch, Crown, ScanLine, Scale, KeyRound, PhoneCall,
} from "lucide-react";
import type { Right } from "@/lib/rbac/rights";
import type { Feature } from "@/lib/billing/plans";

const MODULES: {
  icon: typeof Users; title: string; desc: string; ready: boolean;
  href?: string; open?: string; right?: Right; feature?: Feature;
}[] = [
  { icon: FileText, title: "Applications", desc: "AI pre-screened queue, SHAP reasons, two-tier approvals", ready: true, href: "/console/applications", right: "applications.view" },
  { icon: Package, title: "Products", desc: "Loan products: limits, interest, schedule, disbursement mode", ready: true, href: "/console/products", right: "products.view" },
  { icon: GitBranch, title: "Workflows", desc: "Approval stage chains: tiers, OTP, finalize amount caps", ready: true, href: "/console/workflows", right: "workflows.view" },
  { icon: Users, title: "Borrowers", desc: "The borrower book: KYC status, scores, OLB, graduation", ready: true, href: "/console/borrowers", right: "borrowers.view" },
  { icon: Landmark, title: "Loans", desc: "Booked loans: balances, schedules, printable statements", ready: true, href: "/console/loans", right: "loans.view" },
  { icon: Banknote, title: "Disbursements", desc: "Maker-checker B2C queue, manual confirm, float ledger", ready: true, href: "/console/disbursements", right: "disbursements.view" },
  { icon: Landmark, title: "Repayments", desc: "STK requests, C2B receipts, unallocated exceptions", ready: true, href: "/console/repayments", right: "repayments.view" },
  { icon: Scale, title: "Reconciliation", desc: "Every shilling M-Pesa moved, checked nightly against the book", ready: true, href: "/console/reconciliation", right: "reconciliation.view" },
  { icon: PhoneCall, title: "Collections", desc: "Arrears work queue, promises to pay, call logs, tickets", ready: true, href: "/console/collections", right: "collections.view" },
  { icon: Gauge, title: "Credit Intelligence", desc: "Portfolio early-warning watchlist, risk scores, one-tap recovery", ready: true, href: "/console/intelligence", right: "intelligence.view", feature: "portfolio-scan" },
  { icon: MapPin, title: "Field & Routes", desc: "Geo-pinned verifications, nearest-agent allocation, drive routes", ready: true, href: "/console/field", right: "field.view", feature: "route-planner" },
  { icon: ScanLine, title: "Document Parser", desc: "Fee structures, invoices, permits, statements → structured figures", ready: true, href: "/console/documents", right: "documents.view", feature: "document-parser" },
  { icon: MessageSquare, title: "SMS & Comms", desc: "Campaign blasts, message templates, the email log", ready: true, href: "/console/comms", right: "sms.view" },
  { icon: Bot, title: "Riri Assistant", desc: "Talk to your book — 3 models: Analyst (live data), Copilot & Max", ready: true, open: "analyst", right: "riri.use", feature: "riri" },
  { icon: FileText, title: "Reports", desc: "Portfolio report & loan statements — print or save as PDF", ready: true, href: "/console/report", right: "reports.view" },
  { icon: KeyRound, title: "Team, Roles & Access", desc: "Invite staff, create roles, choose the menus each role sees", ready: true, href: "/console/roles", right: "roles.view" },
  { icon: Crown, title: "Billing & Package", desc: "Your package, usage this month, pay via the wallet", ready: true, href: "/console/billing", right: "billing.view" },
  { icon: Settings2, title: "Settings & Vault", desc: "Branding, integrations (Daraja, SMS, CRB, KYC)", ready: true, href: "/console/settings", right: "settings.view" },
];

export default function ModuleLauncher({ rights, features }: { rights: ReadonlySet<string>; features: ReadonlySet<string> }) {
  const visible = MODULES.filter((m) => (!m.right || rights.has(m.right)) && (!m.feature || features.has(m.feature)));
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
      {visible.map(({ icon: Icon, title, desc, ready, ...m }) => {
        const card = (
          <div className={`glass p-3.5 sm:p-5 h-full ${ready ? "hover:bg-white/80 transition-colors" : "opacity-60"}`}>
            <div className="flex items-center justify-between">
              <Icon className="h-5 w-5 sm:h-6 sm:w-6" style={{ color: "var(--brand)" }} aria-hidden />
              {!ready && <span className="rounded-md bg-zinc-900/5 px-2 py-0.5 text-[10px] font-semibold text-zinc-500">COMING UP</span>}
            </div>
            <h2 className="mt-2.5 sm:mt-3 text-[13px] sm:text-sm font-semibold leading-snug">{title}</h2>
            <p className="mt-1 text-[11px] sm:text-sm leading-snug sm:leading-relaxed text-zinc-600 line-clamp-2 sm:line-clamp-none">{desc}</p>
          </div>
        );
        if (m.href && ready) return <a key={title} href={m.href}>{card}</a>;
        if (m.open && ready) return <button key={title} type="button" data-riri-open={m.open} className="text-left w-full">{card}</button>;
        return <div key={title}>{card}</div>;
      })}
    </div>
  );
}
