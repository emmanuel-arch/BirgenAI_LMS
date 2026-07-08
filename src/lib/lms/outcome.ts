// ─────────────────────────────────────────────────────────────────────────────
// Outcome backfill — closing the ML loop.
//
// Every BirgenAI scoring decision stores its input features (X). The label (y) —
// did the loan get REPAID or DEFAULT — only becomes known months later, inside
// the lender's ServiceSuite loan book. This job joins our records back to the
// borrower's actual loans and writes the realised outcome onto:
//   • lms_applications        (thin-file / M-Pesa decisions)
//   • borrower_score_snapshots (behavioural / repeat-borrower decisions)
//
// It runs in two passes per lender:
//   1. LINK   — for records with no serviceSuiteLoanId yet, find the loan the
//               score was computed for (earliest approved loan on/after the
//               capture time for that borrower), and attach its id.
//   2. RESOLVE — for linked records still PENDING, read the loan's status and
//               set outcome = REPAID | DEFAULTED (and daysToDefault / observedAt).
//
// Outcome definitions (mirroring the Semantic Metric Layer's NPL rule):
//   • REPAID    : Loans.loancleared = 1
//   • DEFAULTED : approved, uncleared, and > 90 days past ExpectedClearDate (NPL)
//   • PENDING   : still active / not yet matured (left for a later run)
//
// Everything here is READ-ONLY against ServiceSuite (runReadOnlyQuery). The only
// writes are to BirgenAI's own Postgres via Prisma. Idempotent: re-running only
// touches records still PENDING / unlinked.
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { runReadOnlyQuery, mssql } from "@/lib/enterprise/mssql";
import { ORGS, getOrg, getEntityId, isOrgConfigured, type OrgDef } from "@/lib/enterprise/connections";

/** Days past ExpectedClearDate at which an open loan is labelled a default (NPL boundary). */
const DEFAULT_DPD = 90;
/** Grace window (ms) subtracted from capture time when linking — covers clock skew between scoring and disbursement. */
const LINK_GRACE_MS = 2 * 24 * 60 * 60 * 1000;

type LoanOutcome = "REPAID" | "DEFAULTED" | "PENDING";

type LoanStatus = {
  loanId: string;
  outcome: LoanOutcome;
  /** Day index from BorrowDate at which it crossed the default boundary (only when DEFAULTED). */
  daysToDefault: number | null;
};

export type BackfillStats = {
  lender: string;
  entityId: number;
  configured: boolean;
  linkedApplications: number;
  linkedSnapshots: number;
  resolvedApplications: number;
  resolvedSnapshots: number;
  repaid: number;
  defaulted: number;
  errors: string[];
};

export type BackfillResult = {
  ranAt: string;
  lenders: BackfillStats[];
  totals: { resolved: number; repaid: number; defaulted: number; linked: number };
};

// Shared SELECT fragment that derives the outcome label from a Loans row.
const STATUS_COLUMNS = `
  L.ID AS loanId,
  CASE
    WHEN L.loancleared = 1 THEN 'REPAID'
    WHEN L.isApproved = 1 AND L.loancleared = 0
         AND DATEDIFF(DAY, L.ExpectedClearDate, GETDATE()) > ${DEFAULT_DPD} THEN 'DEFAULTED'
    ELSE 'PENDING'
  END AS outcome,
  DATEDIFF(DAY, L.BorrowDate, L.ExpectedClearDate) + ${DEFAULT_DPD} AS daysToDefault`;

function rowToStatus(r: Record<string, unknown>): LoanStatus {
  const outcome = String(r.outcome) as LoanOutcome;
  const d = Number(r.daysToDefault);
  return {
    loanId: String(r.loanId),
    outcome,
    daysToDefault: outcome === "DEFAULTED" && Number.isFinite(d) ? d : null,
  };
}

