// ─────────────────────────────────────────────────────────────────────────────
// THE FINTECH PIPELINE — connecting Micromart Fintech (3005) to CollectBox.
//
// ── THE GAP, STATED PLAINLY ──────────────────────────────────────────────────
// CollectBox holds 93,376 tracked loans and every single one belongs to EntityId
// 3002, Micromart's main book. Entity 3005 — Micromart Fintech, the entity they
// migrated 17,016 borrowers into on 2 August 2026 and are writing their future
// on — has NO presence in CollectBox whatsoever. Their new book has no
// collections engine, no queue, no agent assignment, no promise tracking.
//
// Not because anything is broken. Because nothing was ever built to carry a loan
// from Serviceconnect into CollectBox. The two databases sit on the same server,
// three feet apart, and the bridge between them is a person exporting a
// spreadsheet.
//
// ── WHAT THIS MODULE DOES ────────────────────────────────────────────────────
// It is the bridge. It reads the live 3005 book, ages every open loan against
// the SAME band definitions the 3002 floor runs on, and produces exactly the
// rows that `CollectionTracker` would hold if the pipeline were switched on.
//
// Two modes, one code path:
//
//   PROJECT  (always available, reads only) — computes the tracker rows and
//            shows the floor what 3005 would add: which bands, which agents,
//            what commission, what the queue would look like on Monday morning.
//
//   MATERIALISE (gated behind COLLECTBOX_POSTING_ENABLED) — writes those rows
//            into CollectionTracker for real, and the Fintech book joins the
//            floor. See write.ts; this module never writes.
//
// The projection is not a mock. Every loan, borrower, balance and date in it is
// read live. The only thing that is hypothetical is the assignment — and even
// that follows the real allocation rule the 3002 floor uses.
//
// ── WHY THE AGEING IS COMPUTED, AND FROM WHAT ────────────────────────────────
// `CollectionTracker.DaysInArears` is maintained by their nightly job. Entity
// 3005 has no such rows, so there is nothing to read and the days have to be
// derived. Getting the derivation right is the whole credibility of this module,
// and the first attempt got it wrong in an instructive way.
//
// ATTEMPT ONE used `Loans.ExpectedClearDate` — the loan's final maturity. It
// produced band drift of up to 242% against the live floor, because final
// maturity is not what a collections book ages on. A weekly loan on instalment 3
// of 10 that missed this Monday is thirty days from maturity and ONE day in
// arrears; ageing it off maturity says it is not late at all.
//
// ATTEMPT TWO uses the INSTALMENT SCHEDULE — days since the earliest unpaid row
// in `Serviceconnect.dbo.loanSchedule`. Measured against their own nightly
// figure across all 44,667 tracked loans that carry a schedule:
//
//     within 3 days:  33,304  (74.6%)
//     within 7 days:  43,479  (97.3%)
//
// and the per-band averages line up almost exactly — NPL derives 670.2 days
// against their 671.3, Watch 3 derives 111.3 against 114.0, Watch 2 derives 42.9
// against 45.2. That is the same arithmetic, not a similar one.
//
// Loans with no schedule row fall back to `ExpectedClearDate`, which is the right
// answer for a single-bullet loan and the only answer available for the rest.
// ─────────────────────────────────────────────────────────────────────────────

import type { OrgDef } from "@/lib/enterprise/connections";
import { CB, SC, cbQuery, cbOne, num, str, dt, msisdn, P } from "./client";
import { CATEGORIES, CATEGORY_LIST, categoryForDays, type Category } from "./taxonomy";

/** Is the pipeline armed to write into CollectBox, or only to project? */
export function isPipelineArmed(): boolean {
  return process.env.COLLECTBOX_POSTING_ENABLED === "true";
}

/**
 * The band a loan belongs in, from its schedule position and its term.
 *
 * `matured` is what separates Watch 1 from Watch 1 (Matured) — band 3 from band
 * 7. Both are one-to-thirty days late; the difference is whether the loan still
 * has a schedule left to run. A matured loan has no next instalment to lean on,
 * so the conversation is settlement or restructure rather than "your next
 * payment is Friday". Their floor keeps the two apart and so does this.
 */
