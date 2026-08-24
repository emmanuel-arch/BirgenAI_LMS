// Platform administration — BirgenAI-side org activation (cross-tenant, the
// ONLY surface that crosses orgs). Gated by a PlatformAdmin session (the
// founder's real account) or, for one more release, the legacy
// PLATFORM_ADMIN_SECRET bearer as break-glass — never by an org session.
//   GET  → all orgs with status + counts + setup completeness (review queue)
//   POST → { orgId, action: "activate" | "suspend" | "pend" | "plan" | "systems"
//                            | "grant-sms" | "delete-org" }
import { NextRequest, NextResponse } from "next/server";
import type { OrgPlan } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { runAsPlatform } from "@/lib/db/context";
import { platformAuth, legacyBearerOk } from "@/lib/platform-auth";
import { PLAN_ORDER, PLANS } from "@/lib/billing/plans";
import { SUITE_APPS } from "@/lib/suite/apps";
import { ALL_SYSTEM_IDS, normaliseSystems, parseSystems } from "@/lib/suite/entitlements";
import { invalidateEntitlements } from "@/lib/billing/entitlements";
import { creditTopUp } from "@/lib/sms/wallet";
import { flushQueuedSms } from "@/lib/sms/send";
import { deleteTenant, tenantDeletionBlockers } from "@/lib/compliance/tenant";

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
        // Which systems this lender bought. Null means all of them — the board
        // renders that distinctly from "all seven ticked", because the two
        // differ in what happens when an EIGHTH system ships: null follows the
        // catalogue, an explicit list does not.
        systems: true,
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
    catalog: SUITE_APPS.map((a) => ({ id: a.id, name: a.name, short: a.short, accent: a.accent, purpose: a.purpose, external: !!a.external })),
    orgs: orgs.map(({ invoices, smsWallet, onboardingState, systems, ...o }) => {
      const state = (onboardingState ?? {}) as { activationRequestedAt?: string };
      const parsed = parseSystems(systems);
      return {
        ...o,
        // null → "all systems, including ones not built yet". The editor needs to
        // tell that apart from an explicit list, so both are sent.
        systemsAll: parsed === null,
        systems: parsed === null ? [...ALL_SYSTEM_IDS] : [...parsed],
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

  let body: { orgId?: string; action?: string; plan?: string; units?: number; note?: string; confirmSlug?: string; systems?: unknown[] };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }
  if (!body.orgId) return NextResponse.json({ success: false, message: "orgId is required." }, { status: 400 });

  // ── Destroy a tenant. The end of the line; see src/lib/compliance/tenant.ts. ──
  if (body.action === "delete-org") {
    const note = body.note?.trim() ?? "";
    if (note.length < 10) {
      return NextResponse.json({ success: false, message: "A note explaining the deletion is required." }, { status: 400 });
    }
    return runAsPlatform(async () => {
      const org = await prisma.org.findUnique({ where: { id: body.orgId! }, select: { id: true, slug: true, name: true } });
      if (!org) return NextResponse.json({ success: false, message: "Org not found." }, { status: 404 });

      // Typing the slug is the last gate. A destructive button that fires on one
      // click is a button that eventually fires by accident.
      if (body.confirmSlug !== org.slug) {
        return NextResponse.json(
          { success: false, message: `To confirm, type the org's slug exactly: "${org.slug}".` },
          { status: 400 },
        );
      }

      const blockers = await tenantDeletionBlockers(org.id);
      if (blockers.length) {
        return NextResponse.json({ success: false, blockers, message: blockers[0].message }, { status: 409 });
      }

      const outcome = await deleteTenant(org.id);

      // Close out the lender's own request, if they raised one. Their register row
      // dies with them; the audit row (written inside deleteTenant) is what remains.
      return NextResponse.json({ success: true, ...outcome, note });
    });
  }

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

  // ── WHICH SYSTEMS THIS LENDER HOLDS ────────────────────────────────────────
  //
  // The commercial boundary, and the switch with the widest blast radius on this
  // board: turning a system off here removes it from EVERY user at that lender on
  // their next page load — not greyed out, not "request access", gone. See
  // lib/suite/entitlements.ts for why null and [] are different values and why
  // both have to be reachable.
  //
  // Deliberately NOT tied to the plan. The package is what a lender pays each
  // month; the systems are what they bought, and the two come apart constantly in
  // practice — a STARTER lender who took PeopleHub as an add-on, an ENTERPRISE
  // one who genuinely does not want a call centre. Deriving one from the other
  // would mean a package change silently taking a system away.
  if (body.action === "systems") {
    if (!Array.isArray(body.systems) || body.systems.some((s) => typeof s !== "string")) {
      return NextResponse.json({ success: false, message: "systems must be an array of system ids." }, { status: 400 });
    }
    // Unknown ids are dropped rather than 400'd: a board left open in a tab
    // across a deploy that renamed a system would otherwise be unable to save
    // anything at all, and the resulting value is still exactly what the
    // administrator sees ticked.
    const next = normaliseSystems(body.systems as string[]);

    return runAsPlatform(async () => {
      const before = await prisma.org.findUnique({ where: { id: body.orgId! }, select: { systems: true } });
      const org = await prisma.org.update({
        where: { id: body.orgId! },
        data: { systems: next },
        select: { id: true, slug: true, systems: true },
      }).catch(() => null);
      if (!org) return NextResponse.json({ success: false, message: "Org not found." }, { status: 404 });

      // BOTH SIDES OF THE CHANGE ARE RECORDED. "Ledgerly disappeared last
      // Tuesday" is a question somebody will eventually ask, and an audit row
      // holding only the new value cannot answer it.
      await prisma.auditLog.create({
        data: {
          orgId: org.id, actorType: "platform", action: "org.systems", entity: "Org", entityId: org.id,
          meta: { from: before?.systems ?? null, to: next },
        },
      }).catch(() => {});

      return NextResponse.json({ success: true, slug: org.slug, systems: next });
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
