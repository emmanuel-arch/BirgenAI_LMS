// ─────────────────────────────────────────────────────────────────────────────
// THE LIVE QUERY ENGINE — the studio, answered by ServiceSuite.
//
// engine.ts is the Postgres implementation of six functions. This is the same
// six against a bridged lender's real SQL Server, reached through the SQL relay
// when the deployment cannot open a socket itself (lib/enterprise/relay.ts).
// Same names, same return shapes, so no page and no chart knows which one ran.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
// Micromart's Postgres row holds 199 loans. Their real book, probed on
// 29 Aug 2026, holds 275,605 loans and KES 350.5M outstanding across EntityId
// 3002, plus 61,536 more on 3005. Fourteen of fifteen studio surfaces were
// asking Postgres, so the board view opened with "There is no open book in this
// cut." Nothing was broken; the wrong database was being asked.
//
// ── EVERY QUERY GROUPS BY ENTITY WHEN SPLIT ──────────────────────────────────
// A cut can hold more than one book. Combined sums them; split breaks every
// measure out per entity so two books can be read side by side. Split is not a
// second query and is not slower — it is `GROUP BY l.EntityId` added to the one
// that was already running. Measured through the relay over twelve months of
// Micromart's book: 149ms single, 152ms split.
//
// ── TIME BUCKETS ARE ROLLED UP IN JS, DELIBERATELY ───────────────────────────
// SQL groups by DAY and nothing coarser. Week/month/quarter come from
// bucketKey() in ranges.ts — the SAME function that builds the axis. Truncating
// in T-SQL instead would mean two independent implementations of "which week is
// this", one in SQL Server's locale and one in Node's, and the day they disagree
// the chart silently drops a column. A long range is at most ~2,000 day rows.
//
// ── INJECTION ────────────────────────────────────────────────────────────────
// Same posture as engine.ts, by the same two mechanisms. VALUES are bound
// parameters, always. IDENTIFIERS and the GROUP BY expression are never taken
// from the caller — a DimensionKey is looked up in a closed table in this file.
// Entity ids are the one thing interpolated, and only after Number.isInteger, so
// a non-integer cannot reach the query text at all.
// ─────────────────────────────────────────────────────────────────────────────
import { cbQuery, SC, CB, P, num, str, dt } from "@/lib/collectbox/client";
import type { QueryParam } from "@/lib/enterprise/mssql";
import { AGE_BANDS, LOAN_SIZE_BANDS, TENURE_BANDS, type DimensionKey } from "./cube";
import { bucketKey, bucketAxis } from "./ranges";
import type { LiveScope } from "./scope";
import type { CubeRow, CubeMeasures, Headline, StudioFilters, TimePoint, TimeRow, CohortRow } from "./engine";

// ── What this particular deployment can answer ───────────────────────────────
//
// ServiceSuite is not one schema. Micromart's box and Axe's box run the same
// product and differ in ways that decide whether a query is valid at all —
// found by running the studio against both rather than by reading either:
//
//   Micromart  DateCleared ✓   CollectBox ✓   ChannelUsed ✓
//   Axe        DateCleared ✗   CollectBox ✗   ChannelUsed ✓
//
// So capability is DETECTED, once per process per connection, and cached. The
// alternative — a hardcoded table of which lender has which column — would be
// correct today and wrong the first time somebody upgrades one deployment.

type Caps = {
  /** Loans.DateCleared — without it, "cleared in this period" needs another date. */
  hasDateCleared: boolean;
  /** The CollectBox database: the collections floor and PayedAmount. */
  hasCollectBox: boolean;
  /** Loans.ChannelUsed — origination channel. */
  hasChannelUsed: boolean;
};

const CAPS_CACHE = new Map<string, Promise<Caps>>();

function capsFor(org: { slug: string } & Parameters<typeof cbQuery>[0]): Promise<Caps> {
  const hit = CAPS_CACHE.get(org.slug);
  if (hit) return hit;
  const p = cbQuery<Record<string, unknown>>(
    org,
    `SELECT CASE WHEN COL_LENGTH('Serviceconnect.dbo.Loans','DateCleared') IS NULL THEN 0 ELSE 1 END AS a,
            CASE WHEN DB_ID('CollectBox') IS NULL THEN 0 ELSE 1 END AS b,
            CASE WHEN COL_LENGTH('Serviceconnect.dbo.Loans','ChannelUsed') IS NULL THEN 0 ELSE 1 END AS c`,
    [], { timeoutMs: 20000, maxRows: 1 },
  ).then((rows) => ({
    hasDateCleared: num(rows[0]?.a) === 1,
    hasCollectBox: num(rows[0]?.b) === 1,
    hasChannelUsed: num(rows[0]?.c) === 1,
  })).catch(() => ({ hasDateCleared: false, hasCollectBox: false, hasChannelUsed: false }));
  CAPS_CACHE.set(org.slug, p);
  return p;
}

// ── Small helpers ────────────────────────────────────────────────────────────