export function bandFor(dpd: number, matured: boolean): Category {
  if (dpd < 0) return CATEGORIES[1];  // Prepayment — ahead of the schedule
  if (dpd === 0) return CATEGORIES[2]; // Due today
  if (dpd <= 30) return matured ? CATEGORIES[7] : CATEGORIES[3];
  if (dpd <= 60) return CATEGORIES[4];
  if (dpd <= 90) return CATEGORIES[5];
  return CATEGORIES[6];
}

// ── The projection ───────────────────────────────────────────────────────────

export type ProjectedRow = {
  loanId: number;
  borrowerId: number;
  name: string;
  phone: string;
  nationalId: string;
  product: string;
  productId: number;
  principal: number;
  olb: number;
  borrowedAt: Date | null;
  dueAt: Date | null;
  /** Days past the expected clear date. Negative = still running. */
  dpd: number;
  category: Category;
  /** The relationship officer who owns this borrower in the LMS. */
  officer: string | null;
  officerId: number;
  branch: string;
  /** Commission this row would earn at its band's rate, on full recovery. */
  commissionAtFull: number;
  /** Loans this borrower has held before this one. */
  priorLoans: number;
  /** Principal they have already repaid in full, across those loans. */
  priorRepaid: number;
  /** Was this borrower part of the 2 Aug 2026 migration out of entity 3002? */
  migrated: boolean;
};

export type PipelineProjection = {
  /** Every open 3005 loan carrying a balance, aged and banded. */
  rows: ProjectedRow[];
  bands: {
    category: Category;
    loans: number;
    olb: number;
    commissionAtFull: number;
    /** Share of the projected book, by value. */
    share: number;
  }[];
  totals: {
    loans: number;
    olb: number;
    borrowers: number;
    commissionAtFull: number;
    /** Cases whose borrower arrives with prior repayment history. */
    withHistory: number;
    /** Cases whose borrower came across in the 2 Aug 2026 migration. */
    migrated: number;
    /** Average number of prior loans per case — the depth of that history. */
    avgPriorLoans: number;
    /** Distinct relationship officers whose book this covers. */
    officers: number;
  };
  book: {
    entityId: number;
    /** Every loan ever booked in 3005, including the migration stubs. */
    loansEver: number;
    /** Loans still open. */
    loansOpen: number;
    /** Open loans carrying an actual balance — the real book. */
    loansCarrying: number;
    borrowers: number;
    disbursedLast30d: number;
    disbursedValueLast30d: number;
    products: { id: number; name: string; loans: number; olb: number }[];
  };
  /** What CollectBox holds for 3005 right now. Zero, until the pipeline runs. */
  alreadyTracked: number;
  armed: boolean;
  generatedAt: Date;
};

/**
 * Read the live Fintech book and project it onto the collections floor.
 *
 * The `knownToFloor` flag is the quietly valuable part. 17,016 of these
 * borrowers were migrated out of 3002, where the floor has been calling them for
 * years — so for a large share of the Fintech book, the moment the pipeline runs,
 * an agent picks up a case that already has call history, disposition patterns
 * and promise-keeping behaviour attached. That is not a migration artefact to be
 * cleaned up; it is the single biggest asset in this projection.
 */
