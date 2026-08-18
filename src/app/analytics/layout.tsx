// ─────────────────────────────────────────────────────────────────────────────
// THE ANALYTICS STUDIO — its own system, its own chrome, the same identity.
//
// This layout is the studio's equivalent of the console's: it decides, once per
// request and on the server, who this person is and which modules they may see.
// Nothing about that reasoning is duplicated — it reads the SAME rights and the
// SAME session as the console, because "one login, six systems" has to be true
// at the authorisation layer or it is marketing.
//
// The studio lives at /analytics inside this deployment and is rewritten onto
// analytics.birgenai.com by src/proxy.ts. When it is split into its own origin,
// SUITE_ANALYTICS_ORIGIN moves it and nothing here changes — the same mechanism
// already proven for the other satellites (src/lib/suite/hosts.ts).
// ─────────────────────────────────────────────────────────────────────────────
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRights } from "@/lib/rbac/authz";
import { studioNavFor } from "@/lib/analytics/studio-nav";
import { resolveSuite, hrefFor } from "@/lib/suite/hosts";
import { suiteApp } from "@/lib/suite/apps";
import StudioShell from "@/components/analytics/StudioShell";
import BrandHead from "@/components/BrandHead";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.orgId) redirect("/login?callbackUrl=/analytics");

  const [org, rights] = await Promise.all([
    prisma.org.findUnique({
      where: { id: session.user.orgId },
      select: { name: true, slug: true, mode: true, logoUrl: true },
    }),
    getRights(session),
  ]);
  if (!org) redirect("/login");

  // The studio reads the WHOLE book. That is a reporting right, not a lending
  // one — a field officer with borrowers.view has no business reading group PAR,
  // and sending them back to the console is more useful than a 403 page.
  if (!rights.has("reports.view") && !rights.has("reports.analytics")) redirect("/console");

  const nav = studioNavFor(rights, { bridged: org.mode === "BRIDGED" });
  const lms = suiteApp("lms");

  return (
    <>
      <BrandHead logoUrl={org.logoUrl} title={`${org.name} — Analytics Studio`} />
      <StudioShell
        nav={nav}
        org={{ name: org.name, slug: org.slug, mode: org.mode, logoUrl: org.logoUrl }}
        user={{ name: session.user.name ?? "Staff", email: session.user.email, role: session.user.role }}
        suiteHosts={resolveSuite()}
        consoleHref={lms ? hrefFor(lms) : "/console"}
      >
        {children}
      </StudioShell>
    </>
  );
}
