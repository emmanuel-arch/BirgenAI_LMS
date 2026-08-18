// ─────────────────────────────────────────────────────────────────────────────
// BirgenAI ID — the connected-suite launcher.
//
// The server's jobs: prove the session, name the org, decide which systems this
// person is actually INSIDE (as opposed to merely able to look at), and read one
// live figure per system so the launcher is a demonstration rather than a menu.
//
// The telemetry read is best-effort by construction (see lib/suite/telemetry.ts):
// this is the first screen anyone sees, and a database blip must degrade the
// numbers, never the doors.
// ─────────────────────────────────────────────────────────────────────────────
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRights } from "@/lib/rbac/authz";
import { SUITE_APPS } from "@/lib/suite/apps";
import { resolveSuite } from "@/lib/suite/hosts";
import { getSuiteTelemetry } from "@/lib/suite/telemetry";
import SuiteBoard from "@/components/suite/SuiteBoard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SuiteLauncherPage() {
  const session = await auth();
  if (!session?.user?.orgId) redirect("/login?callbackUrl=/suite");

  const [org, rights, telemetry] = await Promise.all([
    prisma.org.findUnique({
      where: { id: session.user.orgId },
      select: { name: true, accent: true, accentSoft: true },
    }),
    getRights(session),
    getSuiteTelemetry(),
  ]);

  // "Signed in" means holding a role in that system — not merely holding a valid
  // identity. The satellites have no rights vocabulary of their own yet, so any
  // session is inside them; the ones that do declare a right gate on it.
  const entered = SUITE_APPS.filter((a) => !a.right || rights.has(a.right)).map((a) => a.id);

  return (
    <SuiteBoard
      who={session.user.name ?? session.user.email ?? "Signed in"}
      orgName={org?.name ?? "Your organisation"}
      entered={entered}
      hosts={resolveSuite()}
      telemetry={telemetry}
    />
  );
}
