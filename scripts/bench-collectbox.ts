// ─────────────────────────────────────────────────────────────────────────────
// THE BENCHMARK — the same eight reads, timed, before and after indexing.
//
//   npx tsx scripts/bench-collectbox.ts
//
// These are not synthetic. They are the exact calls the six systems make on
// every page render, so the numbers here are the numbers a user experiences.
// Run it before `index-advisor --apply` and again after; the difference is the
// whole argument for touching a production schema at all.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { collectBoxOrg } from "../src/lib/collectbox/client";
import { getFloorSummary, getQueue, getCase, listBranches } from "../src/lib/collectbox/floor";
import { getLeaderboard, getFloorPulse, getDailyTrend } from "../src/lib/collectbox/agents";
import { projectFintechPipeline, reconcileBands } from "../src/lib/collectbox/pipeline";
import { getTimeline, getActivityFeed } from "../src/lib/interactions/timeline";

async function main() {
  const org = collectBoxOrg("micromart");
  const results: { name: string; ms: number; note: string }[] = [];

  const time = async (name: string, fn: () => Promise<unknown>, note = "") => {
    const t = Date.now();
    try {
      await fn();
      results.push({ name, ms: Date.now() - t, note });
    } catch (e) {
      results.push({ name, ms: -1, note: e instanceof Error ? e.message.slice(0, 60) : "failed" });
    }
  };

  // Warm the pool so the first measurement is not a TCP handshake.
  await getFloorSummary(org);

  await time("floor summary", () => getFloorSummary(org), "the live floor's four tiles + band rollup");
  await time("queue · 50 rows", () => getQueue(org, { sort: "value", limit: 50 }), "the work queue, page 1");
  await time("queue · untouched", () => getQueue(org, { untouchedToday: true, sort: "oldest-touch", limit: 50 }), "the anti-neglect sort");
  await time("leaderboard", () => getLeaderboard(org, "today"), "agent board, today");
  await time("floor pulse", () => getFloorPulse(org), "today by hour");
  await time("30-day trend", () => getDailyTrend(org, 30), "daily recovery");
  await time("branches", () => listBranches(org), "the branch filter");
  await time("activity feed", () => getActivityFeed(org, { limit: 40 }), "cross-system stream");
  await time("fintech projection", () => projectFintechPipeline(org, 3005), "the pipeline board");
  await time("ageing reconciliation", () => reconcileBands(org), "the accuracy panel");

  const q = await getQueue(org, { sort: "value", limit: 1 });
  if (q[0]) {
    await time("case file", () => getCase(org, q[0].loanId), "one customer, in full");
    await time("timeline · relationship", () => getTimeline(org, { loanId: q[0].loanId, borrowerId: q[0].borrowerId, wholeRelationship: true, limit: 100 }), "seven sources merged");
  }

  const total = results.filter((r) => r.ms > 0).reduce((s, r) => s + r.ms, 0);
  console.log(`\n\x1b[1mCOLLECTBOX READ BENCHMARK\x1b[0m  ${new Date().toISOString()}\n`);
  for (const r of results) {
    const bar = r.ms > 0 ? "█".repeat(Math.min(40, Math.ceil(r.ms / 100))) : "";
    const col = r.ms < 0 ? "\x1b[31m" : r.ms > 2000 ? "\x1b[31m" : r.ms > 500 ? "\x1b[33m" : "\x1b[32m";
    console.log(`  ${r.name.padEnd(24)} ${col}${String(r.ms < 0 ? "FAIL" : `${r.ms}ms`).padStart(8)}\x1b[0m  ${bar}`);
    if (r.note) console.log(`  ${"".padEnd(24)} \x1b[2m${r.note}\x1b[0m`);
  }
  console.log(`\n  TOTAL ${total}ms across ${results.filter((r) => r.ms > 0).length} reads\n`);
  process.exit(0);
}

main().catch((e) => {
  console.error(`FAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
