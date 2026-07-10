// ─────────────────────────────────────────────────────────────────────────────
// The centralised payment system.
//
// PLATFORM RULE: every payment made to BirgenAI — from birgenai.com and from every
// subdomain, this one included — settles through the Hub wallet. One Till, one
// ledger, one receipt. So this file contains no Daraja client, no STK push, and no
// callback handler, and it must stay that way.
//
// Not to be confused with the Daraja credentials in each org's vault
// (src/lib/mpesa/daraja.ts). Those move the LENDER's money: disbursements out to
// their borrowers, repayments in from them. That is the lender's own float and
// has nothing to do with what the lender owes BirgenAI. The two never touch.
//
// How a lender pays for BirgenAI_LMS:
//   1. this console verifies the signed-in staffer administers the org, then MINTS a
//      short-lived HMAC token over {org, plan, exp} and sends them to the Hub's
//      checkout (`/transact?lms=<slug>&plan=<PLAN>&t=<token>&return=<back here>`),
//      the same deep-link the Movies app uses for its upgrades;
//   2. the Hub verifies the signature, prices the package from ITS rate card — never
//      from anything in the query string — opens a PaymentIntent with purpose
//      SUBSCRIPTION, and STK-pushes to the Till;
//   3. its callback settles the intent through `lib/wallet.ts` and marks the org
//      paid through +30 days;
//   4. we read that state back here and mirror it onto OrgSubscription.
//
// The token exists because the Hub CANNOT answer "may this person pay for lender X?"
// — an LMS org's staff live in this database, not the Hub's. Without it, a bare
// `/transact?lms=micromart&plan=STARTER` would let any signed-in stranger pay KES
// 10,000 and downgrade a Premium lender from 30,000. We vouch; the Hub verifies.
//
// Step 4 is the only other coupling, and it is read-only: the Hub is the source of
// truth for whether an invoice is paid, and this app never asserts otherwise.
//
// SIMULATION-FIRST, like every other provider seam here. With no LMS_BILLING_SECRET
// no token can be signed, checkout is unavailable, the sync is a no-op and local
// OrgSubscription state stands — so the demo org and local development keep working
// with no Hub running.
// ─────────────────────────────────────────────────────────────────────────────
import { createHmac } from "node:crypto";
import type { OrgPlan } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { runWithOrg } from "@/lib/db/context";
import { creditTopUp } from "@/lib/sms/wallet";
import { flushQueuedSms } from "@/lib/sms/send";
import { invalidateEntitlements } from "./entitlements";
import { PLAN_ORDER, smsPack } from "./plans";

export type HubBillingMode = "simulation" | "live";

const DEFAULT_HUB = "https://birgenai.com";

/** How long a minted checkout token stays valid. The Hub rejects anything longer. */
const CHECKOUT_TTL_SEC = 15 * 60;

export function hubUrl(): string {
  return (process.env.HUB_BILLING_URL || process.env.NEXT_PUBLIC_HUB_URL || DEFAULT_HUB).replace(/\/$/, "");
}

/** Shared with the Hub deployment under the same name. */
function billingSecret(): string | null {
  const s = process.env.LMS_BILLING_SECRET?.trim();
  return s ? s : null;
}

export function hubBillingMode(): HubBillingMode {
  return billingSecret() ? "live" : "simulation";
}

/**
 * Vouch, cryptographically, that this org may be charged for this package.
 *
 * The caller MUST have established that the actor administers `orgSlug` — this
 * function does not check, it only signs. Returns null in simulation, which is why
 * checkout is disabled rather than silently unauthenticated when the secret is unset.
 */
