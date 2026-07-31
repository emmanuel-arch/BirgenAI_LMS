// ─────────────────────────────────────────────────────────────────────────────
// BirgenAI ID — the connected-suite launcher. One identity across Lending, the
// Customer Portal, HR, Accounting and the Call-Center.
//
// The server's only jobs here are to prove the session, name the org, and decide
// which systems this person is actually *inside* (as opposed to merely able to
// look at). The launcher itself is a client component so the identity rail can
// animate — see components/suite/SuiteLauncher.tsx.
// ─────────────────────────────────────────────────────────────────────────────
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRights } from "@/lib/rbac/authz";
import { SUITE_APPS } from "@/lib/suite/apps";
import SuiteLauncher from "@/components/suite/SuiteLauncher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SuiteLauncherPage() {
  const session = await auth();
  if (!session?.user?.orgId) redirect("/login?callbackUrl=/suite");

  const [org, rights] = await Promise.all([
    prisma.org.findUnique({
      where: { id: session.user.orgId },
      select: { name: true, accent: true, accentSoft: true },
    }),
    getRights(session),
  ]);

  // "Signed in" means a role in that system — not merely a valid identity. The
  // satellites have no rights vocabulary of their own yet, so anyone with a
  // session is inside them; the LMS gates on the same right the console does.
  const entered = SUITE_APPS.filter((a) => !a.right || rights.has(a.right)).map((a) => a.id);

  return (
    <div
      style={{
        ["--brand" as never]: org?.accent ?? "#f97316",
        ["--brand-soft" as never]: org?.accentSoft ?? "rgba(249,115,22,0.12)",
      }}
    >
      <SuiteLauncher
        who={session.user.name ?? session.user.email ?? "Signed in"}
        orgName={org?.name ?? "Your organisation"}
        entered={entered}
      />
    </div>
  );
}
