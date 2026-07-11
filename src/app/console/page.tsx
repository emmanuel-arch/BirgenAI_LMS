import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRights } from "@/lib/rbac/authz";
import { entitlementsFor } from "@/lib/billing/entitlements";
import type { Right } from "@/lib/rbac/rights";
import type { Feature } from "@/lib/billing/plans";
import {
  Users, Banknote, Gauge, FileText, Landmark, MessageSquare, Settings2, MapPin, Bot, Package, GitBranch, Crown, ScanLine, Scale, KeyRound, PhoneCall,
} from "lucide-react";
import SetupChecklist, { type ChecklistItem } from "@/components/console/SetupChecklist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Staff console home. The sidebar is the canonical menu (src/lib/nav/registry);
// these cards are the same destinations as a scannable dashboard, filtered by
// the SAME rights + plan features so the two can never disagree.
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
  { icon: Crown, title: "Billing & Package", desc: "Your package, usage this month, pay via the BirgenAI wallet", ready: true, href: "/console/billing", right: "billing.view" },
  { icon: Settings2, title: "Settings & Vault", desc: "Branding, integrations (Daraja, SMS, CRB, KYC)", ready: true, href: "/console/settings", right: "settings.view" },
];

export default async function Console() {
  const session = await auth();
  if (!session?.user?.orgId) redirect("/login");
  const orgId = session.user.orgId;

  const org = await prisma.org.findUnique({ where: { id: orgId }, select: { name: true, status: true, onboardingState: true } });
  if (!org) redirect("/login");

  const [rights, ent] = await Promise.all([getRights(session), entitlementsFor(orgId)]);
  const visible = MODULES.filter(
    (m) => (!m.right || rights.has(m.right)) && (!m.feature || ent.features.has(m.feature)),
  );

  // Portfolio pulse — the semantic-metric-layer seeds (OLB, PAR30, today's flows).
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const par30Cutoff = new Date(Date.now() - 30 * 86400000);
  const [olbAgg, activeCount, par30Agg, disbToday, collToday, liveApps, pendingDisb] = await Promise.all([
    prisma.loan.aggregate({ where: { orgId, status: "ACTIVE" }, _sum: { balance: true } }),
    prisma.loan.count({ where: { orgId, status: "ACTIVE" } }),
    prisma.loan.aggregate({
      where: { orgId, status: "ACTIVE", installments: { some: { status: "OVERDUE", dueDate: { lt: par30Cutoff } } } },
      _sum: { balance: true },
    }),
    prisma.disbursement.aggregate({
      where: { orgId, state: { in: ["CONFIRMED", "MANUAL_CONFIRMED"] }, updatedAt: { gte: today } },
      _sum: { amount: true },
    }),
    prisma.c2BReceipt.aggregate({ where: { orgId, createdAt: { gte: today } }, _sum: { amount: true } }),
    prisma.loanApplication.count({ where: { orgId, status: { in: ["SUBMITTED", "AI_PRESCREEN", "OFFICER_REVIEW", "REFERRED"] } } }),
    prisma.disbursement.count({ where: { orgId, state: { in: ["PENDING_MAKER", "PENDING_CHECKER"] } } }),
  ]);
  // First-run checklist — only while the org is PENDING and not dismissed.
  const setupState = (org.onboardingState ?? {}) as { dismissed?: boolean; activationRequestedAt?: string };
  let checklist: ChecklistItem[] | null = null;
  if (org.status === "PENDING" && !setupState.dismissed) {
    const [products, workflows, staffCount, roleCount, integrations] = await Promise.all([
      prisma.product.count({ where: { orgId } }),
      prisma.workflow.count({ where: { orgId } }),
      prisma.staffUser.count({ where: { orgId, status: "ACTIVE" } }),
      prisma.role.count({ where: { orgId } }),
      prisma.orgIntegration.count({ where: { orgId } }),
    ]);
    checklist = [
      { key: "branding", label: "Brand your platform", detail: "Logo, colors and words — done at onboarding, refine any time.", href: "/console/settings/branding", done: true },
      { key: "products", label: "Create a loan product", detail: "Limits, interest, schedule — what you actually lend.", href: "/console/products", done: products > 0 },
      { key: "workflows", label: "Design your approval workflow", detail: "Who reviews, who approves, who finalizes — your stages, your caps.", href: "/console/workflows", done: workflows > 0 },
      { key: "roles", label: "Review your roles", detail: "Starter roles are in place — choose the menus each role sees.", href: "/console/roles", done: roleCount > 1 },
      { key: "team", label: "Invite your team", detail: "Officers, checkers, field agents — credentials are emailed.", href: "/console/team", done: staffCount > 1 },
      { key: "vault", label: "Connect your rails", detail: "M-Pesa (Daraja), SMS, CRB and KYC credentials in the vault.", href: "/console/settings", done: integrations > 0 },
    ];
  }

  const olb = Number(olbAgg._sum.balance ?? 0);
  const par30 = Number(par30Agg._sum.balance ?? 0);
  const fmt = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
  const TILES = [
    { label: "Outstanding loan book", value: fmt(olb), sub: `${activeCount} active loan${activeCount === 1 ? "" : "s"}` },
    { label: "PAR 30", value: olb > 0 ? `${((par30 / olb) * 100).toFixed(1)}%` : "0.0%", sub: fmt(par30) },
    { label: "Disbursed today", value: fmt(Number(disbToday._sum.amount ?? 0)), sub: null },
    { label: "Collected today", value: fmt(Number(collToday._sum.amount ?? 0)), sub: null },
    { label: "Applications waiting", value: String(liveApps), sub: null },
    { label: "Disbursements queued", value: String(pendingDisb), sub: null },
  ];

  return (
    <main className="mx-auto max-w-6xl px-4 sm:px-6 py-8">
      <h1 className="text-xl font-bold">Console</h1>
      <p className="mt-1 text-sm text-zinc-500">Your lending operation, org-scoped and isolated.</p>

      {checklist && (
        <SetupChecklist
          items={checklist}
          canAct={rights.has("settings.manage")}
          activationRequestedAt={setupState.activationRequestedAt ?? null}
        />
      )}

      <div className="mt-5 grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        {TILES.map((t) => (
          <div key={t.label} className="glass p-3.5">
            <p className="text-[10px] uppercase tracking-wide text-zinc-500">{t.label}</p>
            <p className="mt-1 text-base font-bold leading-tight" style={{ color: "var(--brand)" }}>{t.value}</p>
            {t.sub && <p className="mt-0.5 text-[10px] text-zinc-500">{t.sub}</p>}
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map(({ icon: Icon, title, desc, ready, ...m }) => {
          const card = (
            <div className={`glass p-5 h-full ${ready ? "hover:bg-white/80 transition-colors" : "opacity-60"}`}>
              <div className="flex items-center justify-between">
                <Icon className="h-6 w-6" style={{ color: "var(--brand)" }} aria-hidden />
                {!ready && <span className="rounded-md bg-zinc-900/5 px-2 py-0.5 text-[10px] font-semibold text-zinc-500">COMING UP</span>}
              </div>
              <h2 className="mt-3 text-sm font-semibold">{title}</h2>
              <p className="mt-1 text-sm leading-relaxed text-zinc-600">{desc}</p>
            </div>
          );
          if (m.href && ready) return <a key={title} href={m.href}>{card}</a>;
          // Riri opens the floating dock (mounted in the console layout) via a
          // global [data-riri-open] listener — no client component needed here.
          if (m.open && ready) return <button key={title} type="button" data-riri-open={m.open} className="text-left w-full">{card}</button>;
          return <div key={title}>{card}</div>;
        })}
      </div>
    </main>
  );
}
