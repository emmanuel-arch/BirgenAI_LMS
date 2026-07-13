// ─────────────────────────────────────────────────────────────────────────────
// CREDIT SCORING — the engines, the batch, and what to do about the number.
//
// Four panels, in the order a risk manager actually asks:
//   1. THE ENGINES  — every scorer the platform runs (thin-file, origination v2,
//      pooled v3, behavioral v1, fused, manual), each with its population, its
//      role, and how many scores it has actually produced on THIS book. The
//      fleet is visible, not folklore.
//   2. THE BATCH    — the whole active book scored (PortfolioRun), latest run
//      vs the run a week ago: at-risk %, projected loss, band migrations.
//      A run is a RECORDING, never a re-decision (item 18's rule holds).
//   3. THE PROJECTION — deterministic arithmetic, not prophecy: to be at X%
//      next week, cure THESE accounts, freshest arrears first (they are the
//      most recoverable — the collections queue sorts the same way).
//   4. THE PLAYBOOK — the top risk drivers across the live watchlist, each with
//      the concrete screen that fixes it. Reducing defaults is a set of actions,
//      not a dashboard.
// ─────────────────────────────────────────────────────────────────────────────
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasFeature } from "@/lib/billing/entitlements";
import { UpgradeCard } from "@/components/billing/UpgradeCard";
import { portfolioEarlyWarning } from "@/lib/intelligence/earlywarning";
import { portfolioTrend, latestRun, movementBetween, compactRows, type CompactRow } from "@/lib/intelligence/portfolio";
import { activeScorer } from "@/lib/statement/score-thinfile";
import { ScoringClient } from "./ScoringClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ScoringPage() {
  const session = await auth();
  if (!session?.user?.orgId) redirect("/login");
  const orgId = session.user.orgId;

  if (!(await hasFeature(orgId, "portfolio-scan"))) {
    return (
      <main className="mx-auto max-w-3xl px-4 sm:px-6 py-8">
        <UpgradeCard
          feature="portfolio-scan"
          title="Credit Scoring"
          blurb="Batch-score the whole active book, compare week over week, and get the exact accounts to cure to hit next week's target."
        />
      </main>
    );
  }

  const [ew, trend, latest, scorerCounts, activeLoans] = await Promise.all([
    portfolioEarlyWarning(orgId),
    portfolioTrend(orgId, 30),
    latestRun(orgId),
    prisma.scoreSnapshot.groupBy({
      by: ["modelKind"],
      where: { orgId },
      _count: true,
      _max: { createdAt: true },
    }),
    prisma.loan.count({ where: { orgId, status: "ACTIVE" } }),
  ]);

  // The comparison run: the newest one at least ~a week older than the latest.
  const latestAt = latest ? new Date(latest.ranAt).getTime() : Date.now();
  const weekAgoRun = await prisma.portfolioRun.findFirst({
    where: { orgId, ranAt: { lte: new Date(latestAt - 6.5 * 86_400_000) } },
    orderBy: { ranAt: "desc" },
    select: { ranAt: true, atRiskValue: true, projectedLoss: true, high: true, elevated: true, watchlist: true, olb: true, rows: true },
  });

  const currRows: CompactRow[] = latest ? ((latest.rows as unknown as CompactRow[]) ?? compactRows(ew.rows)) : compactRows(ew.rows);
  const prevRows: CompactRow[] | null = weekAgoRun ? ((weekAgoRun.rows as unknown as CompactRow[]) ?? null) : null;
  const moved = movementBetween(prevRows, currRows);
  const movement = { entered: moved.entered.length, left: moved.left.length, escalated: moved.escalated.length, improved: moved.improved.length };

  const scorerStats = new Map(scorerCounts.map((s) => [s.modelKind, { count: s._count, last: s._max.createdAt }]));
  const thin = activeScorer();

  return (
    <ScoringClient
      generatedAt={ew.generatedAt}
      olb={ew.tiles.olb}
      atRiskValue={ew.tiles.atRiskValue}
      atRiskPct={ew.tiles.olb > 0 ? (ew.tiles.atRiskValue / ew.tiles.olb) * 100 : 0}
      projectedLoss={ew.tiles.projectedLoss}
      bands={{ high: ew.rows.filter((r) => r.band === "HIGH").length, elevated: ew.rows.filter((r) => r.band === "ELEVATED").length, watch: ew.rows.filter((r) => r.band === "WATCH").length }}
      activeLoans={activeLoans}
      rows={ew.rows.map((r) => ({
        borrowerId: r.borrowerId, loanId: r.loanId, name: r.name, band: r.band,
        dpd: r.dpd, balance: r.balance, riskScore: r.riskScore, expectedLoss: r.expectedLoss,
        reasons: r.reasons,
      }))}
      trend={trend.map((t) => ({ ranAt: t.ranAt, atRiskPct: t.atRiskPct, projectedLoss: t.projectedLoss, high: t.high, watchlist: t.watchlist }))}
      weekAgo={weekAgoRun ? {
        ranAt: weekAgoRun.ranAt.toISOString(),
        atRiskPct: Number(weekAgoRun.olb) > 0 ? (Number(weekAgoRun.atRiskValue) / Number(weekAgoRun.olb)) * 100 : 0,
        projectedLoss: Number(weekAgoRun.projectedLoss),
        high: weekAgoRun.high,
        watchlist: weekAgoRun.watchlist,
      } : null}
      movement={movement}
      engines={[
        {
          key: "thin-file",
          name: thin.kind === "trained" ? `Thin-file (trained ${thin.version})` : "Thin-file scorecard",
          role: "New applicants with no history here — scored on M-Pesa cashflow alone.",
          population: "First-time applicants",
          live: true,
          note: thin.kind === "trained" ? `Fitted on ${thin.nObserved} observed outcomes` : `Expert scorecard — flips to the trained model at enough observed outcomes (${thin.nObserved} so far)`,
          count: scorerStats.get("thin-file")?.count ?? 0,
        },
        {
          key: "origination-v2",
          name: "Origination v2.1 (bespoke)",
          role: "Micromart's bespoke model — skew-free, trained on their own book.",
          population: "Bridged: Micromart",
          live: true,
          note: "AUC 0.822",
          count: scorerStats.get("origination-v2")?.count ?? 0,
        },
        {
          key: "pooled-v3",
          name: "Pooled v3.1.1",
          role: "Cross-lender pooled model — rollover-aware; every other returning borrower.",
          population: "Returning borrowers",
          live: true,
          note: "AUC 0.823",
          count: scorerStats.get("pooled-v3")?.count ?? 0,
        },
        {
          key: "behavioral-v1",
          name: "Behavioral v1 (in-life)",
          role: "Watches ACTIVE loans for early trouble — feeds the early-warning engine.",
          population: "Active loans",
          live: true,
          note: "Monitoring tier",
          count: scorerStats.get("behavioral-v1")?.count ?? 0,
        },
        {
          key: "fused",
          name: "Fusion (60/40)",
          role: "Statement score fused with repayment history when both exist.",
          population: "Returning + statement",
          live: true,
          note: "60% history · 40% statement",
          count: scorerStats.get("fused")?.count ?? 0,
        },
        {
          key: "MANUAL",
          name: "Officer override",
          role: "Hand-set scores from Customer-360 — always marked MANUAL, never mistaken for a model.",
          population: "Exceptions only",
          live: true,
          note: "Audited, note-mandatory",
          count: scorerStats.get("MANUAL")?.count ?? 0,
        },
      ]}
    />
  );
}
