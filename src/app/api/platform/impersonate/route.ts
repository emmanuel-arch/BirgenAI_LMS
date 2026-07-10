// Platform impersonation — the founder "switching into" a lender's console.
//   POST   { orgId }  → mints an org-scoped lms_session carrying an
//                       `impersonator` claim (total control, banner always on,
//                       audited on BOTH sides), then the client goes to /console.
//   DELETE            → ends the act: clears lms_session ONLY; the platform
//                       session survives, so "Return to platform" just works.
//
// Requires a real platform session — the legacy bearer deliberately cannot
// impersonate, because impersonation without an identity is exactly the
// anonymous-god-mode problem this commit removes.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runAsPlatform } from "@/lib/db/context";
import { platformAuth } from "@/lib/platform-auth";
import { createSession, destroySession } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await platformAuth();
  if (!session?.admin) {
    return NextResponse.json({ success: false, message: "Platform sign-in required." }, { status: 401 });
  }
  const admin = session.admin;

  let body: { orgId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }
  if (!body.orgId) return NextResponse.json({ success: false, message: "orgId required." }, { status: 400 });

  return runAsPlatform(async () => {
    const org = await prisma.org.findUnique({ where: { id: body.orgId }, select: { id: true, slug: true, name: true, status: true } });
    if (!org) return NextResponse.json({ success: false, message: "Organization not found." }, { status: 404 });
    if (org.status === "SUSPENDED") {
      return NextResponse.json({ success: false, message: "That organization is suspended — unsuspend it first." }, { status: 400 });
    }

    // Audited twice: in the org's own trail (their admins can see the platform
    // was inside) and platform-side (who acted, where).
    await prisma.auditLog.create({
      data: { orgId: org.id, actorId: `platform:${admin.id}`, actorType: "platform", action: "platform.impersonate", entity: "Org", entityId: org.id, meta: { admin: admin.email } },
    }).catch(() => {});
    await prisma.auditLog.create({
      data: { orgId: null, actorId: admin.id, actorType: "platform", action: "platform.impersonate", entity: "Org", entityId: org.id, meta: { orgSlug: org.slug } },
    }).catch(() => {});

    await createSession({
      id: `platform:${admin.id}`,
      name: admin.name,
      email: admin.email,
      role: "Platform Admin",
      roleId: null,
      orgId: org.id,
      orgSlug: org.slug,
      tiers: { initiator: true, authorizer: true, validator: true },
      impersonator: { platformAdminId: admin.id, name: admin.name },
    });

    return NextResponse.json({ success: true, orgSlug: org.slug, orgName: org.name });
  });
}

export async function DELETE() {
  // End the act. Platform cookie untouched — the founder lands back on /platform.
  await destroySession();
  return NextResponse.json({ success: true });
}
