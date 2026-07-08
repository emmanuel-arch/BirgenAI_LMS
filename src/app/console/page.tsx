import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  Users, Banknote, Gauge, FileText, Landmark, MessageSquare, Settings2, MapPin, ShieldCheck, Bot, Package,
} from "lucide-react";
import { SignOutButton } from "./signout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Staff console shell — the org-scoped home for officers/managers/admins.
// Modules below are the Phase-2+ build order; each card lights up as it ships.
const MODULES = [
  { icon: FileText, title: "Applications", desc: "AI pre-screened queue, SHAP reasons, two-tier approvals", ready: true, href: "/console/applications" },
  { icon: Package, title: "Products", desc: "Loan products: limits, interest, schedule, disbursement mode", ready: true, href: "/console/products" },
  { icon: Users, title: "Borrowers", desc: "KYC profiles, Customer-360, consents", ready: false },
  { icon: Banknote, title: "Loans & Disbursement", desc: "Maker-checker B2C queue, manual confirm, float ledger", ready: true, href: "/console/disbursements" },
  { icon: Landmark, title: "Repayments", desc: "STK push, C2B receipting, reconciliation", ready: false },
  { icon: Gauge, title: "Credit Intelligence", desc: "Scorer, statement cruncher, portfolio early-warning", ready: false },
  { icon: MapPin, title: "Field & Routes", desc: "Geo-pinned verifications, RO route planner", ready: false },
  { icon: MessageSquare, title: "SMS & Comms", desc: "Templates, campaigns, delivery billing", ready: false },
  { icon: Bot, title: "Riri Analytics", desc: "Talk to your portfolio — OLB, PAR, due today", ready: false },
  { icon: Settings2, title: "Settings & Vault", desc: "Branding, team, roles, integrations (Daraja, SMS, CRB, KYC)", ready: true, href: "/console/settings" },
] as const;

export default async function Console() {
  const session = await auth();
  if (!session?.user?.orgId) redirect("/login");

  const org = await prisma.org.findUnique({
    where: { id: session.user.orgId },
    select: { name: true, slug: true, status: true, mode: true, accent: true, accentSoft: true },
  });
  if (!org) redirect("/login");

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
        <p className="mt-1 text-sm text-zinc-500">Your lending operation, org-scoped and isolated. Modules light up as they ship.</p>

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
