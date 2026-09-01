// Field Ops — the worklist of customers with no location on file.
//
// A borrower with no business/home pin never appears on a route and, once the
// location gate is on, cannot be disbursed to. This is the list of exactly those
// customers, worst first, so an officer can capture the pin on the next visit.
//
// TWO BOOKS ANSWER THIS. A NATIVE lender's customers are in our Postgres. A
// BRIDGED lender's are in their own ServiceSuite, and there the list is not a
// handful of stragglers: Micromart's Micro Eazy entity has 17,017 customers and
// not one coordinate among them, so the response carries whole-book statistics and
// the officer queues the backlog already shards into, and pages in the lender's
// database rather than shipping 17k rows to a browser.
//
// Both branches return the SAME shape — tier, exposure, stats — so the screen has
// one set of code and one set of words regardless of which book replied.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { prisma } from "@/lib/prisma";
import { requireFeature } from "@/lib/billing/entitlements";
import { resolveScope, borrowerScopeWhere } from "@/lib/rbac/scope";
import { resolveOrg } from "@/lib/tenancy";
import { listNeedsLocationLive, getNeedsLocationStats, listNeedsLocationQueues } from "@/lib/lms/servicesuite";

export const runtime = "nodejs";

const MAX_PAGE = 200;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "field.view");
  if (denied) return denied;
  const orgId = session.user.orgId;
  const gate = await requireFeature(orgId, "route-planner");
  if (gate) return gate;

  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") ?? "").trim();
  const tier = sp.get("tier") ?? "";
  const agentId = Number(sp.get("agent") ?? 0) || 0;
  const takeRaw = Number(sp.get("take") ?? 25);
  const skipRaw = Number(sp.get("skip") ?? 0);
  const take = Number.isFinite(takeRaw) ? Math.min(Math.max(takeRaw, 1), MAX_PAGE) : 25;
  const skip = Number.isFinite(skipRaw) ? Math.max(skipRaw, 0) : 0;

  // ── The lender's own book ──────────────────────────────────────────────────
  if (session.user.orgSlug) {
    const org = await resolveOrg(session.user.orgSlug);
    if (org?.mode === "BRIDGED" && org.bridgedReady && org.registry && org.entityId) {
      try {
        // Whole-book stats and the queue split describe the BOOK, not the page, so
        // they are fetched once on the first unfiltered view instead of being
        // recomputed on every page to say the same thing.
        const wantContext = skip === 0 && q === "" && agentId === 0;
        const [live, stats, queues] = await Promise.all([
          listNeedsLocationLive(org.registry, org.entityId, { q, take, skip, tier, agentId }),
          wantContext ? getNeedsLocationStats(org.registry, org.entityId) : Promise.resolve(null),
          wantContext ? listNeedsLocationQueues(org.registry, org.entityId) : Promise.resolve(null),
        ]);

        return NextResponse.json({
          success: true,
          source: "servicesuite",
          entityId: org.entityId,
          total: live.total,
          stats,
          queues,
          customers: live.rows.map((r) => ({
            // The live ref, so the row opens through the resolve step that seeds a
            // local record — the pin is OURS to store, and needs somewhere to land.
            id: r.ref,
            serviceSuiteId: r.serviceSuiteId,
            name: r.name ?? r.phone ?? `Customer ${r.serviceSuiteId}`,
            phone: r.phone ?? "",
            nationalId: r.nationalId,
            portraitUrl: r.portraitUrl,
            tier: r.tier,
            verified: r.kycVerified,
            activeLoans: r.openLoans,
            olb: r.olb,
            clearedLoans: r.clearedLoans,
            loanLimit: r.loanLimit,
            riskScore: r.riskScore,
            riskCategory: r.riskCategory,
            graduationCount: r.graduationCount,
            dueInDays: r.dueInDays,
            agentId: r.agentId,
            agentName: r.agentName,
            since: r.createdAt,
          })),
        });
      } catch (err) {
        // Say the read failed. An empty list here would read as "every customer is
        // pinned" — the most reassuring possible lie.
        return NextResponse.json(
          {
            success: false,
            source: "servicesuite",
            message: `Could not read the lender's book: ${err instanceof Error ? err.message : "unknown error"}`,
          },
          { status: 502 },
        );
      }
    }
  }

  // ── Our own book ───────────────────────────────────────────────────────────
  const scope = await resolveScope(session);
  const scoped = { orgId, ...borrowerScopeWhere(scope) };
  // No primary pin AND no home pin — genuinely invisible to routes.
  const unpinned = { ...scoped, lat: null, homeLat: null };

  const [total, borrowers, bookTotal, pinnedCount, returning12m] = await Promise.all([
    prisma.borrower.count({ where: unpinned }),
    prisma.borrower.findMany({
      where: unpinned,
      select: {
        id: true, firstName: true, otherName: true, phone: true, nationalId: true,
        kycStatus: true, createdAt: true, loanLimit: true, creditScore: true,
        riskBand: true, graduationCount: true,
        loans: { select: { status: true, balance: true } },
      },
      // Ordering is by tier and exposure, which live in the loans relation — so the
      // sort happens below, over a bounded page of the org's own (small) book.
      orderBy: { createdAt: "asc" },
      take: MAX_PAGE * 4,
    }),
    prisma.borrower.count({ where: scoped }),
    prisma.borrower.count({ where: { ...scoped, NOT: { lat: null } } }),
    prisma.borrower.count({
      where: { ...scoped, loans: { some: { createdAt: { gte: new Date(Date.now() - 365 * 86400000) } } } },
    }),
  ]);

  const rows = borrowers.map((b) => {
    const active = b.loans.filter((l) => l.status === "ACTIVE" || l.status === "PENDING_DISBURSEMENT");
    const cleared = b.loans.filter((l) => l.status === "CLEARED");
    return {
      id: b.id,
      serviceSuiteId: null as number | null,
      name: [b.firstName, b.otherName].filter(Boolean).join(" ") || b.phone,
      phone: b.phone,
      nationalId: b.nationalId,
      portraitUrl: null as string | null,
      tier: active.length > 0 ? "MONEY_OUT" : cleared.length > 0 ? "REPEAT" : "DORMANT",
      verified: b.kycStatus === "VERIFIED",
      activeLoans: active.length,
      olb: active.reduce((s, l) => s + Number(l.balance), 0),
      clearedLoans: cleared.length,
      loanLimit: b.loanLimit != null ? Number(b.loanLimit) : null,
      creditScore: b.creditScore,
      riskCategory: b.riskBand,
      graduationCount: b.graduationCount,
      dueInDays: null as number | null,
      agentId: null as number | null,
      agentName: null as string | null,
      since: b.createdAt.toISOString(),
    };
  });

  // Same order of work as the live branch: live exposure first, then the biggest
  // exposure, then the largest limit waiting on the gate, then oldest on the book.
  const rank = { MONEY_OUT: 0, REPEAT: 1, DORMANT: 2 } as const;
  rows.sort((a, b) =>
    rank[a.tier as keyof typeof rank] - rank[b.tier as keyof typeof rank] ||
    b.olb - a.olb ||
    (b.loanLimit ?? 0) - (a.loanLimit ?? 0) ||
    (a.since < b.since ? -1 : 1));

  const tiered = tier === "MONEY_OUT" || tier === "REPEAT" || tier === "DORMANT" ? rows.filter((r) => r.tier === tier) : rows;
  const needle = q.toLowerCase();
  const digits = q.replace(/\D/g, "");
  const searched = q
    ? tiered.filter((r) =>
        r.name.toLowerCase().includes(needle) ||
        (digits.length >= 3 && r.phone.includes(digits)) ||
        (r.nationalId ?? "").includes(q))
    : tiered;

  const moneyOut = rows.filter((r) => r.tier === "MONEY_OUT");
  const repeats = rows.filter((r) => r.tier === "REPEAT");

  return NextResponse.json({
    success: true,
    source: "postgres",
    entityId: null,
    total: q || tier ? searched.length : total,
    stats: skip === 0 ? {
      total: bookTotal,
      pinned: pinnedCount,
      unpinned: total,
      moneyOutCustomers: moneyOut.length,
      moneyOutOlb: moneyOut.reduce((s, r) => s + r.olb, 0),
      repeatCustomers: repeats.length,
      repeatLimit: repeats.reduce((s, r) => s + (r.loanLimit ?? 0), 0),
      dormantCustomers: rows.length - moneyOut.length - repeats.length,
      // Our own book has no upstream officer assignment to shard by, and inventing
      // one would be worse than showing none.
      agentQueues: 0,
      unpinnedKycVerified: rows.filter((r) => r.verified).length,
      unpinnedScored: rows.filter((r) => r.creditScore != null).length,
      limitBehindGate: rows.reduce((s, r) => s + (r.loanLimit ?? 0), 0),
      returning12m,
      activeMonths12m: 0,
    } : null,
    queues: null,
    customers: searched.slice(skip, skip + take),
  });
}
