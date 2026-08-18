// ─────────────────────────────────────────────────────────────────────────────
// GET / PUT /api/console/crb/plan — the lender's bureau SCRUTINY configuration.
//
// Deliberately NOT the generic /api/orgs/integrations PUT. That endpoint takes a
// whole config object and overwrites the record, which is right for a credentials
// form and catastrophic here: the scrutiny screen never sees the Metropol keys
// (they are secrets and are masked out on the way to the browser), so a whole-
// object write from it would erase them. This route MERGES — it reads the stored
// config, replaces only the plan fields, and writes back. The keys are never in
// the request body and therefore can never be lost by this screen.
//
// GET returns the plan plus a MASKED view of the credentials, so the screen can
// tell the lender whether they are on test or production keys without ever
// transporting the keys themselves.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { getIntegration, setIntegration, type CrbConfig } from "@/lib/vault/integrations";
import { prisma } from "@/lib/prisma";
import {
  resolvePlan, projectSpend, repeatRateFor, SCRUTINY_TIERS, tierByKey,
  reportByCode, DEFAULT_LADDER, type ScrutinyTierKey, type LadderRung,
} from "@/lib/crb/catalogue";

export const runtime = "nodejs";

const TIER_KEYS = new Set<string>([...SCRUTINY_TIERS.map((t) => t.key), "custom"]);
const BUDGET_ACTIONS = new Set(["warn", "downgrade", "block"]);

/** A key is shown as its first 4 and last 4 characters, never in full. */
const mask = (v?: string | null): string | null => {
  const s = (v ?? "").trim();
  if (!s) return null;
  return s.length <= 10 ? `${s.slice(0, 2)}…${s.slice(-2)}` : `${s.slice(0, 4)}…${s.slice(-4)}`;
};

