// Console layout — the enterprise shell around every module page.
//
// This is where "who sees what" is decided, once per request, server-side:
// the caller's role rights (src/lib/rbac) intersect the org's plan entitlements
// intersect the nav registry, and the client shell just renders the survivors.
// The org accent is set here so the whole console (and the Riri dock, a fixed
// child of this wrapper) inherits --brand. Riri mounts here, once, so her
// conversation and position survive navigation between modules.
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRights } from "@/lib/rbac/authz";
import { entitlementsFor } from "@/lib/billing/entitlements";
import { navFor } from "@/lib/nav/registry";
import Shell from "@/components/shell/Shell";
import RiriDock from "@/components/riri/RiriDock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const org = session?.user?.orgId
    ? await prisma.org.findUnique({
        where: { id: session.user.orgId },
        select: { name: true, slug: true, mode: true, status: true, accent: true, accentSoft: true, logoUrl: true },
      })
    : null;

  // Not signed in (the child page redirects to /login): render bare, no chrome.
  if (!org || !session?.user) return <>{children}</>;

  const [rights, ent] = await Promise.all([getRights(session), entitlementsFor(session.user.orgId!)]);
  const nav = navFor(rights, ent.features as ReadonlySet<string>);

  return (
    <div style={{ ["--brand" as never]: org.accent, ["--brand-soft" as never]: org.accentSoft }}>
      <Shell
        nav={nav}
        org={{ name: org.name, slug: org.slug, mode: org.mode, status: org.status, logoUrl: org.logoUrl }}
        user={{ name: session.user.name ?? "Staff", email: session.user.email, role: session.user.role }}
        impersonator={session.user.impersonator ? { name: session.user.impersonator.name } : null}
      >
        {children}
      </Shell>
      <RiriDock orgName={org.name} userName={session.user.name ?? null} />
    </div>
  );
}
