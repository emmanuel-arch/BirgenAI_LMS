// ─────────────────────────────────────────────────────────────────────────────
// Portfolio runs — the early-warning engine, on a clock.
//
// The live watchlist answers "who is at risk right now?". A PortfolioRun answers
// the questions a snapshot cannot: is the book getting better or worse, who is NEW
// to the watchlist since yesterday, whose band worsened — and is the model that
// scores all of it still calibrated (drift.ts rides along on every run).
//
// A run is a RECORDING, never a re-decision. It writes nothing to a loan, a
// balance or a borrower; it freezes what the engine said and when, under the
// policy that said it. The nightly cron makes one per entitled org; "Run now" on
// the console makes one on demand. Diffing two runs is how movement is computed,
// which is why each run keeps a compact copy of its watchlist rows.
// ─────────────────────────────────────────────────────────────────────────────
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { portfolioEarlyWarning, type RiskBand, type RiskRow } from "./earlywarning";
import { tuningFor, isDefault } from "./tuning";
import { modelDrift, type DriftReport } from "./drift";

/** The slice of a risk row a run keeps: enough to diff and to name who moved. */
export type CompactRow = {
  b: string; // borrowerId
  l: string; // loanId
  n: string; // name
  s: number; // riskScore
  band: RiskBand;
  dpd: number;
  bal: number;
};

export type Movement = {
  entered: CompactRow[];
  left: CompactRow[];
  escalated: CompactRow[];
  improved: CompactRow[];
};

export type RunResult = {
  runId: string;
  ranAt: string;
  policy: string;
  tiles: { olb: number; atRiskValue: number; watchlist: number; high: number; elevated: number; projectedLoss: number; activeLoans: number };
  movement: Movement;
  drift: DriftReport;
};

/** Keep a year-plus of nightly points; beyond that a run is archaeology, not a trend. */
const RETAIN_DAYS = 400;
/** A watchlist bigger than this is stored truncated (worst first) — the diff still names the movers that matter. */
const MAX_ROWS = 2000;

const BAND_RANK: Record<RiskBand, number> = { WATCH: 0, ELEVATED: 1, HIGH: 2 };

export function compactRows(rows: RiskRow[]): CompactRow[] {
  return rows.slice(0, MAX_ROWS).map((r) => ({
    b: r.borrowerId, l: r.loanId, n: r.name, s: r.riskScore, band: r.band, dpd: r.dpd, bal: Math.round(r.balance),
  }));
}

/**
 * Who moved between two runs, by borrower. "Entered" and "left" are membership;
 * "escalated" and "improved" are band changes for borrowers present in both.
 */
export function movementBetween(prev: CompactRow[] | null, curr: CompactRow[]): Movement {
  if (!prev) return { entered: curr, left: [], escalated: [], improved: [] };
  const before = new Map(prev.map((r) => [r.b, r]));
  const after = new Map(curr.map((r) => [r.b, r]));

  const entered = curr.filter((r) => !before.has(r.b));
  const left = prev.filter((r) => !after.has(r.b));
  const escalated: CompactRow[] = [];
  const improved: CompactRow[] = [];
  for (const r of curr) {
    const was = before.get(r.b);
    if (!was) continue;
    if (BAND_RANK[r.band] > BAND_RANK[was.band]) escalated.push(r);
    else if (BAND_RANK[r.band] < BAND_RANK[was.band]) improved.push(r);
  }
  return { entered, left, escalated, improved };
}

/** "default" or "custom v<n>" — every trend point states the policy that scored it. */
async function policyLabel(orgId: string): Promise<string> {
  const cfg = await tuningFor(orgId);
  if (isDefault(cfg)) return "default";
  const profile = await prisma.tuningProfile.findUnique({ where: { orgId }, select: { version: true } });
  return `custom v${profile?.version ?? 1}`;
}

/**
 * Score the org's book, diff it against the previous run, measure drift, and
 * freeze all of it as one PortfolioRun. Read-only against the loan book — the
 * only row created is the run itself.
 */
