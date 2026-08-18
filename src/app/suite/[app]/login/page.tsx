// ─────────────────────────────────────────────────────────────────────────────
// A satellite system's OWN login page.
//
// Each product keeps its own front door and its own artwork; but if a BirgenAI ID
// session already exists there is no password to type — one click and you are in.
// That is "six different login pages, authenticated once" made literal, and it is
// the single clearest demonstration of what the suite is.
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
import { hrefFor } from "@/lib/suite/hosts";
import SuiteDoor from "@/components/suite/SuiteDoor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function SatelliteLogin({ params }: { params: Promise<{ app: string }> }) {
  const { app: appId } = await params;
  const app = suiteApp(appId);
  if (!app) redirect("/suite");

  const art = artworkFor(app.id);
  if (!art) redirect("/suite");

  const session = await auth();
  const who = session?.user?.name ?? session?.user?.email ?? null;

  const org = session?.user?.orgId
    ? await prisma.org.findUnique({ where: { id: session.user.orgId }, select: { name: true, logoUrl: true } })
    : null;

  // Checked at request time rather than build time so dropping a PNG in takes
  // effect on the next render, with no rebuild and no code change.
  const hasArtwork = existsSync(join(process.cwd(), "public", art.file.replace(/^\//, "")));

  return (
    <SuiteDoor
      app={{ id: app.id, name: app.name, tagline: app.tagline, accent: app.accent, modules: app.modules, icon: app.icon }}
      art={art}
      who={who}
      orgName={org?.name ?? null}
      logoUrl={org?.logoUrl ?? null}
      continueHref={hrefFor(app)}
      hasArtwork={hasArtwork}
    />
  );
}
