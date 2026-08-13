// Point an LMS org at a ServiceSuite EntityId — which book its console, scoring
// and portfolio views read.
//
//   npx tsx scripts/set-org-entity.ts --org=micromart                  (dry run)
//   npx tsx scripts/set-org-entity.ts --org=micromart --entity=3005 --apply
//
// Run with .env.local loaded:  DOTENV_CONFIG_PATH=.env.local npx tsx ...
//
// WHY THIS IS A ONE-FIELD DECISION WITH LARGE CONSEQUENCES. A BRIDGED org does not
// hold a copy of its customers; tenancy.ts resolves them live as
// `serviceSuiteEntityId ?? getEntityId(registry)`, and every downstream read — the
// borrower list, Customer 360, the behavioural scorer, portfolio analytics — is
// scoped by that one integer. Changing it changes which of a lender's books the
// whole platform is looking at. It does not move or copy any data.
//
// Micromart's case: entity 3002 is their historic book (140k borrowers); entity
// 3005 (MICROMART FINTECH) is the Micro Eazy book — 17,017 borrowers migrated there
// on 2 Aug 2026, of whom 10,485 carry two or more cleared loans and are therefore
// behaviourally scorable today. The Micro Eazy risk story lives in 3005.
//
// Prints what the target entity actually contains BEFORE writing, so nobody points
// an org at an empty or wrong book by typo.
import "dotenv/config";
import { platformPrisma } from "../prisma/seed-client";
import { enterPlatform } from "../src/lib/db/context";
import { getOrg, getPostingOrg, isOrgConfigured } from "../src/lib/enterprise/connections";
import { runReadOnlyQuery, mssql } from "../src/lib/enterprise/mssql";

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
const flag = (k: string) => process.argv.includes(`--${k}`);

const ORG = arg("org") ?? "micromart";
const APPLY = flag("apply");
const fmt = (v: unknown) => Number(v ?? 0).toLocaleString("en-KE");

async function main() {
  const entityArg = arg("entity");
  const entity = entityArg != null ? Number(entityArg) : null;
  if (entityArg != null && (!Number.isInteger(entity) || entity! <= 0)) {
    throw new Error("--entity must be a positive integer.");
  }

  const p = platformPrisma();
  enterPlatform();

  const org = await p.org.findUnique({
    where: { slug: ORG },
    select: { id: true, name: true, mode: true, status: true, serviceSuiteEntityId: true },
  });
  if (!org) throw new Error(`No org with slug "${ORG}".`);

  const registry = getOrg(ORG);
  const readsReady = !!registry && isOrgConfigured(registry);
  console.log(`\n${org.name} (${ORG})`);
  console.log(`  mode              ${org.mode} · ${org.status}`);
  console.log(`  entity now        ${org.serviceSuiteEntityId ?? "(unset — falls back to the registry default)"}`);
  console.log(`  read connection   ${registry?.connEnv ?? "?"} ${readsReady ? "CONFIGURED" : "NOT CONFIGURED — reads will fail"}`);
  const posting = getPostingOrg(ORG);
  console.log(`  posting target    ${posting?.name ?? "(unresolved)"}${posting ? ` · ${posting.connEnv}` : ""}`);

  if (entity == null) {
    console.log(`\nNo --entity given; nothing to change. Pass --entity=<id> to retarget.\n`);
    await p.$disconnect();
    return;
  }
  if (org.mode !== "BRIDGED") {
    console.log(`\n! ${org.name} is ${org.mode}, not BRIDGED — serviceSuiteEntityId has no effect on a native book.`);
  }

  // Look before you leap: read the candidate entity out of the lender's own DB.
  const probeOrg = posting ?? registry;
  if (!probeOrg || !isOrgConfigured(probeOrg)) {
    throw new Error(`Cannot inspect entity ${entity}: no configured ServiceSuite connection for "${ORG}".`);
  }
  const probe = await runReadOnlyQuery(
    probeOrg,
    `SELECT (SELECT EntityName FROM BsEntity WHERE ID = @e) AS entityName,
            (SELECT COUNT(*) FROM Borrowers WHERE EntityId = @e) AS borrowers,
            (SELECT COUNT(*) FROM Borrowers WHERE EntityId = @e AND AccountStatus = 1) AS active,
            (SELECT COUNT(*) FROM Loans WHERE EntityId = @e AND isApproved = 1) AS approvedLoans,
            (SELECT COUNT(*) FROM (
               SELECT BorrowerId FROM Loans WHERE EntityId = @e AND isApproved = 1 AND LoanCleared = 1
               GROUP BY BorrowerId HAVING COUNT(*) >= 2) z) AS scorable,
            (SELECT COUNT(*) FROM Products WHERE EntityId = @e AND IsActive = 1) AS activeProducts`,
    [{ name: "e", type: mssql.Int, value: entity }],
    { maxRows: 1, timeoutMs: 90000 },
  );
  const t = probe.rows[0] ?? {};
  const borrowers = Number(t.borrowers ?? 0);

  console.log(`\nENTITY ${entity} — as the lender's database has it`);
  console.log(`  name              ${t.entityName ?? "(no BsEntity row!)"}`);
  console.log(`  borrowers         ${fmt(t.borrowers)}   active ${fmt(t.active)}`);
  console.log(`  approved loans    ${fmt(t.approvedLoans)}`);
  console.log(`  active products   ${fmt(t.activeProducts)}`);
  console.log(`  behaviourally scorable (2+ cleared loans)   ${fmt(t.scorable)}`);

  if (borrowers === 0) {
    throw new Error(`Entity ${entity} holds no borrowers. Refusing to point ${org.name} at an empty book.`);
  }
  if (!t.entityName) {
    throw new Error(`Entity ${entity} has no BsEntity row — it is not a real entity on this server.`);
  }
  if (org.serviceSuiteEntityId === entity) {
    console.log(`\nAlready set to ${entity} — nothing to do.\n`);
    await p.$disconnect();
    return;
  }

  if (!APPLY) {
    console.log(`\nDRY RUN — would change serviceSuiteEntityId ${org.serviceSuiteEntityId ?? "(unset)"} -> ${entity}`);
    console.log(`  Re-run with --apply to write it. No customer data moves either way.\n`);
    await p.$disconnect();
    return;
  }

  await p.org.update({ where: { id: org.id }, data: { serviceSuiteEntityId: entity } });
  console.log(`\nAPPLIED — ${org.name}.serviceSuiteEntityId ${org.serviceSuiteEntityId ?? "(unset)"} -> ${entity}`);
  console.log(`  Rollback: npx tsx scripts/set-org-entity.ts --org=${ORG} --entity=${org.serviceSuiteEntityId ?? 0} --apply\n`);

  await p.$disconnect();
}

main().then(() => process.exit(0)).catch((e) => { console.error(`\n${e instanceof Error ? e.message : e}\n`); process.exit(1); });
