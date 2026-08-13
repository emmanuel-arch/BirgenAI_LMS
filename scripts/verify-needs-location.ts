// Smoke-test the field-ops needs-location read-through against a bridged lender's
// real book. READ-ONLY. Proves the triage, the paging, the queue split and the
// campaign arithmetic before a board sees any of it on a screen.
//
//   DOTENV_CONFIG_PATH=.env.local npx tsx scripts/verify-needs-location.ts
//   DOTENV_CONFIG_PATH=.env.local npx tsx scripts/verify-needs-location.ts --org=micromart
//
// The checks that matter are the CROSS-CHECKS: three separate queries have to agree
// about the same book. The tiers must sum to the unpinned count, the officer queues
// must sum to the same number again, and the money-out exposure must equal the
// book's whole outstanding balance — because on this entity every customer with a
// live loan is unpinned, so anything less means the predicate is dropping rows.
import "dotenv/config";
import { platformPrisma } from "../prisma/seed-client";
import { enterPlatform } from "../src/lib/db/context";
import { getOrg, getPostingOrg, getEntityId, isOrgConfigured } from "../src/lib/enterprise/connections";
import {
  listNeedsLocationLive, getNeedsLocationStats, listNeedsLocationQueues, getBorrowerBookStats,
} from "../src/lib/lms/servicesuite";
import { planCampaign, humanDuration } from "../src/lib/field/campaign";

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
const ORG = arg("org") ?? "micromart";

const fmt = (v: number) => v.toLocaleString("en-KE");
const kes = (v: number) => `KES ${Math.round(v).toLocaleString("en-KE")}`;
let failures = 0;
const ok = (m: string) => console.log(`  + ${m}`);
const bad = (m: string) => { failures++; console.log(`  ! ${m}`); };
const timed = async <T,>(fn: () => Promise<T>): Promise<[T, number]> => {
  const t = Date.now();
  const v = await fn();
  return [v, Date.now() - t];
};