/** Money, the way this server returns it. */
const MONEY = (col: string) => `CAST(COALESCE(${col},0) AS decimal(18,2))`;

/** A unicode string literal. Band labels carry ≤ and –; varchar would eat them. */
const S = (v: string) => `N'${v.replace(/'/g, "''")}'`;

/**
 * "Cleared inside this window", on a book that may not record when it cleared.
 *
 * With DateCleared it is exact. Without it (Axe), the closest honest question is
 * "was it DUE in this window, and is it now settled" — a different measure with
 * the same intent, and named here rather than silently returning zero, because a
 * zero would read as "nothing was repaid".
 */
const clearedInRange = (caps: Caps) =>
  caps.hasDateCleared
    ? `l.LoanCleared = 1 AND l.DateCleared >= @from AND l.DateCleared < @to`
    : `l.LoanCleared = 1 AND l.ExpectedClearDate >= @from AND l.ExpectedClearDate < @to`;

/**
 * Entity ids, safe to interpolate.
 *
 * The ONE place a value reaches the query text rather than a bind parameter,
 * because `IN (@a, @b)` cannot be built from a variable-length list without
 * generating names anyway — and these are integers from a closed allowlist, not
 * user input. The assertion is what makes that claim true rather than assumed.
 */
function entityList(ids: number[]): string {
  const clean = ids.filter((n) => Number.isInteger(n));
  if (!clean.length) throw new Error("live analytics: no entity in scope");
  return clean.join(",");
}

/** `col IN (@p0, @p1, …)` from a list of ids, with the parameters to match. */
function inClause(col: string, prefix: string, values: string[], params: QueryParam[]): string {
  const nums = values.map((v) => Number(v)).filter((n) => Number.isInteger(n));
  if (!nums.length) return "";
  const names = nums.map((v, i) => {
    const nm = `${prefix}${i}`;
    params.push(P.int(nm, v));
    return `@${nm}`;
  });
  return ` AND ${col} IN (${names.join(",")})`;
}

/**
 * Days in arrears, across books that measure it differently.
 *
 * CollectBox.CollectionTracker covers EntityId 3002 and nothing else — 95,799
 * tracked loans, all of them 3002, verified live. So a cut spanning both books
 * needs one expression that uses the tracker where it exists and the loan's own
 * dates where it does not. See scope.ts for why the two are not interchangeable.
 */
function dpdExpr(scope: LiveScope): string {
  const tracked = scope.lenses.filter((l) => l.basis === "tracker").map((l) => l.id);
  const derived = `CASE WHEN l.LoanCleared = 0 AND ${MONEY("l.LoanBalance")} > 0 AND l.ExpectedClearDate IS NOT NULL
                        THEN DATEDIFF(day, l.ExpectedClearDate, GETDATE()) ELSE 0 END`;
  if (!tracked.length) return derived;
  return `CASE WHEN l.EntityId IN (${entityList(tracked)}) THEN COALESCE(ct.DaysInArears, 0) ELSE ${derived} END`;
}

/**
 * Money in — from whichever ledger this deployment actually records it in.
 *
 * Micromart has CollectBox, and PayedAmount is the figure their collections
 * floor already reports against, so the studio must agree with the floor rather
 * than invent a second truth. Axe has no CollectBox at all; both deployments
 * carry Serviceconnect.RepaymentTransactions with an identical shape, so that is
 * the fallback.
 *
 * The two are never mixed inside one chart: a cut spans one connection, and a
 * connection has one of these, not both.
 */
function paidSource(caps: Caps) {
  return caps.hasCollectBox
    ? { from: `${CB}.PayedAmount pa`, amount: "pa.AmountPaid", at: "pa.DatePaid", loanId: "pa.LoanId" }
    : { from: `${SC}.RepaymentTransactions pa`, amount: "pa.Amount", at: "pa.Datetransacted", loanId: "pa.loanid" };
}

/** The tracker join is only paid for when some book in the cut actually uses it. */
function trackerJoin(scope: LiveScope): string {
  return scope.lenses.some((l) => l.basis === "tracker")
    ? `LEFT JOIN ${CB}.CollectionTracker ct ON ct.LoanId = l.id`
    : "";
}

// ─────────────────────────────────────────────────────────────────────────────
// DIMENSION → SQL. A closed table, exactly like engine.ts's. Nothing here is
// caller-supplied: the caller passes a DimensionKey and an unknown key throws.
// ─────────────────────────────────────────────────────────────────────────────

const FROM = `
  FROM ${SC}.Loans l
  JOIN ${SC}.Borrowers b            ON b.ID = l.BorrowerId
  LEFT JOIN ${SC}.Products p        ON p.ID = l.ProductId
  LEFT JOIN ${SC}.OrganizationUnits ou  ON ou.UnitId = b.EntityUnit
  LEFT JOIN ${SC}.OrganizationUnits reg ON reg.UnitId = ou.ParentUnit
  LEFT JOIN ${SC}.UserMaster s      ON s.ID = b.EntityAgent`;

