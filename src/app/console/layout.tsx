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
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRights, getDeniedModules } from "@/lib/rbac/authz";
import { entitlementsFor } from "@/lib/billing/entitlements";
import { navFor } from "@/lib/nav/registry";
import { resolveSuite } from "@/lib/suite/hosts";
import { visibleSystemIds } from "@/lib/suite/access";
import { realmsFor, brandFor } from "@/lib/suite/realms";
import { activeRealm } from "@/lib/suite/realm-server";
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
        select: { name: true, slug: true, mode: true, status: true, systems: true, accent: true, accentSoft: true, accent2: true, logoUrl: true, logoScale: true },
      })
    : null;

  // Not signed in (the child page redirects to /login): render bare, no chrome.
  if (!org || !session?.user) return <>{children}</>;

  const [rights, denied, ent] = await Promise.all([getRights(session), getDeniedModules(session), entitlementsFor(session.user.orgId!)]);
  const nav = navFor(rights, ent.features as ReadonlySet<string>, denied);

  // ── THE COMMERCIAL GATE ────────────────────────────────────────────────────
  // The lending console is the anchor of the suite and switching it off is
  // unusual — but it is a real, reachable state (a lender who bought only
  // PeopleHub and Ledgerly), and "unusual" is not "impossible". Hiding the tile
  // on the launcher is a courtesy; this refusal is the control.
  const visible = visibleSystemIds(org.systems, denied);
  if (!visible.includes("lms")) redirect("/suite");

  // ── WHICH BOOK ─────────────────────────────────────────────────────────────
  // Micromart is two lenders wearing one name (see lib/suite/realms.ts). The
  // realm is resolved HERE, once per request, for the same reason rights are:
  // it qualifies everything rendered underneath, and a context that each page
  // resolved for itself would eventually disagree with the colour on screen.
  //
  // --brand comes from the realm rather than the org row, so the whole console —
  // and ServiceSuite OS with it — re-paints on a switch without a single
  // component knowing that books exist. A single-book lender resolves to null
  // and gets exactly the org's own accent, unchanged.
  const realm = await activeRealm(org.slug);
  const brand = brandFor(realm, org);
  const realms = realmsFor(org.slug).map((r) => ({
    id: r.id,
    label: r.label,
    name: r.name,
    blurb: r.blurb,
    entityId: r.entityId,
    brand: brandFor(r, org),
  }));

  return (
    <div style={{ ["--brand" as never]: brand.accent, ["--brand-soft" as never]: brand.accentSoft }}>
      {/* The tab says which BOOK, not just which lender — two windows open on
          the two entities are otherwise indistinguishable in the task bar. */}
      <BrandHead logoUrl={org.logoUrl} title={`${realm?.name ?? org.name} — Console`} />
      <Shell
        nav={nav}
        org={{ name: org.name, slug: org.slug, mode: org.mode, status: org.status, logoUrl: org.logoUrl, logoScale: org.logoScale }}
        user={{ name: session.user.name ?? "Staff", email: session.user.email, role: session.user.role }}
        impersonator={session.user.impersonator ? { name: session.user.impersonator.name } : null}
        suiteHosts={resolveSuite(visible)}
        realms={realms}
        activeRealm={realm?.id ?? ""}
      >
        {children}
      </Shell>
      <ServiceSuiteOS orgName={org.name} userName={session.user.name ?? null} />
    </div>
  );
}
