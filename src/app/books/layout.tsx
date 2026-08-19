// Ledgerly's chrome — the shared SuiteShell, an accent, and a nav tree.
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRights } from "@/lib/rbac/authz";
import { resolveSuite, hrefFor } from "@/lib/suite/hosts";
import { suiteApp } from "@/lib/suite/apps";
import { BOOKS_IDENTITY, BOOKS_NAV, satelliteNavFor } from "@/lib/suite/satellites";
import SuiteShell from "@/components/suite/SuiteShell";
import BrandHead from "@/components/BrandHead";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function BooksLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.orgId) redirect("/login?callbackUrl=/books");

  const [org, rights] = await Promise.all([
    prisma.org.findUnique({
      where: { id: session.user.orgId },
      select: { name: true, slug: true, logoUrl: true, logoScale: true },
    }),
    getRights(session),
  ]);
  if (!org) redirect("/login");

  const lms = suiteApp("lms");
  return (
    <>
      <BrandHead logoUrl={org.logoUrl} title={`${org.name} — Ledgerly`} />
      <SuiteShell
        identity={BOOKS_IDENTITY}
        nav={satelliteNavFor(BOOKS_NAV, rights)}
        org={{ name: org.name, slug: org.slug, logoUrl: org.logoUrl, logoScale: org.logoScale }}
        user={{ name: session.user.name ?? "Staff", email: session.user.email, role: session.user.role }}
        suiteHosts={resolveSuite()}
        consoleHref={lms ? hrefFor(lms) : "/console"}
      >
        {children}
      </SuiteShell>
    </>
  );
}