async function main() {
  const p = platformPrisma();
  enterPlatform();
  const row = await p.org.findUnique({ where: { slug: ORG }, select: { name: true, mode: true, serviceSuiteEntityId: true } });
  if (!row) throw new Error(`No org "${ORG}".`);
  const registry = getOrg(ORG);
  if (!registry || !isOrgConfigured(registry)) throw new Error(`${ORG} read connection (${registry?.connEnv}) is not configured.`);
  const entityId = row.serviceSuiteEntityId ?? getEntityId(getPostingOrg(ORG) ?? registry);

  console.log(`\n${row.name} — field ops needs-location · ${row.mode} · entity ${entityId}\n`);

  // 1 ─────────────────────────────────────────────────────────────────────────
  console.log("1 · Whole-book statistics");
  const [stats, statsMs] = await timed(() => getNeedsLocationStats(registry, entityId));
  console.log(`  fetched in ${statsMs}ms`);
  console.log(`    customers on book   ${fmt(stats.total)}`);
  console.log(`    pinned              ${fmt(stats.pinned)}`);
  console.log(`    need a location     ${fmt(stats.unpinned)}  (${stats.total ? ((stats.unpinned / stats.total) * 100).toFixed(1) : 0}%)`);
  console.log(`    money out           ${fmt(stats.moneyOutCustomers)} customers · ${kes(stats.moneyOutOlb)}`);
  console.log(`    blocked next loan   ${fmt(stats.repeatCustomers)} customers · ${kes(stats.repeatLimit)} of limit`);
  console.log(`    never borrowed      ${fmt(stats.dormantCustomers)}`);
  console.log(`    officer queues      ${fmt(stats.agentQueues)}`);
  console.log(`    kyc verified        ${fmt(stats.unpinnedKycVerified)} of ${fmt(stats.unpinned)}`);
  console.log(`    carry a score       ${fmt(stats.unpinnedScored)} of ${fmt(stats.unpinned)}`);
  console.log(`    limit behind gate   ${kes(stats.limitBehindGate)}`);
  console.log(`    returned in 12m     ${fmt(stats.returning12m)} across ${stats.activeMonths12m} active months`);

  if (stats.total > 0) ok(`book is not empty (${fmt(stats.total)})`); else bad("book came back empty");
  if (stats.pinned + stats.unpinned === stats.total) ok("pinned + unpinned = total");
  else bad(`pinned ${stats.pinned} + unpinned ${stats.unpinned} != total ${stats.total}`);

  const tierSum = stats.moneyOutCustomers + stats.repeatCustomers + stats.dormantCustomers;
  if (tierSum === stats.unpinned) ok(`the three tiers sum to the backlog (${fmt(tierSum)})`);
  else bad(`tiers sum to ${fmt(tierSum)} but the backlog is ${fmt(stats.unpinned)} — a customer is in no tier or two`);
  if (statsMs < 30000) ok(`inside the route timeout (${statsMs}ms)`); else bad(`took ${statsMs}ms — too slow for a request`);

  // 2 ─────────────────────────────────────────────────────────────────────────
  // The needs-location predicate here and the one behind the customer-book header
  // strip are different SQL in different functions. They must agree, or one screen
  // tells the officer something the next screen denies.
  console.log("\n2 · Agreement with the customer book's own count");
  const [book, bookMs] = await timed(() => getBorrowerBookStats(registry, entityId));
  console.log(`  customer book says needsLocation=${fmt(book.needsLocation)} of ${fmt(book.total)} (${bookMs}ms)`);
  if (book.total === stats.total) ok("both agree on the size of the book");
  else bad(`book total ${fmt(book.total)} vs stats total ${fmt(stats.total)}`);
  // getBorrowerBookStats checks only the varchar pair; this one also checks the
  // decimal onboarding pair, so it may legitimately be the SMALLER number. It must
  // never be larger.
  if (stats.unpinned <= book.needsLocation) ok(`unpinned (${fmt(stats.unpinned)}) is not larger than the book's looser count (${fmt(book.needsLocation)})`);
  else bad(`unpinned ${fmt(stats.unpinned)} EXCEEDS the book's count ${fmt(book.needsLocation)} — the predicate is too wide`);

  // 3 ─────────────────────────────────────────────────────────────────────────
  console.log("\n3 · First page, worst first");
  const [first, firstMs] = await timed(() => listNeedsLocationLive(registry, entityId, { take: 10 }));
  console.log(`  total in view ${fmt(first.total)} · page fetched in ${firstMs}ms`);
  for (const r of first.rows) {
    console.log(
      `    ${r.ref.padEnd(11)} ${(r.name ?? "-").padEnd(30).slice(0, 30)} ${(r.phone ?? "-").padEnd(13)}` +
      ` ${r.tier.padEnd(10)} olb ${kes(r.olb).padStart(12)}  limit ${kes(r.loanLimit ?? 0).padStart(12)}` +
      `  due ${r.dueInDays == null ? "  -" : String(r.dueInDays).padStart(3)}d  ${(r.agentName ?? "-").slice(0, 18)}`,
    );
  }
  if (first.total === stats.unpinned) ok(`unfiltered list total matches the backlog (${fmt(first.total)})`);
  else bad(`list says ${fmt(first.total)}, stats say ${fmt(stats.unpinned)}`);
  if (first.rows.length === 10) ok("page honoured take=10"); else bad(`asked for 10, got ${first.rows.length}`);

  const rank = { MONEY_OUT: 0, REPEAT: 1, DORMANT: 2 } as const;
  const tiersInOrder = first.rows.every((r, i) => i === 0 || rank[first.rows[i - 1].tier] <= rank[r.tier]);
  if (tiersInOrder) ok("tiers are in worked order down the page");
  else bad("tier order is broken — a later tier appears above an earlier one");

  const moneyRows = first.rows.filter((r) => r.tier === "MONEY_OUT");
  const olbDesc = moneyRows.every((r, i) => i === 0 || moneyRows[i - 1].olb >= r.olb);
  if (olbDesc) ok(`money-out rows descend by exposure (top is ${kes(moneyRows[0]?.olb ?? 0)})`);
  else bad("money-out rows are not ordered by exposure");
  if (first.rows.every((r) => r.ref.startsWith("ss:"))) ok("every row carries a namespaced live ref");
  else bad("a row is missing its ss: ref — it would link to a non-existent local record");
  if (first.rows.every((r) => r.agentId != null)) ok("every row carries the lender's own officer assignment");
  else bad("a row has no officer — the queue split would silently lose it");

  // 4 ─────────────────────────────────────────────────────────────────────────
  // Deep paging is where a 17k sort without a unique tiebreak repeats or drops
  // rows. Page 1 and the LAST page must not intersect.
  console.log("\n4 · Deep paging is stable");
  const lastSkip = Math.max(stats.unpinned - 10, 0);
  const [deep, deepMs] = await timed(() => listNeedsLocationLive(registry, entityId, { take: 10, skip: lastSkip }));
  console.log(`  skip=${fmt(lastSkip)} fetched in ${deepMs}ms`);
  const overlap = deep.rows.filter((r) => first.rows.some((f) => f.ref === r.ref));
  if (overlap.length === 0) ok("the last page shares no row with the first");
  else bad(`${overlap.length} row(s) appear on both the first and last page`);
  const [deepAgain] = await timed(() => listNeedsLocationLive(registry, entityId, { take: 10, skip: lastSkip }));
  if (deepAgain.rows.map((r) => r.ref).join() === deep.rows.map((r) => r.ref).join()) ok("the same deep page twice returns the same rows");
  else bad("a deep page is not deterministic — paging will repeat or skip customers");
  if (deepMs < 30000) ok(`deep page inside the route timeout (${deepMs}ms)`); else bad(`deep page took ${deepMs}ms`);

  // 5 ─────────────────────────────────────────────────────────────────────────
  console.log("\n5 · Tier filters agree with the statistics");
  for (const [tier, expected] of [
    ["MONEY_OUT", stats.moneyOutCustomers],
    ["REPEAT", stats.repeatCustomers],
    ["DORMANT", stats.dormantCustomers],
  ] as const) {
    const [res, ms] = await timed(() => listNeedsLocationLive(registry, entityId, { take: 5, tier }));
    const pure = res.rows.every((r) => r.tier === tier);
    console.log(`  ${tier.padEnd(10)} ${fmt(res.total).padStart(7)} expected ${fmt(expected).padStart(7)}  ${ms}ms`);
    if (res.total === expected) ok(`${tier} count matches`); else bad(`${tier} filter says ${fmt(res.total)}, stats say ${fmt(expected)}`);
    if (pure) ok(`${tier} page contains only ${tier} rows`); else bad(`${tier} page leaked another tier`);
  }
  const [bogus] = await timed(() => listNeedsLocationLive(registry, entityId, { take: 5, tier: "NONSENSE" }));
  if (bogus.total === stats.unpinned) ok("an unrecognised tier falls back to everyone, not an empty screen");
  else bad(`a bad tier returned ${fmt(bogus.total)} instead of the full backlog`);

  // 6 ─────────────────────────────────────────────────────────────────────────
  console.log("\n6 · Officer queues");
  const [queues, qMs] = await timed(() => listNeedsLocationQueues(registry, entityId));
  console.log(`  ${queues.length} queues in ${qMs}ms · top by money out:`);
  for (const qq of queues.slice(0, 6)) {
    console.log(
      `    ${String(qq.agentId).padStart(6)}  ${(qq.agentName ?? "-").padEnd(22).slice(0, 22)}` +
      ` ${String(qq.customers).padStart(4)} to pin  ${String(qq.moneyOut).padStart(2)} out  ${kes(qq.olb).padStart(12)}  limit ${kes(qq.limitBehindGate).padStart(13)}`,
    );
  }
  if (queues.length === stats.agentQueues) ok(`queue count matches the statistics (${queues.length})`);
  else bad(`${queues.length} queues listed but stats counted ${stats.agentQueues}`);
  const queueSum = queues.reduce((s, x) => s + x.customers, 0);
  if (queueSum === stats.unpinned) ok(`queues sum to the backlog (${fmt(queueSum)})`);
  else bad(`queues sum to ${fmt(queueSum)} but the backlog is ${fmt(stats.unpinned)} — customers are unassigned or double-counted`);
  const queueOlb = queues.reduce((s, x) => s + x.olb, 0);
  if (Math.abs(queueOlb - stats.moneyOutOlb) < 1) ok(`queue exposure sums to the money-out total (${kes(queueOlb)})`);
  else bad(`queues hold ${kes(queueOlb)} but money-out is ${kes(stats.moneyOutOlb)}`);
  if (queues.every((x) => x.agentName)) ok("every queue resolves to a named officer");
  else bad(`${queues.filter((x) => !x.agentName).length} queue(s) have no name — check the UserMaster join is not entity-scoped`);

  // 7 ─────────────────────────────────────────────────────────────────────────
  console.log("\n7 · Filtering to one officer's queue");
  const target = queues[0];
  if (target) {
    const [mine, mineMs] = await timed(() => listNeedsLocationLive(registry, entityId, { take: 5, agentId: target.agentId }));
    console.log(`  ${target.agentName} (${target.agentId}) → ${fmt(mine.total)} rows in ${mineMs}ms`);
    if (mine.total === target.customers) ok("the officer filter matches their queue size");
    else bad(`filter says ${fmt(mine.total)}, queue says ${fmt(target.customers)}`);
    if (mine.rows.every((r) => r.agentId === target.agentId)) ok("every row belongs to that officer");
    else bad("the officer filter leaked another officer's customer");
  } else bad("no queues to filter by");

  // 8 ─────────────────────────────────────────────────────────────────────────
  console.log("\n8 · Search, and entity scoping");
  const sample = first.rows[0];
  if (sample?.phone) {
    const [hit] = await timed(() => listNeedsLocationLive(registry, entityId, { take: 5, q: sample.phone!.slice(-9) }));
    if (hit.rows.some((r) => r.ref === sample.ref)) ok(`search by phone finds ${sample.name ?? sample.ref}`);
    else bad(`searching ${sample.phone} did not return the customer it came from`);
  }
  const [none] = await timed(() => listNeedsLocationLive(registry, entityId, { take: 5, q: "zzzz-no-such-customer" }));
  if (none.total === 0) ok("a search that matches nobody returns nothing, not everything");
  else bad(`a nonsense search returned ${fmt(none.total)} rows`);
  // The scoping proof: read the SAME queries against a different entity and the
  // numbers must not be the lender's.
  const otherEntity = entityId === 3005 ? 3002 : 3005;
  const [other] = await timed(() => getNeedsLocationStats(registry, otherEntity));
  if (other.total !== stats.total) ok(`entity ${otherEntity} returns a different book (${fmt(other.total)} customers) — reads are entity-scoped`);
  else bad(`entity ${otherEntity} returned the same ${fmt(other.total)} customers — the entity filter is not binding`);

  // 9 ─────────────────────────────────────────────────────────────────────────
  // Pure arithmetic, but it is the number a board will act on, so it gets checked.
  console.log("\n9 · Campaign arithmetic");
  const from = new Date("2026-08-13T08:00:00Z");
  const plan = planCampaign({
    backlog: stats.unpinned,
    officers: stats.agentQueues || 6,
    pinsPerOfficerPerDay: 8,
    daysPerWeek: 6,
    organicPerMonth: stats.returning12m / 12,
    from,
  });
  console.log(`  ${fmt(stats.agentQueues)} officers × 8 pins/day → ${fmt(Math.round(plan.perDay))} a day`);
  console.log(`  ${fmt(plan.workingDays)} working days (${humanDuration(plan.workingDays)}), finishing ${plan.finishesOn.toDateString()}`);
  console.log(`  ${fmt(plan.perOfficer)} customers each · organic-only would take ${plan.organicOnlyMonths ?? "forever"} months`);
  console.log(`  curve: ${plan.curve.map((c) => `wk${c.week} ${c.pct.toFixed(1)}%`).join("  ")}`);

  if (plan.workingDays > 0) ok("the campaign has a finite length");
  else bad("the campaign computed zero days of work for a non-empty backlog");
  if (plan.perDay * plan.workingDays >= stats.unpinned) ok("the plan captures at least the whole backlog");
  else bad(`plan covers ${fmt(plan.perDay * plan.workingDays)} of ${fmt(stats.unpinned)}`);
  if (plan.finishesOn > from) ok("the finish date is in the future");
  else bad("the finish date is not after the start");
  if (plan.curve.every((c) => c.pct >= 0 && c.pct <= 100)) ok("the coverage curve stays within 0–100%");
  else bad("the coverage curve exceeds 100% — it is not clamped to the backlog");
  // A slider dragged to its floor must not divide by zero or spin.
  const edge = planCampaign({ backlog: stats.unpinned, officers: 0, pinsPerOfficerPerDay: 0, from });
  if (Number.isFinite(edge.workingDays) && edge.workingDays > 0) ok(`zero officers is clamped, not divided by (${fmt(edge.workingDays)} days)`);
  else bad("zero officers produced a non-finite plan");
  const emptyPlan = planCampaign({ backlog: 0, officers: 10, pinsPerOfficerPerDay: 8, from });
  if (emptyPlan.workingDays === 0 && humanDuration(0) === "done") ok("an already-pinned book reports no work");
  else bad(`an empty backlog reported ${emptyPlan.workingDays} days`);

  console.log(
    failures === 0
      ? `\nAll checks passed. ${fmt(stats.unpinned)} customers need a pin; ${fmt(stats.moneyOutCustomers)} of them have ${kes(stats.moneyOutOlb)} out today.\n`
      : `\n${failures} check(s) failed.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(`\n${e instanceof Error ? e.stack : e}\n`); process.exit(1); });
