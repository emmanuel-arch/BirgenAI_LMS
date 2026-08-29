// ─────────────────────────────────────────────────────────────────────────────
// THE QUERY ENGINE — one cube, aggregated in the database.
//
// Every screen in the studio asks the same shape of question: "this measure, by
// this dimension, over this range, filtered to these branches / officers /
// products". This file is the one place that turns that into SQL.
//
// ── WHY THE AGGREGATION IS IN POSTGRES AND NOT IN NODE ───────────────────────
// The tempting shortcut is `findMany()` then reduce in TypeScript, and it works
// beautifully until the book has a hundred thousand loans in it — at which point
// the studio is pulling the entire portfolio over the wire to count it. Micromart
// alone carry 62,000 open loans on their bridged book. So: GROUP BY in the
// database, one round trip per panel, and the rows that come back are already the
// answer.
//
// ── HOW RLS IS HONOURED ──────────────────────────────────────────────────────
// The Prisma client extension that stamps `app.org_id` only wraps MODEL calls —
// `prisma.$queryRaw` is not a model call and would run WITHOUT a tenant stamp,
// which under FORCE row security returns zero rows (the safe failure, but still a
// failure). So every raw query here goes through `orgTx`, which stamps the
// transaction by hand and hands back a client whose statements inherit it. There
// is no path in this file that reaches the database unstamped.
//
// ── HOW INJECTION IS PREVENTED ───────────────────────────────────────────────
// Two different mechanisms, because there are two different kinds of input:
//   · VALUES (ids, dates) are bound parameters via Prisma.sql — never interpolated.
//   · IDENTIFIERS (the GROUP BY column) cannot be parameters in SQL, so they are
//     not taken from the caller at all. The caller passes a DimensionKey, and the
//     key is looked up in a closed table of SQL fragments written in this file.
//     An unknown key throws. No caller-supplied string ever reaches the query text.
// ─────────────────────────────────────────────────────────────────────────────
import { Prisma } from "@prisma/client";
import { orgTx } from "@/lib/prisma";
import type { DimensionKey } from "./cube";
import { AGE_BANDS, LOAN_SIZE_BANDS, TENURE_BANDS } from "./cube";
import { bucketAxis, PG_TRUNC, type Range } from "./ranges";

export type StudioFilters = {
  range: Range;
  branchIds: string[];
  officerIds: string[];
  productIds: string[];
  /** Risk bands to include. Empty = all. */
  riskBands: string[];
};

export const EMPTY_FILTERS = (range: Range): StudioFilters => ({
  range,
  branchIds: [],
  officerIds: [],
  productIds: [],
  riskBands: [],
});

const n = (v: unknown): number => {
  const x = typeof v === "bigint" ? Number(v) : Number(v);
  return Number.isFinite(x) ? x : 0;
};

// ─────────────────────────────────────────────────────────────────────────────
// DIMENSION → SQL. A closed table. Nothing here is caller-supplied.
//
// Each entry gives the expression to GROUP BY and the expression that produces
// the human label, in the context of a query where the loan is aliased `l`, the
// borrower `b`, the branch `br`, the officer `s` and the product `p`.
// ─────────────────────────────────────────────────────────────────────────────

type DimSql = {
  /** The grouping key. */
  key: Prisma.Sql;
  /** The display label. */
  label: Prisma.Sql;
  /** Tables this dimension needs joined in. */
  needs: Array<"borrower" | "branch" | "officer" | "product">;
  /** Fixed display order — ordinal dimensions must never be re-sorted by value. */
  order?: string[];
};

/** A CASE expression that buckets a numeric column, preserving the declared order. */
function bandCase(col: Prisma.Sql, bands: Array<[string, number, number]>): Prisma.Sql {
  const whens = bands.map(
    ([label, lo, hi]) => Prisma.sql`WHEN ${col} >= ${lo} AND ${col} <= ${hi} THEN ${label}`,
  );
  return Prisma.sql`CASE ${Prisma.join(whens, " ")} ELSE 'Unknown' END`;
}

