// ─────────────────────────────────────────────────────────────────────────────
// SMS — per-org provider adapter with DB-queued messages (ServiceSuite parity:
// every message is a row with state/cost/provider ref; billing reads the rows).
//
// Provider resolution: org vault SMS config → platform Africa's Talking env
// default → none (message stays QUEUED so a later worker/config can flush it).
// Sending is best-effort and never throws into a business flow.
//
// WHO PAYS is decided in ./wallet.ts before anything is dispatched: the lender's
// own provider is free of charge, then the plan allowance, then prepaid credits,
// then — for critical templates only — overdraft. A discretionary message that
// finds no credit stays QUEUED; flushQueuedSms() sends it the moment a top-up
// lands. Metering happens on PROVIDER ACCEPTANCE, not on queueing, and a failed
// dispatch refunds the credit it took — a message that never left is not a
// message the lender paid for.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";
import { runWithOrg } from "@/lib/db/context";
import { meter } from "@/lib/billing/meter";
import { getIntegration, type SmsConfig } from "@/lib/vault/integrations";
import { normalizeMsisdn } from "@/lib/mpesa/daraja";
import { fundSms, refundSmsCredit, type SmsFunding } from "./wallet";

// Built-in transactional templates ({placeholders} substituted from vars).
// Orgs override per key via the SmsTemplate table.
const DEFAULT_TEMPLATES: Record<string, string> = {
  approved: "Congratulations {name}! Your loan of KES {amount} has been approved and is being prepared for disbursement.",
  disbursed: "{org}: KES {amount} has been sent to your M-PESA {phone}. Repay by {due}. Loan ref {ref}.",
  payment: "{org}: We received KES {amount}. Loan balance: KES {balance}. Thank you!",
  cleared: "{org}: Your loan is fully repaid. Thank you — your limit grows with every on-time loan!",
  declined: "{org}: We could not approve your application this time. Reply HELP for the reasons and how to appeal.",
  otp: "Your approval code is {code}. It expires in 10 minutes. Never share it.",
  login_code: "{code} is your {org} staff sign-in code for today. It works until midnight. Never share it.",
  verify: "{code} is your {org} verification code. It expires in 5 minutes. Never share it — {org} will never ask you for this code.",
  // A signing code must name what it signs. A borrower who receives "your code is
  // 123456" cannot tell an identity check from a credit agreement worth KES 50,000.
  offer_sign: "{code} is your code to SIGN and accept a loan of KES {principal} from {org}, repaying KES {repayable} by {clearDate}. Only enter it if you agree. Expires in 5 minutes.",
  // A guarantor must be told what they are being asked for, by whom, and for how
  // much — and what it costs them if the borrower does not repay. Not "tap to continue".
  guarantor_invite: "{org}: {borrower} has asked you to guarantee their loan of KES {amount}. If they do not repay, you would be asked to. Read the terms and decide: {link}",
  guarantor_sign: "{code} is your code to GUARANTEE a loan of KES {amount} from {org}. Entering it makes you liable if the borrower does not repay. Only enter it if you agree. Expires in 5 minutes.",
  // Sent from the KYC queue when a customer was registered but never verified. It says
  // what it unlocks, because "complete your verification" motivates nobody — being told
  // your loan cannot be paid out until you do, does.
  kyc_link: "{org}: Hi {name}, your registration is not complete — we still need to verify your identity, and no loan can be paid out until it is. It takes two minutes: {link}",
  reminder: "{org}: A friendly reminder — KES {amount} is due on {date}. Pay early, pay less. Dial your paybill or use Pay Now.",
  due_today: "{org}: KES {amount} is due TODAY on loan {ref}. Pay via your paybill or the Pay Now link to stay on track.",
  arrears: "{org}: Your installment of KES {amount} on loan {ref} is overdue. Please pay today to avoid penalties and protect your limit.",
};