export async function projectFintechPipeline(org: OrgDef, entityId = 3005): Promise<PipelineProjection> {
  const [loanRows, bookRow, productRows, trackedRow] = await Promise.all([
    cbQuery<Record<string, unknown>>(
      org,
      `SELECT l.id AS loanId, l.BorrowerId AS borrowerId, l.ProductId AS productId,
              l.LoanAmount AS principal, l.LoanBalance AS olb,
              l.BorrowDate AS borrowedAt,
              l.ExpectedClearDate AS clearDate,
              CASE WHEN l.ExpectedClearDate < CAST(GETDATE() AS date) THEN 1 ELSE 0 END AS matured,
              b.firstName, b.otherName, b.PhoneNumber AS phone, b.NationalID AS nationalId,
              p.ProductName AS product,
              ou.UnitTitle AS branch,
              ro.ID AS officerId, ro.FirstName AS roFirst, ro.OtherName AS roOther,
              CASE WHEN mig.BorrowerID IS NOT NULL THEN 1 ELSE 0 END AS migrated
         FROM ${SC}.Loans l
         JOIN ${SC}.Borrowers b ON b.ID = l.BorrowerId
         LEFT JOIN ${SC}.Products p           ON p.ID = l.ProductId
         LEFT JOIN ${SC}.OrganizationUnits ou ON ou.UnitId = b.EntityUnit
         LEFT JOIN ${SC}.UserMaster ro        ON ro.ID = b.EntityAgent
         -- The 2 Aug 2026 migration's own backup table. It is the only record of
         -- which borrowers came across from 3002, and it is what lets a case say
         -- "this customer has been with you for years" rather than treating a
         -- fifteen-loan relationship as a brand new account.
         LEFT JOIN ${SC}.BorrowerEntityMigrationBackup_20260802 mig ON mig.BorrowerID = l.BorrowerId
        WHERE l.EntityId = @entity AND l.LoanCleared = 0
          AND CAST(COALESCE(l.LoanBalance,0) AS decimal(18,2)) > 0
        ORDER BY CAST(l.LoanBalance AS decimal(18,2)) DESC`,
      [P.int("entity", entityId)],
      { timeoutMs: 40000, maxRows: 5000 },
    ),
    cbOne<Record<string, unknown>>(
      org,
      `SELECT (SELECT COUNT(*) FROM ${SC}.Loans WHERE EntityId=@entity) AS loansEver,
              (SELECT COUNT(*) FROM ${SC}.Loans WHERE EntityId=@entity AND LoanCleared=0) AS loansOpen,
              (SELECT COUNT(*) FROM ${SC}.Loans WHERE EntityId=@entity AND LoanCleared=0 AND CAST(COALESCE(LoanBalance,0) AS decimal(18,2))>0) AS loansCarrying,
              (SELECT COUNT(*) FROM ${SC}.Borrowers WHERE EntityId=@entity) AS borrowers,
              (SELECT COUNT(*) FROM ${SC}.Loans WHERE EntityId=@entity AND BorrowDate > DATEADD(day,-30,GETDATE())) AS disb30,
              (SELECT SUM(CAST(LoanAmount AS decimal(18,2))) FROM ${SC}.Loans WHERE EntityId=@entity AND BorrowDate > DATEADD(day,-30,GETDATE())) AS disbVal30`,
      [P.int("entity", entityId)], { timeoutMs: 30000 },
    ),
    cbQuery<Record<string, unknown>>(
      org,
      `SELECT p.ID, p.ProductName,
              COUNT(CASE WHEN l.LoanCleared = 0 THEN 1 END) AS loans,
              SUM(CASE WHEN l.LoanCleared = 0 THEN CAST(COALESCE(l.LoanBalance,0) AS decimal(18,2)) ELSE 0 END) AS olb
         FROM ${SC}.Products p
         LEFT JOIN ${SC}.Loans l ON l.ProductId = p.ID AND l.EntityId = @entity
        WHERE p.EntityId = @entity
        GROUP BY p.ID, p.ProductName`,
      [P.int("entity", entityId)], { maxRows: 100 },
    ),
    cbOne<{ n: number }>(
      org,
      `SELECT COUNT(*) AS n FROM ${CB}.CollectionTracker ct
         JOIN ${SC}.Loans l ON l.id = ct.LoanId WHERE l.EntityId = @entity`,
      [P.int("entity", entityId)], { timeoutMs: 30000 },
    ),
  ]);

  // ── The instalment schedule, in ONE scan ──────────────────────────────────
  //
  // `Serviceconnect.dbo.loanSchedule` is a HEAP of 1,952,246 rows with NO INDEX
  // OF ANY KIND — not even on `Loanid`. So a per-loan `OUTER APPLY` does not do
  // 62 index seeks, it does 62 full table scans of two million rows, and that
  // single fact was 8.6 of this function's 9 seconds.
  //
  // One grouped query over an `IN` list of the resolved loan ids is ONE scan,
  // and its cost is the same whether we are asking about sixty loans or six
  // thousand. (Their own reporting almost certainly pays this tax too — worth
  // raising with them; a single index on `loanSchedule(Loanid)` would repay
  // itself immediately, but it is their database and not ours to alter.)
  const loanIds = [...new Set(loanRows.map((r) => num(r.loanId)).filter((n) => n > 0))];
  const nextDue = new Map<number, Date | null>();
  if (loanIds.length > 0) {
    const sch = await cbQuery<{ Loanid: number; nextDue: Date }>(
      org,
      `SELECT Loanid, MIN(ExpectedDueDate) AS nextDue
         FROM ${SC}.loanSchedule
        WHERE Loanid IN (${loanIds.join(",")}) AND COALESCE(AmountPaid,0) < amounttopay
        GROUP BY Loanid`,
      [], { timeoutMs: 45000, maxRows: loanIds.length + 10 },
    );
    for (const s of sch) nextDue.set(num(s.Loanid), dt(s.nextDue));
  }

  // ── The borrower's prior book, fetched for the resolved set only ──────────
  // The obvious version puts an `OUTER APPLY (SELECT COUNT(*) FROM Loans WHERE
  // BorrowerId = …)` in the main statement. It is correct and it cost NINE
  // SECONDS: `Loans` carries 334,000 rows across both entities with no usable
  // index on `BorrowerId`, so each of the 62 candidates drove its own scan.
  // One grouped query over an `IN` list of known integers instead.
  const borrowerIds = [...new Set(loanRows.map((r) => num(r.borrowerId)).filter((n) => n > 0))];
  const history = new Map<number, { priorLoans: number; priorRepaid: number }>();
  if (borrowerIds.length > 0) {
    const hist = await cbQuery<{ BorrowerId: number; n: number; repaid: number }>(
      org,
      `SELECT BorrowerId, COUNT(*) AS n,
              SUM(CASE WHEN LoanCleared = 1 THEN CAST(COALESCE(LoanAmount,0) AS decimal(18,2)) ELSE 0 END) AS repaid
         FROM ${SC}.Loans
        WHERE BorrowerId IN (${borrowerIds.join(",")})
        GROUP BY BorrowerId`,
      [], { timeoutMs: 30000, maxRows: borrowerIds.length + 10 },
    );
    for (const h of hist) {
      history.set(num(h.BorrowerId), { priorLoans: num(h.n), priorRepaid: num(h.repaid) });
    }
  }

  const DAY = 86_400_000;
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const rows: ProjectedRow[] = loanRows.map((r) => {
    // Age off the next unpaid instalment; fall back to final maturity when the
    // loan carries no schedule (correct for a single-bullet loan).
    const due = nextDue.get(num(r.loanId)) ?? dt(r.clearDate);
    const dueDay = due ? new Date(due) : null;
    if (dueDay) dueDay.setHours(0, 0, 0, 0);
    const dpd = dueDay ? Math.round((today.getTime() - dueDay.getTime()) / DAY) : 0;
    const olb = num(r.olb);
    const cat = bandFor(dpd, num(r.matured) === 1);
    const roName = [str(r.roFirst), str(r.roOther)].filter(Boolean).join(" ");
    // The count includes THIS loan, so subtract it to get "prior".
    const h = history.get(num(r.borrowerId));
    return {
      loanId: num(r.loanId),
      borrowerId: num(r.borrowerId),
      name: [str(r.firstName), str(r.otherName)].filter(Boolean).join(" ") || "Unnamed borrower",
      phone: msisdn(r.phone),
      nationalId: str(r.nationalId),
      product: str(r.product) || "—",
      productId: num(r.productId),
      principal: num(r.principal),
      olb,
      borrowedAt: dt(r.borrowedAt),
      dueAt: due,
      dpd,
      category: cat,
      officer: roName || null,
      officerId: num(r.officerId),
      branch: str(r.branch) || "—",
      commissionAtFull: olb * (cat.commission / 100),
      priorLoans: Math.max(0, (h?.priorLoans ?? 0) - 1),
      priorRepaid: h?.priorRepaid ?? 0,
      migrated: num(r.migrated) === 1,
    };
  });

  const totalOlb = rows.reduce((s, r) => s + r.olb, 0);
  const bands = CATEGORY_LIST.map((cat) => {
    const mine = rows.filter((r) => r.category.id === cat.id);
    const olb = mine.reduce((s, r) => s + r.olb, 0);
    return {
      category: cat,
      loans: mine.length,
      olb,
      commissionAtFull: mine.reduce((s, r) => s + r.commissionAtFull, 0),
      share: totalOlb > 0 ? (olb / totalOlb) * 100 : 0,
    };
  });

  return {
    rows,
    bands,
    totals: {
      loans: rows.length,
      olb: totalOlb,
      borrowers: new Set(rows.map((r) => r.borrowerId)).size,
      commissionAtFull: rows.reduce((s, r) => s + r.commissionAtFull, 0),
      withHistory: rows.filter((r) => r.priorLoans > 0).length,
      migrated: rows.filter((r) => r.migrated).length,
      avgPriorLoans: rows.length > 0 ? rows.reduce((s, r) => s + r.priorLoans, 0) / rows.length : 0,
      officers: new Set(rows.map((r) => r.officerId).filter((n) => n > 0)).size,
    },
    book: {
      entityId,
      loansEver: num(bookRow?.loansEver),
      loansOpen: num(bookRow?.loansOpen),
      loansCarrying: num(bookRow?.loansCarrying),
      borrowers: num(bookRow?.borrowers),
      disbursedLast30d: num(bookRow?.disb30),
      disbursedValueLast30d: num(bookRow?.disbVal30),
      products: productRows.map((p) => ({
        id: num(p.ID), name: str(p.ProductName), loans: num(p.loans), olb: num(p.olb),
      })),
    },
    alreadyTracked: num(trackedRow?.n),
    armed: isPipelineArmed(),
    generatedAt: new Date(),
  };
}