/** A CASE that buckets a numeric expression, preserving the declared order. */
function bandCase(expr: string, bands: Array<[string, number, number]>): string {
  const whens = bands
    .map(([label, lo, hi]) => `WHEN ${expr} >= ${lo} AND ${expr} <= ${Math.min(hi, 2_147_483_647)} THEN ${S(label)}`)
    .join(" ");
  return `CASE ${whens} ELSE ${S("Unknown")} END`;
}

type DimSql = { key: string; label: string };

function dimSql(dim: DimensionKey, lensNames: Map<number, string>, caps: Caps): DimSql {
  switch (dim) {
    case "entity": {
      // The label comes from the lens, not the database — ServiceSuite has no
      // table naming EntityIds (probed: Companies holds client companies, not
      // entities), so the studio's own registry is the only source of a name.
      const whens = [...lensNames.entries()].map(([id, name]) => `WHEN ${id} THEN ${S(name)}`).join(" ");
      return { key: "CAST(l.EntityId AS varchar(16))", label: `CASE l.EntityId ${whens} ELSE CAST(l.EntityId AS nvarchar(16)) END` };
    }
    case "region":
      // Micromart's unit tree is three deep: Head Office → region → branch. A
      // borrower hangs off a BRANCH, so the region is its parent — except for
      // the handful attached directly to a region, where it is the unit itself.
      return { key: "COALESCE(reg.UnitTitle, ou.UnitTitle, 'Unassigned')", label: "COALESCE(reg.UnitTitle, ou.UnitTitle, 'Unassigned')" };
    case "branch":
      return { key: "COALESCE(ou.UnitTitle, 'Unassigned')", label: "COALESCE(ou.UnitTitle, 'Unassigned')" };
    case "officer":
      return {
        key: "COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(s.FirstName, ' ', COALESCE(s.OtherName, '')))), ''), 'Unassigned')",
        label: "COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(s.FirstName, ' ', COALESCE(s.OtherName, '')))), ''), 'Unassigned')",
      };
    case "product":
      return { key: "COALESCE(p.ProductName, 'Unknown')", label: "COALESCE(p.ProductName, 'Unknown')" };
    case "riskBand":
      return { key: "COALESCE(NULLIF(LTRIM(RTRIM(b.RiskCategory)), ''), 'Unscored')", label: "COALESCE(NULLIF(LTRIM(RTRIM(b.RiskCategory)), ''), 'Unscored')" };
    case "gender": {
      const e = "CASE b.Gender WHEN 1 THEN 'Male' WHEN 2 THEN 'Female' ELSE 'Not stated' END";
      return { key: e, label: e };
    }
    case "kycStatus": {
      const e = "CASE WHEN b.KycVerification = 1 THEN 'Verified' WHEN b.KycVerification = 0 THEN 'Not verified' ELSE 'Not recorded' END";
      return { key: e, label: e };
    }
    case "status": {
      const e = `CASE WHEN l.LoanCleared = 1 THEN 'Cleared' WHEN ${MONEY("l.LoanBalance")} > 0 THEN 'Active' ELSE 'Closed' END`;
      return { key: e, label: e };
    }
    case "ageBand": {
      const e = bandCase("DATEDIFF(year, b.DOB, GETDATE())", AGE_BANDS);
      return { key: e, label: e };
    }
    case "loanSizeBand": {
      const e = bandCase(MONEY("l.LoanAmount"), LOAN_SIZE_BANDS);
      return { key: e, label: e };
    }
    case "tenureBand": {
      const e = bandCase("DATEDIFF(day, l.BorrowDate, l.ExpectedClearDate)", TENURE_BANDS);
      return { key: e, label: e };
    }
    case "channel": {
      // Loans.ChannelUsed is a small integer enum and this deployment ships no
      // lookup table for it. Live values: Micromart 1 / 3 / 0 / 7 with 164,603
      // nulls; Axe 1 / 2 with 40,630 nulls.
      //
      // The codes are rendered AS CODES. Naming them "USSD" and "Branch" would
      // be a guess dressed as a fact, and this is a chart a general manager
      // would act on. A reader who knows the mapping can read "Channel 3"; a
      // reader who does not is not misled.
      if (!caps.hasChannelUsed) {
        const e = `CASE WHEN l.id IS NULL THEN ${S("Not recorded")} ELSE ${S("Not recorded")} END`;
        return { key: e, label: e };
      }
      const e = `CASE WHEN l.ChannelUsed IS NULL THEN ${S("Not recorded")} ELSE CONCAT(${S("Channel ")}, CAST(l.ChannelUsed AS nvarchar(8))) END`;
      return { key: e, label: e };
    }
    case "time":
      throw new Error("live analytics: 'time' is served by timeSeries(), not cube()");
    default: {
      const never: never = dim;
      throw new Error(`live analytics: unknown dimension ${String(never)}`);
    }
  }
}

