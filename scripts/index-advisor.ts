// ─────────────────────────────────────────────────────────────────────────────
// THE INDEX ADVISOR — what is missing, what it costs, and what it would fix.
//
//   npx tsx scripts/index-advisor.ts            # report only, changes nothing
//   npx tsx scripts/index-advisor.ts --apply    # create them, ONLINE
//   npx tsx scripts/index-advisor.ts --rollback # drop the ones we created
//
// ── WHY THIS IS A SEPARATE, DELIBERATE STEP ──────────────────────────────────
// These are Micromart's production databases with a live collections floor on
// them — 2,000 payments landed today. Adding an index is a safe, reversible,
// well-understood operation, but it is still a schema change to somebody else's
// running system, so it gets: evidence before action, ONLINE builds so nothing
// blocks, a named prefix so every object we created is identifiable, and a
// rollback that drops exactly those and nothing else.
//
// ── THE EVIDENCE, FROM THREE SOURCES ─────────────────────────────────────────
//   1. SQL Server's own missing-index DMVs. The engine records, for every plan
//      it compiles, the index it wished existed and how much it would have
//      saved. This is not a guess; it is the optimiser's own accounting.
//   2. Heaps carrying serious row counts. A heap has no clustered index, so
//      every lookup that is not covered is a full scan. `loanSchedule` is
//      1.95M rows and a heap.
//   3. The joins THIS platform actually runs. Measured, not assumed.
//
// ── WHAT IS DELIBERATELY NOT DONE ────────────────────────────────────────────
// No clustered indexes are added. Converting a heap to a clustered index
// rewrites the entire table, takes a schema-modification lock even ONLINE for
// the final swap, and changes physical ordering under queries nobody here has
// read. Nonclustered indexes are additive and cheap to reverse; that is the
// right size of change to make in somebody else's database.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import mssql from "mssql";
import { parseDotNetConnString } from "../src/lib/enterprise/connections";

const PREFIX = "IX_BAI_"; // every index this script creates carries it

type Plan = {
  db: string;
  table: string;
  name: string;
  keys: string;
  include?: string;
  why: string;
  /** What it unblocks in this platform. */
  fixes: string;
};

/**
 * The indexes this platform's own query patterns need.
 *
 * Every one of these was arrived at by measuring a slow query, not by reading a
 * schema and guessing. The `why` is the measurement.
 */
const PLANS: Plan[] = [
  {
    db: "Serviceconnect", table: "loanSchedule", name: `${PREFIX}loanSchedule_Loanid`,
    keys: "Loanid",
    include: "ExpectedDueDate, amounttopay, AmountPaid",
    why: "1,952,246-row HEAP with no index of any kind. Every lookup by Loanid is a full scan.",
    fixes: "Ageing a loan from its instalment schedule — the Fintech projection, the case file, and the band reconciliation. Was 8.6s for 62 loans.",
  },
  {
    db: "CollectBox", table: "CallLogs", name: `${PREFIX}CallLogs_RecordID_CreatedDate`,
    keys: "RecordID, CreatedDate DESC",
    include: "CallResponse, CallStatus, PromisedAmount, PromisedDate, CreatedBy, Comments",
    why: "1,342,610 rows. Every case file and every queue row asks 'when did anyone last call this loan'.",
    fixes: "The queue's last-contact column and the case timeline. Was 12.5s for a 50-row page.",
  },
  {
    db: "CollectBox", table: "PayedAmount", name: `${PREFIX}PayedAmount_LoanId_DatePaid`,
    keys: "LoanId, DatePaid DESC",
    include: "AmountPaid, AgentId, LoanCategory, MpesaCode",
    why: "1,149,026 rows and growing by ~2,000 a day. Recovery-per-loan is asked on every screen.",
    fixes: "'Paid in the last 30 days' on the queue, the case timeline, and the activity feed.",
  },
  {
    db: "CollectBox", table: "PayedAmount", name: `${PREFIX}PayedAmount_DatePaid_AgentId`,
    keys: "DatePaid, AgentId",
    include: "AmountPaid, LoanCategory, LoanId",
    why: "The leaderboard, the pulse and the daily trend all filter by date and group by agent.",
    fixes: "The live floor's agent board and the 30-day trend.",
  },
  {
    db: "CollectBox", table: "CollectionTracker", name: `${PREFIX}CollectionTracker_LoanId`,
    keys: "LoanId",
    include: "Loantype, DaysInArears, AgentAssigned, IsActioned, LastActionedDate, PtpDate, PtpStatus",
    why: "93,376 rows, joined to Serviceconnect.Loans on every queue read.",
    fixes: "The queue, the floor summary and the 'already tracked' pipeline check.",
  },
  {
    db: "CollectBox", table: "CollectionTracker", name: `${PREFIX}CollectionTracker_Agent_Type`,
    keys: "AgentAssigned, Loantype",
    include: "LoanId, IsActioned, LastActionedDate",
    why: "Filtering the queue by agent and band is the floor's most common operation.",
    fixes: "Agent queues and the band chips on the work queue.",
  },
  {
    db: "CollectBox", table: "PromisedToPay", name: `${PREFIX}PromisedToPay_RecordID`,
    keys: "RecordID, CreatedDate DESC",
    include: "PromisedAmount, PromisedDate, PaymentStatus, AmountPaid, CreatedBy",
    why: "150,345 rows. The promise board and every case timeline read it by loan.",
    fixes: "The promise board and the case file's promise history.",
  },
  {
    db: "CollectBox", table: "TaskScheduler", name: `${PREFIX}TaskScheduler_RecordId`,
    keys: "RecordId, CreatedDate DESC",
    include: "TaskAction, TaskDate, IsActive, Comments, CreatedBy",
    why: "48,945 rows, 30,713 of them still open, read by loan on every case file.",
    fixes: "Callbacks and field visits on the case timeline.",
  },
  {
    db: "Serviceconnect", table: "Loans", name: `${PREFIX}Loans_Entity_Cleared`,
    keys: "EntityId, LoanCleared",
    include: "BorrowerId, ProductId, LoanBalance, LoanAmount, BorrowDate, ExpectedClearDate",
    why: "334,292 rows across entities. Every per-entity book read filters on exactly this pair.",
    fixes: "The Fintech projection, the console's borrower list, and the analytics book reads.",
  },
];

