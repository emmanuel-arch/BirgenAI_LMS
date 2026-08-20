// Console layout — the enterprise shell around every module page.
//
// This is where "who sees what" is decided, once per request, server-side:
// the caller's role rights (src/lib/rbac) intersect the org's plan entitlements
// intersect the nav registry, and the client shell just renders the survivors.
// The org accent is set here so the whole console — and ServiceSuite OS, a fixed
// child of this wrapper — inherits --brand. The assistant mounts here, once, so
// its conversation, its position and its navigation stack survive moving between
// modules. That matters more than it used to: Autopilot navigates the console
// underneath the device, and a device that remounted on every route change would
// lose the conversation that asked to be taken there.
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRights, getDeniedModules } from "@/lib/rbac/authz";
import { entitlementsFor } from "@/lib/billing/entitlements";
import { navFor } from "@/lib/nav/registry";
import { resolveSuite } from "@/lib/suite/hosts";
import Shell from "@/components/shell/Shell";
import ServiceSuiteOS from "@/components/os/ServiceSuiteOS";
import BrandHead from "@/components/BrandHead";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const org = session?.user?.orgId
    ? await prisma.org.findUnique({
        where: { id: session.user.orgId },
        select: { name: true, slug: true, mode: true, status: true, accent: true, accentSoft: true, logoUrl: true, logoScale: true },
      })
    : null;

  // Not signed in (the child page redirects to /login): render bare, no chrome.
  if (!org || !session?.user) return <>{children}</>;

  const [rights, denied, ent] = await Promise.all([getRights(session), getDeniedModules(session), entitlementsFor(session.user.orgId!)]);
  const nav = navFor(rights, ent.features as ReadonlySet<string>, denied);

  return (
    <div style={{ ["--brand" as never]: org.accent, ["--brand-soft" as never]: org.accentSoft }}>
      <BrandHead logoUrl={org.logoUrl} title={`${org.name} — Console`} />
      <Shell
        nav={nav}
        org={{ name: org.name, slug: org.slug, mode: org.mode, status: org.status, logoUrl: org.logoUrl, logoScale: org.logoScale }}
        user={{ name: session.user.name ?? "Staff", email: session.user.email, role: session.user.role }}
        impersonator={session.user.impersonator ? { name: session.user.impersonator.name } : null}
        suiteHosts={resolveSuite()}
      >
        {children}
      </Shell>
      <ServiceSuiteOS orgName={org.name} userName={session.user.name ?? null} />
    </div>
  );
}