function dimSql(dim: DimensionKey, bucketUnit: string): DimSql {
  switch (dim) {
    case "time":
      // date_trunc's unit cannot be a bind parameter, which is exactly why
      // `bucketUnit` comes from PG_TRUNC — a fixed map in ranges.ts — and never
      // from a query string.
      return {
        key: Prisma.raw(`to_char(date_trunc('${bucketUnit}', l."borrowDate"), 'YYYY-MM-DD"T"HH24')`),
        label: Prisma.raw(`to_char(date_trunc('${bucketUnit}', l."borrowDate"), 'YYYY-MM-DD"T"HH24')`),
        needs: [],
      };
    case "branch":
      return { key: Prisma.sql`COALESCE(br.id, 'unassigned')`, label: Prisma.sql`COALESCE(br.name, 'Unassigned')`, needs: ["branch"] };
    case "region":
      // The top of the office tree: a branch's parent where it has one, itself
      // where it does not. A two-level roll-up is what "region" means to every
      // lender on this platform; deeper trees roll to their own parent, which is
      // the honest answer rather than a recursive CTE nobody asked for.
      return {
        key: Prisma.sql`COALESCE(pbr.id, br.id, 'unassigned')`,
        label: Prisma.sql`COALESCE(pbr.name, br.name, 'Unassigned')`,
        needs: ["branch"],
      };
    case "officer":
      return {
        key: Prisma.sql`COALESCE(s.id, 'unassigned')`,
        label: Prisma.sql`COALESCE(NULLIF(TRIM(CONCAT(s."firstName", ' ', COALESCE(s."otherName", ''))), ''), 'Unassigned')`,
        needs: ["officer"],
      };
    case "product":
      return { key: Prisma.sql`COALESCE(p.id, 'unknown')`, label: Prisma.sql`COALESCE(p.name, 'Unknown product')`, needs: ["product"] };
    case "status":
      return { key: Prisma.sql`l.status::text`, label: Prisma.sql`l.status::text`, needs: [] };
    case "gender":
      return {
        key: Prisma.sql`CASE WHEN b.gender = 'M' THEN 'Men' WHEN b.gender = 'F' THEN 'Women' ELSE 'Not stated' END`,
        label: Prisma.sql`CASE WHEN b.gender = 'M' THEN 'Men' WHEN b.gender = 'F' THEN 'Women' ELSE 'Not stated' END`,
        needs: ["borrower"],
      };
    case "riskBand":
      return {
        key: Prisma.sql`COALESCE(b."riskBand", 'Unscored')`,
        label: Prisma.sql`COALESCE(b."riskBand", 'Unscored')`,
        needs: ["borrower"],
        order: ["PRIME", "STRONG", "WATCH", "HIGH", "Unscored"],
      };
    case "kycStatus":
      return { key: Prisma.sql`b."kycStatus"::text`, label: Prisma.sql`b."kycStatus"::text`, needs: ["borrower"] };
    case "ageBand": {
      const age = Prisma.sql`EXTRACT(YEAR FROM AGE(b.dob))`;
      const c = bandCase(age, AGE_BANDS);
      return { key: c, label: c, needs: ["borrower"], order: [...AGE_BANDS.map(([l]) => l), "Unknown"] };
    }
    case "loanSizeBand": {
      const c = bandCase(Prisma.sql`l.principal`, LOAN_SIZE_BANDS);
      return { key: c, label: c, needs: [], order: [...LOAN_SIZE_BANDS.map(([l]) => l), "Unknown"] };
    }
    case "tenureBand": {
      const days = Prisma.sql`COALESCE(DATE_PART('day', l."expectedClearDate" - l."borrowDate"), 0)`;
      const c = bandCase(days, TENURE_BANDS);
      return { key: c, label: c, needs: [], order: [...TENURE_BANDS.map(([l]) => l), "Unknown"] };
    }
    case "channel":
      // Loans carry no channel of their own; the application they came from does.
      // A loan booked at the counter has no application, and "Console" is the
      // truthful label for that rather than "Unknown".
      return {
        key: Prisma.sql`COALESCE(ap.channel, 'Console')`,
        label: Prisma.sql`COALESCE(ap.channel, 'Console')`,
        needs: [],
      };
    case "entity":
      // Only meaningful on a bridged book, where entities live on the lender's own
      // server. On a native book there is exactly one entity — this org — and
      // saying so is better than inventing a dimension.
      return { key: Prisma.sql`'This entity'`, label: Prisma.sql`'This entity'`, needs: [] };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FILTERS → SQL. Values are bound; nothing is interpolated.
// ─────────────────────────────────────────────────────────────────────────────

function loanFilters(orgId: string, f: StudioFilters, opts: { ranged?: boolean } = {}): Prisma.Sql[] {
  const w: Prisma.Sql[] = [Prisma.sql`l."orgId" = ${orgId}`];
  if (opts.ranged !== false) {
    w.push(Prisma.sql`l."borrowDate" >= ${f.range.from} AND l."borrowDate" < ${f.range.to}`);
  }
  if (f.branchIds.length) w.push(Prisma.sql`l."branchId" IN (${Prisma.join(f.branchIds)})`);
  if (f.officerIds.length) w.push(Prisma.sql`l."createdBy" IN (${Prisma.join(f.officerIds)})`);
  if (f.productIds.length) w.push(Prisma.sql`l."productId" IN (${Prisma.join(f.productIds)})`);
  if (f.riskBands.length) w.push(Prisma.sql`b."riskBand" IN (${Prisma.join(f.riskBands)})`);
  return w;
}

/** The join chain a dimension needs. Always the same aliases, so filters compose. */
function joins(needs: DimSql["needs"], forceBorrower: boolean): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  if (forceBorrower || needs.includes("borrower")) parts.push(Prisma.sql`LEFT JOIN "Borrower" b ON b.id = l."borrowerId"`);
  if (needs.includes("branch")) {
    parts.push(Prisma.sql`LEFT JOIN "Branch" br ON br.id = l."branchId"`);
    parts.push(Prisma.sql`LEFT JOIN "Branch" pbr ON pbr.id = br."parentId"`);
  }
  if (needs.includes("officer")) parts.push(Prisma.sql`LEFT JOIN "StaffUser" s ON s.id = l."createdBy"`);
  if (needs.includes("product")) parts.push(Prisma.sql`LEFT JOIN "Product" p ON p.id = l."productId"`);
  return parts.length ? Prisma.join(parts, " ") : Prisma.empty;
}

// ─────────────────────────────────────────────────────────────────────────────
// THE RESULT SHAPE — one row per dimension value, every measure on it.
// ─────────────────────────────────────────────────────────────────────────────

export type CubeMeasures = {
  // Volume
  newLoans: number;
  activeLoans: number;
  clearedLoans: number;
  loans: number;
  // Money
  disbursed: number;
  olb: number;
  avgLoanSize: number;
  avgTenureDays: number;
  // Quality — filled by the arrears pass
  par30: number;
  par30Amount: number;
  par90Amount: number;
  overdue: number;
  // People
  borrowers: number;
};

export type CubeRow = CubeMeasures & {
  key: string;
  label: string;
  /**
   * The same measures again, once per book, when the cut is SPLIT across more
   * than one entity. Absent on every single-book read — which is what lets a
   * chart decide "draw one series or two" from the data rather than from a prop
   * that some caller has to remember to pass.
   */
  by?: Array<CubeMeasures & { entityId: number }>;
};

const EMPTY_ROW = (key: string, label: string): CubeRow => ({
  key, label,
  newLoans: 0, activeLoans: 0, clearedLoans: 0, loans: 0,
  disbursed: 0, olb: 0, avgLoanSize: 0, avgTenureDays: 0,
  par30: 0, par30Amount: 0, par90Amount: 0, overdue: 0,
  borrowers: 0,
});

/**
 * The loan cube: every loan measure, grouped by one dimension, in one query.
 *
 * ── THE FLOW / STOCK SPLIT, IN SQL ──────────────────────────────────────────
 * `newLoans` and `disbursed` are FLOWS and are filtered to the range. `olb` and
 * `activeLoans` are STOCKS — a level, not an event — and are NOT: the outstanding
 * balance of a book is what is open today, regardless of when each loan was
 * written. Filtering a stock by the range is the single most common way an
 * analytics screen produces a number nobody can reconcile ("why does our
 * outstanding change when I pick last month?"), so the two are computed in the
 * same pass with different predicates rather than left to the caller.
 */
export async function loanCube(orgId: string, dim: DimensionKey, f: StudioFilters): Promise<CubeRow[]> {
  const d = dimSql(dim, PG_TRUNC[f.range.bucket]);
  const needsBorrower = d.needs.includes("borrower") || f.riskBands.length > 0;

  // Static filters (not the date range) — applied to the stock measures too.
  const base = loanFilters(orgId, f, { ranged: false });
  const inRange = Prisma.sql`l."borrowDate" >= ${f.range.from} AND l."borrowDate" < ${f.range.to}`;

  const needsApplication = dim === "channel";

  const rows = await orgTx((tx) =>
    tx.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT ${d.key} AS key,
             ${d.label} AS label,
             COUNT(*) FILTER (WHERE ${inRange})                                   AS "newLoans",
             COUNT(*)                                                              AS "loans",
             COUNT(*) FILTER (WHERE l.status = 'ACTIVE')                           AS "activeLoans",
             COUNT(*) FILTER (WHERE l.status = 'CLEARED' AND l."clearedAt" >= ${f.range.from} AND l."clearedAt" < ${f.range.to}) AS "clearedLoans",
             COALESCE(SUM(l.principal) FILTER (WHERE ${inRange}), 0)               AS "disbursed",
             COALESCE(SUM(l.balance)   FILTER (WHERE l.status = 'ACTIVE'), 0)      AS "olb",
             COALESCE(AVG(l.principal) FILTER (WHERE ${inRange}), 0)               AS "avgLoanSize",
             COALESCE(AVG(DATE_PART('day', l."expectedClearDate" - l."borrowDate")) FILTER (WHERE ${inRange}), 0) AS "avgTenureDays",
             COUNT(DISTINCT l."borrowerId")                                        AS "borrowers"
      FROM "Loan" l
      ${joins(d.needs, needsBorrower)}
      ${needsApplication ? Prisma.sql`LEFT JOIN "LoanApplication" ap ON ap.id = l."applicationId"` : Prisma.empty}
      WHERE ${Prisma.join(base, " AND ")}
      GROUP BY 1, 2
      ORDER BY 1 ASC
    `),
  );

  const out = rows.map((r) => ({
    ...EMPTY_ROW(String(r.key ?? ""), String(r.label ?? "")),
    newLoans: n(r.newLoans),
    loans: n(r.loans),
    activeLoans: n(r.activeLoans),
    clearedLoans: n(r.clearedLoans),
    disbursed: n(r.disbursed),
    olb: n(r.olb),
    avgLoanSize: n(r.avgLoanSize),
    avgTenureDays: n(r.avgTenureDays),
    borrowers: n(r.borrowers),
  }));

  return applyOrder(out, d.order);
}

/**
 * PAR and overdue balance, grouped by the same dimension.
 *
 * A separate pass because it is a different grain: PAR is a property of a LOAN
 * derived from its INSTALLMENTS, and doing it in the same GROUP BY would fan the
 * loan rows out by their schedule and multiply every sum above by the number of
 * installments. The classic fan-out bug — one join too many and the disbursement
 * figure quietly triples.
 */
export async function arrearsCube(orgId: string, dim: DimensionKey, f: StudioFilters): Promise<Map<string, { par30Amount: number; par90Amount: number; overdue: number }>> {
  const d = dimSql(dim, PG_TRUNC[f.range.bucket]);
  const needsBorrower = d.needs.includes("borrower") || f.riskBands.length > 0;
  const base = loanFilters(orgId, f, { ranged: false });
  const needsApplication = dim === "channel";

  const rows = await orgTx((tx) =>
    tx.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      WITH overdue AS (
        SELECT i."loanId",
               MAX(DATE_PART('day', NOW() - i."dueDate"))                AS "worstDpd",
               SUM(i."amountDue" - i."amountPaid" + i.penalty)           AS "overdue"
        FROM "Installment" i
        WHERE i."orgId" = ${orgId} AND i.status = 'OVERDUE'
        GROUP BY i."loanId"
      )
      SELECT ${d.key} AS key,
             COALESCE(SUM(l.balance) FILTER (WHERE o."worstDpd" > 30), 0) AS "par30Amount",
             COALESCE(SUM(l.balance) FILTER (WHERE o."worstDpd" > 90), 0) AS "par90Amount",
             COALESCE(SUM(o.overdue), 0)                                  AS "overdue"
      FROM "Loan" l
      INNER JOIN overdue o ON o."loanId" = l.id
      ${joins(d.needs, needsBorrower)}
      ${needsApplication ? Prisma.sql`LEFT JOIN "LoanApplication" ap ON ap.id = l."applicationId"` : Prisma.empty}
      WHERE ${Prisma.join(base, " AND ")} AND l.status = 'ACTIVE'
      GROUP BY 1
    `),
  );

  const map = new Map<string, { par30Amount: number; par90Amount: number; overdue: number }>();
  for (const r of rows) {
    map.set(String(r.key ?? ""), {
      par30Amount: n(r.par30Amount),
      par90Amount: n(r.par90Amount),
      overdue: n(r.overdue),
    });
  }
  return map;
}

