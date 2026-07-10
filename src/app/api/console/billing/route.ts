// GET  /api/console/billing — this org's package, usage this month, and estimate.
// POST /api/console/billing { action: "checkout" | "sms-topup" | "sync" }
//
//   checkout  → a URL into the Hub's centralised wallet. We do not take money here.
//   sms-topup → same wallet, different product: a prepaid SMS pack.
//   sync      → re-read what the Hub says has been paid, and mirror it locally —
//               the subscription AND any SMS packs bought since we last looked.
//
// The estimate is exactly that. The authoritative amount is recomputed by the Hub
// from its own rate card when the lender actually pays, so a stale price in this
// deployment can misinform, never mischarge.
import { NextRequest, NextResponse } from "next/server";
import { auth, hasAdminAccess } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { entitlementsFor, overageFor, currentPeriod, invalidateEntitlements } from "@/lib/billing/entitlements";
import { usageBetween } from "@/lib/billing/meter";
import {
  PLANS, PLAN_ORDER, USAGE_KINDS, USAGE_LABEL, UNIT_PRICE_KES, SMS_PACKS, smsPack,
  deliverableFeatures, isBillableKind,
} from "@/lib/billing/plans";
import {
  hubCheckoutUrl, hubSmsTopupUrl, hubBillingMode, syncSubscriptionFromHub, syncSmsTopupsFromHub,
} from "@/lib/billing/hub";
import { estimateOpenPeriod } from "@/lib/billing/invoice";
import { smsWalletSummary } from "@/lib/sms/wallet";
import { getIntegration } from "@/lib/vault/integrations";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const orgId = session.user.orgId;

  const ent = await entitlementsFor(orgId);
  const { start, end } = currentPeriod();
  const used = await usageBetween(orgId, start, end);

  // Only meters whose tool exists. Otherwise the page advertises an allowance for
  // something the lender cannot use ("Documents parsed 0 / 100 included").
  const lines = USAGE_KINDS.filter(isBillableKind)
    .map((kind) => {
      const qty = used[kind] ?? 0;
      const { included, overage, costKes } = overageFor(ent, kind, qty);
      return { kind, label: USAGE_LABEL[kind], used: qty, included, overage, unitPriceKes: UNIT_PRICE_KES[kind], costKes };
    })
    .filter((l) => l.used > 0 || l.included > 0);

  // The estimate uses the SAME arithmetic the invoice will: the allowance is spent
  // chronologically and every billed unit costs what it cost when it happened. The
  // bars above are a progress display; this is the number the lender will owe.
  const open = await estimateOpenPeriod(orgId, ent.plan.key, (await prisma.orgSubscription.findUnique({ where: { orgId }, select: { includedOverrides: true } }))?.includedOverrides as never);
  const overageKes = open.overageKes;

  // Closed months, exactly as they were frozen. Never recomputed for display.
  const invoices = await prisma.invoice.findMany({
    where: { orgId },
    orderBy: { periodStart: "desc" },
    take: 12,
    select: { id: true, number: true, periodStart: true, periodEnd: true, plan: true, planFeeKes: true, overageKes: true, totalKes: true, status: true, issuedAt: true, paidAt: true },
  });

  // Messaging. SMS is prepaid — allowance, then credits — so it lives in its own
  // section rather than on the invoice estimate. An org sending through its own
  // vault provider is told so instead of being sold credits it would never spend.
  const [wallet, ownSms] = await Promise.all([
    smsWalletSummary(orgId),
    getIntegration(orgId, "SMS").then((c) => !!c?.apiKey).catch(() => false),
  ]);

  return NextResponse.json({
    success: true,
    plan: { ...ent.plan, features: deliverableFeatures(ent.plan) },
    invoices: invoices.map((i) => ({
      ...i, planFeeKes: Number(i.planFeeKes), overageKes: Number(i.overageKes), totalKes: Number(i.totalKes),
    })),
    features: [...ent.features],
    status: ent.status,
    paying: ent.paying,
    trialEndsAt: ent.trialEndsAt,
    period: { start, end },
    seats: ent.seats,
    lines,
    sms: {
      ...wallet,
      included: ent.included.sms ?? 0,
      used: used.sms ?? 0,
      packs: SMS_PACKS,
      ownProvider: ownSms,
    },
    estimate: { baseKes: open.planFeeKes, overageKes, totalKes: open.totalKes },
    catalogue: PLAN_ORDER.map((k) => ({ ...PLANS[k], features: deliverableFeatures(PLANS[k]) })),
    payment: { via: "hub-wallet", mode: hubBillingMode() },
    canPay: hasAdminAccess(session),
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const orgId = session.user.orgId;

  let body: { action?: string; plan?: string; pack?: string; returnTo?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  if (body.action === "sync") {
    const ent = await entitlementsFor(orgId);
    const moved = await syncSubscriptionFromHub(orgId, ent.orgSlug);
    const packs = await syncSmsTopupsFromHub(orgId, ent.orgSlug);
    invalidateEntitlements(orgId);
    return NextResponse.json({
      success: true,
      synced: moved || packs > 0,
      message: packs > 0
        ? `Updated from the BirgenAI wallet — ${packs} SMS ${packs === 1 ? "pack" : "packs"} credited.`
        : moved ? "Updated from the BirgenAI wallet." : "No payment record to sync yet.",
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

  if (body.action === "sms-topup") {
    // Buying credits is spending company money — the same admin bar as checkout.
    if (!hasAdminAccess(session)) {
      return NextResponse.json({ success: false, message: "Only an admin can buy SMS credits." }, { status: 403 });
    }
    const pack = smsPack(body.pack);
    if (!pack) return NextResponse.json({ success: false, message: "Choose an SMS pack." }, { status: 400 });
    const ent = await entitlementsFor(orgId);
    const returnTo = body.returnTo?.startsWith("http") ? body.returnTo : `${req.nextUrl.origin}/console/billing`;
    const url = hubSmsTopupUrl(ent.orgSlug, pack.key, returnTo);
    if (!url) {
      return NextResponse.json(
        { success: false, message: "The BirgenAI wallet is not connected to this deployment yet." },
        { status: 503 },
      );
    }
    return NextResponse.json({ success: true, url });
  }

  return NextResponse.json({ success: false, message: "Unknown action." }, { status: 400 });
}
