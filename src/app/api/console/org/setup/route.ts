// Setup-checklist actions (own org, settings.manage).
//   POST { action: "request-activation" | "dismiss" }
// "request-activation" stamps Org.onboardingState and writes the audit row the
// platform review queue watches for; "dismiss" hides the card.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireRight } from "@/lib/rbac/authz";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await auth();
  const denied = await requireRight(session, "settings.manage");
  if (denied) return denied;
  const orgId = session!.user!.orgId!;

  let body: { action?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const org = await prisma.org.findUniqueOrThrow({ where: { id: orgId }, select: { onboardingState: true, status: true } });
  const state = (org.onboardingState ?? {}) as { dismissed?: boolean; activationRequestedAt?: string };

  if (body.action === "dismiss") {
    await prisma.org.update({ where: { id: orgId }, data: { onboardingState: { ...state, dismissed: true } } });
    return NextResponse.json({ success: true });
  }

  if (body.action === "request-activation") {
    if (org.status === "ACTIVE") return NextResponse.json({ success: false, message: "You're already active." }, { status: 400 });
    const at = new Date().toISOString();
    await prisma.org.update({ where: { id: orgId }, data: { onboardingState: { ...state, activationRequestedAt: at } } });
    await prisma.auditLog.create({
      data: { orgId, actorId: session!.user!.id, actorType: "staff", action: "org.activation-requested", entity: "Org", entityId: orgId },
    }).catch(() => {});
    return NextResponse.json({ success: true, requestedAt: at });
  }

  return NextResponse.json({ success: false, message: "Unknown action." }, { status: 400 });
}
