// ─────────────────────────────────────────────────────────────────────────────
// A SYSTEM'S OWN LOGIN PAGE.
//
// Each product keeps its own front door and its own artwork. If a BirgenAI ID
// session already exists there is no password to type — one click, on a button
// carrying the person's own first name, and they are in. If there is not, the
// same page shows the real email-and-password form rather than throwing the
// visitor back to a generic sign-in that has forgotten which system they asked
// for. That is "a login page per system, authenticated once" made literal, and
// it is the single clearest demonstration of what the suite is.
//
// This route is what every branded host serves at "/" — connectdesk.…, ledgerly.…,
// analytics.… all rewrite here (see lib/suite/labels.ts and proxy.ts) — so it is
// the first thing most staff ever see of the platform.
//
// The artwork file is optional: until it is generated the door renders a gradient
// in the same accent (see lib/suite/artwork.ts), so a half-finished asset set
// never looks like a half-finished product.
// ─────────────────────────────────────────────────────────────────────────────
import { redirect } from "next/navigation";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { suiteApp } from "@/lib/suite/apps";
import { artworkFor } from "@/lib/suite/artwork";
import { entitledSystems } from "@/lib/suite/entitlements";
import { hrefFor, resolveSuite } from "@/lib/suite/hosts";
import SuiteDoor from "@/components/suite/SuiteDoor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SatelliteLogin({ params }: { params: Promise<{ app: string }> }) {
  const { app: appId } = await params;
  const app = suiteApp(appId);
  if (!app) redirect("/suite");

  // Systems with no staff door of their own. The Customer Portal belongs to
  // borrowers and the Interchange is a separate deployment with its own member
  // gate — neither can honour a "Continue as …" button, so neither gets one.
  if (app.external || app.door === false) redirect("/suite");

  const art = artworkFor(app.id);
  if (!art) redirect("/suite");

  const session = await auth();
  const who = session?.user?.name ?? session?.user?.email ?? null;

  const org = session?.user?.orgId
    ? await prisma.org.findUnique({
        where: { id: session.user.orgId },
        select: { name: true, slug: true, logoUrl: true, systems: true },
      })
    : null;

  // ── THE COMMERCIAL GATE ────────────────────────────────────────────────────
  // A signed-in person whose organisation never bought this system must not be
  // offered a "Continue as …" button that lands them on a 403 one click later. A
  // door onto a refusal is worse than no door — it reads as a broken product
  // rather than as a system this lender does not have.
  //
  // Checked ONLY when there is a session, because without one there is no
  // organisation to check against. An unauthenticated visitor sees the form; if
  // the credentials they type belong to a lender without this system, the
  // launcher they land on simply will not show it.
  if (org && !entitledSystems(org.systems).has(app.id)) redirect("/suite");

  // Just the first name for the button. `session.user.name` is
  // "${firstName} ${otherName}" (see /api/auth/login), so the first token is the
  // right one — and the fallback down the chain never renders a bare email
  // local-part as though it were somebody's name.
  const firstName = session?.user?.name?.trim().split(/\s+/)[0] || null;

  // Checked at request time rather than build time so dropping a file in takes
  // effect on the next render, with no rebuild and no code change.
  const hasArtwork = existsSync(join(process.cwd(), "public", art.file.replace(/^\//, "")));

  // ── WHAT THE CORNER SWITCHER OFFERS ────────────────────────────────────────
  // The doors this visitor could walk to instead. It replaces the "All six
  // systems" link that used to sit in the bottom-right corner of this page and
  // hard-code a count onto a screen served to lenders who bought four.
  //
  // Scoped to the lender WHERE THERE IS ONE. A signed-in visitor whose
  // organisation holds four systems is offered four; an anonymous visitor is
  // offered all of them, because without a session there is no organisation to
  // scope by and a guess would be wrong for everybody whose lender bought a
  // different four. Each door gates itself on arrival either way — the
  // entitlement check a dozen lines above is that gate — so this menu is a
  // convenience and never an access boundary.
  const hosts = org ? resolveSuite([...entitledSystems(org.systems)]) : resolveSuite();

  return (
    <SuiteDoor
      app={{ id: app.id, name: app.name, tagline: app.tagline, accent: app.accent, modules: app.modules, icon: app.icon }}
      art={art}
      who={who}
      firstName={firstName}
      orgName={org?.name ?? null}
      orgSlug={org?.slug ?? null}
      logoUrl={org?.logoUrl ?? null}
      continueHref={hrefFor(app)}
      hasArtwork={hasArtwork}
      hosts={hosts}
    />
  );
}