const money = (n: number) => n.toLocaleString("en-KE", { maximumFractionDigits: 0 });

async function main() {
  const apply = process.argv.includes("--apply");
  const rollback = process.argv.includes("--rollback");

  const cfg = parseDotNetConnString(process.env.SERVICESUITE_CONN_MICROMART!);
  const pool = await new mssql.ConnectionPool(cfg).connect();
  const q = async <T = Record<string, unknown>>(s: string, timeout = 60000): Promise<T[]> => {
    const r = pool.request();
    (r as unknown as { timeout?: number }).timeout = timeout;
    return (await r.query(s)).recordset as T[];
  };

  const [me] = await q<{ dbowner: number; ddladmin: number; edition: number; server: string }>(
    `SELECT IS_ROLEMEMBER('db_owner') AS dbowner, IS_ROLEMEMBER('db_ddladmin') AS ddladmin,
            CAST(SERVERPROPERTY('EngineEdition') AS int) AS edition, @@SERVERNAME AS server`,
  );
  const online = Number(me.edition) === 3; // Enterprise
  console.log(`Server "${me.server}" · db_owner=${me.dbowner} ddladmin=${me.ddladmin} · ONLINE builds ${online ? "AVAILABLE" : "NOT available"}\n`);

  // ── Rollback ───────────────────────────────────────────────────────────────
  if (rollback) {
    console.log(`Dropping every index named ${PREFIX}*\n`);
    for (const db of ["Serviceconnect", "CollectBox", "Transactions"]) {
      const found = await q<{ tbl: string; idx: string }>(
        `SELECT t.name AS tbl, i.name AS idx
           FROM ${db}.sys.indexes i JOIN ${db}.sys.tables t ON t.object_id = i.object_id
          WHERE i.name LIKE '${PREFIX}%'`,
      );
      for (const f of found) {
        await q(`DROP INDEX [${f.idx}] ON ${db}.dbo.[${f.tbl}]`, 300000);
        console.log(`  dropped ${db}.dbo.${f.tbl} · ${f.idx}`);
      }
      if (found.length === 0) console.log(`  ${db}: nothing to drop`);
    }
    await pool.close();
    return;
  }

  // ── 1 · SQL Server's own accounting ────────────────────────────────────────
  console.log("\x1b[1m1 · What the optimiser says it is missing\x1b[0m");
  console.log("  (sys.dm_db_missing_index_* — the engine's own record of indexes it wished existed)\n");
  // The DMVs need VIEW SERVER STATE, which a least-privilege application login
  // rightly does not have. Its absence is not a problem — it is one of three
  // evidence sources and the other two need no special permission.
  const missing = await q<Record<string, unknown>>(`
    SELECT TOP 15
           DB_NAME(d.database_id) AS db,
           OBJECT_NAME(d.object_id, d.database_id) AS tbl,
           CAST(s.avg_total_user_cost * s.avg_user_impact * (s.user_seeks + s.user_scans) AS bigint) AS score,
           s.user_seeks, s.user_scans,
           CAST(s.avg_user_impact AS int) AS pctImprovement,
           d.equality_columns, d.inequality_columns, d.included_columns
      FROM sys.dm_db_missing_index_groups g
      JOIN sys.dm_db_missing_index_group_stats s ON s.group_handle = g.index_group_handle
      JOIN sys.dm_db_missing_index_details d ON d.index_handle = g.index_handle
     WHERE DB_NAME(d.database_id) IN ('Serviceconnect','CollectBox','Transactions')
     ORDER BY score DESC`).catch(() => {
    console.log("  [2mUnavailable - this login has no VIEW SERVER STATE, which is");
    console.log("  correct for a least-privilege application account. The heap survey and");
    console.log("  the measured query patterns below need no such right.[0m");
    console.log("");
    return [] as Record<string, unknown>[];
  });
  if (missing.length === 0) {
    /* explained above, or the DMVs are simply empty after a server restart */
  } else {
    for (const m of missing) {
      console.log(`  ${String(m.db).padEnd(15)} ${String(m.tbl).padEnd(26)} score ${money(Number(m.score)).padStart(12)}  ${m.pctImprovement}% faster  (${m.user_seeks} seeks, ${m.user_scans} scans)`);
      console.log(`      on: ${m.equality_columns ?? ""}${m.inequality_columns ? ` + ${m.inequality_columns}` : ""}${m.included_columns ? `  include(${m.included_columns})` : ""}`);
    }
    console.log();
  }

  // ── 2 · Heaps ──────────────────────────────────────────────────────────────
  console.log("\x1b[1m2 · Heaps carrying real volume\x1b[0m");
  console.log("  (no clustered index — every uncovered lookup is a full scan)\n");
  for (const db of ["Serviceconnect", "CollectBox"]) {
    const heaps = await q<{ tbl: string; rows: number; idx: number }>(`
      SELECT t.name AS tbl, SUM(p.rows) AS rows,
             (SELECT COUNT(*) FROM ${db}.sys.indexes i2 WHERE i2.object_id = t.object_id AND i2.index_id > 0) AS idx
        FROM ${db}.sys.tables t
        JOIN ${db}.sys.indexes i ON i.object_id = t.object_id AND i.index_id = 0
        JOIN ${db}.sys.partitions p ON p.object_id = t.object_id AND p.index_id = 0
       GROUP BY t.name, t.object_id
      HAVING SUM(p.rows) > 50000
       ORDER BY SUM(p.rows) DESC`);
    for (const h of heaps) {
      const flag = Number(h.idx) === 0 ? "\x1b[31mNO INDEXES AT ALL\x1b[0m" : `${h.idx} nonclustered`;
      console.log(`  ${db}.${String(h.tbl).padEnd(24)} ${money(Number(h.rows)).padStart(11)} rows · ${flag}`);
    }
  }

  // ── 3 · The plan ───────────────────────────────────────────────────────────
  console.log(`\n\x1b[1m3 · The plan — ${PLANS.length} nonclustered indexes\x1b[0m\n`);
  const existing = new Set<string>();
  for (const db of ["Serviceconnect", "CollectBox"]) {
    const rows = await q<{ name: string }>(`SELECT i.name FROM ${db}.sys.indexes i WHERE i.name LIKE '${PREFIX}%'`);
    for (const r of rows) existing.add(r.name);
  }

  for (const p of PLANS) {
    const already = existing.has(p.name);
    console.log(`  ${already ? "\x1b[32m✓ exists\x1b[0m" : "\x1b[33m+ create\x1b[0m"}  ${p.db}.dbo.${p.table}`);
    console.log(`            ${p.name}`);
    console.log(`            keys: ${p.keys}${p.include ? `  include: ${p.include}` : ""}`);
    console.log(`            \x1b[2m${p.why}\x1b[0m`);
    console.log(`            \x1b[2mfixes: ${p.fixes}\x1b[0m\n`);
  }

  if (!apply) {
    console.log("  Report only. Nothing was changed.");
    console.log("  Run with --apply to create them, --rollback to remove them again.\n");
    await pool.close();
    return;
  }

  // ── 4 · Apply ──────────────────────────────────────────────────────────────
  console.log("\x1b[1m4 · Creating\x1b[0m");
  console.log(`  ONLINE = ${online ? "ON — readers and writers are never blocked" : "OFF — Enterprise not detected; builds will take a lock"}\n`);

  let made = 0, skipped = 0, failed = 0;
  for (const p of PLANS) {
    if (existing.has(p.name)) { console.log(`  \x1b[2m· skipped ${p.name} (already there)\x1b[0m`); skipped++; continue; }
    const sql = `CREATE NONCLUSTERED INDEX [${p.name}] ON ${p.db}.dbo.[${p.table}] (${p.keys})`
      + (p.include ? ` INCLUDE (${p.include})` : "")
      + ` WITH (ONLINE = ${online ? "ON" : "OFF"}, SORT_IN_TEMPDB = ON, DATA_COMPRESSION = PAGE, MAXDOP = 2)`;
    const started = Date.now();
    try {
      await q(sql, 900000); // fifteen minutes — a 2M-row build is not instant
      console.log(`  \x1b[32m✓\x1b[0m ${p.name.padEnd(44)} ${((Date.now() - started) / 1000).toFixed(1)}s`);
      made++;
    } catch (e) {
      console.log(`  \x1b[31m✗\x1b[0m ${p.name}: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
      failed++;
    }
  }

  console.log(`\n  ${made} created · ${skipped} already present · ${failed} failed`);
  if (made > 0) {
    console.log(`\n  Every index created carries the ${PREFIX} prefix.`);
    console.log(`  To reverse: npx tsx scripts/index-advisor.ts --rollback`);
  }
  await pool.close();
}

main().catch((e) => {
  console.error(`\nFAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
