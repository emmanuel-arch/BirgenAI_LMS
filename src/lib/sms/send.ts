// ─────────────────────────────────────────────────────────────────────────────
// SMS — per-org provider adapter with DB-queued messages (ServiceSuite parity:
// every message is a row with state/cost/provider ref; billing reads the rows).
//
// Provider resolution: org vault SMS config → platform Africa's Talking env
// default → none (message stays QUEUED so a later worker/config can flush it).
// Sending is best-effort and never throws into a business flow.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";
import { meter } from "@/lib/billing/meter";
import { getIntegration, type SmsConfig } from "@/lib/vault/integrations";
import { normalizeMsisdn } from "@/lib/mpesa/daraja";

// Built-in transactional templates ({placeholders} substituted from vars).
// Orgs override per key via the SmsTemplate table.
const DEFAULT_TEMPLATES: Record<string, string> = {
  approved: "Congratulations {name}! Your loan of KES {amount} has been approved and is being prepared for disbursement.",
  disbursed: "{org}: KES {amount} has been sent to your M-PESA {phone}. Repay by {due}. Loan ref {ref}.",
  payment: "{org}: We received KES {amount}. Loan balance: KES {balance}. Thank you!",
  cleared: "{org}: Your loan is fully repaid. Thank you — your limit grows with every on-time loan!",
  declined: "{org}: We could not approve your application this time. Reply HELP for the reasons and how to appeal.",
  otp: "Your approval code is {code}. It expires in 10 minutes. Never share it.",
  verify: "{code} is your {org} verification code. It expires in 5 minutes. Never share it — {org} will never ask you for this code.",
  reminder: "{org}: A friendly reminder — KES {amount} is due on {date}. Pay early, pay less. Dial your paybill or use Pay Now.",
  due_today: "{org}: KES {amount} is due TODAY on loan {ref}. Pay via your paybill or the Pay Now link to stay on track.",
  arrears: "{org}: Your installment of KES {amount} on loan {ref} is overdue. Please pay today to avoid penalties and protect your limit.",
};

function render(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ""));
}

async function providerFor(orgId: string): Promise<SmsConfig | null> {
  const vault = await getIntegration(orgId, "SMS");
  if (vault?.apiKey) return vault;
  const apiKey = process.env.AFRICASTALKING_API_KEY?.trim();
  const username = process.env.AFRICASTALKING_USERNAME?.trim();
  if (apiKey && username) {
    return { provider: "africastalking", apiKey, username, senderId: process.env.AFRICASTALKING_SENDER_ID?.trim() };
  }
  return null;
}

/**
 * Can this org actually deliver an SMS right now? Callers that depend on
 * delivery (borrower OTP) must know the difference between "queued" and "sent" —
 * sendSms() returns a row id either way.
 */
export async function hasSmsProvider(orgId: string): Promise<boolean> {
  try {
    return !!(await providerFor(orgId));
  } catch {
    return false;
  }
}

async function sendViaAfricasTalking(cfg: SmsConfig, phone: string, message: string) {
  const res = await fetch("https://api.africastalking.com/version1/messaging", {
    method: "POST",
    headers: {
      apiKey: cfg.apiKey,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      username: cfg.username ?? "",
      to: `+${phone}`,
      message,
      ...(cfg.senderId ? { from: cfg.senderId } : {}),
    }),
    signal: AbortSignal.timeout(20000),
  });
  const data = (await res.json().catch(() => ({}))) as {
    SMSMessageData?: { Recipients?: { status?: string; messageId?: string; cost?: string }[] };
  };
  const r = data.SMSMessageData?.Recipients?.[0];
  const ok = r?.status === "Success";
  return {
    ok,
    providerRef: r?.messageId ?? null,
    cost: r?.cost ? Number(String(r.cost).replace(/[^\d.]/g, "")) : null,
    error: ok ? null : (r?.status ?? `HTTP ${res.status}`),
  };
}

/**
 * Queue (and best-effort send) a templated SMS. Returns the SmsMessage id.
 * Never throws — comms must not break lending flows.
 */
export async function sendSms(
  orgId: string,
  phone: string,
  templateKey: keyof typeof DEFAULT_TEMPLATES | (string & {}),
  vars: Record<string, string | number>,
): Promise<string | null> {
  try {
    const msisdn = normalizeMsisdn(phone);
    const custom = await prisma.smsTemplate.findUnique({ where: { orgId_key: { orgId, key: templateKey } } }).catch(() => null);
    const body = custom?.active ? custom.body : DEFAULT_TEMPLATES[templateKey];
    if (!body) return null;
    const message = render(body, vars);

    const row = await prisma.smsMessage.create({
      data: { orgId, phone: msisdn, message, templateKey, state: "QUEUED" },
    });

    const cfg = await providerFor(orgId);
    if (!cfg) return row.id; // stays QUEUED, and unbilled, until a provider exists

    // Metered on dispatch, not on queueing: a message that never left is not a
    // message the lender should pay for.
    void meter(orgId, "sms", 1, { templateKey });

    try {
      const sent = cfg.provider === "africastalking"
        ? await sendViaAfricasTalking(cfg, msisdn, message)
        : { ok: false, providerRef: null, cost: null, error: `Provider ${cfg.provider} not implemented yet` };
      await prisma.smsMessage.update({
        where: { id: row.id },
        data: {
          state: sent.ok ? "SENT" : "FAILED",
          provider: cfg.provider,
          providerRef: sent.providerRef,
          cost: sent.cost ?? undefined,
          sentAt: sent.ok ? new Date() : null,
        },
      });
    } catch {
      await prisma.smsMessage.update({ where: { id: row.id }, data: { state: "FAILED", provider: cfg.provider } }).catch(() => {});
    }
    return row.id;
  } catch {
    return null;
  }
}
