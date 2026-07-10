// GET/POST /api/cron/billing — nightly subscription housekeeping (CRON_SECRET).
//
// Three jobs, in this order, per org:
//
//   1. Close any month whose period has ended: freeze it into an Invoice built from
//      the prices as charged, then advance the subscription to the next month. The
//      freeze is idempotent, so a retry after a timeout cannot bill twice.
//   2. Lapse a trial whose end date has passed → PAST_DUE.
//   3. Mirror the Hub wallet, when one is connected. The Hub is the source of truth
//      for whether an invoice is paid; we never decide that ourselves.
//
// Gating never waits for this job. `entitlementsFor` already reads an expired trial
// as PAST_DUE the moment it expires, so a cron that fails to run costs us tidiness,
// not correctness — which is the only safe way to build a job that touches money.
//
// A period that fell behind by several months is caught up one month at a time, so a
// lender who was invisible to the cron for a quarter gets three invoices, not one
// wrong one.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runAsPlatform, runWithOrg } from "@/lib/db/context";
import { freezeInvoice, nextMonth } from "@/lib/billing/invoice";
import { invalidateEntitlements } from "@/lib/billing/entitlements";
import { syncSubscriptionFromHub, hubBillingMode } from "@/lib/billing/hub";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Never catch up further than this in one run; a stuck clock must not spin. */
const MAX_PERIODS_PER_ORG = 24;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  return !!token && token === secret;
}

async function run() {
  const now = new Date();
  const stats = { orgs: 0, invoicesIssued: 0, periodsRolled: 0, trialsLapsed: 0, hubSynced: 0, errors: 0 };

  const subs = await prisma.orgSubscription.findMany({
    include: { org: { select: { id: true, slug: true } } },
  });

  for (const sub of subs) {
    stats.orgs++;
    const orgId = sub.orgId;

    try {
      // 1. Close every month that has ended, oldest first.
      let periodStart = sub.currentPeriodStart;
      let periodEnd = sub.currentPeriodEnd;
      let rolled = 0;

      while (periodEnd <= now && rolled < MAX_PERIODS_PER_ORG) {
        const invoice = await freezeInvoice(orgId, periodStart, periodEnd);
        if (invoice && !invoice.alreadyExisted) stats.invoicesIssued++;

        periodStart = periodEnd;
        periodEnd = nextMonth(periodEnd);
        rolled++;
      }

      if (rolled > 0) {
        await runWithOrg(orgId, () =>
          prisma.orgSubscription.update({
            where: { orgId },
            data: { currentPeriodStart: periodStart, currentPeriodEnd: periodEnd },
          }),
        );
        stats.periodsRolled += rolled;
      }

      // 2. A trial that has run out owes money from here on.
      if (sub.status === "TRIALING" && sub.trialEndsAt && sub.trialEndsAt <= now) {
        await runWithOrg(orgId, () => prisma.orgSubscription.update({ where: { orgId }, data: { status: "PAST_DUE" } }));
        stats.trialsLapsed++;
      }

      // 3. The Hub decides what is paid. We only ever read it.
      if (hubBillingMode() === "live") {
        if (await syncSubscriptionFromHub(orgId, sub.org.slug)) stats.hubSynced++;
      }

      invalidateEntitlements(orgId);
    } catch (err) {
      // One lender's bad month must not stop every other lender's billing.
      stats.errors++;
      console.error(`[cron/billing] org ${sub.org.slug} failed:`, err);
    }
  }

  return stats;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  try {
    const stats = await runAsPlatform(run);
    return NextResponse.json({ success: true, ranAt: new Date().toISOString(), ...stats });
  } catch (err) {
    return NextResponse.json({ success: false, message: err instanceof Error ? err.message : "Billing run failed." }, { status: 500 });
  }
}

export const POST = GET;