/** The loan cube with arrears folded in and PAR computed. The normal entry point. */
async function pgCube(orgId: string, dim: DimensionKey, f: StudioFilters): Promise<CubeRow[]> {
  const [rows, arrears] = await Promise.all([loanCube(orgId, dim, f), arrearsCube(orgId, dim, f)]);
  return rows.map((r) => {
    const a = arrears.get(r.key);
    const par30Amount = a?.par30Amount ?? 0;
    return {
      ...r,
      par30Amount,
      par90Amount: a?.par90Amount ?? 0,
      overdue: a?.overdue ?? 0,
      // PAR is a RATIO and is computed from this row's own two numbers. Summing
      // ratios across rows is meaningless, which is why no caller is given one to
      // sum — the totals row recomputes from its own amounts.
      par30: r.olb > 0 ? (par30Amount / r.olb) * 100 : 0,
    };
  });
}

/**
 * A time series over the range, with EMPTY BUCKETS INCLUDED.
 *
 * The left join onto the axis is the whole point. A GROUP BY only returns
 * buckets that had activity, so a week with no disbursements simply vanishes and
 * the line joins straight across the gap — an outage rendered as a plateau. The
 * axis is built from the range (ranges.ts) and the aggregate is joined onto it,
 * so a zero week is drawn as a zero.
 */
