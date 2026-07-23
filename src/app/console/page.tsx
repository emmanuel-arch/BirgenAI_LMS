import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRights } from "@/lib/rbac/authz";
import { entitlementsFor } from "@/lib/billing/entitlements";
import { LayoutGrid } from "lucide-react";
import SetupChecklist, { type ChecklistItem } from "@/components/console/SetupChecklist";
import ModuleLauncher from "@/components/console/ModuleLauncher";
import CinematicDashboard from "@/components/dashboard/CinematicDashboard";
import type { LiveSnapshot, Scope } from "@/lib/dashboard/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Staff console home — the cinematic Portfolio Command dashboard. The old launcher
// grid is now admin-only (ModuleLauncher); everyone else navigates via the sidebar.
export default async function Console() {
  const session = await auth();
  if (!session?.user?.orgId) redirect("/login");
  const orgId = session.user.orgId;

  const org = await prisma.org.findUnique({
    where: { id: orgId },
    select: { name: true, slug: true, status: true, onboardingState: true, accent: true, accent2: true },
  });
  if (!org) redirect("/login");

  const [rights, ent] = await Promise.all([getRights(session), entitlementsFor(orgId)]);

  // Who is asking, and how much of the book may they see? Mirrors the proc's three
  // scopes: validator/admin → whole entity, authorizer → their unit, else own book.
  const tiers = session.user.tiers;
  const adminRole = (session.user.role ?? "").toLowerCase().includes("admin");
  const isAdmin = rights.has("settings.manage") || rights.has("roles.manage") || adminRole;
  const scope: Scope = (tiers?.validator || isAdmin) ? "entity" : tiers?.authorizer ? "unit" : "agent";
  const canPickScope = isAdmin || !!tiers?.validator;

  // Real portfolio position (range-invariant, always "as of now"). An empty book
  // (a lender that just onboarded) yields null → the dashboard runs its showcase.
  const par30Cutoff = new Date(Date.now() - 30 * 86400000);
  const [olbAgg, activeCount, par30Agg] = await Promise.all([
    prisma.loan.aggregate({ where: { orgId, status: "ACTIVE" }, _sum: { balance: true } }),
    prisma.loan.count({ where: { orgId, status: "ACTIVE" } }),
    prisma.loan.aggregate({
      where: { orgId, status: "ACTIVE", installments: { some: { status: "OVERDUE", dueDate: { lt: par30Cutoff } } } },
      _sum: { balance: true },
    }),
  ]);
  const olb = Number(olbAgg._sum.balance ?? 0);
  const arrears = Number(par30Agg._sum.balance ?? 0);
  const live: LiveSnapshot | null = activeCount > 0
    ? { olb, activeLoans: activeCount, totalArrears: arrears, par: olb > 0 ? (arrears / olb) * 100 : 0 }
    : null;

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

  return (
    <main className="mx-auto max-w-6xl px-4 sm:px-6 py-6 sm:py-8">
      {checklist && (
        <div className="mb-5">
          <SetupChecklist
            items={checklist}
            canAct={rights.has("settings.manage")}
            activationRequestedAt={setupState.activationRequestedAt ?? null}
          />
        </div>
      )}

      <CinematicDashboard
        orgName={org.name}
        orgSlug={org.slug}
        accent={org.accent || "#0f172a"}
        accent2={org.accent2 || org.accent || "#334155"}
        initialScope={scope}
        canPickScope={canPickScope}
        live={live}
      />

      {isAdmin && (
        <section className="mt-8">
          <div className="mb-3 flex items-center gap-2">
            <LayoutGrid className="h-4 w-4 text-zinc-400" />
            <h2 className="text-sm font-semibold">All modules</h2>
            <span className="rounded-md bg-zinc-900/5 px-2 py-0.5 text-[10px] font-semibold text-zinc-500">ADMIN</span>
          </div>
          <ModuleLauncher rights={rights} features={ent.features as ReadonlySet<string>} />
        </section>
      )}
    </main>
  );
}
