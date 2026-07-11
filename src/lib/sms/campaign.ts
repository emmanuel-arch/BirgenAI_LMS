// ─────────────────────────────────────────────────────────────────────────────
// SMS campaigns — one message to a borrower segment (ServiceSuite parity).
//
// The AUDIENCE is derived from the live book at send time, like the collections
// queue: nobody maintains a mailing list that goes stale. Each recipient gets an
// SmsMessage row tagged `campaign:<id>`, so delivery, queueing and billing ride
// the exact rails every transactional SMS already uses — an empty wallet queues
// a campaign, it never overdrafts one (campaigns are discretionary by
// definition; a marketing blast must never spend the credits a signing code
// would need).
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";
import { sendRawSms } from "./send";

export const CAMPAIGN_AUDIENCES = ["ALL", "ACTIVE_LOANS", "ARREARS", "CLEARED", "BROKEN_PTP"] as const;
export type CampaignAudience = (typeof CAMPAIGN_AUDIENCES)[number];

export const AUDIENCE_LABELS: Record<CampaignAudience, string> = {
  ALL: "Every borrower",
  ACTIVE_LOANS: "Borrowers with an active loan",
  ARREARS: "Borrowers in arrears",
  CLEARED: "Borrowers who repaid in full (no active loan)",
  BROKEN_PTP: "Borrowers with a broken promise to pay",
};

/** Hard ceiling per campaign — a fat-finger must not queue a county. */
export const MAX_RECIPIENTS = 5000;

export type CampaignRecipient = { borrowerId: string; phone: string; firstName: string | null };

/** Enumerate the audience from the live book. Distinct by borrower. */
export async function enumerateAudience(orgId: string, audience: CampaignAudience): Promise<CampaignRecipient[]> {
  const base = { orgId, phone: { not: "" } };
  const select = { id: true, phone: true, firstName: true } as const;

  let rows: { id: string; phone: string; firstName: string | null }[];
  if (audience === "ACTIVE_LOANS") {
    rows = await prisma.borrower.findMany({
      where: { ...base, loans: { some: { status: "ACTIVE" } } }, select, take: MAX_RECIPIENTS,
    });
  } else if (audience === "ARREARS") {
    rows = await prisma.borrower.findMany({
      where: { ...base, loans: { some: { status: "ACTIVE", installments: { some: { status: "OVERDUE" } } } } },
      select, take: MAX_RECIPIENTS,
    });
  } else if (audience === "CLEARED") {
    rows = await prisma.borrower.findMany({
      where: { ...base, loans: { some: { status: "CLEARED" }, none: { status: "ACTIVE" } } },
      select, take: MAX_RECIPIENTS,
    });
  } else if (audience === "BROKEN_PTP") {
    const broken = await prisma.promiseToPay.findMany({
      where: { orgId, status: "BROKEN" }, select: { borrowerId: true }, distinct: ["borrowerId"], take: MAX_RECIPIENTS,
    });
    rows = await prisma.borrower.findMany({
      where: { ...base, id: { in: broken.map((b) => b.borrowerId) } }, select, take: MAX_RECIPIENTS,
    });
  } else {
    rows = await prisma.borrower.findMany({ where: base, select, take: MAX_RECIPIENTS });
  }
  return rows.map((r) => ({ borrowerId: r.id, phone: r.phone, firstName: r.firstName }));
}

/** {name} → the borrower's first name (or a neutral fallback). */
export function renderCampaignMessage(template: string, firstName: string | null): string {
  return template.replace(/\{name\}/g, firstName?.trim() || "customer");
}

/**
 * Create + send a campaign: enumerate, write the campaign row, queue one
 * SmsMessage per recipient (tagged `campaign:<id>`), settle the counts.
 * Returns the campaign id and how many rows were queued.
 */
export async function sendCampaign(args: {
  orgId: string; name: string; message: string; audience: CampaignAudience; createdBy: string;
}): Promise<{ id: string; recipients: number; queued: number }> {
  const recipients = await enumerateAudience(args.orgId, args.audience);

  const campaign = await prisma.smsCampaign.create({
    data: {
      orgId: args.orgId, name: args.name, message: args.message, audience: args.audience,
      recipients: recipients.length, status: "SENDING", createdBy: args.createdBy,
    },
  });

  let queued = 0;
  for (const r of recipients) {
    const id = await sendRawSms(args.orgId, r.phone, renderCampaignMessage(args.message, r.firstName), `campaign:${campaign.id}`);
    if (id) queued++;
  }

  await prisma.smsCampaign.update({
    where: { id: campaign.id },
    data: { queued, status: queued > 0 || recipients.length === 0 ? "SENT" : "FAILED", sentAt: new Date() },
  });

  return { id: campaign.id, recipients: recipients.length, queued };
}

/** Per-campaign delivery stats, read off the tagged SmsMessage rows. */
export async function campaignStats(orgId: string, campaignIds: string[]): Promise<Map<string, { sent: number; queued: number; failed: number }>> {
  const rows = await prisma.smsMessage.groupBy({
    by: ["templateKey", "state"],
    where: { orgId, templateKey: { in: campaignIds.map((id) => `campaign:${id}`) } },
    _count: true,
  });
  const out = new Map<string, { sent: number; queued: number; failed: number }>();
  for (const r of rows) {
    const id = (r.templateKey ?? "").slice("campaign:".length);
    const s = out.get(id) ?? { sent: 0, queued: 0, failed: 0 };
    if (r.state === "SENT") s.sent += r._count;
    else if (r.state === "QUEUED") s.queued += r._count;
    else s.failed += r._count;
    out.set(id, s);
  }
  return out;
}
