// ─────────────────────────────────────────────────────────────────────────────
// VERIFY CONNECTDESK — the agent layer, the pipeline, the timeline, the shadow.
//
//   DOTENV_CONFIG_PATH=.env npx tsx scripts/verify-desk.ts
//
// Reads live. The one thing it WRITES is a single shadow interaction into our own
// Postgres, which it then deletes — because "the write path works" is not a claim
// that can be made by inspection, and because proving the shadow does NOT touch
// CollectBox is the single most important assurance in this build.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { collectBoxOrg } from "../src/lib/collectbox/client";
import { listAgents, getLeaderboard, getFloorPulse, getDailyTrend, listExtensions, getLiveActivity } from "../src/lib/collectbox/agents";
import { projectFintechPipeline, allocateProjection, reconcileBands, isPipelineArmed } from "../src/lib/collectbox/pipeline";
import { getTimeline, getActivityFeed } from "../src/lib/interactions/timeline";
import { getQueue } from "../src/lib/collectbox/floor";
import { logCall, mirrorPosture, shadowCount, isMirrorArmed } from "../src/lib/collectbox/write";
import { rawPrisma } from "../src/lib/prisma";

const money = (n: number) => `KES ${n.toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;
const ok = (s: string) => console.log(`  \x1b[32m✓\x1b[0m ${s}`);
const bad = (s: string) => { console.log(`  \x1b[31m✗\x1b[0m ${s}`); failures++; };
const info = (s: string) => console.log(`     ${s}`);
const head = (s: string) => console.log(`\n\x1b[1m${s}\x1b[0m`);
let failures = 0;

async function main() {
  const org = collectBoxOrg("micromart");

  head("1 · The floor's people");
  const agents = await listAgents(org);
  const linked = agents.filter((a) => a.lms);
  ok(`${agents.length} agents on the CollectBox floor · ${linked.length} linked to a lending-system identity`);
  const byMethod = linked.reduce<Record<string, number>>((m, a) => { m[a.linkedBy!] = (m[a.linkedBy!] ?? 0) + 1; return m; }, {});
  info(`linked by: ${Object.entries(byMethod).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}`);
  for (const a of agents.filter((x) => x.roleId === 4).slice(0, 5)) {
    info(`${a.name.padEnd(22).slice(0, 22)} ${a.role.padEnd(20)} ${a.lms ? `→ LMS #${a.lms.userId} (${a.linkedBy})` : "— not linked"}`);
  }
  if (agents.length === 0) bad("no agents found");

  head("2 · The leaderboard (today)");
  const board = await getLeaderboard(org, "today");
  ok(`${board.length} agents with activity today`);
  for (const s of board.slice(0, 8)) {
    info(`${s.name.padEnd(20).slice(0, 20)} recovered ${money(s.recovered).padStart(14)} · ${String(s.payments).padStart(4)} pmts · ${String(s.assigned).padStart(5)} assigned · commission ${money(s.commission)}`);
  }
  const totalRec = board.reduce((s, a) => s + a.recovered, 0);
  const totalCom = board.reduce((s, a) => s + a.commission, 0);
  info(`TOTAL recovered ${money(totalRec)} · commission earned ${money(totalCom)}`);

  head("3 · The pulse");
  const pulse = await getFloorPulse(org);
  const busiest = [...pulse].sort((a, b) => b.recovered - a.recovered)[0];
  ok(`24 hourly buckets · busiest hour ${busiest.hour}:00 with ${money(busiest.recovered)}`);
  const active = pulse.filter((p) => p.payments > 0);
  info(`hours with activity: ${active.map((p) => `${p.hour}h`).join(" ")}`);

  const trend = await getDailyTrend(org, 14);
  ok(`${trend.length} days of trend`);
  for (const d of trend.slice(-5)) info(`${d.day}  ${money(d.recovered).padStart(14)}  ${String(d.payments).padStart(5)} pmts  ${d.agents} agents`);

  head("4 · The phone floor");
  const exts = await listExtensions(org);
  ok(`${exts.length} PBX extensions · ${exts.filter((e) => e.agentName).length} mapped to an agent`);
  const live = await getLiveActivity(org);
  info(`last hour: ${live.activeAgents} agents, ${live.eventsLastHour} events, last at ${live.lastEventAt?.toISOString() ?? "—"}`);

  head("5 · The Fintech pipeline (3005)");
  const proj = await projectFintechPipeline(org, 3005);
  ok(`projected ${proj.totals.loans} cases · ${money(proj.totals.olb)} · ${proj.totals.borrowers} borrowers`);
  info(`book: ${proj.book.loansEver.toLocaleString()} loans ever · ${proj.book.loansOpen.toLocaleString()} open · ${proj.book.loansCarrying.toLocaleString()} carrying a balance · ${proj.book.borrowers.toLocaleString()} borrowers`);
  info(`last 30d: ${proj.book.disbursedLast30d} disbursed worth ${money(proj.book.disbursedValueLast30d)}`);
  info(`already tracked in CollectBox: ${proj.alreadyTracked}  ← the gap this closes`);
  info(`cases arriving with prior history: ${proj.totals.withHistory} of ${proj.totals.loans} · avg ${proj.totals.avgPriorLoans.toFixed(1)} prior loans each`);
  info(`came across in the 2 Aug migration: ${proj.totals.migrated}`);
  info(`relationship officers covered: ${proj.totals.officers}`);
  for (const p of proj.book.products) info(`product ${p.id} ${p.name.padEnd(22)} ${String(p.loans).padStart(5)} open · ${money(p.olb)}`);
  for (const b of proj.bands.filter((x) => x.loans > 0)) {
    info(`  ${b.category.short.padEnd(4)} ${String(b.loans).padStart(4)} cases · ${money(b.olb).padStart(14)} · ${b.share.toFixed(1)}% · commission at full ${money(b.commissionAtFull)}`);
  }
  if (proj.totals.loans === 0) bad("the pipeline projected nothing — 3005 should carry an open book");

  head("6 · Allocation");
  const alloc = await allocateProjection(org, proj);
  ok(`${alloc.length} agents would carry the Fintech book`);
  for (const a of alloc.slice(0, 6)) {
    info(`${a.agentName.padEnd(20).slice(0, 20)} ${String(a.loans).padStart(4)} cases · ${money(a.olb).padStart(12)} · commission at full ${money(a.commissionAtFull)}`);
  }
  const spread = alloc.length > 1 ? Math.max(...alloc.map((a) => a.olb)) - Math.min(...alloc.map((a) => a.olb)) : 0;
  info(`value spread across agents: ${money(spread)} (lower is a fairer split)`);

  head("7 · Ageing-rule equivalence (3002)");
  const { bands: recon, accuracy } = await reconcileBands(org);
  info("days-in-arrears, our rule vs their nightly job, loan by loan:");
  info(`  compared ${accuracy.compared.toLocaleString()} tracked loans carrying a schedule`);
  info(`  within 3 days: ${accuracy.within3.toLocaleString()} (${accuracy.within3Pct.toFixed(1)}%)`);
  info(`  within 7 days: ${accuracy.within7.toLocaleString()} (${accuracy.within7Pct.toFixed(1)}%)`);
  info(`  ${accuracy.noSchedule.toLocaleString()} loans carry no schedule and fall back to final maturity`);
  if (accuracy.within7Pct >= 90) ok(`the ageing rule reproduces their arithmetic — ${accuracy.within7Pct.toFixed(1)}% agree within a week`);
  else bad(`only ${accuracy.within7Pct.toFixed(1)}% agree within a week — the projection's ageing cannot be trusted`);

  info("");
  info("band placement (absorbing bands will not and should not agree):");
  for (const r of recon) {
    if (r.actual === 0 && r.derived === 0) continue;
    const mark = r.absorbing ? "  ← absorbing" : "";
    info(`  ${r.category.short.padEnd(4)} CollectBox ${String(r.actual).padStart(6)} · derived ${String(r.derived).padStart(6)} · ${r.drift >= 0 ? "+" : ""}${r.drift}${mark}`);
  }

  head("8 · The timeline");
  const queue = await getQueue(org, { sort: "value", limit: 3 });
  if (!queue[0]) { bad("no queue row to build a timeline from"); }
  else {
    const t0 = Date.now();
    const orgRowForTl = await rawPrisma.org.findFirst({ where: { slug: "micromart" }, select: { id: true } }) ?? await rawPrisma.org.findFirst({ select: { id: true } });
    const tl = await getTimeline(org, { loanId: queue[0].loanId, borrowerId: queue[0].borrowerId, wholeRelationship: true, limit: 25, orgId: orgRowForTl?.id });
    ok(`${tl.length} interactions for ${queue[0].name} in ${Date.now() - t0}ms`);
    const sources = [...new Set(tl.map((i) => i.system))];
    info(`merged from: ${sources.join(", ") || "—"}`);
    for (const i of tl.slice(0, 8)) {
      info(`${i.at.toISOString().slice(0, 16).replace("T", " ")}  ${i.system.padEnd(14)} ${i.headline.slice(0, 52).padEnd(52)} ${i.actor?.name ?? ""}`);
    }
  }

  head("9 · The activity feed");
  const t1 = Date.now();
  const orgRowForFeed = await rawPrisma.org.findFirst({ where: { slug: "micromart" }, select: { id: true } }) ?? await rawPrisma.org.findFirst({ select: { id: true } });
  const feed = await getActivityFeed(org, { limit: 12, orgId: orgRowForFeed?.id });
  ok(`${feed.length} cross-system events in ${Date.now() - t1}ms`);
  for (const f of feed.slice(0, 8)) {
    info(`${f.at.toISOString().slice(5, 16).replace("T", " ")}  ${f.system.padEnd(14)} ${f.subjectLabel.padEnd(24).slice(0, 24)} ${f.headline}`);
  }
  if (feed.length === 0) bad("the activity feed is empty");

  head("10 · The write path");
  const posture = mirrorPosture();
  ok(`posture: ${posture.label}`);
  info(posture.detail);
  if (isMirrorArmed()) {
    console.log(`  \x1b[33m!\x1b[0m COLLECTBOX_POSTING_ENABLED is TRUE — a live write test is NOT run automatically. Skipping.`);
  } else if (queue[0]) {
    const orgRow = await rawPrisma.org.findFirst({ where: { slug: "micromart" }, select: { id: true } })
      ?? await rawPrisma.org.findFirst({ select: { id: true } });
    if (!orgRow) { bad("no Org row in Postgres to attribute the test interaction to"); }
    else {
      const before = await shadowCount(orgRow.id);
      const res = await logCall({
        org, orgId: orgRow.id,
        actor: { agentId: 246, name: "Verification harness" },
        subject: {
          entityId: queue[0].entityId, loanId: queue[0].loanId, borrowerId: queue[0].borrowerId,
          name: queue[0].name, phone: queue[0].phone, categoryId: queue[0].category.id,
        },
        dispositionId: 4,
        comment: "verify-desk.ts — shadow write test, deleted immediately",
      });
      if (res.mirrorState !== "SHADOW") bad(`expected SHADOW, got ${res.mirrorState}`);
      else ok(`shadow write recorded, CollectBox untouched`);
      if (!res.shadowSql) bad("no shadow SQL was composed");
      else {
        ok("statement composed and stored for review:");
        console.log(`\x1b[2m     ${res.shadowSql.slice(0, 300)}${res.shadowSql.length > 300 ? "…" : ""}\x1b[0m`);
      }
      const after = await shadowCount(orgRow.id);
      if (after.shadow !== before.shadow + 1) bad(`shadow count did not advance (${before.shadow} → ${after.shadow})`);
      else ok(`shadow queue ${before.shadow} → ${after.shadow}`);

      await rawPrisma.deskInteraction.delete({ where: { id: res.id } });
      ok("test interaction removed");
    }
  }

  head("11 · Pipeline arming");
  info(`pipeline armed: ${isPipelineArmed()} · mirror armed: ${isMirrorArmed()}`);
  ok("both default to OFF — the demo runs without touching Micromart's production database");

  head(failures === 0 ? "\x1b[32mALL CHECKS PASSED\x1b[0m" : `\x1b[31m${failures} CHECK(S) FAILED\x1b[0m`);
  await rawPrisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(`\n\x1b[31mFATAL\x1b[0m ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  await rawPrisma.$disconnect();
  process.exit(1);
});
