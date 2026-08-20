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
import { getRights, getDeniedModules } from "@/lib/rbac/authz";
import { isDenied } from "@/lib/rbac/modules";
import { SUITE_APPS } from "@/lib/suite/apps";
import { resolveSuite } from "@/lib/suite/hosts";
import { getSuiteTelemetry } from "@/lib/suite/telemetry";
import SuiteBoard from "@/components/suite/SuiteBoard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SuiteLauncherPage() {
  const session = await auth();
  if (!session?.user?.orgId) redirect("/login?callbackUrl=/suite");

  const [org, rights, denied, telemetry] = await Promise.all([
    prisma.org.findUnique({
      where: { id: session.user.orgId },
      select: { name: true, accent: true, accentSoft: true },
    }),
    getRights(session),
    getDeniedModules(session),
    getSuiteTelemetry(),
  ]);

  // TWO DIFFERENT QUESTIONS, and conflating them is what makes access control
  // confusing to the person on the receiving end:
  //
  //   VISIBLE  — is this system part of your working life at all? Set per person
  //              by their administrator. A door turned off is not on the page.
  //   ENTERED  — do you hold the right that opens it? A visible door you cannot
  //              yet enter reads "Request access", which is a useful thing to
  //              see; an invisible one you could have entered is not.
  const visible = SUITE_APPS.filter((a) => !isDenied(denied, a.id)).map((a) => a.id);
  const entered = SUITE_APPS.filter((a) => !a.right || rights.has(a.right)).map((a) => a.id);

  return (
    <SuiteBoard
      who={session.user.name ?? session.user.email ?? "Signed in"}
      orgName={org?.name ?? "Your organisation"}
      entered={entered}
      visible={visible}
      hosts={resolveSuite()}
      telemetry={telemetry}
    />
  );
}