// The BORROWER-facing templates, in Kiswahili (item 20, blueprint §5.1). A key's
// absence here is a statement, not an omission: staff messages (otp, login_code)
// never localise — the console works in English — so the catalogue itself defines
// which messages can ever switch language. Same placeholders as the English twin,
// pinned by scripts/verify-i18n.ts.
const SW_TEMPLATES: Record<string, string> = {
  approved: "Hongera {name}! Mkopo wako wa KES {amount} umeidhinishwa na unaandaliwa kutumwa.",
  disbursed: "{org}: KES {amount} imetumwa kwenye M-PESA yako {phone}. Lipa ifikapo {due}. Kumbukumbu ya mkopo {ref}.",
  payment: "{org}: Tumepokea KES {amount}. Salio la mkopo: KES {balance}. Asante!",
  cleared: "{org}: Mkopo wako umelipwa kikamilifu. Asante — kikomo chako hukua kwa kila mkopo unaolipwa kwa wakati!",
  declined: "{org}: Hatukuweza kuidhinisha ombi lako wakati huu. Jibu HELP kupata sababu na jinsi ya kukata rufaa.",
  verify: "{code} ni nambari yako ya uthibitisho ya {org}. Inaisha baada ya dakika 5. Usimpe mtu yeyote — {org} haitawahi kukuuliza nambari hii.",
  offer_sign: "{code} ni nambari yako ya KUTIA SAHIHI na kukubali mkopo wa KES {principal} kutoka {org}, ukilipa KES {repayable} ifikapo {clearDate}. Iweke tu ikiwa unakubali. Inaisha baada ya dakika 5.",
  guarantor_invite: "{org}: {borrower} amekuomba udhamini mkopo wake wa KES {amount}. Asipolipa, utaombwa ulipe wewe. Soma masharti kisha uamue: {link}",
  guarantor_sign: "{code} ni nambari yako ya KUDHAMINI mkopo wa KES {amount} kutoka {org}. Kuiweka kunakufanya uwajibike ikiwa mkopaji hatalipa. Iweke tu ikiwa unakubali. Inaisha baada ya dakika 5.",
  kyc_link: "{org}: Habari {name}, usajili wako haujakamilika — bado tunahitaji kuthibitisha utambulisho wako, na hakuna mkopo utakaotolewa hadi ukamilike. Inachukua dakika mbili: {link}",
  reminder: "{org}: Kumbusho — KES {amount} inastahili kulipwa tarehe {date}. Lipa mapema, lipa kidogo. Tumia paybill yako au Lipa Sasa.",
  due_today: "{org}: KES {amount} inastahili kulipwa LEO kwa mkopo {ref}. Lipa kupitia paybill yako au kiungo cha Lipa Sasa ili usibaki nyuma.",
  arrears: "{org}: Awamu yako ya KES {amount} kwa mkopo {ref} imechelewa. Tafadhali lipa leo kuepuka adhabu na kulinda kikomo chako.",
};

export type SmsLang = "en" | "sw" | "auto";

function render(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ""));
}

/**
 * Which language this message should speak. Explicit wins (the borrower is looking
 * at a Kiswahili screen right now); otherwise the Borrower row's saved preference —
 * set when they applied — decides; otherwise English. Only consulted for keys that
 * HAVE a Kiswahili twin, so staff codes never trigger a lookup at all. An org's own
 * template override wins over all of this: they wrote it, they chose its language.
 */
async function resolveSmsLang(orgId: string, msisdn: string, templateKey: string, lang: SmsLang): Promise<"en" | "sw"> {
  if (!SW_TEMPLATES[templateKey]) return "en";
  if (lang === "en" || lang === "sw") return lang;
  try {
    const b = await prisma.borrower.findUnique({
      where: { orgId_phone: { orgId, phone: msisdn } },
      select: { language: true },
    });
    return b?.language === "sw" ? "sw" : "en";
  } catch {
    return "en"; // a language lookup must never sink a message
  }
}

type ResolvedProvider = {
  cfg: SmsConfig;
  /** True when the message rides OUR Africa's Talking account — the only case that spends credits. */
  platform: boolean;
};