export async function GET() {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "settings.view");
  if (denied) return denied;
  const orgId = session.user.orgId;

  const cfg = (await getIntegration(orgId, "CRB").catch(() => null)) ?? ({} as CrbConfig);

  // Actual bureau spend this calendar month, from the metering ledger — so the
  // projection below can be checked against what has really been billed rather
  // than only against an estimate the lender typed in.
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const [spent, checks] = await Promise.all([
    prisma.usageEvent.aggregate({
      where: { orgId, kind: "crb", createdAt: { gte: monthStart } },
      _sum: { unitCost: true },
    }),
    prisma.usageEvent.count({ where: { orgId, kind: "crb", createdAt: { gte: monthStart } } }),
  ]);

  return NextResponse.json({
    success: true,
    plan: {
      scrutinyTier: cfg.scrutinyTier ?? null,
      reports: cfg.reports ?? null,
      ladder: cfg.ladder ?? null,
      tariff: cfg.tariff ?? null,
      reuseHours: cfg.reuseHours ?? 6,
      monthlyChecks: cfg.monthlyChecks ?? null,
      monthlyBudget: cfg.monthlyBudget ?? null,
      budgetAction: cfg.budgetAction ?? "warn",
      environment: cfg.environment ?? null,
      /** Legacy setting, shown so a lender can see what they are migrating from. */
      reportDepth: cfg.reportDepth ?? null,
    },
    credentials: {
      bureau: cfg.bureau ?? null,
      host: cfg.host ?? null,
      port: cfg.port ?? null,
      apiVersion: cfg.apiVersion ?? null,
      publicKey: mask(cfg.publicKey ?? cfg.username),
      privateKey: mask(cfg.privateKey ?? cfg.password),
      configured: !!((cfg.publicKey || cfg.username) && (cfg.privateKey || cfg.password) && cfg.apiVersion),
    },
    actual: {
      monthStart: monthStart.toISOString(),
      checks,
      spend: Number(spent._sum.unitCost ?? 0),
    },
  });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "settings.manage");
  if (denied) return denied;
  const orgId = session.user.orgId;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 });
  }

  const tier = String(body.scrutinyTier ?? "standard");
  if (!TIER_KEYS.has(tier)) {
    return NextResponse.json({ success: false, message: `Unknown scrutiny tier "${tier}".` }, { status: 400 });
  }

  // A custom tier with no reports would buy nothing and silently return an empty
  // file — refuse it here rather than let a lender save a configuration that
  // makes every borrower look like a thin file.
  const reports = Array.isArray(body.reports)
    ? [...new Set((body.reports as unknown[]).map(Number).filter((c) => !!reportByCode(c)))]
    : [];
  if (tier === "custom" && reports.length === 0) {
    return NextResponse.json(
      { success: false, message: "A custom plan must include at least one report." },
      { status: 400 },
    );
  }

  // The ladder: rungs sorted ascending with exactly one open-ended top rung, so
  // every possible loan amount lands on exactly one tier. A ladder with a hole
  // in it is worse than no ladder — some amounts would resolve to nothing.
  let ladder: LadderRung[] | undefined;
  if (Array.isArray(body.ladder)) {
    const rungs = (body.ladder as Array<Record<string, unknown>>)
      .map((r) => ({
        upTo: r.upTo === null || r.upTo === undefined || r.upTo === "" ? null : Math.max(0, Number(r.upTo) || 0),
        tier: String(r.tier ?? "standard"),
      }))
      .filter((r) => tierByKey(r.tier));
    if (rungs.length) {
      const bounded = rungs.filter((r) => r.upTo !== null).sort((a, b) => (a.upTo ?? 0) - (b.upTo ?? 0));
      const open = rungs.find((r) => r.upTo === null) ?? { upTo: null, tier: rungs.at(-1)!.tier };
      ladder = [...bounded, open] as LadderRung[];
    }
  }

  // Tariff: report code → KES. Non-numeric or negative entries are dropped rather
  // than saved as zero, because a zero price silently reports a paid report as free.
  let tariff: Record<string, number> | undefined;
  if (body.tariff && typeof body.tariff === "object") {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(body.tariff as Record<string, unknown>)) {
      const code = Number(k);
      const price = Number(v);
      if (reportByCode(code) && Number.isFinite(price) && price >= 0) out[String(code)] = price;
    }
    if (Object.keys(out).length) tariff = out;
  }

  const num = (v: unknown, min: number, max: number, fallback: number | undefined): number | undefined => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  };

  const existing = (await getIntegration(orgId, "CRB").catch(() => null)) ?? ({} as CrbConfig);

  const next: CrbConfig = {
    ...existing,
    bureau: existing.bureau ?? "metropol",
    scrutinyTier: tier,
    reports: tier === "custom" ? reports : undefined,
    ladder,
    tariff,
    reuseHours: num(body.reuseHours, 0, 24 * 90, 6),
    monthlyChecks: num(body.monthlyChecks, 0, 10_000_000, undefined),
    monthlyBudget: num(body.monthlyBudget, 0, 1_000_000_000, undefined),
    budgetAction: BUDGET_ACTIONS.has(String(body.budgetAction)) ? (body.budgetAction as CrbConfig["budgetAction"]) : "warn",
    environment: body.environment === "production" || body.environment === "test" ? body.environment : existing.environment,
    // The legacy depth is retired the moment a tier is saved — leaving it would
    // give two settings that disagree, and the resolver would have to pick.
    reportDepth: undefined,
  };

  await setIntegration(orgId, "CRB", next, session.user.id);

  // Hand back the resolved plan and projection so the screen shows the SAVED
  // truth rather than its own optimistic arithmetic.
  const plan = resolvePlan({ tier: tier as ScrutinyTierKey, reports, tariff });
  const projection = projectSpend({
    perCheck: plan.perCheck,
    monthlyChecks: next.monthlyChecks ?? 0,
    reuseHours: next.reuseHours ?? 6,
    monthlyBudget: next.monthlyBudget ?? null,
  });

  return NextResponse.json({
    success: true,
    plan,
    projection,
    repeatRate: repeatRateFor(next.reuseHours ?? 6),
    ladder: ladder ?? DEFAULT_LADDER,
  });
}