export type TimePoint = {
  label: string;
  disbursed: number;
  collected: number;
  newLoans: number;
  applications: number;
  clearedLoans: number;
};

export type TimeRow = TimePoint & {
  /** Per-book series, present only on a SPLIT cut. See CubeRow.by. */
  by?: Array<TimePoint & { entityId: number }>;
};

async function pgTimeSeries(orgId: string, f: StudioFilters): Promise<TimeRow[]> {
  const unit = PG_TRUNC[f.range.bucket];
  const axis = bucketAxis(f.range);

  const [loans, collections, apps] = await Promise.all([
    orgTx((tx) =>
      tx.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT ${Prisma.raw(`to_char(date_trunc('${unit}', l."borrowDate"), 'YYYY-MM-DD"T"HH24')`)} AS bucket,
               COUNT(*) AS "newLoans",
               COALESCE(SUM(l.principal), 0) AS disbursed,
               COUNT(*) FILTER (WHERE l.status = 'CLEARED') AS "clearedLoans"
        FROM "Loan" l
        ${f.riskBands.length ? Prisma.sql`LEFT JOIN "Borrower" b ON b.id = l."borrowerId"` : Prisma.empty}
        WHERE ${Prisma.join(loanFilters(orgId, f), " AND ")}
        GROUP BY 1
      `),
    ),
    collectionsSeries(orgId, f),
    orgTx((tx) =>
      tx.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT ${Prisma.raw(`to_char(date_trunc('${unit}', a."createdAt"), 'YYYY-MM-DD"T"HH24')`)} AS bucket,
               COUNT(*) AS applications
        FROM "LoanApplication" a
        WHERE a."orgId" = ${orgId}
          AND a."createdAt" >= ${f.range.from} AND a."createdAt" < ${f.range.to}
          ${f.productIds.length ? Prisma.sql`AND a."productId" IN (${Prisma.join(f.productIds)})` : Prisma.empty}
          ${f.branchIds.length ? Prisma.sql`AND a."branchId" IN (${Prisma.join(f.branchIds)})` : Prisma.empty}
          ${f.officerIds.length ? Prisma.sql`AND a."officerId" IN (${Prisma.join(f.officerIds)})` : Prisma.empty}
        GROUP BY 1
      `),
    ),
  ]);

  const loanBy = new Map(loans.map((r) => [String(r.bucket), r]));
  const appBy = new Map(apps.map((r) => [String(r.bucket), r]));

  return axis.map((a) => {
    // The axis key from ranges.ts and the SQL bucket string must agree exactly.
    // Both are built to the same 'YYYY-MM-DDTHH' shape, and the comparison is a
    // prefix match so an hour axis and a day truncation still line up.
    const sqlKey = [...loanBy.keys(), ...appBy.keys(), ...collections.keys()].find((k) => k.startsWith(a.key)) ?? a.key;
    const l = loanBy.get(sqlKey);
    const ap = appBy.get(sqlKey);
    return {
      label: a.label,
      disbursed: n(l?.disbursed),
      collected: collections.get(sqlKey) ?? 0,
      newLoans: n(l?.newLoans),
      clearedLoans: n(l?.clearedLoans),
      applications: n(ap?.applications),
    };
  });
}