async function providerFor(orgId: string): Promise<ResolvedProvider | null> {
  const vault = await getIntegration(orgId, "SMS");
  if (vault?.apiKey) return { cfg: vault, platform: false };
  const apiKey = process.env.AFRICASTALKING_API_KEY?.trim();
  const username = process.env.AFRICASTALKING_USERNAME?.trim();
  if (apiKey && username) {
    return {
      cfg: { provider: "africastalking", apiKey, username, senderId: process.env.AFRICASTALKING_SENDER_ID?.trim() },
      platform: true,
    };
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

type QueuedRow = { id: string; orgId: string; phone: string; message: string; templateKey: string | null };

/**
 * Push one row through the provider and settle everything that depends on the
 * outcome: row state, the usage record, and — when the dispatch fails after a
 * credit was taken — the refund.
 */
async function dispatchRow(row: QueuedRow, resolved: ResolvedProvider, funding: SmsFunding): Promise<boolean> {
  try {
    const sent = resolved.cfg.provider === "africastalking"
      ? await sendViaAfricasTalking(resolved.cfg, row.phone, row.message)
      : { ok: false, providerRef: null, cost: null, error: `Provider ${resolved.cfg.provider} not implemented yet` };
    await prisma.smsMessage.update({
      where: { id: row.id },
      data: {
        state: sent.ok ? "SENT" : "FAILED",
        provider: resolved.cfg.provider,
        providerRef: sent.providerRef,
        cost: sent.cost ?? undefined,
        sentAt: sent.ok ? new Date() : null,
      },
    });
    if (sent.ok) {
      // Metered on provider acceptance. Own-provider messages stamp unit cost 0:
      // the lender pays Africa's Talking directly and we charge nothing.
      void meter(row.orgId, "sms", 1, { templateKey: row.templateKey, via: funding }, funding === "own-provider" ? 0 : undefined);
      return true;
    }
    if (funding === "credit" || funding === "overdraft") await refundSmsCredit(row.orgId);
    return false;
  } catch {
    await prisma.smsMessage.update({ where: { id: row.id }, data: { state: "FAILED", provider: resolved.cfg.provider } }).catch(() => {});
    if (funding === "credit" || funding === "overdraft") await refundSmsCredit(row.orgId);
    return false;
  }
}

/**
 * Queue (and best-effort send) a templated SMS. Returns the SmsMessage id.
 * Never throws — comms must not break lending flows.
 *
 * A null return means the template does not exist; a returned id with the row
 * still QUEUED means either no provider is configured or a discretionary message
 * found no credit — both flush later, neither blocks the caller.
 */
export async function sendSms(
  orgId: string,
  phone: string,
  templateKey: keyof typeof DEFAULT_TEMPLATES | (string & {}),
  vars: Record<string, string | number>,
  lang: SmsLang = "auto",
): Promise<string | null> {
  try {
    const msisdn = normalizeMsisdn(phone);
    const custom = await prisma.smsTemplate.findUnique({ where: { orgId_key: { orgId, key: templateKey } } }).catch(() => null);
    const smsLang = custom?.active ? null : await resolveSmsLang(orgId, msisdn, templateKey, lang);
    const body = custom?.active
      ? custom.body
      : smsLang === "sw"
        ? SW_TEMPLATES[templateKey] ?? DEFAULT_TEMPLATES[templateKey]
        : DEFAULT_TEMPLATES[templateKey];
    if (!body) return null;
    const message = render(body, vars);

    const row = await prisma.smsMessage.create({
      data: { orgId, phone: msisdn, message, templateKey, state: "QUEUED" },
    });

    const resolved = await providerFor(orgId);
    if (!resolved) return row.id; // stays QUEUED, and unfunded, until a provider exists

    const funding = await fundSms(orgId, templateKey, resolved.platform);
    if (funding === "refused") return row.id; // stays QUEUED until a top-up flushes it

    await dispatchRow({ id: row.id, orgId, phone: msisdn, message, templateKey }, resolved, funding);
    return row.id;
  } catch {
    return null;
  }
}

/** The built-in template catalogue, for the console's template editor. */
export function defaultSmsTemplates(): { key: string; body: string }[] {
  return Object.entries(DEFAULT_TEMPLATES).map(([key, body]) => ({ key, body }));
}

/** The Kiswahili twins — exported for the template editor and the i18n test suite. */
export function swahiliSmsTemplates(): { key: string; body: string }[] {
  return Object.entries(SW_TEMPLATES).map(([key, body]) => ({ key, body }));
}

/**
 * Queue (and best-effort send) a RAW message — campaign blasts and other
 * one-off copy that lives nowhere in the template catalogue. `tagKey` labels
 * the row (e.g. `campaign:<id>`) so delivery stats group per campaign; raw
 * sends are never critical, so an empty wallet queues them rather than
 * overdrafting.
 */
export async function sendRawSms(orgId: string, phone: string, message: string, tagKey: string): Promise<string | null> {
  try {
    const msisdn = normalizeMsisdn(phone);
    const body = (message ?? "").trim();
    if (!body) return null;

    const row = await prisma.smsMessage.create({
      data: { orgId, phone: msisdn, message: body, templateKey: tagKey, state: "QUEUED" },
    });

    const resolved = await providerFor(orgId);
    if (!resolved) return row.id;

    const funding = await fundSms(orgId, tagKey, resolved.platform);
    if (funding === "refused") return row.id;

    await dispatchRow({ id: row.id, orgId, phone: msisdn, message: body, templateKey: tagKey }, resolved, funding);
    return row.id;
  } catch {
    return null;
  }
}

/** A queued message older than this never flushes — a three-day-old "KES 900 due TODAY" is worse than silence. */
const QUEUE_FRESH_MS = 48 * 3_600_000;

/**
 * Send what has been waiting. Called when credit arrives (top-up read-back,
 * platform grant) and by the nightly cron — oldest first, because that is the
 * order the messages were owed. Stops at the first refusal: if the new credit
 * ran out halfway, the rest keep waiting rather than burning the overdraft.
 */
export async function flushQueuedSms(orgId: string, max = 200): Promise<{ sent: number; expired: number; waiting: number }> {
  return runWithOrg(orgId, async () => {
    const cutoff = new Date(Date.now() - QUEUE_FRESH_MS);
    // Expire the stale ones first, provider or not. They were never dispatched;
    // FAILED is the honest state, and dunning that arrives days late is noise.
    const expired = await prisma.smsMessage.updateMany({
      where: { orgId, state: "QUEUED", createdAt: { lt: cutoff } },
      data: { state: "FAILED" },
    });

    let sent = 0;
    const resolved = await providerFor(orgId);
    if (resolved) {
      const rows = await prisma.smsMessage.findMany({
        where: { orgId, state: "QUEUED" },
        orderBy: { createdAt: "asc" },
        take: Math.min(Math.max(1, max), 500),
        select: { id: true, orgId: true, phone: true, message: true, templateKey: true },
      });
      for (const row of rows) {
        const funding = await fundSms(orgId, row.templateKey ?? "", resolved.platform);
        if (funding === "refused") break;
        if (await dispatchRow(row, resolved, funding)) sent++;
      }
    }

    const waiting = await prisma.smsMessage.count({ where: { orgId, state: "QUEUED" } });
    return { sent, expired: expired.count, waiting };
  });
}