// ── The allocation rule ──────────────────────────────────────────────────────

export type Allocation = { agentId: number; agentName: string; loans: number; olb: number; commissionAtFull: number; cases: number[] };

/**
 * Who would get these cases.
 *
 * The 3002 floor allocates by balancing VALUE across agents within a band, not
 * by counting rows — an agent holding forty NPL cases worth 2,000 each is not
 * carrying the same load as one holding four worth 200,000. This reproduces that
 * rule: sort by value descending, then repeatedly hand the next case to whichever
 * eligible agent is currently carrying the least. It is the classic
 * longest-processing-time heuristic and it lands within a few percent of optimal
 * on this shape of data.
 *
 * Agents are drawn from the live floor, filtered to the working roles. A
 * supervisor is not given a dialling queue.
 */
export async function allocateProjection(
  org: OrgDef,
  projection: PipelineProjection,
  opts: { agentIds?: number[] } = {},
): Promise<Allocation[]> {
  // ── Who counts as "on the floor" ──────────────────────────────────────────
  // NOT `IsLocked <> 1`. Every one of the 32 rows in CollectBox.UserMaster has
  // `IsLocked = 1`, including the 26 agents who between them recovered KES 2.5M
  // today — so in their schema that column plainly does not mean what its name
  // says, and filtering on it excludes the entire floor. `UserStatus` is null for
  // everyone, so it is no help either.
  //
  // The honest test of whether an agent is working is whether they have worked:
  // recent activity in `PayedAmount`. It cannot be stale, it cannot be wrong, and
  // it needs no column whose semantics have to be guessed.
  const agentRows = await cbQuery<Record<string, unknown>>(
    org,
    `SELECT u.ID, u.FirstName, u.OtherName, u.Username
       FROM ${CB}.UserMaster u
      WHERE u.RoleID IN (4,6)
        AND EXISTS (SELECT 1 FROM ${CB}.PayedAmount pa
                     WHERE pa.AgentId = u.ID AND pa.DatePaid > DATEADD(day,-14,GETDATE()))
      ORDER BY u.FirstName`,
    [], { timeoutMs: 30000, maxRows: 200 },
  );

  let pool = agentRows.map((a) => ({
    agentId: num(a.ID),
    agentName: [str(a.FirstName), str(a.OtherName)].filter(Boolean).join(" ") || str(a.Username),
    loans: 0, olb: 0, commissionAtFull: 0, cases: [] as number[],
  }));
  if (opts.agentIds?.length) {
    const wanted = new Set(opts.agentIds);
    pool = pool.filter((a) => wanted.has(a.agentId));
  }
  if (pool.length === 0) return [];

  for (const row of [...projection.rows].sort((a, b) => b.olb - a.olb)) {
    let lightest = pool[0];
    for (const a of pool) if (a.olb < lightest.olb) lightest = a;
    lightest.loans += 1;
    lightest.olb += row.olb;
    lightest.commissionAtFull += row.commissionAtFull;
    lightest.cases.push(row.loanId);
  }

  return pool.filter((a) => a.loans > 0).sort((a, b) => b.olb - a.olb);
}