/** Resolve the current status of a set of known ServiceSuite loan ids (one query). */
async function resolveByLoanIds(org: OrgDef, entityId: number, loanIds: string[]): Promise<Map<string, LoanStatus>> {
  const ids = [...new Set(loanIds)].map((s) => Number(s)).filter((n) => Number.isInteger(n) && n > 0);
  const out = new Map<string, LoanStatus>();
  if (ids.length === 0) return out;

  // ids are integers validated above, safe to inline; entityId is parameterised.
  const sql = `
    SELECT ${STATUS_COLUMNS}
    FROM Loans L
    WHERE L.EntityId = @eid AND L.ID IN (${ids.join(",")})`;
  const { rows } = await runReadOnlyQuery(org, sql, [{ name: "eid", type: mssql.Int, value: entityId }], {
    timeoutMs: 30000,
    maxRows: ids.length,
  });
  for (const r of rows) {
    const s = rowToStatus(r);
    out.set(s.loanId, s);
  }
  return out;
}

/** Find the loan a score was computed for: earliest approved loan for the borrower on/after the capture time. */
async function findLoanForBorrower(
  org: OrgDef,
  entityId: number,
  borrowerId: number,
  capturedAt: Date,
): Promise<LoanStatus | null> {
  const since = new Date(capturedAt.getTime() - LINK_GRACE_MS);
  const sql = `
    SELECT TOP 1 ${STATUS_COLUMNS}
    FROM Loans L
    WHERE L.EntityId = @eid AND L.BorrowerId = @bid
      AND L.isApproved = 1 AND L.BorrowDate >= @since
    ORDER BY L.BorrowDate ASC`;
  const { rows } = await runReadOnlyQuery(
    org,
    sql,
    [
      { name: "eid", type: mssql.Int, value: entityId },
      { name: "bid", type: mssql.Int, value: borrowerId },
      { name: "since", type: mssql.DateTime, value: since },
    ],
    { timeoutMs: 20000, maxRows: 1 },
  );
  return rows.length ? rowToStatus(rows[0]) : null;
}