// ── The shared WHERE ─────────────────────────────────────────────────────────

function whereFor(scope: LiveScope, f: StudioFilters, params: QueryParam[]): string {
  let w = ` WHERE l.EntityId IN (${entityList(scope.lenses.map((l) => l.id))})`;
  w += inClause("b.EntityUnit", "br", f.branchIds, params);
  w += inClause("b.EntityAgent", "of", f.officerIds, params);
  w += inClause("l.ProductId", "pr", f.productIds, params);
  if (f.riskBands.length) {
    const names = f.riskBands.slice(0, 12).map((v, i) => {
      const nm = `rb${i}`;
      params.push(P.str(nm, v, 64));
      return `@${nm}`;
    });
    w += ` AND COALESCE(NULLIF(LTRIM(RTRIM(b.RiskCategory)), ''), 'Unscored') IN (${names.join(",")})`;
  }
  return w;
}

const EMPTY_MEASURES = (): CubeMeasures => ({
  newLoans: 0, activeLoans: 0, clearedLoans: 0, loans: 0,
  disbursed: 0, olb: 0, avgLoanSize: 0, avgTenureDays: 0,
  par30: 0, par30Amount: 0, par90Amount: 0, overdue: 0, borrowers: 0,
});

/** Rows out of SQL → measures, with PAR recomputed from this row's own numbers. */
function toMeasures(r: Record<string, unknown>): CubeMeasures {
  const olb = num(r.olb);
  const par30Amount = num(r.par30Amount);
  return {
    newLoans: num(r.newLoans),
    activeLoans: num(r.activeLoans),
    clearedLoans: num(r.clearedLoans),
    loans: num(r.loans),
    disbursed: num(r.disbursed),
    olb,
    avgLoanSize: num(r.avgLoanSize),
    avgTenureDays: num(r.avgTenureDays),
    par30Amount,
    par90Amount: num(r.par90Amount),
    overdue: num(r.overdue),
    borrowers: num(r.borrowers),
    // A ratio, computed from this row's own two numbers. Summing ratios across
    // rows is meaningless, so no caller is ever handed one to sum.
    par30: olb > 0 ? (par30Amount / olb) * 100 : 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CUBE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every measure, grouped by one dimension, in one query — and by entity too
 * when the cut is split.
 *
 * THE FLOW / STOCK SPLIT is preserved exactly as the Postgres engine defines it:
 * `newLoans` and `disbursed` are flows and are filtered to the range; `olb` and
 * `activeLoans` are stocks and are NOT, because the outstanding balance of a
 * book is what is open today regardless of when each loan was written.
 */
export async function liveCube(scope: LiveScope, dim: DimensionKey, f: StudioFilters): Promise<CubeRow[]> {
  const caps = await capsFor(scope.org);
  const lensNames = new Map(scope.lenses.map((l) => [l.id, l.name]));
  const d = dimSql(dim, lensNames, caps);
  const params: QueryParam[] = [P.date("from", f.range.from), P.date("to", f.range.to)];
  const where = whereFor(scope, f, params);
  const dpd = dpdExpr(scope);
  const bal = MONEY("l.LoanBalance");
  const amt = MONEY("l.LoanAmount");
  const inRange = `l.BorrowDate >= @from AND l.BorrowDate < @to`;
  const entityCol = scope.split ? "l.EntityId" : "0";

  const rows = await cbQuery<Record<string, unknown>>(
    scope.org,
    `SELECT ${d.key} AS [key], MIN(${d.label}) AS [label], ${entityCol} AS entityId,
            SUM(CASE WHEN ${inRange} THEN 1 ELSE 0 END)                          AS newLoans,
            SUM(CASE WHEN l.LoanCleared = 0 AND ${bal} > 0 THEN 1 ELSE 0 END)    AS activeLoans,
            SUM(CASE WHEN ${clearedInRange(caps)} THEN 1 ELSE 0 END) AS clearedLoans,
            COUNT(*)                                                             AS loans,
            SUM(CASE WHEN ${inRange} THEN ${amt} ELSE 0 END)                     AS disbursed,
            SUM(CASE WHEN l.LoanCleared = 0 THEN ${bal} ELSE 0 END)              AS olb,
            AVG(CASE WHEN ${inRange} THEN ${amt} END)                            AS avgLoanSize,
            AVG(CASE WHEN ${inRange} THEN CAST(DATEDIFF(day, l.BorrowDate, l.ExpectedClearDate) AS float) END) AS avgTenureDays,
            SUM(CASE WHEN ${dpd} > 30 THEN ${bal} ELSE 0 END)                    AS par30Amount,
            SUM(CASE WHEN ${dpd} > 90 THEN ${bal} ELSE 0 END)                    AS par90Amount,
            SUM(CASE WHEN ${dpd} > 0  THEN 1 ELSE 0 END)                         AS overdue,
            COUNT(DISTINCT l.BorrowerId)                                         AS borrowers
       ${FROM}
       ${trackerJoin(scope)}
       ${where}
      GROUP BY ${d.key}${scope.split ? ", l.EntityId" : ""}
      ORDER BY 1`,
    params,
    { timeoutMs: 60000, maxRows: 4000 },
  );

  // Fold the per-entity rows back into one row per dimension value, carrying the
  // breakdown so a chart can draw the two books beside each other.
  const out = new Map<string, CubeRow>();
  for (const r of rows) {
    const key = str(r.key) || "Unknown";
    const m = toMeasures(r);
    let row = out.get(key);
    if (!row) {
      row = { key, label: str(r.label) || key, ...EMPTY_MEASURES(), ...(scope.split ? { by: [] } : {}) };
      out.set(key, row);
    }
    // Sum the totals; ratios are recomputed from the summed amounts afterwards.
    for (const k of ["newLoans", "activeLoans", "clearedLoans", "loans", "disbursed", "olb", "par30Amount", "par90Amount", "overdue", "borrowers"] as const) {
      row[k] += m[k];
    }
    // Averages weight by the row's own loan count rather than being averaged
    // again — an unweighted mean of two books' averages is not either book's.
    row.avgLoanSize = row.newLoans > 0 ? (row.avgLoanSize * (row.newLoans - m.newLoans) + m.avgLoanSize * m.newLoans) / row.newLoans : m.avgLoanSize;
    row.avgTenureDays = row.newLoans > 0 ? (row.avgTenureDays * (row.newLoans - m.newLoans) + m.avgTenureDays * m.newLoans) / row.newLoans : m.avgTenureDays;
    if (scope.split) row.by!.push({ entityId: num(r.entityId), ...m });
  }
  for (const row of out.values()) row.par30 = row.olb > 0 ? (row.par30Amount / row.olb) * 100 : 0;
  return [...out.values()];
}

// ─────────────────────────────────────────────────────────────────────────────
// TIME SERIES
// ─────────────────────────────────────────────────────────────────────────────

const EMPTY_POINT = (label: string): TimePoint => ({
  label, disbursed: 0, collected: 0, newLoans: 0, applications: 0, clearedLoans: 0,
});

/**
 * A series over the range, WITH EMPTY BUCKETS INCLUDED.
 *
 * The axis is built from the range and the aggregate is joined onto it in
 * memory, so a week with no disbursement is drawn as a zero rather than
 * vanishing and letting the line join straight across the gap.
 *
 * `applications` is always zero on the live path and that is not an oversight:
 * this ServiceSuite deployment has no LoanApplications table, so there is no
 * application to count. A funnel drawn from a fabricated number would be worse
 * than a funnel that says nothing.
 */
export async function liveTimeSeries(scope: LiveScope, f: StudioFilters): Promise<TimeRow[]> {
  const caps = await capsFor(scope.org);
  const paid$ = paidSource(caps);
  const params: QueryParam[] = [P.date("from", f.range.from), P.date("to", f.range.to)];
  const where = whereFor(scope, f, params);
  const amt = MONEY("l.LoanAmount");
  const entityCol = scope.split ? "l.EntityId" : "0";

  const [loans, paid] = await Promise.all([
    cbQuery<Record<string, unknown>>(
      scope.org,
      `SELECT CAST(l.BorrowDate AS date) AS d, ${entityCol} AS entityId,
              COUNT(*) AS newLoans, SUM(${amt}) AS disbursed,
              SUM(CASE WHEN ${clearedInRange(caps)} THEN 1 ELSE 0 END) AS clearedLoans
         ${FROM}
         ${where} AND l.BorrowDate >= @from AND l.BorrowDate < @to
        GROUP BY CAST(l.BorrowDate AS date)${scope.split ? ", l.EntityId" : ""}`,
      params,
      { timeoutMs: 60000, maxRows: 4000 },
    ),
    // Money in, from the collections ledger, joined back to the loan so it can
    // be attributed to the right book.
    cbQuery<Record<string, unknown>>(
      scope.org,
      `SELECT CAST(${paid$.at} AS date) AS d, ${entityCol} AS entityId,
              SUM(${MONEY(paid$.amount)}) AS collected
         FROM ${paid$.from}
         JOIN ${SC}.Loans l ON l.id = ${paid$.loanId}
         JOIN ${SC}.Borrowers b ON b.ID = l.BorrowerId
         ${where} AND ${paid$.at} >= @from AND ${paid$.at} < @to
        GROUP BY CAST(${paid$.at} AS date)${scope.split ? ", l.EntityId" : ""}`,
      params,
      { timeoutMs: 60000, maxRows: 4000 },
    ),
  ]);

  const axis = bucketAxis(f.range);
  const rows = new Map<string, TimeRow>();
  for (const a of axis) rows.set(a.key, { ...EMPTY_POINT(a.label), ...(scope.split ? { by: [] } : {}) });

  const slot = (row: TimeRow, entityId: number): TimePoint => {
    if (!scope.split) return row;
    let s = row.by!.find((x) => x.entityId === entityId);
    if (!s) { s = { entityId, ...EMPTY_POINT(row.label) }; row.by!.push(s); }
    return s;
  };

  const add = (raw: unknown, entityId: number, apply: (p: TimePoint) => void) => {
    const at = dt(raw);
    if (!at) return;
    const row = rows.get(bucketKey(at, f.range.bucket));
    if (!row) return; // outside the axis — a row the range does not cover
    apply(row);
    if (scope.split) apply(slot(row, entityId));
  };

  for (const r of loans) {
    add(r.d, num(r.entityId), (p) => {
      p.newLoans += num(r.newLoans);
      p.disbursed += num(r.disbursed);
      p.clearedLoans += num(r.clearedLoans);
    });
  }
  for (const r of paid) add(r.d, num(r.entityId), (p) => { p.collected += num(r.collected); });

  // Every book gets a slot in every bucket, so a split chart draws a flat zero
  // for the quiet book instead of an absent series that re-scales the axis.
  if (scope.split) {
    for (const row of rows.values()) {
      for (const lens of scope.lenses) if (!row.by!.some((s) => s.entityId === lens.id)) row.by!.push({ entityId: lens.id, ...EMPTY_POINT(row.label) });
      row.by!.sort((a, b) => a.entityId - b.entityId);
    }
  }
  return [...rows.values()];
}

// ─────────────────────────────────────────────────────────────────────────────
// HEADLINE
// ─────────────────────────────────────────────────────────────────────────────

function headlineFrom(r: Record<string, unknown>, collected: number, dueInPeriod: number): Headline {
  const olb = num(r.olb);
  const par30Amount = num(r.par30Amount);
  const newLoans = num(r.newLoans);
  const borrowers = num(r.borrowers);
  const newBorrowers = num(r.newBorrowers);
  return {
    disbursed: num(r.disbursed),
    collected,
    olb,
    par30: olb > 0 ? (par30Amount / olb) * 100 : 0,
    par30Amount,
    nplAmount: num(r.nplAmount),
    newLoans,
    activeLoans: num(r.activeLoans),
    clearedLoans: num(r.clearedLoans),
    borrowers,
    newBorrowers,
    // No LoanApplications table on this deployment: there is nothing to count,
    // so these stay zero and the rates stay NULL. A null renders as "—"; a zero
    // rate would render as a catastrophe that never happened.
    applications: 0,
    approvals: 0,
    declines: 0,
    approvalRate: null,
    onTimeRate: null,
    collectionRate: dueInPeriod > 0 ? (collected / dueInPeriod) * 100 : null,
    dueInPeriod,
    avgLoanSize: num(r.avgLoanSize),
    avgScore: r.avgScore == null ? null : num(r.avgScore),
    repeatRate: borrowers > 0 ? ((borrowers - newBorrowers) / borrowers) * 100 : 0,
  };
}

async function headlineRows(scope: LiveScope, f: StudioFilters) {
  const caps = await capsFor(scope.org);
  const paid$ = paidSource(caps);
  const params: QueryParam[] = [P.date("from", f.range.from), P.date("to", f.range.to)];
  const where = whereFor(scope, f, params);
  const dpd = dpdExpr(scope);
  const bal = MONEY("l.LoanBalance");
  const amt = MONEY("l.LoanAmount");
  const inRange = `l.BorrowDate >= @from AND l.BorrowDate < @to`;
  const entityCol = scope.split ? "l.EntityId" : "0";

  const [agg, paid, due] = await Promise.all([
    cbQuery<Record<string, unknown>>(
      scope.org,
      `SELECT ${entityCol} AS entityId,
              SUM(CASE WHEN ${inRange} THEN 1 ELSE 0 END)                       AS newLoans,
              SUM(CASE WHEN l.LoanCleared = 0 AND ${bal} > 0 THEN 1 ELSE 0 END) AS activeLoans,
              SUM(CASE WHEN ${clearedInRange(caps)} THEN 1 ELSE 0 END) AS clearedLoans,
              SUM(CASE WHEN ${inRange} THEN ${amt} ELSE 0 END)                  AS disbursed,
              SUM(CASE WHEN l.LoanCleared = 0 THEN ${bal} ELSE 0 END)           AS olb,
              SUM(CASE WHEN ${dpd} > 30 THEN ${bal} ELSE 0 END)                 AS par30Amount,
              SUM(CASE WHEN ${dpd} > 90 THEN ${bal} ELSE 0 END)                 AS nplAmount,
              AVG(CASE WHEN ${inRange} THEN ${amt} END)                         AS avgLoanSize,
              COUNT(DISTINCT l.BorrowerId)                                      AS borrowers,
              COUNT(DISTINCT CASE WHEN b.CreatedDate >= @from AND b.CreatedDate < @to THEN l.BorrowerId END) AS newBorrowers,
              AVG(CAST(b.CreditScore AS float))                                 AS avgScore
         ${FROM}
         ${trackerJoin(scope)}
         ${where}
        ${scope.split ? "GROUP BY l.EntityId" : ""}`,
      params, { timeoutMs: 60000, maxRows: 50 },
    ),
    cbQuery<Record<string, unknown>>(
      scope.org,
      `SELECT ${entityCol} AS entityId, SUM(${MONEY(paid$.amount)}) AS collected
         FROM ${paid$.from}
         JOIN ${SC}.Loans l ON l.id = ${paid$.loanId}
         JOIN ${SC}.Borrowers b ON b.ID = l.BorrowerId
         ${where} AND ${paid$.at} >= @from AND ${paid$.at} < @to
        ${scope.split ? "GROUP BY l.EntityId" : ""}`,
      params, { timeoutMs: 60000, maxRows: 50 },
    ),
    // What the book EXPECTED in this window — loans whose clear date falls in it.
    // The denominator for a collection rate, and the reason that rate is null
    // rather than zero when nothing was due.
    cbQuery<Record<string, unknown>>(
      scope.org,
      `SELECT ${entityCol} AS entityId, SUM(${amt}) AS dueInPeriod
         ${FROM}
         ${where} AND l.ExpectedClearDate >= @from AND l.ExpectedClearDate < @to
        ${scope.split ? "GROUP BY l.EntityId" : ""}`,
      params, { timeoutMs: 60000, maxRows: 50 },
    ),
  ]);
  return { agg, paid, due };
}

/** The numbers a screen leads with — summed across every book in the cut. */
export async function liveHeadline(scope: LiveScope, f: StudioFilters): Promise<Headline> {
  // Always ask combined: a caller wanting the split asks for it by name.
  const combined: LiveScope = { ...scope, split: false };
  const { agg, paid, due } = await headlineRows(combined, f);
  const collected = paid.reduce((s, r) => s + num(r.collected), 0);
  const dueIn = due.reduce((s, r) => s + num(r.dueInPeriod), 0);
  const h = headlineFrom(agg[0] ?? {}, collected, dueIn);
  if (!scope.split || scope.lenses.length < 2) return h;
  return { ...h, by: await liveHeadlineByEntity(scope, f) };
}

/** The same numbers, one set per book — what a side-by-side stat tile reads. */
export async function liveHeadlineByEntity(scope: LiveScope, f: StudioFilters): Promise<Array<Headline & { entityId: number }>> {
  const split: LiveScope = { ...scope, split: true };
  const { agg, paid, due } = await headlineRows(split, f);
  const paidBy = new Map(paid.map((r) => [num(r.entityId), num(r.collected)]));
  const dueBy = new Map(due.map((r) => [num(r.entityId), num(r.dueInPeriod)]));
  return scope.lenses.map((lens) => {
    const row = agg.find((r) => num(r.entityId) === lens.id) ?? {};
    return { entityId: lens.id, ...headlineFrom(row, paidBy.get(lens.id) ?? 0, dueBy.get(lens.id) ?? 0) };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// COHORTS, FILTER OPTIONS, INCEPTION
// ─────────────────────────────────────────────────────────────────────────────

/** Vintages: does the business we wrote in March behave like the business in September? */
export async function liveCohorts(scope: LiveScope, months = 12): Promise<CohortRow[]> {
  await capsFor(scope.org);
  const params: QueryParam[] = [P.int("months", Math.min(Math.max(months, 1), 60))];
  const dpd = dpdExpr(scope);
  const bal = MONEY("l.LoanBalance");
  const amt = MONEY("l.LoanAmount");

  const rows = await cbQuery<Record<string, unknown>>(
    scope.org,
    `WITH firstLoan AS (
       SELECT BorrowerId, MIN(BorrowDate) AS firstAt
         FROM ${SC}.Loans WHERE EntityId IN (${entityList(scope.lenses.map((l) => l.id))})
        GROUP BY BorrowerId
     )
     SELECT DATEFROMPARTS(YEAR(l.BorrowDate), MONTH(l.BorrowDate), 1) AS cohort,
            COUNT(*) AS loans,
            COUNT(DISTINCT l.BorrowerId) AS borrowers,
            COUNT(DISTINCT CASE WHEN fl.firstAt >= DATEFROMPARTS(YEAR(l.BorrowDate), MONTH(l.BorrowDate), 1)
                                 AND fl.firstAt <  DATEADD(month, 1, DATEFROMPARTS(YEAR(l.BorrowDate), MONTH(l.BorrowDate), 1))
                            THEN l.BorrowerId END) AS newBorrowers,
            SUM(${amt}) AS disbursed,
            AVG(${amt}) AS avgLoanSize,
            SUM(CASE WHEN l.LoanCleared = 1 THEN 1 ELSE 0 END) AS cleared,
            SUM(CASE WHEN l.LoanCleared = 0 AND ${bal} > 0 THEN 1 ELSE 0 END) AS stillOpen,
            SUM(CASE WHEN l.LoanCleared = 0 THEN ${bal} ELSE 0 END) AS openBalance,
            SUM(CASE WHEN ${dpd} > 30 THEN ${bal} ELSE 0 END) AS par30Amount
       FROM ${SC}.Loans l
       JOIN firstLoan fl ON fl.BorrowerId = l.BorrowerId
       ${trackerJoin(scope)}
      WHERE l.EntityId IN (${entityList(scope.lenses.map((l) => l.id))})
        AND l.BorrowDate >= DATEADD(month, -@months, GETDATE())
      GROUP BY DATEFROMPARTS(YEAR(l.BorrowDate), MONTH(l.BorrowDate), 1)
      ORDER BY 1 DESC`,
    params, { timeoutMs: 90000, maxRows: 120 },
  );

  const now = new Date();
  return rows.map((r) => {
    const at = dt(r.cohort) ?? now;
    const openBalance = num(r.openBalance);
    const par30Amount = num(r.par30Amount);
    const loans = num(r.loans);
    const cleared = num(r.cleared);
    return {
      cohort: `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}`,
      label: at.toLocaleDateString("en-GB", { month: "short", year: "numeric" }),
      loans,
      borrowers: num(r.borrowers),
      newBorrowers: num(r.newBorrowers),
      disbursed: num(r.disbursed),
      avgLoanSize: num(r.avgLoanSize),
      cleared,
      clearedPct: loans > 0 ? (cleared / loans) * 100 : 0,
      stillOpen: num(r.stillOpen),
      openBalance,
      par30Amount,
      // Against the vintage's OWN open balance — the only denominator that lets
      // two vintages of different sizes be compared.
      par30Pct: openBalance > 0 ? (par30Amount / openBalance) * 100 : 0,
      ageMonths: Math.max(0, (now.getFullYear() - at.getFullYear()) * 12 + (now.getMonth() - at.getMonth())),
    };
  });
}

/**
 * The filter surface's options, read from the LOAN BOOK rather than the master
 * tables — a filter offering 89 products when six have ever been lent against is
 * eighty-three rows of noise, and most of them lead to an empty screen.
 */
export async function liveFilterOptions(scope: LiveScope) {
  const ents = entityList(scope.lenses.map((l) => l.id));
  const [branches, officers, products] = await Promise.all([
    cbQuery<Record<string, unknown>>(
      scope.org,
      `SELECT ou.UnitId AS id, ou.UnitTitle AS label, reg.UnitTitle AS hint
         FROM ${SC}.OrganizationUnits ou
         LEFT JOIN ${SC}.OrganizationUnits reg ON reg.UnitId = ou.ParentUnit
        WHERE ou.ActiveStatus = 1 AND ou.OrganizationId IN (${ents})
        ORDER BY COALESCE(reg.UnitTitle, ''), ou.UnitTitle`,
      [], { timeoutMs: 30000, maxRows: 400 },
    ),
    cbQuery<Record<string, unknown>>(
      scope.org,
      `SELECT DISTINCT s.ID AS id,
              LTRIM(RTRIM(CONCAT(s.FirstName, ' ', COALESCE(s.OtherName, '')))) AS label,
              ou.UnitTitle AS hint
         FROM ${SC}.Borrowers b
         JOIN ${SC}.UserMaster s ON s.ID = b.EntityAgent
         LEFT JOIN ${SC}.OrganizationUnits ou ON ou.UnitId = b.EntityUnit
        WHERE b.EntityId IN (${ents})
        ORDER BY 2`,
      [], { timeoutMs: 45000, maxRows: 600 },
    ),
    cbQuery<Record<string, unknown>>(
      scope.org,
      `SELECT p.ID AS id, p.ProductName AS label
         FROM ${SC}.Products p
        WHERE p.EntityId IN (${ents}) AND EXISTS (SELECT 1 FROM ${SC}.Loans l WHERE l.ProductId = p.ID AND l.EntityId IN (${ents}))
        ORDER BY p.ProductName`,
      [], { timeoutMs: 45000, maxRows: 300 },
    ),
  ]);

  return {
    branches: branches.map((b) => ({ id: String(num(b.id)), label: str(b.label) || "Unnamed", hint: str(b.hint) || undefined })),
    officers: officers.filter((o) => str(o.label)).map((o) => ({ id: String(num(o.id)), label: str(o.label), hint: str(o.hint) || undefined })),
    products: products.map((p) => ({ id: String(num(p.id)), label: str(p.label) || "Unnamed" })),
  };
}

/** The earliest loan on the book — the true start for "since inception". */
export async function liveInception(scope: LiveScope): Promise<Date | null> {
  const rows = await cbQuery<Record<string, unknown>>(
    scope.org,
    `SELECT MIN(BorrowDate) AS first FROM ${SC}.Loans WHERE EntityId IN (${entityList(scope.lenses.map((l) => l.id))})`,
    [], { timeoutMs: 30000, maxRows: 1 },
  );
  return dt(rows[0]?.first) ?? null;
}
