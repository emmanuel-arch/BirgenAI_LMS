// Ledgerly's chrome — the shared SuiteShell, an accent, and a nav tree.
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRights, getDeniedModules } from "@/lib/rbac/authz";
import { resolveSuite, hrefFor } from "@/lib/suite/hosts";
import { visibleSystemIds } from "@/lib/suite/access";
import { suiteApp } from "@/lib/suite/apps";
import { BOOKS_IDENTITY, BOOKS_NAV, satelliteNavFor } from "@/lib/suite/satellites";
import SuiteShell from "@/components/suite/SuiteShell";
import BrandHead from "@/components/BrandHead";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function BooksLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.orgId) redirect("/login?callbackUrl=/books");

  const [org, rights, denied] = await Promise.all([
    prisma.org.findUnique({
      where: { id: session.user.orgId },
      select: { name: true, slug: true, systems: true, logoUrl: true, logoScale: true },
    }),
    getRights(session),
    getDeniedModules(session),
  ]);
  if (!org) redirect("/login");

  // ── THE COMMERCIAL GATE ────────────────────────────────────────────────────
  // Hiding a tile on the launcher is a courtesy. THIS is the control: a lender
  // whose Ledgerly was switched off at /platform can still type /books, and
  // without a refusal here they would simply be inside it. Menu filtering has
  // never been an access boundary and is not sold as one.
  //
  // /suite rather than /login, because the person IS authenticated — bouncing a
  // signed-in user to a sign-in page to tell them their company does not have a
  // system reads as a broken session, which is the wrong support ticket.
  const visible = visibleSystemIds(org.systems, denied);
  if (!visible.includes("accounting")) redirect("/suite");

  const lms = suiteApp("lms");
  return (
    <>
      <BrandHead logoUrl={org.logoUrl} title={`${org.name} — Ledgerly`} />
      <SuiteShell
        identity={BOOKS_IDENTITY}
        nav={satelliteNavFor(BOOKS_NAV, rights, "accounting", denied)}
        org={{ name: org.name, slug: org.slug, logoUrl: org.logoUrl, logoScale: org.logoScale }}
        user={{ name: session.user.name ?? "Staff", email: session.user.email, role: session.user.role }}
        suiteHosts={resolveSuite(visible)}
        consoleHref={lms ? hrefFor(lms) : "/console"}
      >
        {children}
      </SuiteShell>
    </>
  );
}
