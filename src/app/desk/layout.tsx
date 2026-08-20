// ─────────────────────────────────────────────────────────────────────────────
// CONNECTDESK — its own system, its own front door, the same identity.
//
// The layout's job is the same as the console's and the studio's: decide, once
// per request and on the server, who this person is and which screens they may
// see. None of that reasoning is duplicated — it reads the SAME session and the
// SAME rights, because "one login, six systems" has to be true at the
// authorisation layer or it is a slogan.
//
// The badge on the queue item is computed here rather than in the client, and it
// is not decoration: an agent arriving at the floor should be able to see how
// much unworked book is waiting without navigating to it. It is the one number
// worth a database round trip on every page of this system.
// ─────────────────────────────────────────────────────────────────────────────
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRights, getDeniedModules } from "@/lib/rbac/authz";
import { resolveSuite, hrefFor } from "@/lib/suite/hosts";
import { suiteApp } from "@/lib/suite/apps";
import { deskNavFor, DESK_IDENTITY } from "@/lib/desk/nav";
import { collectBoxOrg, isCollectBoxConfigured } from "@/lib/collectbox/client";
import { countQueue } from "@/lib/collectbox/floor";
import SuiteShell from "@/components/suite/SuiteShell";
import BrandHead from "@/components/BrandHead";
import DeskPulse from "@/components/desk/DeskPulse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DeskLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.orgId) redirect("/login?callbackUrl=/desk");

  const [org, rights, denied] = await Promise.all([
    prisma.org.findUnique({
      where: { id: session.user.orgId },
      select: { name: true, slug: true, logoUrl: true, logoScale: true },
    }),
    getRights(session),
    getDeniedModules(session),
  ]);
  if (!org) redirect("/login");

  // ConnectDesk works a lender's arrears book. That is a collections right, not
  // a lending one — sending someone without it back to the console they came
  // from is more useful than a 403 page.
  if (!rights.has("collections.view") && !rights.has("collections.manage")) redirect("/console");

  // How much is sitting unworked today. Best-effort: a slow or unreachable
  // CollectBox must not stop the whole system rendering, so the badge simply
  // does not appear.
  let untouched: number | null = null;
  if (isCollectBoxConfigured(org.slug) || isCollectBoxConfigured("micromart")) {
    try {
      untouched = await countQueue(collectBoxOrg("micromart"), { untouchedToday: true });
    } catch {
      untouched = null;
    }
  }

  const nav = deskNavFor(rights, {
    badges: { queue: untouched != null ? (untouched > 999 ? `${Math.round(untouched / 1000)}k` : untouched) : null },
    denied,
  });
  const lms = suiteApp("lms");

  return (
    <>
      <BrandHead logoUrl={org.logoUrl} title={`${org.name} — ConnectDesk`} />
      <SuiteShell
        identity={DESK_IDENTITY}
        nav={nav}
        org={{ name: org.name, slug: org.slug, logoUrl: org.logoUrl, logoScale: org.logoScale }}
        user={{ name: session.user.name ?? "Staff", email: session.user.email, role: session.user.role }}
        suiteHosts={resolveSuite()}
        consoleHref={lms ? hrefFor(lms) : "/console"}
        headerRight={<DeskPulse />}
      >
        {children}
      </SuiteShell>
    </>
  );
}