async function backfillLender(org: OrgDef): Promise<BackfillStats> {
  const entityId = getEntityId(org);
  const stats: BackfillStats = {
    lender: org.slug,
    entityId,
    configured: true,
    linkedApplications: 0,
    linkedSnapshots: 0,
    resolvedApplications: 0,
    resolvedSnapshots: 0,
    repaid: 0,
    defaulted: 0,
    errors: [],
  };

  const tally = (s: LoanStatus) => {
    if (s.outcome === "REPAID") stats.repaid++;
    else if (s.outcome === "DEFAULTED") stats.defaulted++;
  };

  // Resolve the tenant row — all LMS records are keyed by orgId.
  const orgRow = await prisma.org.findUnique({ where: { slug: org.slug }, select: { id: true } });
  if (!orgRow) {
    stats.errors.push(`${org.name} has no Org row in the LMS DB (run prisma db seed).`);
    return stats;
  }

  // ── Applications ────────────────────────────────────────────────────────────
  // 1a. LINK: graduated apps with a matched borrower but no loan id yet.
  try {
    const unlinkedApps = await prisma.loanApplication.findMany({
      where: { orgId: orgRow.id, outcome: "PENDING", serviceSuiteLoanId: null, serviceSuiteBorrowerId: { not: null } },
      select: { id: true, serviceSuiteBorrowerId: true, createdAt: true },
      take: 500,
    });
    for (const a of unlinkedApps) {
      const found = await findLoanForBorrower(org, entityId, a.serviceSuiteBorrowerId!, a.createdAt);
      if (!found) continue;
      await prisma.loanApplication.update({
        where: { id: a.id },
        data: {
          serviceSuiteLoanId: found.loanId,
          ...(found.outcome !== "PENDING"
            ? { outcome: found.outcome, outcomeObservedAt: new Date(), daysToDefault: found.daysToDefault }
            : {}),
        },
      });
      stats.linkedApplications++;
      if (found.outcome !== "PENDING") {
        stats.resolvedApplications++;
        tally(found);
      }
    }
  } catch (err) {
    stats.errors.push(`apps.link: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 1b. RESOLVE: linked apps still PENDING.
  try {
    const linkedApps = await prisma.loanApplication.findMany({
      where: { orgId: orgRow.id, outcome: "PENDING", serviceSuiteLoanId: { not: null } },
      select: { id: true, serviceSuiteLoanId: true },
      take: 1000,
    });
    if (linkedApps.length) {
      const statuses = await resolveByLoanIds(org, entityId, linkedApps.map((a) => a.serviceSuiteLoanId!));
      for (const a of linkedApps) {
        const s = statuses.get(String(a.serviceSuiteLoanId));
        if (!s || s.outcome === "PENDING") continue;
        await prisma.loanApplication.update({
          where: { id: a.id },
          data: { outcome: s.outcome, outcomeObservedAt: new Date(), daysToDefault: s.daysToDefault },
        });
        stats.resolvedApplications++;
        tally(s);
      }
    }
  } catch (err) {
    stats.errors.push(`apps.resolve: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── Behavioural snapshots ─────────────────────────────────────────────────────
  // 2a. LINK: snapshots with no loan id yet (the loan was booked via ServiceSuite's own flow).
  try {
    const unlinkedSnaps = await prisma.scoreSnapshot.findMany({
      where: { orgId: orgRow.id, outcome: "PENDING", serviceSuiteLoanId: null, serviceSuiteBorrowerId: { not: null } },
      select: { id: true, serviceSuiteBorrowerId: true, createdAt: true },
      take: 500,
    });
    for (const snap of unlinkedSnaps) {
      const found = await findLoanForBorrower(org, entityId, snap.serviceSuiteBorrowerId!, snap.createdAt);
      if (!found) continue;
      await prisma.scoreSnapshot.update({
        where: { id: snap.id },
        data: {
          serviceSuiteLoanId: found.loanId,
          ...(found.outcome !== "PENDING" ? { outcome: found.outcome, outcomeObservedAt: new Date() } : {}),
        },
      });
      stats.linkedSnapshots++;
      if (found.outcome !== "PENDING") {
        stats.resolvedSnapshots++;
        tally(found);
      }
    }
  } catch (err) {
    stats.errors.push(`snaps.link: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 2b. RESOLVE: linked snapshots still PENDING.
  try {
    const linkedSnaps = await prisma.scoreSnapshot.findMany({
      where: { orgId: orgRow.id, outcome: "PENDING", serviceSuiteLoanId: { not: null } },
      select: { id: true, serviceSuiteLoanId: true },
      take: 1000,
    });
    if (linkedSnaps.length) {
      const statuses = await resolveByLoanIds(org, entityId, linkedSnaps.map((s) => s.serviceSuiteLoanId!));
      for (const snap of linkedSnaps) {
        const s = statuses.get(String(snap.serviceSuiteLoanId));
        if (!s || s.outcome === "PENDING") continue;
        await prisma.scoreSnapshot.update({
          where: { id: snap.id },
          data: { outcome: s.outcome, outcomeObservedAt: new Date() },
        });
        stats.resolvedSnapshots++;
        tally(s);
      }
    }
  } catch (err) {
    stats.errors.push(`snaps.resolve: ${err instanceof Error ? err.message : String(err)}`);
  }

  return stats;
}

/**
 * Backfill loan outcomes for one lender or all configured lenders.
 * @param opts.lenderSlug  restrict to a single org slug (default: every configured, non-admin org)
 */
export async function backfillOutcomes(opts: { lenderSlug?: string } = {}): Promise<BackfillResult> {
  const targets: OrgDef[] = opts.lenderSlug
    ? [getOrg(opts.lenderSlug)].filter((o): o is OrgDef => !!o)
    : Object.values(ORGS).filter((o) => !o.isAdmin);

  const lenders: BackfillStats[] = [];
  for (const org of targets) {
    if (!isOrgConfigured(org)) {
      lenders.push({
        lender: org.slug,
        entityId: getEntityId(org),
        configured: false,
        linkedApplications: 0,
        linkedSnapshots: 0,
        resolvedApplications: 0,
        resolvedSnapshots: 0,
        repaid: 0,
        defaulted: 0,
        errors: [`${org.name} is not connected (${org.connEnv} unset).`],
      });
      continue;
    }
    lenders.push(await backfillLender(org));
  }

  const totals = lenders.reduce(
    (acc, s) => ({
      resolved: acc.resolved + s.resolvedApplications + s.resolvedSnapshots,
      repaid: acc.repaid + s.repaid,
      defaulted: acc.defaulted + s.defaulted,
      linked: acc.linked + s.linkedApplications + s.linkedSnapshots,
    }),
    { resolved: 0, repaid: 0, defaulted: 0, linked: 0 },
  );

  return { ranAt: new Date().toISOString(), lenders, totals };
}
