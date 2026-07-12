// GET/POST /api/cron/portfolio — nightly batch portfolio scoring (CRON_SECRET).
//
// Runs at 03:45, deliberately AFTER the outcome backfill (03:00): each run carries
// a drift report measured against realised outcomes, and it should see labels that
// are hours old, not a day old.
//
// One PortfolioRun per org that is entitled to portfolio-scan. The entitlement
// check is the same hasFeature the console uses — a lapsed subscription loses the
// scan here exactly as it loses it on screen, and regains the trend when it pays
// (with a visible gap in the line, which is honest). Orgs with no book and no
// history are skipped rather than accumulating rows of zeros.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runAsPlatform, runWithOrg } from "@/lib/db/context";
import { hasFeature } from "@/lib/billing/entitlements";
import { runPortfolio, sweepPortfolioRuns } from "@/lib/intelligence/portfolio";

export const runtime = "nodejs";
export const maxDuration = 300;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  return !!token && token === secret;
}

async function run() {
  const stats = { orgsScanned: 0, orgsSkipped: 0, runsSwept: 0, drifting: 0, errors: [] as string[] };

  stats.runsSwept = await sweepPortfolioRuns();

  const orgs = await prisma.org.findMany({
    where: { status: { in: ["ACTIVE", "SUSPENDED"] } },
    select: { id: true, slug: true, status: true },
  });

  for (const org of orgs) {
    try {
      // Suspended orgs keep their history but stop accruing points; entitlement
      // covers the lapsed-subscription case for active ones.
      if (org.status !== "ACTIVE" || !(await hasFeature(org.id, "portfolio-scan"))) {
        stats.orgsSkipped++;
        continue;
      }
      const [activeLoans, priorRuns] = await Promise.all([
        prisma.loan.count({ where: { orgId: org.id, status: "ACTIVE" } }),
        prisma.portfolioRun.count({ where: { orgId: org.id } }),
      ]);
      if (activeLoans === 0 && priorRuns === 0) {
        stats.orgsSkipped++;
        continue;
      }
      const result = await runWithOrg(org.id, () => runPortfolio(org.id, "cron"));
      stats.orgsScanned++;
      if (result.drift.status === "DRIFTING") stats.drifting++;
    } catch (err) {
      stats.errors.push(`${org.slug}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return stats;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 });
  try {
    // The sweep spans every lender's book, so it runs platform-scoped; each org's
    // run re-enters that org's own context.
    const stats = await runAsPlatform(run);
    return NextResponse.json({ success: true, ranAt: new Date().toISOString(), ...stats });
  } catch (err) {
    return NextResponse.json({ success: false, message: err instanceof Error ? err.message : "Portfolio run failed." }, { status: 500 });
  }
}

export const POST = GET;