/**
 * Money in, per bucket — DEDUPLICATED across STK and C2B.
 *
 * An STK payment also lands as a C2B confirmation with the same M-Pesa receipt.
 * Counting both is the reconciliation sin this platform exists to catch, so the
 * UNION is on the receipt number and the STK leg is dropped where a C2B row for
 * the same receipt already exists.
 */
async function collectionsSeries(orgId: string, f: StudioFilters): Promise<Map<string, number>> {
  const unit = PG_TRUNC[f.range.bucket];
  const rows = await orgTx((tx) =>
    tx.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      WITH inflow AS (
        SELECT r."createdAt" AS at, r.amount AS amount
        FROM "C2BReceipt" r
        WHERE r."orgId" = ${orgId} AND r."createdAt" >= ${f.range.from} AND r."createdAt" < ${f.range.to}
        UNION ALL
        SELECT pi."createdAt" AS at, pi.amount AS amount
        FROM "PaymentIntent" pi
        WHERE pi."orgId" = ${orgId} AND pi.state = 'SUCCESS'
          AND pi."createdAt" >= ${f.range.from} AND pi."createdAt" < ${f.range.to}
          AND (
            pi."mpesaReceipt" IS NULL
            OR NOT EXISTS (
              SELECT 1 FROM "C2BReceipt" c
              WHERE c."orgId" = ${orgId} AND c."transId" = pi."mpesaReceipt"
            )
          )
      )
      SELECT ${Prisma.raw(`to_char(date_trunc('${unit}', at), 'YYYY-MM-DD"T"HH24')`)} AS bucket,
             COALESCE(SUM(amount), 0) AS collected
      FROM inflow
      GROUP BY 1
    `),
  );
  return new Map(rows.map((r) => [String(r.bucket), n(r.collected)]));
}

// ─────────────────────────────────────────────────────────────────────────────
// HEADLINE — the numbers a screen leads with, for one period.
// ─────────────────────────────────────────────────────────────────────────────

export type Headline = {
  /** Per-book breakdown, present only on a SPLIT cut. See CubeRow.by. */
  by?: Array<Omit<Headline, "by"> & { entityId: number }>;
  disbursed: number;
  collected: number;
  olb: number;
  par30: number;
  par30Amount: number;
  nplAmount: number;
  newLoans: number;
  activeLoans: number;
  clearedLoans: number;
  borrowers: number;
  newBorrowers: number;
  applications: number;
  approvals: number;
  declines: number;
  approvalRate: number | null;
  onTimeRate: number | null;
  collectionRate: number | null;
  dueInPeriod: number;
  avgLoanSize: number;
  avgScore: number | null;
  repeatRate: number;
};

async function pgHeadline(orgId: string, f: StudioFilters): Promise<Headline> {
  const riskJoin = f.riskBands.length ? Prisma.sql`LEFT JOIN "Borrower" b ON b.id = l."borrowerId"` : Prisma.empty;
  const base = loanFilters(orgId, f, { ranged: false });
  const inRange = Prisma.sql`l."borrowDate" >= ${f.range.from} AND l."borrowDate" < ${f.range.to}`;

  const [loanAgg, arrears, appAgg, peopleAgg, dueAgg, collectedMap] = await Promise.all([
    orgTx((tx) =>
      tx.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT COUNT(*) FILTER (WHERE ${inRange})                              AS "newLoans",
               COUNT(*) FILTER (WHERE l.status = 'ACTIVE')                     AS "activeLoans",
               COUNT(*) FILTER (WHERE l.status = 'CLEARED' AND l."clearedAt" >= ${f.range.from} AND l."clearedAt" < ${f.range.to}) AS "clearedLoans",
               COALESCE(SUM(l.principal) FILTER (WHERE ${inRange}), 0)         AS disbursed,
               COALESCE(SUM(l.balance) FILTER (WHERE l.status = 'ACTIVE'), 0)  AS olb,
               COALESCE(AVG(l.principal) FILTER (WHERE ${inRange}), 0)         AS "avgLoanSize",
               COUNT(DISTINCT l."borrowerId")                                  AS "borrowersWithLoan",
               COUNT(DISTINCT l."borrowerId") FILTER (WHERE l.seq > 1)         AS "repeatBorrowers"
        FROM (
          SELECT l.*, ROW_NUMBER() OVER (PARTITION BY l."borrowerId" ORDER BY l."borrowDate") AS seq
          FROM "Loan" l WHERE l."orgId" = ${orgId}
        ) l
        ${riskJoin}
        WHERE ${Prisma.join(base, " AND ")}
      `),
    ),
    orgTx((tx) =>
      tx.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        WITH overdue AS (
          SELECT i."loanId", MAX(DATE_PART('day', NOW() - i."dueDate")) AS "worstDpd"
          FROM "Installment" i
          WHERE i."orgId" = ${orgId} AND i.status = 'OVERDUE'
          GROUP BY i."loanId"
        )
        SELECT COALESCE(SUM(l.balance) FILTER (WHERE o."worstDpd" > 30), 0) AS "par30Amount",
               COALESCE(SUM(l.balance) FILTER (WHERE o."worstDpd" > 90), 0) AS "nplAmount"
        FROM "Loan" l
        INNER JOIN overdue o ON o."loanId" = l.id
        ${riskJoin}
        WHERE ${Prisma.join(base, " AND ")} AND l.status = 'ACTIVE'
      `),
    ),
    orgTx((tx) =>
      tx.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT COUNT(*) AS applications,
               COUNT(*) FILTER (WHERE a.status = 'APPROVED') AS approvals,
               COUNT(*) FILTER (WHERE a.status = 'DECLINED') AS declines
        FROM "LoanApplication" a
        WHERE a."orgId" = ${orgId}
          AND a."createdAt" >= ${f.range.from} AND a."createdAt" < ${f.range.to}
          ${f.productIds.length ? Prisma.sql`AND a."productId" IN (${Prisma.join(f.productIds)})` : Prisma.empty}
          ${f.branchIds.length ? Prisma.sql`AND a."branchId" IN (${Prisma.join(f.branchIds)})` : Prisma.empty}
          ${f.officerIds.length ? Prisma.sql`AND a."officerId" IN (${Prisma.join(f.officerIds)})` : Prisma.empty}
      `),
    ),
    orgTx((tx) =>
      tx.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT COUNT(*) AS borrowers,
               COUNT(*) FILTER (WHERE b."createdAt" >= ${f.range.from} AND b."createdAt" < ${f.range.to}) AS "newBorrowers",
               AVG(b."creditScore") FILTER (WHERE b."creditScore" IS NOT NULL) AS "avgScore"
        FROM "Borrower" b
        WHERE b."orgId" = ${orgId}
          ${f.branchIds.length ? Prisma.sql`AND b."branchId" IN (${Prisma.join(f.branchIds)})` : Prisma.empty}
          ${f.riskBands.length ? Prisma.sql`AND b."riskBand" IN (${Prisma.join(f.riskBands)})` : Prisma.empty}
      `),
    ),
    orgTx((tx) =>
      tx.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
        SELECT COALESCE(SUM(i."amountDue"), 0) AS "dueInPeriod",
               COUNT(*) AS "installmentsDue",
               COUNT(*) FILTER (WHERE i.status = 'PAID' AND i."paidAt" <= i."dueDate" + INTERVAL '1 day') AS "onTime",
               COUNT(*) FILTER (WHERE i.status IN ('PAID','PARTIAL','OVERDUE')) AS settled
        FROM "Installment" i
        INNER JOIN "Loan" l ON l.id = i."loanId"
        ${riskJoin}
        WHERE i."orgId" = ${orgId}
          AND i."dueDate" >= ${f.range.from} AND i."dueDate" < ${f.range.to}
          ${f.branchIds.length ? Prisma.sql`AND l."branchId" IN (${Prisma.join(f.branchIds)})` : Prisma.empty}
          ${f.officerIds.length ? Prisma.sql`AND l."createdBy" IN (${Prisma.join(f.officerIds)})` : Prisma.empty}
          ${f.productIds.length ? Prisma.sql`AND l."productId" IN (${Prisma.join(f.productIds)})` : Prisma.empty}
      `),
    ),
    collectionsSeries(orgId, f),
  ]);

  const L = loanAgg[0] ?? {};
  const A = arrears[0] ?? {};
  const AP = appAgg[0] ?? {};
  const P = peopleAgg[0] ?? {};
  const D = dueAgg[0] ?? {};

  const olb = n(L.olb);
  const par30Amount = n(A.par30Amount);
  const collected = [...collectedMap.values()].reduce((s, v) => s + v, 0);
  const dueInPeriod = n(D.dueInPeriod);
  const settled = n(D.settled);
  const decided = n(AP.approvals) + n(AP.declines);
  const withLoan = n(L.borrowersWithLoan);

  return {
    disbursed: n(L.disbursed),
    collected,
    olb,
    par30: olb > 0 ? (par30Amount / olb) * 100 : 0,
    par30Amount,
    nplAmount: n(A.nplAmount),
    newLoans: n(L.newLoans),
    activeLoans: n(L.activeLoans),
    clearedLoans: n(L.clearedLoans),
    borrowers: n(P.borrowers),
    newBorrowers: n(P.newBorrowers),
    applications: n(AP.applications),
    approvals: n(AP.approvals),
    declines: n(AP.declines),
    // Undecided applications are EXCLUDED from the denominator. Including them
    // makes the approval rate fall every time a busy week fills the queue, which
    // is a property of the calendar, not of the credit policy.
    approvalRate: decided > 0 ? (n(AP.approvals) / decided) * 100 : null,
    onTimeRate: settled > 0 ? (n(D.onTime) / settled) * 100 : null,
    collectionRate: dueInPeriod > 0 ? (collected / dueInPeriod) * 100 : null,
    dueInPeriod,
    avgLoanSize: n(L.avgLoanSize),
    avgScore: P.avgScore != null ? n(P.avgScore) : null,
    repeatRate: withLoan > 0 ? (n(L.repeatBorrowers) / withLoan) * 100 : 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

/** Ordinal dimensions keep their declared order; everything else sorts by size. */
function applyOrder(rows: CubeRow[], order?: string[]): CubeRow[] {
  if (!order) return rows;
  const rank = new Map(order.map((o, i) => [o, i]));
  return [...rows].sort((a, b) => (rank.get(a.label) ?? 99) - (rank.get(b.label) ?? 99));
}

/**
 * The filter surface's option lists, scoped to what the caller may already see.
 *
 * Reads from the loan book rather than the master tables on purpose: a filter
 * offering forty branches when only six have ever written a loan is forty rows
 * of noise, and thirty-four of them lead to an empty screen.
 */
async function pgFilterOptions(orgId: string) {
  const [branches, officers, products] = await Promise.all([
    orgTx((tx) =>
      tx.$queryRaw<Array<{ id: string; name: string; parent: string | null }>>(Prisma.sql`
        SELECT br.id, br.name, pbr.name AS parent
        FROM "Branch" br
        LEFT JOIN "Branch" pbr ON pbr.id = br."parentId"
        WHERE br."orgId" = ${orgId} AND br.active = TRUE
        ORDER BY COALESCE(pbr.name, ''), br.name
      `),
    ),
    orgTx((tx) =>
      tx.$queryRaw<Array<{ id: string; name: string; branch: string | null }>>(Prisma.sql`
        SELECT s.id,
               NULLIF(TRIM(CONCAT(s."firstName", ' ', COALESCE(s."otherName", ''))), '') AS name,
               br.name AS branch
        FROM "StaffUser" s
        LEFT JOIN "Branch" br ON br.id = s."branchId"
        WHERE s."orgId" = ${orgId} AND s.status <> 'DISABLED'
        ORDER BY 2
      `),
    ),
    orgTx((tx) =>
      tx.$queryRaw<Array<{ id: string; name: string }>>(Prisma.sql`
        SELECT p.id, p.name FROM "Product" p WHERE p."orgId" = ${orgId} ORDER BY p.name
      `),
    ),
  ]);

  return {
    branches: branches.map((b) => ({ id: b.id, label: b.name, hint: b.parent ?? undefined })),
    officers: officers.filter((o) => o.name).map((o) => ({ id: o.id, label: o.name, hint: o.branch ?? undefined })),
    products: products.map((p) => ({ id: p.id, label: p.name })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// COHORTS — do the customers we took on last quarter behave like the ones before?
//
// The single most valuable analysis a lender can run and the one no incumbent
// ships, because it requires holding two dates at once: WHEN a loan was written,
// and how it has performed SINCE. A portfolio read as one blob cannot answer it
// — a book whose March vintage is failing and whose September vintage is clean
// reports as "slightly deteriorating" and gives nobody anything to act on.
//
// The output is a matrix: one row per origination month, with that vintage's own
// performance. If the columns worsen as you read down, credit standards have
// slipped and the date of the slip is on the left-hand side.
// ─────────────────────────────────────────────────────────────────────────────

export type CohortRow = {
  /** Origination month, "YYYY-MM". */
  cohort: string;
  label: string;
  loans: number;
  borrowers: number;
  /** New customers in that month — a vintage's true intake. */
  newBorrowers: number;
  disbursed: number;
  avgLoanSize: number;
  /** Of that vintage's loans, how many have been fully repaid. */
  cleared: number;
  clearedPct: number;
  /** Of that vintage, how much is still open. */
  stillOpen: number;
  openBalance: number;
  /** The vintage's own arrears — the number the whole analysis is for. */
  par30Amount: number;
  par30Pct: number;
  /** Months of observation. A 1-month-old vintage cannot be compared with a 12. */
  ageMonths: number;
};

async function pgCohorts(orgId: string, months = 12): Promise<CohortRow[]> {
  const rows = await orgTx((tx) =>
    tx.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      WITH overdue AS (
        SELECT i."loanId", MAX(DATE_PART('day', NOW() - i."dueDate")) AS "worstDpd"
        FROM "Installment" i
        WHERE i."orgId" = ${orgId} AND i.status = 'OVERDUE'
        GROUP BY i."loanId"
      ),
      first_loan AS (
        SELECT l."borrowerId", MIN(l."borrowDate") AS "firstAt"
        FROM "Loan" l WHERE l."orgId" = ${orgId}
        GROUP BY l."borrowerId"
      )
      SELECT to_char(date_trunc('month', l."borrowDate"), 'YYYY-MM')          AS cohort,
             COUNT(*)                                                         AS loans,
             COUNT(DISTINCT l."borrowerId")                                   AS borrowers,
             COUNT(DISTINCT l."borrowerId") FILTER (
               WHERE date_trunc('month', fl."firstAt") = date_trunc('month', l."borrowDate")
             )                                                                AS "newBorrowers",
             COALESCE(SUM(l.principal), 0)                                    AS disbursed,
             COALESCE(AVG(l.principal), 0)                                    AS "avgLoanSize",
             COUNT(*) FILTER (WHERE l.status = 'CLEARED')                     AS cleared,
             COUNT(*) FILTER (WHERE l.status = 'ACTIVE')                      AS "stillOpen",
             COALESCE(SUM(l.balance) FILTER (WHERE l.status = 'ACTIVE'), 0)   AS "openBalance",
             COALESCE(SUM(l.balance) FILTER (WHERE l.status = 'ACTIVE' AND o."worstDpd" > 30), 0) AS "par30Amount",
             DATE_PART('month', AGE(NOW(), date_trunc('month', l."borrowDate"))) +
               DATE_PART('year', AGE(NOW(), date_trunc('month', l."borrowDate"))) * 12 AS "ageMonths"
      FROM "Loan" l
      LEFT JOIN overdue o ON o."loanId" = l.id
      LEFT JOIN first_loan fl ON fl."borrowerId" = l."borrowerId"
      WHERE l."orgId" = ${orgId}
        AND l."borrowDate" >= date_trunc('month', NOW()) - (${Math.min(60, Math.max(1, months))} || ' months')::interval
      GROUP BY 1, "ageMonths"
      ORDER BY 1 ASC
    `),
  );

  return rows.map((r) => {
    const loans = n(r.loans);
    const openBalance = n(r.openBalance);
    const par30Amount = n(r.par30Amount);
    const cleared = n(r.cleared);
    return {
      cohort: String(r.cohort),
      label: new Date(`${String(r.cohort)}-01T00:00:00`).toLocaleDateString("en-GB", { month: "short", year: "2-digit" }),
      loans,
      borrowers: n(r.borrowers),
      newBorrowers: n(r.newBorrowers),
      disbursed: n(r.disbursed),
      avgLoanSize: n(r.avgLoanSize),
      cleared,
      clearedPct: loans > 0 ? (cleared / loans) * 100 : 0,
      stillOpen: n(r.stillOpen),
      openBalance,
      par30Amount,
      // Against the vintage's OWN open balance, not the whole book's — that is
      // the only denominator that lets two vintages be compared.
      par30Pct: openBalance > 0 ? (par30Amount / openBalance) * 100 : 0,
      ageMonths: n(r.ageMonths),
    };
  });
}

/** The earliest loan on the book — the true start for "since inception". */
async function pgInception(orgId: string): Promise<Date | null> {
  const rows = await orgTx((tx) =>
    tx.$queryRaw<Array<{ first: Date | null }>>(Prisma.sql`
      SELECT MIN(l."borrowDate") AS first FROM "Loan" l WHERE l."orgId" = ${orgId}
    `),
  );
  return rows[0]?.first ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// THE DISPATCH — which database answers.
//
// Everything above this line is the Postgres implementation and is unchanged.
// Everything below decides, per request, whether a studio question is answered
// from our Postgres (a native lender's book lives there and nowhere else) or
// from the lender's own ServiceSuite through the relay (lib/analytics/live.ts).
//
// The six exported names are the same six the fifteen surfaces have always
// called. Only their FIRST ARGUMENT changed — from an orgId to a resolved
// StudioScope — and that change is the entire point: an orgId cannot express
// "Micromart's fintech book" or "both books, side by side", so as long as it was
// the argument the studio could not ask the right question.
//
// ── THE THIRD BRANCH IS THE IMPORTANT ONE ────────────────────────────────────
// When a bridged lender's database is unreachable, these return EMPTY rather
// than falling through to Postgres. Falling through is what produced the
// original bug: Postgres answered about Micromart's 199-loan shadow row, the
// board view said "There is no open book in this cut", and nothing anywhere
// suggested the real book was fine and simply had not been asked. An empty
// result paired with `scope.unavailable` lets the page say which it is.
// ─────────────────────────────────────────────────────────────────────────────
import type { StudioScope } from "./scope";
import {
  liveCube, liveTimeSeries, liveHeadline, liveCohorts, liveFilterOptions, liveInception,
} from "./live";

export const EMPTY_HEADLINE: Headline = {
  disbursed: 0, collected: 0, olb: 0, par30: 0, par30Amount: 0, nplAmount: 0,
  newLoans: 0, activeLoans: 0, clearedLoans: 0, borrowers: 0, newBorrowers: 0,
  applications: 0, approvals: 0, declines: 0,
  approvalRate: null, onTimeRate: null, collectionRate: null,
  dueInPeriod: 0, avgLoanSize: 0, avgScore: null, repeatRate: 0,
};

/** Every measure, grouped by one dimension — and by book too, when split. */
export async function cube(scope: StudioScope, dim: DimensionKey, f: StudioFilters): Promise<CubeRow[]> {
  if (scope.live) return liveCube(scope.live, dim, f);
  if (scope.unavailable) return [];
  return pgCube(scope.orgId, dim, f);
}

/** A series over the range, with empty buckets included. */
export async function timeSeries(scope: StudioScope, f: StudioFilters): Promise<TimeRow[]> {
  if (scope.live) return liveTimeSeries(scope.live, f);
  if (scope.unavailable) return [];
  return pgTimeSeries(scope.orgId, f);
}

/** The numbers a screen leads with. */
export async function headline(scope: StudioScope, f: StudioFilters): Promise<Headline> {
  if (scope.live) return liveHeadline(scope.live, f);
  if (scope.unavailable) return EMPTY_HEADLINE;
  return pgHeadline(scope.orgId, f);
}

/** Vintages — does this quarter's business behave like last quarter's? */
export async function cohorts(scope: StudioScope, months = 12): Promise<CohortRow[]> {
  if (scope.live) return liveCohorts(scope.live, months);
  if (scope.unavailable) return [];
  return pgCohorts(scope.orgId, months);
}

/** The filter surface's option lists, from whichever book is being read. */
export async function filterOptions(scope: StudioScope) {
  if (scope.live) return liveFilterOptions(scope.live);
  if (scope.unavailable) return { branches: [], officers: [], products: [] };
  return pgFilterOptions(scope.orgId);
}

/** The earliest loan on the book — the true start for "since inception". */
export async function inceptionDate(scope: StudioScope): Promise<Date | null> {
  if (scope.live) return liveInception(scope.live);
  if (scope.unavailable) return null;
  return pgInception(scope.orgId);
}
