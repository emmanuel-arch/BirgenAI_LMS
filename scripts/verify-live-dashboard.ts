// Smoke-test the live dashboard read against a bridged lender's real book.
// Read-only: MainDashboard is SELECT-only.
//
//   DOTENV_CONFIG_PATH=.env.local npx tsx scripts/verify-live-dashboard.ts
import "dotenv/config";
import { platformPrisma } from "../prisma/seed-client";
import { enterPlatform } from "../src/lib/db/context";
import { getOrg, getPostingOrg, getEntityId, isOrgConfigured } from "../src/lib/enterprise/connections";
import { getLiveDashboard, resolveDashboardUserId, parseMoney } from "../src/lib/lms/dashboard";
import { getBorrowerBookStats } from "../src/lib/lms/servicesuite";
import { simulate, applyLive } from "../src/lib/dashboard/model";

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
const ORG = arg("org") ?? "micromart";
const fmt = (v: number) => v.toLocaleString("en-KE");
let failures = 0;
const ok = (m: string) => console.log(`  + ${m}`);
const bad = (m: string) => { failures++; console.log(`  ! ${m}`); };

async function main() {
  console.log("\n1 · The currency parser (a wrong zero here would misstate a balance sheet)");
  const cases: [unknown, number | undefined][] = [
    ["Ksh 566,089.00", 566089],
    ["Ksh 0.00", 0],
    ["(Ksh 1,200.00)", -1200],
    ["KES 1,234.56", 1234.56],
    [1234, 1234],
    ["", undefined],
    [null, undefined],
    ["n/a", undefined],
  ];
  for (const [input, want] of cases) {
    const got = parseMoney(input);
    if (got === want) ok(`${JSON.stringify(input)} -> ${String(got)}`);
    else bad(`${JSON.stringify(input)} -> ${String(got)} (expected ${String(want)})`);
  }

  const p = platformPrisma();
  enterPlatform();
  const row = await p.org.findUnique({ where: { slug: ORG }, select: { name: true, mode: true, serviceSuiteEntityId: true } });
  if (!row) throw new Error(`No org "${ORG}".`);
  const registry = getOrg(ORG);
  if (!registry || !isOrgConfigured(registry)) throw new Error(`${ORG} read connection is not configured.`);
  const entityId = row.serviceSuiteEntityId ?? getEntityId(getPostingOrg(ORG) ?? registry);

  console.log(`\n2 · Whose scope answers for ${row.name} (entity ${entityId})`);
  const readAs = await resolveDashboardUserId(registry, entityId);
  if (readAs == null) { bad("no ServiceSuite user on this entity — the proc cannot be scoped"); }
  else ok(`reading as Usermaster ${readAs}`);

  console.log("\n3 · The live figures");
  const t0 = Date.now();
  const live = await getLiveDashboard(registry, entityId);
  const ms = Date.now() - t0;
  if (!live) { bad("no dashboard returned"); }
  else {
    console.log(`  answered ${live.provided.length} metrics in ${ms}ms · currency "${live.currencyLabel}"`);
    for (const k of live.provided.sort()) {
      const v = (live.snapshot as Record<string, number>)[k];
      console.log(`    ${k.padEnd(16)} ${fmt(v)}`);
    }
    if (live.provided.includes("olb")) ok("OLB parsed out of the formatted string");
    else bad("OLB did not parse — every money figure would be modelled");
    if (ms < 30000) ok(`returned inside the route timeout (${ms}ms)`); else bad(`took ${ms}ms`);

    // Cross-check against a figure computed independently, straight off Borrowers.
    const stats = await getBorrowerBookStats(registry, entityId);
    if (live.snapshot.totalCustomers === stats.total) {
      ok(`customer count agrees with a direct count of the book (${fmt(stats.total)})`);
    } else {
      bad(`dashboard says ${fmt(live.snapshot.totalCustomers ?? -1)} customers, a direct count says ${fmt(stats.total)}`);
    }

    console.log("\n4 · Overlaying onto the modelled dataset");
    const base = simulate("30d", "entity", { seed: ORG });
    const merged = applyLive(base, live.snapshot);
    console.log(`    olb            modelled ${fmt(Math.round(base.kpis.olb))}  ->  live ${fmt(Math.round(merged.kpis.olb))}`);
    console.log(`    activeLoans    modelled ${fmt(base.kpis.activeLoans)}  ->  live ${fmt(merged.kpis.activeLoans)}`);
    console.log(`    totalCustomers modelled ${fmt(base.kpis.totalCustomers)}  ->  live ${fmt(merged.kpis.totalCustomers)}`);
    if (Math.round(merged.kpis.olb) === Math.round(live.snapshot.olb ?? -1)) ok("the live OLB survives the overlay");
    else bad("the overlay did not take the live OLB");
    if (merged.kpis.cleanOlb <= merged.kpis.olb) ok("clean OLB recomputed to something <= OLB");
    else bad(`clean OLB ${merged.kpis.cleanOlb} exceeds OLB ${merged.kpis.olb}`);
  }

  console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
  await p.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(`\n${e instanceof Error ? e.message : e}\n`); process.exit(1); });
