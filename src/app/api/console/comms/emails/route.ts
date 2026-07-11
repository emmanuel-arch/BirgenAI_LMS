// GET /api/console/comms/emails — the outbound email log (sms.view; comms is
// one module). Answers "did the system actually email them?" — invites,
// sign-in codes, approvals, with the failure reason when it didn't.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireRight } from "@/lib/rbac/authz";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  const denied = await requireRight(session, "sms.view");
  if (denied) return denied;

  const emails = await prisma.emailMessage.findMany({
    where: { orgId: session!.user!.orgId! },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return NextResponse.json({ success: true, emails });
}
