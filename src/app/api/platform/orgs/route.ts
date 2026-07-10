// Platform administration — BirgenAI-side org activation (cross-tenant, the
// ONLY surface that crosses orgs). Gated by a PlatformAdmin session (the
// founder's real account) or, for one more release, the legacy
// PLATFORM_ADMIN_SECRET bearer as break-glass — never by an org session.
//   GET  → all orgs with status + counts + setup completeness (review queue)
//   POST → { orgId, action: "activate" | "suspend" | "pend" | "plan" | "grant-sms" }
import { NextRequest, NextResponse } from "next/server";
import type { OrgPlan } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { runAsPlatform } from "@/lib/db/context";
import { platformAuth, legacyBearerOk } from "@/lib/platform-auth";
import { PLAN_ORDER, PLANS } from "@/lib/billing/plans";
import { invalidateEntitlements } from "@/lib/billing/entitlements";
import { creditTopUp } from "@/lib/sms/wallet";
import { flushQueuedSms } from "@/lib/sms/send";

export const runtime = "nodejs";

async function authorized(req: NextRequest): Promise<boolean> {
  const session = await platformAuth();
  if (session?.admin) return true;
  return legacyBearerOk(req.headers.get("authorization"));
}

export async function GET(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });
  // The one surface that legitimately crosses tenants.
  const orgs = await runAsPlatform(() =>
    prisma.org.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true, slug: true, name: true, mode: true, status: true, plan: true, createdAt: true,
        logoUrl: true, accent: true, onboardingState: true,
        // What the lender is actually paying, and what they last owed. A board that
        // shows a package but not whether it has been paid for is decoration.
        subscription: { select: { status: true, trialEndsAt: true, currentPeriodEnd: true } },
        invoices: { orderBy: { periodStart: "desc" }, take: 1, select: { number: true, totalKes: true, status: true } },
        // A deep negative here is a lender we are subsidising — the board should see it.
        smsWallet: { select: { balance: true } },
        _count: {
          select: {
            staff: true, borrowers: true, loans: true, applications: true,
            // Setup completeness for the review queue: can this lender actually
            // lend the moment the founder flips them ACTIVE?
            products: true, workflows: true, roles: true, integrations: true,
          },
        },
      },
    }),
  );

  return NextResponse.json({
    success: true,
    plans: PLAN_ORDER.map((k) => ({ key: k, name: PLANS[k].name, monthlyKes: PLANS[k].monthlyKes })),
    orgs: orgs.map(({ invoices, smsWallet, onboardingState, ...o }) => {
      const state = (onboardingState ?? {}) as { activationRequestedAt?: string };
      return {
        ...o,
        smsBalance: smsWallet?.balance ?? 0,
        lastInvoice: invoices[0] ? { ...invoices[0], totalKes: Number(invoices[0].totalKes) } : null,
        activationRequestedAt: state.activationRequestedAt ?? null,
        setup: {
          branding: !!o.logoUrl,
          products: o._count.products > 0,
          workflows: o._count.workflows > 0,
          roles: o._count.roles > 1,
          team: o._count.staff > 1,
          vault: o._count.integrations > 0,
        },
      };
    }),
  });
}

export async function POST(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });

  let body: { orgId?: string; action?: string; plan?: string; units?: number; note?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }
  if (!body.orgId) return NextResponse.json({ success: false, message: "orgId is required." }, { status: 400 });

  // Grant SMS credits without money moving — sales sweeteners, goodwill after an
  // outage, demo stock. The note is mandatory BECAUSE no money moves: the ledger
  // entry is the only record of why the platform gave credit away.
  if (body.action === "grant-sms") {
    const units = Math.floor(Number(body.units));
    const note = body.note?.trim() ?? "";
    if (!Number.isFinite(units) || units < 1 || units > 100_000) {
      return NextResponse.json({ success: false, message: "units must be between 1 and 100,000." }, { status: 400 });
    }
    if (!note) return NextResponse.json({ success: false, message: "A note explaining the grant is required." }, { status: 400 });

    return runAsPlatform(async () => {
      const org = await prisma.org.findUnique({ where: { id: body.orgId! }, select: { id: true, slug: true } });
      if (!org) return NextResponse.json({ success: false, message: "Org not found." }, { status: 404 });

      await creditTopUp({ orgId: org.id, units, amountKes: 0, source: "PLATFORM_GRANT", note, createdBy: "platform" });
      await prisma.auditLog.create({
        data: { orgId: org.id, actorType: "platform", action: "sms.grant", entity: "SmsWallet", entityId: org.id, meta: { units, note } },
      }).catch(() => {});
      // The credits may be exactly what a pile of queued reminders was waiting for.
      const flushed = await flushQueuedSms(org.id).catch(() => null);

      return NextResponse.json({ success: true, slug: org.slug, granted: units, flushed: flushed?.sent ?? 0 });
    });
  }

  // Assign a package. Sales negotiates the deal; the Hub still collects the money,
  // and PAST_DUE still switches the metered features off.
  if (body.action === "plan") {
    if (!PLAN_ORDER.includes(body.plan as OrgPlan)) {
      return NextResponse.json({ success: false, message: `plan must be one of ${PLAN_ORDER.join(", ")}.` }, { status: 400 });
    }
    return runAsPlatform(async () => {
      const org = await prisma.org.update({ where: { id: body.orgId! }, data: { plan: body.plan as OrgPlan } }).catch(() => null);
      if (!org) return NextResponse.json({ success: false, message: "Org not found." }, { status: 404 });
      await prisma.auditLog.create({
        data: { orgId: org.id, actorType: "platform", action: "org.plan", entity: "Org", entityId: org.id, meta: { plan: org.plan } },
      }).catch(() => {});
      invalidateEntitlements(org.id);
      return NextResponse.json({ success: true, slug: org.slug, plan: org.plan });
    });
  }

  const status = body.action === "activate" ? "ACTIVE" : body.action === "suspend" ? "SUSPENDED" : body.action === "pend" ? "PENDING" : null;
  if (!status) return NextResponse.json({ success: false, message: "A valid action is required." }, { status: 400 });

  return runAsPlatform(async () => {
    const org = await prisma.org.update({ where: { id: body.orgId! }, data: { status } }).catch(() => null);
    if (!org) return NextResponse.json({ success: false, message: "Org not found." }, { status: 404 });

    await prisma.auditLog.create({
      data: { orgId: org.id, actorType: "platform", action: `org.${body.action}`, entity: "Org", entityId: org.id },
    }).catch(() => {});

    return NextResponse.json({ success: true, slug: org.slug, status: org.status });
  });
}