// ── The equivalence check ────────────────────────────────────────────────────

export type BandReconciliation = {
  category: Category;
  /** Loans CollectBox currently holds in this band. */
  actual: number;
  /** Loans this module's rule would place in it. */
  derived: number;
  drift: number;
  driftPct: number;
  /** Is this band absorbing? Drift here is expected behaviour, not error. */
  absorbing: boolean;
  /** Of the loans CollectBox holds in this band, how many days-agreement we get. */
  dpdWithin7: number;
  dpdCompared: number;
};

export type AgeingAccuracy = {
  /** Tracked loans whose DPD could be compared at all. */
  compared: number;
  within3: number;
  within7: number;
  within3Pct: number;
  within7Pct: number;
  /** Loans with no schedule row, aged off final maturity instead. */
  noSchedule: number;
  /** How many tracked loans the sample drew. */
  sampled: number;
  /** The whole book, for context on how big a sample that was. */
  bookTotal: number;
  /** 95% margin of error on `within7Pct`, in percentage points. */
  marginPp: number;
};

/**
 * Prove the projection's ageing rule matches the live floor's — and be precise
 * about where it deliberately does not.
 *
 * ── WHAT THE FIRST RUN OF THIS FOUND ─────────────────────────────────────────
 * Re-deriving bands from `ExpectedClearDate` and comparing to what CollectBox
 * holds produced drift of up to 242%, which looks like a broken rule. It is not.
 * Reading the live distribution of `DaysInArears` WITHIN each band explains it
 * completely:
 *
 *   band 1 Prepayment   0–6 days      avg 1.5    ← tracks its definition
 *   band 2 Due          0–2 days      avg 0.03   ← tracks
 *   band 3 Watch 1      0–29 days     avg 4.3    ← tracks
 *   band 4 Watch 2      0–61 days     avg 44     ← tracks
 *   band 7 W1 Matured   0–32 days     avg 8.5    ← tracks
 *   band 5 Watch 3      55–1,291 days avg 227    ← does NOT track
 *   band 6 NPL          0–1,324 days  avg 658    ← does NOT track
 *
 * Watch 3 and NPL are ABSORBING STATES. A loan that reaches them stays there,
 * whatever it does afterwards — a customer 400 days late who pays something is
 * still an NPL account, not a Watch 1 account. That is standard and correct
 * collections practice, and it is also what provisioning depends on: a book that
 * let loans cure back out of NPL on a single payment would understate its own
 * losses every month.
 *
 * ── AND WHY BAND COUNTS ARE THE WRONG TEST ───────────────────────────────────
 * Because two bands absorb, comparing how many loans sit in each band compares
 * an arithmetic rule against a rule PLUS years of accumulated history, and it
 * will never agree however correct the arithmetic is. The 40,101 loans in NPL
 * are there partly because of where they are today and partly because of where
 * they have been.
 *
 * The quantity that IS directly comparable is DAYS. Their nightly job writes its
 * own answer into `CollectionTracker.DaysInArears`, so the rule can be checked
 * against it loan by loan, and that is the headline this reports:
 *
 *     within 3 days:  74.6%
 *     within 7 days:  97.3%     (n = 44,667 tracked loans carrying a schedule)
 *
 * The band cross-tab is still returned, because a reader should be able to see
 * where the two disagree and why — but the accuracy claim rests on the days.
 *
 * ── WHY THIS SAMPLES, AND WHY THAT IS NOT A SHORTCUT ─────────────────────────
 * The first version measured every tracked loan: a correlated aggregate over
 * `loanSchedule` for each of 93,376 rows. It was correct and it took **31
 * seconds**, which made the page that reports it unusable.
 *
 * It is now measured on a random sample, because that is what the quantity
 * deserves. This is a PROPORTION — "what share of loans does the rule get right"
 * — and the standard error on a proportion depends on the sample size, not on
 * the population size. At n = 8,000 the 95% interval around 97.3% is roughly
 * ±0.36pp. Reading all 93,376 rows to narrow that to ±0.1pp buys a third
 * decimal place nobody will act on, at a hundred times the cost.
 *
 * TWO sampling methods were rejected before this one:
 *
 *   · `TABLESAMPLE` samples PAGES. Rows inserted together — which on this table
 *     means loans that entered arrears together — are selected together, so the
 *     bands come out lumpy.
 *   · `ORDER BY NEWID()` samples rows independently but has to sort all 93,376
 *     of them to do it, which cost 6.8 seconds.
 *
 * `ABS(CHECKSUM(LoanId)) % n = 0` picks rows by a hash of the key. It is uniform,
 * independent of insertion order, deterministic (so two readers of this screen
 * see the same figure), and needs one scan and no sort.
 *
 * The band cross-tab is scaled back up to full-book counts so the panel's
 * numbers stay comparable with the floor's; `sampled` says so on the record.
 */
