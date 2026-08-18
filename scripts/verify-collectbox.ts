// ─────────────────────────────────────────────────────────────────────────────
// VERIFY THE COLLECTIONS BRIDGE — run it against the live server.
//
//   DOTENV_CONFIG_PATH=.env npx tsx scripts/verify-collectbox.ts
//
// It reads only. It proves four things, in order, and stops at the first that
// fails, because each one makes the next meaningful:
//
//   1. CollectBox is reachable through the org's ServiceSuite pool.
//   2. The taxonomy this codebase mirrors still matches theirs.
//   3. The cross-database joins resolve — the claim the whole suite rests on.
//   4. The floor, the queue and a case file all return live rows.
//
// A green run is the evidence behind every number ConnectDesk puts on screen.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { collectBoxOrg, cbOne, cbQuery, CB, SC, num } from "../src/lib/collectbox/client";
import { verifyTaxonomy, CATEGORY_LIST, DISPOSITION_LIST } from "../src/lib/collectbox/taxonomy";
import { getFloorSummary, getQueue, getCase, listBranches } from "../src/lib/collectbox/floor";

const money = (n: number) => `KES ${n.toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;
const ok = (s: string) => console.log(`  \x1b[32m✓\x1b[0m ${s}`);
const bad = (s: string) => console.log(`  \x1b[31m✗\x1b[0m ${s}`);
const head = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`);

let failures = 0;

async function main() {
  head("1 · Reachability");
  const org = collectBoxOrg("micromart");
  ok(`org resolved: ${org.name} (${org.connEnv})`);

  const ping = await cbOne<{ server: string; dbs: number; trackerRows: number }>(
    org,
    `SELECT @@SERVERNAME AS server,
            (SELECT COUNT(*) FROM sys.databases WHERE name IN ('CollectBox','Serviceconnect','Transactions')) AS dbs,
            (SELECT COUNT(*) FROM ${CB}.CollectionTracker) AS trackerRows`,
  );
  if (!ping || num(ping.dbs) < 3) { bad("CollectBox / Serviceconnect / Transactions not all visible"); failures++; return; }
  ok(`server "${ping.server}" · 3 databases visible · ${num(ping.trackerRows).toLocaleString()} tracked loans`);

  head("2 · Taxonomy parity");
  const drift = await verifyTaxonomy(org);
  if (drift.length === 0) {
    ok(`${CATEGORY_LIST.length} categories and ${DISPOSITION_LIST.length} dispositions match the live tables`);
  } else {
    for (const d of drift) bad(`${d.kind} ${d.id}: ours="${d.ours ?? "—"}" theirs="${d.theirs ?? "—"}"`);
    failures += drift.length;
  }

  head("3 · Cross-database joins");
  const joins = await cbOne<{ trk: number; trkOrphan: number; calls: number; callOrphan: number; pay: number; payOrphan: number }>(
    org,
    `SELECT
       (SELECT COUNT(*) FROM ${CB}.CollectionTracker) AS trk,
       (SELECT COUNT(*) FROM ${CB}.CollectionTracker ct LEFT JOIN ${SC}.Loans l ON l.id=ct.LoanId WHERE l.id IS NULL) AS trkOrphan,
       (SELECT COUNT(*) FROM ${CB}.CallLogs WHERE CreatedDate > '2025-01-01') AS calls,
       (SELECT COUNT(*) FROM ${CB}.CallLogs cl LEFT JOIN ${SC}.Loans l ON l.id=cl.RecordID WHERE cl.CreatedDate > '2025-01-01' AND l.id IS NULL) AS callOrphan,
       (SELECT COUNT(*) FROM ${CB}.PayedAmount WHERE DatePaid > DATEADD(day,-30,GETDATE())) AS pay,
       (SELECT COUNT(*) FROM ${CB}.PayedAmount pa LEFT JOIN ${SC}.Loans l ON l.id=pa.LoanId WHERE pa.DatePaid > DATEADD(day,-30,GETDATE()) AND l.id IS NULL) AS payOrphan`,
    [], { timeoutMs: 60000 },
  );
  const j = (label: string, total: number, orphan: number) => {
    const pct = total ? ((total - orphan) / total) * 100 : 0;
    if (orphan === 0) ok(`${label}: ${total.toLocaleString()} rows, 0 orphans (100%)`);
    else if (pct >= 99) ok(`${label}: ${total.toLocaleString()} rows, ${orphan} orphans (${pct.toFixed(2)}%)`);
    else { bad(`${label}: only ${pct.toFixed(1)}% resolve — ${orphan.toLocaleString()} orphans`); failures++; }
  };
  j("CollectionTracker.LoanId → Loans.id", num(joins?.trk), num(joins?.trkOrphan));
  j("CallLogs.RecordID → Loans.id (2025+)", num(joins?.calls), num(joins?.callOrphan));
  j("PayedAmount.LoanId → Loans.id (30d)", num(joins?.pay), num(joins?.payOrphan));

  head("4 · The floor");
  const t0 = Date.now();
  const floor = await getFloorSummary(org);
  ok(`summary in ${Date.now() - t0}ms`);
  console.log(`     tracked ${floor.totals.loans.toLocaleString()} loans · OLB ${money(floor.totals.olb)}`);
  console.log(`     today: ${floor.totals.paymentsToday.toLocaleString()} payments · ${money(floor.totals.recoveredToday)} · ${floor.totals.agentsOnFloor} agents · ${floor.totals.callsToday} calls`);
  console.log(`     tracker last written ${floor.trackerLastWrite?.toISOString() ?? "never"}`);
  console.log(`     last payment        ${floor.lastPaymentAt?.toISOString() ?? "never"}`);
  for (const b of floor.bands) {
    console.log(`     ${b.category.short.padEnd(4)} ${String(b.loans).padStart(6)} loans  OLB ${money(b.olb).padStart(18)}  recovered today ${money(b.recoveredToday)}`);
  }
  if (floor.totals.loans === 0) { bad("the floor is empty — that should not be possible"); failures++; }

  head("5 · The queue");
  const t1 = Date.now();
  const queue = await getQueue(org, { sort: "value", limit: 5 });
  ok(`${queue.length} rows in ${Date.now() - t1}ms`);
  for (const r of queue) {
    console.log(`     #${r.loanId} ${r.name.padEnd(28).slice(0, 28)} ${r.category.short.padEnd(4)} ${String(r.dpd).padStart(4)}d  OLB ${money(r.olb).padStart(14)}  agent ${r.agentName ?? "—"}`);
    console.log(`         officer ${r.officer ?? "—"} · branch ${r.branch} · ${r.callCount} calls · recovered 30d ${money(r.recovered30d)}`);
  }
  if (queue.length === 0) { bad("queue returned nothing"); failures++; }

  head("6 · A case file");
  if (queue[0]) {
    const t2 = Date.now();
    const c = await getCase(org, queue[0].loanId);
    if (!c) { bad("case file did not load"); failures++; }
    else {
      ok(`case for ${c.borrower.name} in ${Date.now() - t2}ms`);
      console.log(`     ${c.totals.loansTotal} loans · ${c.totals.loansCleared} cleared · taken ${money(c.totals.taken)} · outstanding ${money(c.totals.outstanding)}`);
      console.log(`     officer ${c.borrower.officer ?? "—"} (${c.borrower.officerPhone ?? "no number"}) · score ${c.borrower.creditScore} · limit ${money(c.borrower.loanLimit)}`);
    }
  }

  head("7 · Branches");
  const branches = await listBranches(org);
  ok(`${branches.length} branches carrying tracked loans`);
  for (const b of branches.slice(0, 6)) console.log(`     ${b.name.padEnd(22).slice(0, 22)} ${String(b.loans).padStart(6)} loans  ${money(b.olb)}`);

  head(failures === 0 ? "\x1b[32mALL CHECKS PASSED\x1b[0m" : `\x1b[31m${failures} CHECK(S) FAILED\x1b[0m`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(`\n\x1b[31mFATAL\x1b[0m ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
