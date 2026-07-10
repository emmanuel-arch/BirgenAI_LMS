// Platform administration — BirgenAI-side org activation (cross-tenant, the
// ONLY surface that crosses orgs). Gated by PLATFORM_ADMIN_SECRET bearer —
// never by an org session.
//   GET  → all orgs with status + counts
//   POST → { orgId, action: "activate" | "suspend" | "pend" }
import { NextRequest, NextResponse } from "next/server";
import type { OrgPlan } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { runAsPlatform } from "@/lib/db/context";
import { PLAN_ORDER, PLANS } from "@/lib/billing/plans";
import { invalidateEntitlements } from "@/lib/billing/entitlements";

export const runtime = "nodejs";

function authorized(req: NextRequest): boolean {
  const secret = process.env.PLATFORM_ADMIN_SECRET?.trim();
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  return !!token && token === secret;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });
  // The one surface that legitimately crosses tenants — gated by the platform secret.
  const orgs = await runAsPlatform(() =>
    prisma.org.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true, slug: true, name: true, mode: true, status: true, plan: true, createdAt: true,
        // What the lender is actually paying, and what they last owed. A board that
        // shows a package but not whether it has been paid for is decoration.
        subscription: { select: { status: true, trialEndsAt: true, currentPeriodEnd: true } },
        invoices: { orderBy: { periodStart: "desc" }, take: 1, select: { number: true, totalKes: true, status: true } },
        _count: { select: { staff: true, borrowers: true, loans: true, applications: true } },
      },
    }),
  );

  return NextResponse.json({
    success: true,
    plans: PLAN_ORDER.map((k) => ({ key: k, name: PLANS[k].name, monthlyKes: PLANS[k].monthlyKes })),
    orgs: orgs.map(({ invoices, ...o }) => ({
      ...o,
      lastInvoice: invoices[0] ? { ...invoices[0], totalKes: Number(invoices[0].totalKes) } : null,
    })),
  });
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });

  let body: { orgId?: string; action?: string; plan?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }
  if (!body.orgId) return NextResponse.json({ success: false, message: "orgId is required." }, { status: 400 });

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
