import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  Users, Banknote, Gauge, FileText, Landmark, MessageSquare, Settings2, MapPin, ShieldCheck, Bot, Package, GitBranch,
} from "lucide-react";
import { SignOutButton } from "./signout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Staff console shell — the org-scoped home for officers/managers/admins.
// Modules below are the Phase-2+ build order; each card lights up as it ships.
const MODULES = [
  { icon: FileText, title: "Applications", desc: "AI pre-screened queue, SHAP reasons, two-tier approvals", ready: true, href: "/console/applications" },
  { icon: Package, title: "Products", desc: "Loan products: limits, interest, schedule, disbursement mode", ready: true, href: "/console/products" },
  { icon: GitBranch, title: "Workflows", desc: "Approval stage chains: tiers, OTP, finalize amount caps", ready: true, href: "/console/workflows" },
  { icon: Users, title: "Borrowers", desc: "The borrower book: KYC status, scores, OLB, graduation", ready: true, href: "/console/borrowers" },
  { icon: Users, title: "Team & Roles", desc: "Invite staff, approval tiers (INIT/AUTH/VALID), access", ready: true, href: "/console/team" },
  { icon: Banknote, title: "Loans & Disbursement", desc: "Maker-checker B2C queue, manual confirm, float ledger", ready: true, href: "/console/disbursements" },
  { icon: Landmark, title: "Repayments", desc: "STK requests, C2B receipts, unallocated exceptions", ready: true, href: "/console/repayments" },
  { icon: Gauge, title: "Credit Intelligence", desc: "Scorer, statement cruncher, portfolio early-warning", ready: false },
  { icon: MapPin, title: "Field & Routes", desc: "Geo-pinned verifications, nearest-agent allocation, drive routes", ready: true, href: "/console/field" },
  { icon: MessageSquare, title: "SMS & Comms", desc: "Templates, campaigns, delivery billing", ready: false },
  { icon: Bot, title: "Riri Analytics", desc: "Talk to your portfolio — OLB, PAR, due today", ready: false },
  { icon: Settings2, title: "Settings & Vault", desc: "Branding, team, roles, integrations (Daraja, SMS, CRB, KYC)", ready: true, href: "/console/settings" },
] as const;

export default async function Console() {
  const session = await auth();
  if (!session?.user?.orgId) redirect("/login");
  const orgId = session.user.orgId;

  const org = await prisma.org.findUnique({
    where: { id: orgId },
    select: { name: true, slug: true, status: true, mode: true, accent: true, accentSoft: true },
  });
  if (!org) redirect("/login");

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
    <div className="min-h-screen relative text-zinc-900" style={{ ["--brand" as never]: org.accent, ["--brand-soft" as never]: org.accentSoft }}>
      <div aria-hidden className="fixed inset-0 z-0 bg-[url('/images/white-background.png')] bg-cover bg-center" />

      <header className="sticky top-0 z-30 border-b border-zinc-900/10 bg-white/70 backdrop-blur-xl">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg text-white text-sm font-bold shrink-0" style={{ backgroundColor: "var(--brand)" }}>
              {org.name.slice(0, 1)}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold leading-tight truncate">{org.name}</p>
              <p className="text-[10px] text-zinc-500 leading-tight">{org.slug}.birgenai.com · {org.mode === "NATIVE" ? "Native book" : "Bridged (ServiceSuite)"}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {org.status !== "ACTIVE" && (
              <span className="rounded-md bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-700">
                <ShieldCheck className="inline h-3 w-3 mr-1 -mt-0.5" />Pending activation
              </span>
            )}
            <span className="hidden sm:block text-xs text-zinc-500 max-w-[160px] truncate">{session.user.name} · {session.user.role ?? "Staff"}</span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-6xl px-4 sm:px-6 py-8">
        <h1 className="text-xl font-bold">Console</h1>
        <p className="mt-1 text-sm text-zinc-500">Your lending operation, org-scoped and isolated.</p>

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
          {MODULES.map(({ icon: Icon, title, desc, ready, ...m }) => {
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
            return "href" in m && m.href && ready ? (
              <a key={title} href={m.href}>{card}</a>
            ) : (
              <div key={title}>{card}</div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
