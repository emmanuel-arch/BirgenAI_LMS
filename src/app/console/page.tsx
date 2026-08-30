import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRights } from "@/lib/rbac/authz";
import { entitlementsFor } from "@/lib/billing/entitlements";
import { resolveScope } from "@/lib/rbac/scope";
import { capabilityFor } from "@/lib/dashboard/filters.server";
import { LayoutGrid } from "lucide-react";
import SetupChecklist, { type ChecklistItem } from "@/components/console/SetupChecklist";
import ModuleLauncher from "@/components/console/ModuleLauncher";
import CinematicDashboard from "@/components/dashboard/CinematicDashboard";
import type { LiveSnapshot, DashboardProvenance } from "@/lib/dashboard/model";
import { resolveOrg } from "@/lib/tenancy";
import { getLiveDashboard } from "@/lib/lms/dashboard";

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

  const [rights, ent, scope] = await Promise.all([
    getRights(session),
    entitlementsFor(orgId),
    resolveScope(session),
  ]);

  const adminRole = (session.user.role ?? "").toLowerCase().includes("admin");
  const isAdmin = rights.has("settings.manage") || rights.has("roles.manage") || adminRole;

  // How much of the book may they see, and along which axes may they re-cut it?
  // Both answers come from the SAME resolved DataScope that filters their rows, so
  // the filter surface can never offer a branch whose loans they may not read.
  const capability = await capabilityFor(scope);

  // ── WHERE THIS LENDER'S NUMBERS COME FROM ────────────────────────────────
  // A BRIDGED lender's portfolio is not in our Postgres — it is in their own
  // ServiceSuite, and their managers already have a dashboard over it. So we read
  // THAT, through the same MainDashboard proc they use, rather than aggregating the
  // handful of applications we happen to have originated. For Micromart the
  // difference is not cosmetic: our tables hold 199 loans, their Micro Eazy book
  // holds ~59.8k.
  //
  // Native orgs keep the Postgres aggregate. An empty book yields null → the
  // dashboard runs its showcase, which is the right answer on a lender's day one.
  let live: LiveSnapshot | null = null;
  let provenance: DashboardProvenance | null = null;

  const tenant = await resolveOrg(org.slug);
  if (tenant?.mode === "BRIDGED" && tenant.bridgedReady && tenant.registry && tenant.entityId) {
    try {
      const dash = await getLiveDashboard(tenant.registry, tenant.entityId);
      if (dash && dash.provided.length > 0) {
        live = dash.snapshot;
        provenance = {
          source: "servicesuite",
          entityId: tenant.entityId,
          readAs: dash.readAs,
          liveMetrics: dash.provided,
          currencyLabel: dash.currencyLabel,
        };
      }
    } catch {
      // Their database being unreachable must not take the console down; the
      // dashboard falls through to the showcase and says so.
      live = null;
      provenance = null;
    }
  }

  if (!live) {
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
    if (activeCount > 0) {
      live = { olb, activeLoans: activeCount, totalArrears: arrears, par: olb > 0 ? (arrears / olb) * 100 : 0 };
      provenance = { source: "postgres", liveMetrics: ["olb", "activeLoans", "totalArrears", "par"] };
    }
  }

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
        capability={capability}
        live={live}
        provenance={provenance}
      />

      {isAdmin && (
        <section className="mt-8">
          <div className="mb-3 flex items-center gap-2">
            <LayoutGrid className="h-4 w-4 text-ash-400" />
            <h2 className="text-sm font-semibold">All modules</h2>
            <span className="rounded-md bg-ash-900/5 px-2 py-0.5 text-[10px] font-semibold text-ash-500">ADMIN</span>
          </div>
          <ModuleLauncher rights={rights} features={ent.features as ReadonlySet<string>} />
        </section>
      )}
    </main>
  );
}
