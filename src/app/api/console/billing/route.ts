// GET  /api/console/billing — this org's package, usage this month, and estimate.
// POST /api/console/billing { action: "checkout" | "sync" }
//
//   checkout → a URL into the Hub's centralised wallet. We do not take money here.
//   sync     → re-read what the Hub says has been paid, and mirror it locally.
//
// The estimate is exactly that. The authoritative amount is recomputed by the Hub
// from its own rate card when the lender actually pays, so a stale price in this
// deployment can misinform, never mischarge.
import { NextRequest, NextResponse } from "next/server";
import { auth, hasAdminAccess } from "@/lib/auth";
import { entitlementsFor, overageFor, currentPeriod, invalidateEntitlements } from "@/lib/billing/entitlements";
import { usageBetween } from "@/lib/billing/meter";
import { PLANS, PLAN_ORDER, USAGE_KINDS, USAGE_LABEL, UNIT_PRICE_KES } from "@/lib/billing/plans";
import { hubCheckoutUrl, hubBillingMode, syncSubscriptionFromHub } from "@/lib/billing/hub";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const orgId = session.user.orgId;

  const ent = await entitlementsFor(orgId);
  const { start, end } = currentPeriod();
  const used = await usageBetween(orgId, start, end);

  const lines = USAGE_KINDS.map((kind) => {
    const qty = used[kind] ?? 0;
    const { included, overage, costKes } = overageFor(ent, kind, qty);
    return { kind, label: USAGE_LABEL[kind], used: qty, included, overage, unitPriceKes: UNIT_PRICE_KES[kind], costKes };
  }).filter((l) => l.used > 0 || l.included > 0);

  const overageKes = lines.reduce((s, l) => s + l.costKes, 0);

  return NextResponse.json({
    success: true,
    plan: { ...ent.plan, features: ent.plan.features },
    features: [...ent.features],
    status: ent.status,
    paying: ent.paying,
    trialEndsAt: ent.trialEndsAt,
    period: { start, end },
    seats: ent.seats,
    lines,
    estimate: { baseKes: ent.plan.monthlyKes, overageKes, totalKes: ent.plan.monthlyKes + overageKes },
    catalogue: PLAN_ORDER.map((k) => PLANS[k]),
    payment: { via: "hub-wallet", mode: hubBillingMode() },
    canPay: hasAdminAccess(session),
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const orgId = session.user.orgId;

  let body: { action?: string; plan?: string; returnTo?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  if (body.action === "sync") {
    const ent = await entitlementsFor(orgId);
    const moved = await syncSubscriptionFromHub(orgId, ent.orgSlug);
    invalidateEntitlements(orgId);
    return NextResponse.json({
      success: true,
      synced: moved,
      message: moved ? "Updated from the BirgenAI wallet." : "No payment record to sync yet.",
    });
  }

  if (body.action === "checkout") {
    // Only a billing admin sends the company to a payment page. This check is what
    // the signed token vouches for — the Hub has no way to make it itself.
    if (!hasAdminAccess(session)) {
      return NextResponse.json({ success: false, message: "Only an admin can start a payment." }, { status: 403 });
    }
    const ent = await entitlementsFor(orgId);
    const plan = PLAN_ORDER.includes(body.plan as never) ? (body.plan as keyof typeof PLANS) : ent.plan.key;
    const returnTo = body.returnTo?.startsWith("http") ? body.returnTo : `${req.nextUrl.origin}/console/billing`;
    const url = hubCheckoutUrl(ent.orgSlug, plan, returnTo);
    if (!url) {
      // No shared secret ⇒ we cannot vouch for this org, so we do not hand out a link
      // the Hub would refuse anyway.
      return NextResponse.json(
        { success: false, message: "The BirgenAI wallet is not connected to this deployment yet." },
        { status: 503 },
      );
    }
    return NextResponse.json({ success: true, url });
  }

  return NextResponse.json({ success: false, message: "Unknown action." }, { status: 400 });
}
