// Org branding (own org).
//   GET → current branding (settings.view)
//   PUT → { logoDataUrl?, accent?, accent2?, accentSoft?, tagline?, blurb? }
//         (branding.manage) — logo goes to the public brand bucket (or stays a
//         size-capped data URL in simulation), colors are format-validated, the
//         previous logo object is best-effort deleted, and the change is audited.
//
// Tenant isolation is structural: this route can only ever write its own org's
// row, and logo keys are org-prefixed — one lender's brand cannot touch another's.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireRight } from "@/lib/rbac/authz";
import { putBrandLogo, deleteBrandLogo, storageMode, InvalidImageError, StorageConfigError } from "@/lib/storage/provider";
import { isHexColor, isCssRgba } from "@/lib/branding/palette";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  const denied = await requireRight(session, "settings.view");
  if (denied) return denied;

  const org = await prisma.org.findUniqueOrThrow({
    where: { id: session!.user!.orgId! },
    select: { name: true, slug: true, accent: true, accentSoft: true, accent2: true, tagline: true, blurb: true, logoUrl: true, logoScale: true },
  });
  return NextResponse.json({ success: true, branding: org, storage: storageMode() });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  const denied = await requireRight(session, "branding.manage");
  if (denied) return denied;
  const orgId = session!.user!.orgId!;

  let body: { logoDataUrl?: string | null; accent?: string; accent2?: string; accentSoft?: string; tagline?: string | null; blurb?: string | null; logoScale?: number };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  if (body.logoScale !== undefined && (!Number.isFinite(body.logoScale) || body.logoScale < 50 || body.logoScale > 200)) {
    return NextResponse.json({ success: false, message: "Logo size must be between 50% and 200%." }, { status: 400 });
  }

  if (body.accent !== undefined && !isHexColor(body.accent)) {
    return NextResponse.json({ success: false, message: "Accent must be a hex color like #E11D48." }, { status: 400 });
  }
  if (body.accent2 !== undefined && body.accent2 !== null && !isHexColor(body.accent2)) {
    return NextResponse.json({ success: false, message: "The gradient color must be a hex color." }, { status: 400 });
  }
  if (body.accentSoft !== undefined && !isCssRgba(body.accentSoft)) {
    return NextResponse.json({ success: false, message: "The soft accent must be an rgba() color." }, { status: 400 });
  }
  const trim = (s: string | null | undefined, max: number) =>
    s === undefined ? undefined : s === null ? null : s.trim().slice(0, max) || null;

  const prior = await prisma.org.findUniqueOrThrow({ where: { id: orgId }, select: { logoUrl: true } });

  let logoUrl: string | undefined;
  if (body.logoDataUrl) {
    try {
      logoUrl = await putBrandLogo(orgId, body.logoDataUrl);
    } catch (e) {
      if (e instanceof InvalidImageError) return NextResponse.json({ success: false, message: e.message }, { status: 400 });
      // A broken storage credential is OUR misconfiguration, not the admin's bad file.
      // Say so, and say it where they can read it — the alternative was a 500 whose
      // only clue was "Invalid Compact JWS" buried in the server log.
      if (e instanceof StorageConfigError) {
        console.error("[branding] storage is misconfigured:", e.message);
        return NextResponse.json({ success: false, message: `Your colours are fine — the logo couldn't be stored because object storage is misconfigured. ${e.message}` }, { status: 503 });
      }
      throw e;
    }
  }

  const org = await prisma.org.update({
    where: { id: orgId },
    data: {
      accent: body.accent ?? undefined,
      accent2: body.accent2 === undefined ? undefined : body.accent2,
      accentSoft: body.accentSoft ?? undefined,
      tagline: trim(body.tagline, 120),
      blurb: trim(body.blurb, 240),
      logoUrl,
      logoScale: body.logoScale === undefined ? undefined : Math.round(body.logoScale),
    },
    select: { accent: true, accentSoft: true, accent2: true, tagline: true, blurb: true, logoUrl: true, logoScale: true },
  });

  // A replaced logo's old object serves nobody — clean it up, best-effort.
  if (logoUrl && prior.logoUrl && prior.logoUrl !== logoUrl) await deleteBrandLogo(prior.logoUrl);

  await prisma.auditLog.create({
    data: {
      orgId, actorId: session!.user!.id, actorType: "staff", action: "org.branding", entity: "Org", entityId: orgId,
      meta: { accent: org.accent, accent2: org.accent2, logoChanged: !!logoUrl },
    },
  }).catch(() => {});

  return NextResponse.json({ success: true, branding: org });
}
