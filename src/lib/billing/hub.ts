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
//   1. the console sends their billing admin to the Hub's checkout
//      (`/transact?lms=<slug>&plan=<PLAN>&return=<back here>`), the same deep-link
//      the Movies app uses for its upgrades;
//   2. the Hub recomputes the amount from ITS rate card — never from anything we
//      send — opens a PaymentIntent with purpose SUBSCRIPTION, and STK-pushes to
//      the Till;
//   3. its callback settles the intent through `lib/wallet.ts` and marks the org
//      paid through +30 days;
//   4. we read that state back here and mirror it onto OrgSubscription.
//
// Step 4 is the only coupling, and it is read-only: the Hub is the source of truth
// for whether an invoice is paid, and this app never asserts otherwise.
//
// SIMULATION-FIRST, like every other provider seam here. With no HUB_BILLING_SECRET
// the sync is a no-op and local OrgSubscription state stands, so the demo org and
// local development keep working with no Hub running.
// ─────────────────────────────────────────────────────────────────────────────
import type { OrgPlan } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { runWithOrg } from "@/lib/db/context";
import { invalidateEntitlements } from "./entitlements";

export type HubBillingMode = "simulation" | "live";

const DEFAULT_HUB = "https://birgenai.com";

export function hubUrl(): string {
  return (process.env.HUB_BILLING_URL || process.env.NEXT_PUBLIC_HUB_URL || DEFAULT_HUB).replace(/\/$/, "");
}

export function hubBillingMode(): HubBillingMode {
  return process.env.HUB_BILLING_SECRET?.trim() ? "live" : "simulation";
}

/**
 * Where to send a billing admin to pay. The plan is a HINT for pre-selection; the
 * Hub reads the authoritative plan and price from its own records, so a tampered
 * query string buys nothing.
 */
export function hubCheckoutUrl(orgSlug: string, plan: OrgPlan, returnTo: string): string {
  const u = new URL(`${hubUrl()}/transact`);
  u.searchParams.set("lms", orgSlug);
  u.searchParams.set("plan", plan);
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
  const secret = process.env.HUB_BILLING_SECRET?.trim();
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

  await runWithOrg(orgId, async () => {
    await prisma.org.update({ where: { id: orgId }, data: { plan: hub.plan } });
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