export async function runPortfolio(orgId: string, trigger: "cron" | "manual" | "seed"): Promise<RunResult> {
  const [ew, policy, drift, previous] = await Promise.all([
    portfolioEarlyWarning(orgId),
    policyLabel(orgId),
    modelDrift(orgId),
    prisma.portfolioRun.findFirst({ where: { orgId }, orderBy: { ranAt: "desc" }, select: { rows: true } }),
  ]);

  const rows = compactRows(ew.rows);
  const movement = movementBetween(previous ? (previous.rows as CompactRow[]) : null, rows);
  const elevated = ew.rows.filter((r) => r.band === "ELEVATED").length;
  const activeLoans = await prisma.loan.count({ where: { orgId, status: "ACTIVE" } });

  const run = await prisma.portfolioRun.create({
    data: {
      orgId,
      trigger,
      policy,
      activeLoans,
      olb: new Prisma.Decimal(Math.round(ew.tiles.olb * 100) / 100),
      atRiskValue: new Prisma.Decimal(Math.round(ew.tiles.atRiskValue * 100) / 100),
      projectedLoss: new Prisma.Decimal(Math.round(ew.tiles.projectedLoss * 100) / 100),
      watchlist: ew.rows.length,
      high: ew.tiles.high,
      elevated,
      entered: movement.entered.length,
      left: movement.left.length,
      escalated: movement.escalated.length,
      improved: movement.improved.length,
      rows: rows as unknown as Prisma.InputJsonValue,
      drift: drift as unknown as Prisma.InputJsonValue,
    },
    select: { id: true, ranAt: true },
  });

  return {
    runId: run.id,
    ranAt: run.ranAt.toISOString(),
    policy,
    tiles: {
      olb: ew.tiles.olb, atRiskValue: ew.tiles.atRiskValue, watchlist: ew.rows.length,
      high: ew.tiles.high, elevated, projectedLoss: ew.tiles.projectedLoss, activeLoans,
    },
    movement,
    drift,
  };
}

export type TrendPoint = {
  runId: string;
  ranAt: string;
  trigger: string;
  policy: string;
  activeLoans: number;
  olb: number;
  atRiskValue: number;
  atRiskPct: number;
  projectedLoss: number;
  watchlist: number;
  high: number;
  elevated: number;
  entered: number;
  left: number;
  escalated: number;
  improved: number;
};

/** The recent runs, oldest → newest, shaped for a trend line. */
export async function portfolioTrend(orgId: string, limit = 30): Promise<TrendPoint[]> {
  const runs = await prisma.portfolioRun.findMany({
    where: { orgId },
    orderBy: { ranAt: "desc" },
    take: limit,
    select: {
      id: true, ranAt: true, trigger: true, policy: true, activeLoans: true,
      olb: true, atRiskValue: true, projectedLoss: true,
      watchlist: true, high: true, elevated: true,
      entered: true, left: true, escalated: true, improved: true,
    },
  });

  return runs.reverse().map((r) => {
    const olb = Number(r.olb);
    const atRisk = Number(r.atRiskValue);
    return {
      runId: r.id, ranAt: r.ranAt.toISOString(), trigger: r.trigger, policy: r.policy,
      activeLoans: r.activeLoans, olb, atRiskValue: atRisk,
      atRiskPct: olb > 0 ? Math.round((atRisk / olb) * 1000) / 10 : 0,
      projectedLoss: Number(r.projectedLoss),
      watchlist: r.watchlist, high: r.high, elevated: r.elevated,
      entered: r.entered, left: r.left, escalated: r.escalated, improved: r.improved,
    };
  });
}

/** The most recent run in full (movement rows + drift), for the dashboard. */
export async function latestRun(orgId: string) {
  const run = await prisma.portfolioRun.findFirst({ where: { orgId }, orderBy: { ranAt: "desc" } });
  if (!run) return null;
  return {
    runId: run.id,
    ranAt: run.ranAt.toISOString(),
    trigger: run.trigger,
    policy: run.policy,
    rows: run.rows as CompactRow[],
    drift: (run.drift ?? null) as DriftReport | null,
    counts: { entered: run.entered, left: run.left, escalated: run.escalated, improved: run.improved },
  };
}

/** Platform-wide retention sweep — called by the nightly cron. */
export async function sweepPortfolioRuns(): Promise<number> {
  const res = await prisma.portfolioRun.deleteMany({
    where: { ranAt: { lt: new Date(Date.now() - RETAIN_DAYS * 86400000) } },
  });
  return res.count;
}