export function signCheckout(orgSlug: string, plan: OrgPlan): string | null {
  const secret = billingSecret();
  if (!secret) return null;
  const claims = { org: orgSlug, plan, exp: Math.floor(Date.now() / 1000) + CHECKOUT_TTL_SEC };
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

/**
 * Where to send a billing admin to pay. `plan` in the query string is a display hint
 * only — the Hub takes the plan it charges for out of the signed token, so a tampered
 * URL buys nothing. Null when we cannot sign (no Hub connection configured).
 */
export function hubCheckoutUrl(orgSlug: string, plan: OrgPlan, returnTo: string): string | null {
  const token = signCheckout(orgSlug, plan);
  if (!token) return null;
  const u = new URL(`${hubUrl()}/transact`);
  u.searchParams.set("lms", orgSlug);
  u.searchParams.set("plan", plan);
  u.searchParams.set("t", token);
  u.searchParams.set("return", returnTo);
  return u.toString();
}

/**
 * Vouch that this org may buy this SMS pack. Same HMAC, same TTL, but a
 * DIFFERENT claim shape (`kind: "sms"`, a pack key, no plan) — so a captured
 * top-up token cannot be replayed into a package purchase or vice versa: each
 * verifier on the Hub side accepts only its own shape.
 */
export function signSmsTopup(orgSlug: string, packKey: string): string | null {
  const secret = billingSecret();
  if (!secret || !smsPack(packKey)) return null;
  const claims = { org: orgSlug, kind: "sms", pack: packKey, exp: Math.floor(Date.now() / 1000) + CHECKOUT_TTL_SEC };
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

/**
 * Where to send a billing admin to buy SMS credits. The pack in the query string
 * is a display hint; the Hub prices from the pack key inside the signed token.
 */
export function hubSmsTopupUrl(orgSlug: string, packKey: string, returnTo: string): string | null {
  const token = signSmsTopup(orgSlug, packKey);
  if (!token) return null;
  const u = new URL(`${hubUrl()}/transact`);
  u.searchParams.set("lms", orgSlug);
  u.searchParams.set("sms", packKey);
  u.searchParams.set("t", token);
  u.searchParams.set("return", returnTo);
  return u.toString();
}

export type HubSubscription = {
  plan: OrgPlan;
  /** Paid up to this instant. Past ⇒ the org owes us. */
  paidThroughAt: string | null;
  lastPaymentAt: string | null;
  active: boolean;
};

/** Ask the Hub what this org has actually paid for. Null when unreachable/simulated. */
export async function fetchHubSubscription(orgSlug: string): Promise<HubSubscription | null> {
  const secret = billingSecret();
  if (!secret) return null;
  try {
    const res = await fetch(`${hubUrl()}/api/lms/subscription?orgSlug=${encodeURIComponent(orgSlug)}`, {
      headers: { Authorization: `Bearer ${secret}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { success?: boolean; subscription?: HubSubscription };
    return data.success && data.subscription ? data.subscription : null;
  } catch {
    return null; // the Hub is down; the lender keeps working on cached state
  }
}

/**
 * Mirror the Hub's payment state onto this org. Returns true when something moved.
 *
 * Deliberately one-way. If the Hub says paid, we are paid; if it says nothing, we
 * leave local state exactly as it was rather than guessing a lender into arrears
 * because a network call timed out.
 */
export async function syncSubscriptionFromHub(orgId: string, orgSlug: string): Promise<boolean> {
  const hub = await fetchHubSubscription(orgSlug);
  if (!hub) return false;

  const paidThrough = hub.paidThroughAt ? new Date(hub.paidThroughAt) : null;
  const paid = hub.active && !!paidThrough && paidThrough > new Date();

  // The Hub stores the package as a plain string. Validate it before it reaches an
  // enum column — an unrecognised value should cost us the plan update, not the
  // whole sync, and certainly not an unhandled Prisma error on a billing page.
  const plan = (PLAN_ORDER as string[]).includes(hub.plan) ? (hub.plan as OrgPlan) : null;

  await runWithOrg(orgId, async () => {
    if (plan) await prisma.org.update({ where: { id: orgId }, data: { plan } });
    await prisma.orgSubscription.update({
      where: { orgId },
      data: {
        status: paid ? "ACTIVE" : "PAST_DUE",
        ...(paidThrough ? { currentPeriodEnd: paidThrough } : {}),
        // A paid subscription ends the trial; there is nothing left to try.
        ...(paid ? { trialEndsAt: null } : {}),
      },
    });
  });

  invalidateEntitlements(orgId);
  return true;
}

export type HubSmsTopup = { id: string; pack: string; units: number; amountKes: number; receipt: string | null; at: string };

/** SMS packs this lender has paid for at the Hub. Null when unreachable/simulated. */
export async function fetchHubSmsTopups(orgSlug: string): Promise<HubSmsTopup[] | null> {
  const secret = billingSecret();
  if (!secret) return null;
  try {
    const res = await fetch(`${hubUrl()}/api/lms/sms-topups?orgSlug=${encodeURIComponent(orgSlug)}`, {
      headers: { Authorization: `Bearer ${secret}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { success?: boolean; topups?: HubSmsTopup[] };
    return data.success && Array.isArray(data.topups) ? data.topups : null;
  } catch {
    return null;
  }
}

/**
 * Mirror paid SMS packs onto the local wallet. Safe to call as often as we like:
 * each Hub settlement credits at most once (`hubReference` is unique), so this
 * runs on the billing page's sync button, on the return from checkout, and in
 * the nightly cron without ever double-crediting. Returns how many NEW top-ups
 * landed — and when any did, sends the messages that were waiting for them.
 */
export async function syncSmsTopupsFromHub(orgId: string, orgSlug: string): Promise<number> {
  const topups = await fetchHubSmsTopups(orgSlug);
  if (!topups?.length) return 0;

  let credited = 0;
  for (const t of topups) {
    try {
      if (await creditTopUp({ orgId, units: t.units, amountKes: t.amountKes, source: "HUB", hubReference: t.id, note: t.pack })) {
        credited++;
      }
    } catch (err) {
      // One malformed row must not block the rest of the lender's credits.
      console.error(`[sms-sync] top-up ${t.id} for org ${orgSlug} failed:`, err);
    }
  }

  if (credited > 0) await flushQueuedSms(orgId).catch(() => {});
  return credited;
}
