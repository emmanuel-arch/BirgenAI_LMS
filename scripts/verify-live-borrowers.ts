// Smoke-test the live borrower read-through against a bridged lender's real book.
// Read-only. Proves paging, search and the per-borrower aggregates before the
// console depends on them.
//
//   DOTENV_CONFIG_PATH=.env.local npx tsx scripts/verify-live-borrowers.ts
//   DOTENV_CONFIG_PATH=.env.local npx tsx scripts/verify-live-borrowers.ts --q=0758517032
import "dotenv/config";
import { platformPrisma } from "../prisma/seed-client";
import { enterPlatform } from "../src/lib/db/context";
import { getOrg, getPostingOrg, getEntityId, isOrgConfigured } from "../src/lib/enterprise/connections";
import { listBorrowersLive, getLiveBorrowerById, getBorrowerBookStats } from "../src/lib/lms/servicesuite";

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
const ORG = arg("org") ?? "micromart";

const fmt = (v: number) => v.toLocaleString("en-KE");
const kes = (v: number) => `KES ${Math.round(v).toLocaleString("en-KE")}`;
let failures = 0;
const ok = (m: string) => console.log(`  + ${m}`);
const bad = (m: string) => { failures++; console.log(`  ! ${m}`); };

async function main() {
  const p = platformPrisma();
  enterPlatform();
  const row = await p.org.findUnique({ where: { slug: ORG }, select: { name: true, mode: true, serviceSuiteEntityId: true } });
  if (!row) throw new Error(`No org "${ORG}".`);

  // Reads follow the org's own registry entry; the entity comes from Postgres
  // first, exactly as tenancy.ts resolves it.
  const registry = getOrg(ORG);
  if (!registry || !isOrgConfigured(registry)) throw new Error(`${ORG} read connection (${registry?.connEnv}) is not configured.`);
  const entityId = row.serviceSuiteEntityId ?? getEntityId(getPostingOrg(ORG) ?? registry);

  console.log(`\n${row.name} — live borrower read-through · ${row.mode} · entity ${entityId}\n`);

  console.log("1 · First page");
  const t0 = Date.now();
  const first = await listBorrowersLive(registry, entityId, { take: 5 });
  const ms = Date.now() - t0;
  console.log(`  total in book: ${fmt(first.total)}   page fetched in ${ms}ms`);
  if (first.total > 0) ok(`book is not empty (${fmt(first.total)})`); else bad("book came back empty");
  if (first.borrowers.length === 5) ok("page honoured take=5"); else bad(`asked for 5, got ${first.borrowers.length}`);
  if (ms < 30000) ok(`page returned inside the route timeout (${ms}ms)`); else bad(`page took ${ms}ms — too slow for a console request`);

  for (const b of first.borrowers.slice(0, 5)) {
    console.log(
      `    ${b.ref.padEnd(11)} ${(b.name ?? "-").padEnd(34).slice(0, 34)} ${(b.phone ?? "-").padEnd(13)}` +
      ` loans ${String(b.loansCount).padStart(3)}  cleared ${String(b.clearedLoans).padStart(3)}` +
      `  olb ${kes(b.olb).padStart(14)}  risk ${b.riskScore ?? "-"}  geo ${b.hasGeo ? "yes" : "NO"}`,
    );
  }

  console.log("\n2 · Paging does not repeat rows");
  const second = await listBorrowersLive(registry, entityId, { take: 5, skip: 5 });
  const overlap = first.borrowers.filter((a) => second.borrowers.some((c) => c.ref === a.ref));
  if (overlap.length === 0) ok("page 2 shares no rows with page 1"); else bad(`${overlap.length} row(s) repeated across pages`);
  if (second.total === first.total) ok("total is stable across pages"); else bad(`total moved ${first.total} -> ${second.total}`);

  console.log("\n3 · Search");
  const needle = arg("q") ?? "0758517032";
  const found = await listBorrowersLive(registry, entityId, { q: needle, take: 10 });
  console.log(`  q="${needle}" -> ${fmt(found.total)} match(es)`);
  for (const b of found.borrowers) {
    console.log(`    ${b.ref}  ${b.name}  ${b.phone}  NID ${b.nationalId ?? "-"}  limit ${b.loanLimit != null ? kes(b.loanLimit) : "-"}`);
  }
  if (found.total <= first.total) ok("a search narrows the book"); else bad("search returned more rows than the whole book");

  console.log("\n4 · The location gap the field-ops worklist will inherit");
  const sample = await listBorrowersLive(registry, entityId, { take: 200 });
  const pinned = sample.borrowers.filter((b) => b.hasGeo).length;
  console.log(`  of ${sample.borrowers.length} sampled: ${pinned} pinned, ${sample.borrowers.length - pinned} need a location`);
  if (pinned === 0) ok("confirms 0% pinned — every customer lands in needs-location");
  else console.log(`  (note: ${pinned} already carry a pin)`);

  console.log("\n5 · Opening one customer by id (what the resolver seeds from)");
  const target = found.borrowers[0] ?? first.borrowers[0];
  if (!target) {
    bad("no borrower to open");
  } else {
    const seed = await getLiveBorrowerById(registry, entityId, target.serviceSuiteId);
    if (!seed) {
      bad(`could not read borrower ${target.serviceSuiteId} back by id`);
    } else {
      console.log(`    ${seed.firstName} ${seed.otherName}  phone ${seed.phone}  NID ${seed.nationalId}`);
      console.log(`    dob ${seed.dob?.slice(0, 10) ?? "-"}  gender ${seed.gender ?? "-"}  risk ${seed.riskScore ?? "-"}` +
                  `  limit ${seed.loanLimit != null ? kes(seed.loanLimit) : "-"}  graduations ${seed.graduationCount}`);
      console.log(`    email ${seed.email ?? "(none — placeholder rejected)"}`);
      if (seed.serviceSuiteId === target.serviceSuiteId) ok("id round-trips"); else bad("id did not round-trip");
      if ((seed.phone ?? "").replace(/\D/g, "").length >= 9) ok("phone is usable as the local key"); else bad("phone is not usable");
    }

    // SECURITY: an id is only meaningful inside its own entity. Reading a 3002
    // borrower against 3005 must come back empty, or one lender could open
    // another's customer by guessing an integer.
    const foreign = await listBorrowersLive(registry, 3002, { take: 1 });
    const foreignId = foreign.borrowers[0]?.serviceSuiteId;
    if (foreignId == null) {
      console.log("  (skipped cross-entity check — entity 3002 returned no rows)");
    } else {
      const leaked = await getLiveBorrowerById(registry, entityId, foreignId);
      if (leaked === null) ok(`entity scoping holds — borrower ${foreignId} from 3002 is invisible to entity ${entityId}`);
      else bad(`LEAK: borrower ${foreignId} belongs to 3002 but was readable against entity ${entityId}`);
    }
  }

  console.log("\n6 · Whole-book stats (the header strip)");
  const t1 = Date.now();
  const stats = await getBorrowerBookStats(registry, entityId);
  const statMs = Date.now() - t1;
  console.log(`    customers ${fmt(stats.total)}   active ${fmt(stats.active)}`);
  console.log(`    need a location ${fmt(stats.needsLocation)}   scored ${fmt(stats.scored)}   open loans ${fmt(stats.withOpenLoan)}   (${statMs}ms)`);
  if (stats.total === first.total) ok("stats total agrees with the list total");
  else bad(`stats say ${fmt(stats.total)} but the list says ${fmt(first.total)}`);
  if (stats.needsLocation === stats.total) ok("every customer needs a location — the field-ops banner will fire");
  else console.log(`  (${fmt(stats.total - stats.needsLocation)} already pinned, so the banner stays off)`);
  if (statMs < 30000) ok(`stats returned inside the route timeout (${statMs}ms)`); else bad(`stats took ${statMs}ms`);

  console.log("\n7 · Non-existent id fails closed");
  const ghost = await getLiveBorrowerById(registry, entityId, 999999999);
  if (ghost === null) ok("an unknown id returns null rather than throwing"); else bad("an unknown id returned a row");

  console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
  await p.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(`\n${e instanceof Error ? e.message : e}\n`); process.exit(1); });