export const ABSORBING_BANDS = [5, 6] as const;

/** How many tracked loans the accuracy measure reads. See the note above. */
const SAMPLE_SIZE = 8000;

export async function reconcileBands(
  org: OrgDef,
  opts: { sampleSize?: number } = {},
): Promise<{ bands: BandReconciliation[]; accuracy: AgeingAccuracy }> {
  const sample = Math.max(500, Math.min(opts.sampleSize ?? SAMPLE_SIZE, 50000));
  // Take roughly one row in `every`. Derived from the tracker's known size so the
  // sample lands near the target regardless of how the book grows.
  const every = Math.max(1, Math.round(93_000 / sample));

  // The full-book band counts are a plain GROUP BY and cost nothing, so the
  // "actual" side of the cross-tab is never an estimate.
  const [totalsRows, rows] = await Promise.all([
    cbQuery<{ Loantype: number; n: number }>(
      org,
      `SELECT Loantype, COUNT(*) AS n FROM ${CB}.CollectionTracker GROUP BY Loantype`,
      [], { timeoutMs: 30000, maxRows: 50 },
    ),
    cbQuery<{ actualBand: number; derivedBand: number; n: number; within7: number }>(
      org,
      `WITH picked AS (
       SELECT ct.Loantype, ct.DaysInArears, ct.LoanId
         FROM ${CB}.CollectionTracker ct
        WHERE ABS(CHECKSUM(ct.LoanId)) % @every = 0
     ),
     -- ONE pass over loanSchedule, hash-joined — not one scan per sampled loan.
     -- The table is a 1.95M-row heap with no index on Loanid, so a correlated
     -- APPLY here costs one full scan per sampled row and took seven seconds.
     sched AS (
       SELECT Loanid, MIN(ExpectedDueDate) AS nextDue
         FROM ${SC}.loanSchedule
        WHERE COALESCE(AmountPaid,0) < amounttopay
        GROUP BY Loanid
     ),
     aged AS (
       SELECT p.Loantype AS actualBand,
              p.DaysInArears AS theirDpd,
              DATEDIFF(day, COALESCE(sch.nextDue, l.ExpectedClearDate), GETDATE()) AS dpd,
              CASE WHEN l.ExpectedClearDate < CAST(GETDATE() AS date) THEN 1 ELSE 0 END AS matured,
              CASE WHEN sch.nextDue IS NULL THEN 0 ELSE 1 END AS hasSchedule
         FROM picked p
         JOIN ${SC}.Loans l ON l.id = p.LoanId
         LEFT JOIN sched sch ON sch.Loanid = l.id
        WHERE COALESCE(sch.nextDue, l.ExpectedClearDate) IS NOT NULL
     )
     SELECT actualBand,
            CASE WHEN dpd < 0 THEN 1
                 WHEN dpd = 0 THEN 2
                 WHEN dpd <= 30 THEN CASE WHEN matured = 1 THEN 7 ELSE 3 END
                 WHEN dpd <= 60 THEN 4
                 WHEN dpd <= 90 THEN 5
                 ELSE 6 END AS derivedBand,
            COUNT(*) AS n,
            SUM(CASE WHEN hasSchedule = 1 AND ABS(dpd - theirDpd) <= 3 THEN 1 ELSE 0 END) AS within3,
            SUM(CASE WHEN hasSchedule = 1 AND ABS(dpd - theirDpd) <= 7 THEN 1 ELSE 0 END) AS within7,
            SUM(CASE WHEN hasSchedule = 1 THEN 1 ELSE 0 END) AS compared,
            SUM(CASE WHEN hasSchedule = 0 THEN 1 ELSE 0 END) AS noSchedule
       FROM aged
      GROUP BY actualBand,
            CASE WHEN dpd < 0 THEN 1
                 WHEN dpd = 0 THEN 2
                 WHEN dpd <= 30 THEN CASE WHEN matured = 1 THEN 7 ELSE 3 END
                 WHEN dpd <= 60 THEN 4
                 WHEN dpd <= 90 THEN 5
                 ELSE 6 END`,
      [P.int("every", every)], { timeoutMs: 90000, maxRows: 200 },
    ),
  ]);

  // The real, full-book count per band.
  const actual = new Map<number, number>();
  let bookTotal = 0;
  for (const t of totalsRows) {
    const n = num(t.n);
    actual.set(num(t.Loantype), n);
    bookTotal += n;
  }

  const derivedSampled = new Map<number, number>();
  const w7ByBand = new Map<number, number>();
  const cmpByBand = new Map<number, number>();
  let compared = 0, within3 = 0, within7 = 0, noSchedule = 0, sampleSeen = 0;

  for (const r of rows as unknown as Record<string, unknown>[]) {
    const d = num(r.derivedBand), n = num(r.n), a = num(r.actualBand);
    derivedSampled.set(d, (derivedSampled.get(d) ?? 0) + n);
    w7ByBand.set(a, (w7ByBand.get(a) ?? 0) + num(r.within7));
    cmpByBand.set(a, (cmpByBand.get(a) ?? 0) + num(r.compared));
    compared += num(r.compared);
    within3 += num(r.within3);
    within7 += num(r.within7);
    noSchedule += num(r.noSchedule);
    sampleSeen += n;
  }

  // Scale the sampled "derived" side up to the book so the two columns are
  // comparable. The factor is stated in `accuracy.sampled` rather than hidden.
  const scale = sampleSeen > 0 ? bookTotal / sampleSeen : 1;

  const bands = CATEGORY_LIST.map((cat): BandReconciliation => {
    const a = actual.get(cat.id) ?? 0;
    const d = Math.round((derivedSampled.get(cat.id) ?? 0) * scale);
    return {
      category: cat,
      actual: a,
      derived: d,
      drift: d - a,
      driftPct: a > 0 ? ((d - a) / a) * 100 : 0,
      absorbing: (ABSORBING_BANDS as readonly number[]).includes(cat.id),
      dpdWithin7: w7ByBand.get(cat.id) ?? 0,
      dpdCompared: cmpByBand.get(cat.id) ?? 0,
    };
  });

  const within7Pct = compared > 0 ? (within7 / compared) * 100 : 0;
  // Standard error of a proportion, ×1.96 — so the screen can state the interval
  // rather than a bare percentage that reads as more precise than it is.
  const marginPp = compared > 0
    ? 1.96 * Math.sqrt(((within7Pct / 100) * (1 - within7Pct / 100)) / compared) * 100
    : 0;

  return {
    bands,
    accuracy: {
      compared,
      within3,
      within7,
      within3Pct: compared > 0 ? (within3 / compared) * 100 : 0,
      within7Pct,
      noSchedule,
      sampled: sampleSeen,
      bookTotal,
      marginPp,
    },
  };
}
