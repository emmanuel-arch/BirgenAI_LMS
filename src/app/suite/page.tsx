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
import { existsSync } from "node:fs";
import { join } from "node:path";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getRights, getDeniedModules } from "@/lib/rbac/authz";
import { isDenied } from "@/lib/rbac/modules";
import { SUITE_APPS } from "@/lib/suite/apps";
import { entitledSystems } from "@/lib/suite/entitlements";
import { resolveSuite } from "@/lib/suite/hosts";
import { getSuiteTelemetry } from "@/lib/suite/telemetry";
import { artworkFor } from "@/lib/suite/artwork";
import SuiteBoard from "@/components/suite/SuiteBoard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SuiteLauncherPage() {
  const session = await auth();
  if (!session?.user?.orgId) redirect("/login?callbackUrl=/suite");

  const [org, rights, denied, telemetry] = await Promise.all([
    prisma.org.findUnique({
      where: { id: session.user.orgId },
      select: { name: true, accent: true, accentSoft: true, systems: true },
    }),
    getRights(session),
    getDeniedModules(session),
    getSuiteTelemetry(),
  ]);

  // THREE DIFFERENT QUESTIONS, and conflating any two of them is what makes
  // access control impossible to explain to the person on the receiving end:
  //
  //   ENTITLED — did this ORGANISATION buy this system? Set by the platform
  //              admin at /platform. Commercial, and org-wide: switching one off
  //              takes the door away from everybody at this lender at once.
  //   VISIBLE  — is this system part of YOUR working life at all? Set per person
  //              by their administrator. A door turned off is not on the page.
  //   ENTERED  — do you hold the right that opens it? A visible door you cannot
  //              yet enter reads "Request access", which is a useful thing to
  //              see; an invisible one you could have entered is not.
  //
  // They compose by AND, in that order.
  const entitled = entitledSystems(org?.systems);
  const visible = SUITE_APPS
    .filter((a) => entitled.has(a.id) && !isDenied(denied, a.id))
    .map((a) => a.id);
  const entered = SUITE_APPS.filter((a) => !a.right || rights.has(a.right)).map((a) => a.id);

  // ── WHICH PLATES ARE ACTUALLY ON DISK ──────────────────────────────────────
  // Each card on the rail wears its own system’s front-door artwork, so the
  // launcher and the door it opens are visibly one product. The files are
  // optional by design (see lib/suite/artwork), and the check has to happen HERE
  // rather than in the card: a client component cannot stat the filesystem, so
  // it would request a missing image, fail, and flash its fallback gradient in
  // after the fact. Checked at request time, so dropping a plate in takes effect
  // on the next render with no rebuild.
  const art = SUITE_APPS.map((a) => {
    const w = artworkFor(a.id);
    return {
      id: a.id,
      file: w?.file ?? "",
      gradient: w?.gradient ?? "#0b0a10",
      hasFile: !!w && existsSync(join(process.cwd(), "public", w.file.replace(/^\//, ""))),
    };
  });

  return (
    <SuiteBoard
      who={session.user.name ?? session.user.email ?? "Signed in"}
      orgName={org?.name ?? "Your organisation"}
      entered={entered}
      visible={visible}
      hosts={resolveSuite(visible)}
      telemetry={telemetry}
      art={art}
    />
  );
}
