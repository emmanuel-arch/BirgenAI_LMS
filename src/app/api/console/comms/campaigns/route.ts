// SMS campaigns (own org).
//   GET  → campaign history with per-campaign delivery stats (sms.view)
//   POST { name, message, audience, dryRun? } (sms.manage)
//        dryRun → audience size + cost preview, nothing sent
//        else   → creates + sends the campaign (rows queue if credits run out)
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireRight } from "@/lib/rbac/authz";
import {
  CAMPAIGN_AUDIENCES, type CampaignAudience, enumerateAudience, sendCampaign, campaignStats, MAX_RECIPIENTS,
} from "@/lib/sms/campaign";

export const runtime = "nodejs";
export const maxDuration = 300; // a few thousand queue writes on the far end

export async function GET() {
  const session = await auth();
  const denied = await requireRight(session, "sms.view");
  if (denied) return denied;
  const orgId = session!.user!.orgId!;

  const campaigns = await prisma.smsCampaign.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const stats = await campaignStats(orgId, campaigns.map((c) => c.id));
  return NextResponse.json({
    success: true,
    campaigns: campaigns.map((c) => ({
      id: c.id, name: c.name, message: c.message, audience: c.audience, status: c.status,
      recipients: c.recipients, queued: c.queued, sentAt: c.sentAt, createdAt: c.createdAt,
      delivery: stats.get(c.id) ?? { sent: 0, queued: 0, failed: 0 },
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const denied = await requireRight(session, "sms.manage");
  if (denied) return denied;
  const orgId = session!.user!.orgId!;

  let body: { name?: string; message?: string; audience?: string; dryRun?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const audience = body.audience as CampaignAudience;
  if (!CAMPAIGN_AUDIENCES.includes(audience)) {
    return NextResponse.json({ success: false, message: "Pick who this goes to." }, { status: 400 });
  }
  const message = (body.message ?? "").trim();
  if (message.length < 10 || message.length > 480) {
    return NextResponse.json({ success: false, message: "Write a message between 10 and 480 characters." }, { status: 400 });
  }

  if (body.dryRun) {
    const recipients = await enumerateAudience(orgId, audience);
    return NextResponse.json({
      success: true,
      dryRun: true,
      recipients: recipients.length,
      capped: recipients.length >= MAX_RECIPIENTS,
      // 160 GSM chars per segment; each segment is one SMS credit per recipient.
      segments: Math.max(1, Math.ceil(message.length / 160)),
    });
  }

  const name = (body.name ?? "").trim();
  if (name.length < 3) return NextResponse.json({ success: false, message: "Name the campaign — history needs to say what it was." }, { status: 400 });

  const result = await sendCampaign({ orgId, name, message, audience, createdBy: session!.user!.id });
  await prisma.auditLog.create({
    data: {
      orgId, actorId: session!.user!.id, actorType: "staff", action: "comms.campaign.send",
      entity: "SmsCampaign", entityId: result.id, meta: { name, audience, recipients: result.recipients, queued: result.queued },
    },
  }).catch(() => {});

  return NextResponse.json({ success: true, ...result });
}
