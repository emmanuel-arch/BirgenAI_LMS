// ─────────────────────────────────────────────────────────────────────────────
// What is this org allowed to do, right now?
//
// Entitlement = the plan's features, plus any per-org overrides, minus whatever a
// lapsed subscription takes away. Two rules govern the "minus":
//
//   1. A PAST_DUE or CANCELED org loses the METERED intelligence features — CRB
//      pulls, identity checks, Riri, early-warning. Those cost us real money on
//      every call, and we are not lending a lender our bureau spend on credit.
//
//   2. It NEVER loses the loan book. Borrowers with live loans still repay,
//      officers still collect, the schedule still runs. Holding a lender's
//      customers hostage over an invoice would be indefensible, and the loans on
//      that book are real people's debts. Billing pressure belongs on the
//      features, not on the money.
//
// Resolution is cached per-process for a minute. On a serverless deployment that
// means a plan change can take up to 60s to land in every lambda — acceptable for
// a monthly subscription, and the alternative is a database round trip on every
// gated call.
// ─────────────────────────────────────────────────────────────────────────────
import { NextResponse } from "next/server";
import type { OrgPlan, SubscriptionStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { runWithOrg } from "@/lib/db/context";
import {
  planFor, cheapestPlanWith, UNIT_PRICE_KES,
  type Feature, type UsageKind, type PlanDef,
} from "./plans";

export type Entitlements = {
  orgId: string;
  orgSlug: string;
  plan: PlanDef;
  status: SubscriptionStatus;
  /** Trialing or paid. False ⇒ metered features are off. */
  paying: boolean;
  features: Set<Feature>;
  included: Partial<Record<UsageKind, number>>;
  /** null = unlimited */
  seats: number | null;
  periodStart: Date;
  periodEnd: Date;
  trialEndsAt: Date | null;
};

const TTL_MS = 60_000;

// Hung off globalThis, NOT a module-level const. Next compiles each route and page
// into its own server bundle, so a plain module Map is instantiated once PER
// BUNDLE: the platform route would clear its copy while the intelligence page went
// on serving a stale plan. (Same reason src/lib/prisma.ts pins its client here.)
// Across lambdas nothing is shared and the TTL is the only guarantee — fine for a
// monthly subscription, and every write path calls invalidateEntitlements anyway.
const globalForBilling = globalThis as unknown as { entitlementsCache?: Map<string, { at: number; value: Entitlements }> };
const cache = (globalForBilling.entitlementsCache ??= new Map());

/** Metered features cost us money per call; they are what a lapsed org loses. */
const METERED_FEATURES: Feature[] = ["crb", "id-verify", "riri", "portfolio-scan"];

function monthWindow(now = new Date()): { start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

/** The current billing month, in UTC. Exported so usage rollups agree with gating. */
export const currentPeriod = monthWindow;

/**
 * Read (and lazily create) the org's subscription, then fold in plan + overrides.
 * `Org` carries no RLS policy, so it is readable under any tenant context.
 */
async function resolve(orgId: string): Promise<Entitlements> {
  return runWithOrg(orgId, async () => {
    const org = await prisma.org.findUniqueOrThrow({ where: { id: orgId }, select: { slug: true, plan: true } });
    const { start, end } = monthWindow();

    const sub = await prisma.orgSubscription.upsert({
      where: { orgId },
      // A brand-new lender starts on a trial of whatever plan they were assigned,
      // so onboarding never dead-ends at a paywall.
      create: {
        orgId,
        status: "TRIALING",
        trialEndsAt: new Date(Date.now() + 14 * 86_400_000),
        currentPeriodStart: start,
        currentPeriodEnd: end,
      },
      update: {},
    });

    // An expired trial is PAST_DUE until someone pays, but we don't mutate here —
    // the nightly cron owns state transitions. Gating just reads the truth.
    const trialLapsed = sub.status === "TRIALING" && !!sub.trialEndsAt && sub.trialEndsAt < new Date();
    const status: SubscriptionStatus = trialLapsed ? "PAST_DUE" : sub.status;
    const paying = status === "ACTIVE" || status === "TRIALING";

    const plan = planFor(org.plan as OrgPlan);
    const overrides = (sub.featureOverrides ?? {}) as Partial<Record<Feature, boolean>>;

    const features = new Set<Feature>(plan.features);
    for (const [f, on] of Object.entries(overrides)) {
      if (on) features.add(f as Feature);
      else features.delete(f as Feature);
    }
    // Lapsed: keep the loan book, drop the things that bill us per call.
    if (!paying) for (const f of METERED_FEATURES) features.delete(f);

    const included = { ...plan.included, ...((sub.includedOverrides ?? {}) as Partial<Record<UsageKind, number>>) };

    return {
      orgId,
      orgSlug: org.slug,
      plan,
      status,
      paying,
      features,
      included,
      seats: sub.seatsOverride ?? plan.seats,
      periodStart: sub.currentPeriodStart,
      periodEnd: sub.currentPeriodEnd,
      trialEndsAt: sub.trialEndsAt,
    };
  });
}

export async function entitlementsFor(orgId: string): Promise<Entitlements> {
  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = await resolve(orgId);
  cache.set(orgId, { at: Date.now(), value });
  return value;
}

/** Call after any plan/subscription write so the caller sees it immediately. */
export function invalidateEntitlements(orgId: string): void {
  cache.delete(orgId);
}

export async function hasFeature(orgId: string, feature: Feature): Promise<boolean> {
  return (await entitlementsFor(orgId)).features.has(feature);
}

/**
 * Route guard. Returns a ready-to-send 402 when the org cannot use `feature`,
 * or null to proceed. The response names the cheapest plan that would unlock it,
 * so the UI can offer a specific upgrade rather than a shrug.
 */
export async function requireFeature(orgId: string, feature: Feature): Promise<NextResponse | null> {
  const ent = await entitlementsFor(orgId);
  if (ent.features.has(feature)) return null;

  const upgrade = cheapestPlanWith(feature);
  const lapsed = !ent.paying && (upgrade ? ent.plan.features.includes(feature) : false);

  return NextResponse.json(
    {
      success: false,
      upgradeRequired: true,
      feature,
      currentPlan: ent.plan.key,
      status: ent.status,
      upgradeTo: lapsed ? null : (upgrade?.key ?? null),
      message: lapsed
        ? `Your subscription is ${ent.status === "PAST_DUE" ? "past due" : "canceled"}. Settle it to re-enable this.`
        : upgrade
          ? `${upgrade.name} (KES ${upgrade.monthlyKes.toLocaleString()}/mo) unlocks this.`
          : "This feature is not available on your plan.",
    },
    { status: 402 },
  );
}

/** Included allowance, then the overage price per extra unit. */
export function overageFor(ent: Entitlements, kind: UsageKind, used: number): { included: number; overage: number; costKes: number } {
  const included = ent.included[kind] ?? 0;
  const overage = Math.max(0, used - included);
  return { included, overage, costKes: overage * UNIT_PRICE_KES[kind] };
}
