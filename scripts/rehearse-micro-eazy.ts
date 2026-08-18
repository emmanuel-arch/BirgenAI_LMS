// ─────────────────────────────────────────────────────────────────────────────
// MICRO EAZY — END-TO-END REHEARSAL ON THE REAL MICROMART BRIDGE  (task 0.10)
//
//   npx tsx scripts/rehearse-micro-eazy.ts                  # DRY RUN (default)
//   npx tsx scripts/rehearse-micro-eazy.ts --arm --yes-post-to-production
//   npx tsx scripts/rehearse-micro-eazy.ts --arm --yes-post-to-production --runs=2
//   npx tsx scripts/rehearse-micro-eazy.ts --principal=5000 --product=me|mem
//
// WHAT THIS IS. The blueprint's own risk table says it plainly: posting is armed
// against Micromart's PRODUCTION ServiceSuite, and "never rehearse blind". This
// script is the not-blind part. It proves every link in the chain — connection,
// entity, product, workflow, service account, stored-procedure signature,
// borrower resolution — BEFORE anything is written, and when it does write it
// records exactly what it wrote so a human can reverse it.
//
// ── THE SAFETY MODEL, AND WHY IT HAS THREE LOCKS ────────────────────────────
//
//   1. DRY RUN IS THE DEFAULT. With no flags this script writes nothing. Every
//      preflight below is a read. You can run it any time, including during the
//      board demo, and the worst case is a printed table.
//   2. --arm AND --yes-post-to-production are BOTH required. Two flags, because
//      one flag is something you can type by muscle memory from history, and the
//      second one names the consequence in the flag itself.
//   3. LMS_POSTING_ENABLED must be "true" in the environment. That gate lives in
//      the library (isPostingEnabled), not here, so this script cannot talk its
//      way past it.
//
// ── WHY "REVERSIBLE" DOES NOT MEAN "THIS SCRIPT DELETES IT" ─────────────────
//
// It does not, and it must not. Our SQL credential is read-only by design and
// the guard layer enforces it; the only writes are the two stored procedures
// ServiceSuite's own UI calls. A loan posts with isApproved = 0 at the root of
// the "Micro Eazy" workflow — which is precisely what makes it reversible: it is
// a PENDING application in Micromart's own queue, and their officer rejects or
// cancels it exactly as they would any other. That is a business reversal
// performed by the loan's owner, not a DELETE performed by us, and it is the
// right shape: we should not have the power to erase a record from a licensed
// lender's book.
//
// So the deliverable of an armed run is the ROLLBACK RECORD — the LoanID, the
// borrower, the timestamp, written to reports/ — which is what someone at
// Micromart needs in order to void it. An armed run that cannot write that file
// is treated as a failure.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { platformPrisma } from "../prisma/seed-client";
import { enterPlatform } from "../src/lib/db/context";
import { getOrg, getPostingOrg, getEntityId, isOrgConfigured, type OrgDef } from "../src/lib/enterprise/connections";
import { runReadOnlyQuery, mssql } from "../src/lib/enterprise/mssql";
import { isPostingEnabled, ensureBorrower, postLoan, findBorrowerByPhone, listProducts } from "../src/lib/lms/servicesuite";

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
const has = (k: string) => process.argv.includes(`--${k}`);

const ORG_SLUG = arg("org") ?? "micromart";
const RUNS = Math.min(Math.max(Number(arg("runs") ?? 2), 1), 5);
const PRINCIPAL = Number(arg("principal") ?? 5000);
const WHICH = (arg("product") ?? "me").toLowerCase();

/**
 * The rehearsal identity. Overridable, because whoever runs this must be able to
 * use a number they actually control — a rehearsal against a stranger's phone
 * would send a real stranger a real SMS about a real loan.
 */
const TEST_PHONE = arg("phone") ?? process.env.REHEARSAL_TEST_PHONE ?? "";
const TEST_NID = arg("nid") ?? process.env.REHEARSAL_TEST_NID ?? "";
const TEST_FIRST = arg("first") ?? "BIRGENAI";
const TEST_OTHER = arg("other") ?? "REHEARSAL";

let failures = 0;
const ok = (m: string) => console.log(`  [32m+[0m ${m}`);
const bad = (m: string) => { failures++; console.log(`  [31m![0m ${m}`); };
const info = (m: string) => console.log(`    ${m}`);
const kes = (n: number) => `KES ${Math.round(n).toLocaleString("en-KE")}`;

type Preflight = { org: OrgDef; postOrg: OrgDef; entityId: number; productId: number; productName: string };

async function preflight(): Promise<Preflight | null> {
  console.log("\n[1m1 · PREFLIGHT — every link, read-only[0m\n");

  const p = platformPrisma();
  enterPlatform();

  const row = await p.org.findUnique({
    where: { slug: ORG_SLUG },
    select: { id: true, name: true, mode: true, serviceSuiteEntityId: true, status: true },
  });
  if (!row) { bad(`No org "${ORG_SLUG}" in Postgres.`); return null; }
  ok(`org: ${row.name} · ${row.mode} · ${row.status}`);
  if (row.mode !== "BRIDGED") bad(`${row.name} is ${row.mode}, not BRIDGED — there is no bridge to rehearse.`);

  const org = getOrg(ORG_SLUG);
  if (!org) { bad(`No registry entry for "${ORG_SLUG}".`); return null; }
  if (!isOrgConfigured(org)) { bad(`Read connection ${org.connEnv} is not set.`); return null; }
  ok(`read connection configured (${org.connEnv})`);

  // Reads come from the org's own book; the loan BOOKS into the posting target.
  // On Micromart these are different entities on the same server, and conflating
  // them is the documented way to book into the wrong building.
  const postOrg = getPostingOrg(ORG_SLUG);
  if (!postOrg) {
    bad(`No posting target configured for ${ORG_SLUG} — a declared target whose connection is missing means posting stays OFF by design.`);
    return null;
  }
  const entityId = row.serviceSuiteEntityId ?? getEntityId(postOrg);
  ok(`posting target: ${postOrg.name} · entity ${entityId}${postOrg.slug === ORG_SLUG ? "" : `  (reads ${ORG_SLUG} → books ${postOrg.slug})`}`);

  // Does the entity actually answer, and is it the book we think it is?
  try {
    const { rows } = await runReadOnlyQuery(
      postOrg,
      "SELECT COUNT(*) AS borrowers FROM Borrowers WHERE EntityId = @eid",
      [{ name: "eid", type: mssql.Int, value: entityId }],
      { timeoutMs: 30000, maxRows: 1 },
    );
    ok(`entity ${entityId} answers — ${Number(rows[0]?.borrowers ?? 0).toLocaleString("en-KE")} borrowers on the book`);
  } catch (e) {
    bad(`Could not read entity ${entityId}: ${e instanceof Error ? e.message : e}`);
    return null;
  }

  // The shelf, live.
  let productId = 0;
  let productName = "";
  try {
    const shelf = await listProducts(postOrg, entityId);
    if (!shelf.length) { bad(`No active products on entity ${entityId}.`); return null; }
    for (const s of shelf) info(`product ${s.id}  ${s.name}`);
    const wanted = WHICH === "mem" ? /monthly/i : /^micro eazy$/i;
    const match = shelf.find((s) => wanted.test(s.name)) ?? shelf.find((s) => /micro eazy/i.test(s.name));
    if (!match) { bad(`Neither Micro Eazy product is on entity ${entityId}'s shelf.`); return null; }
    productId = match.id;
    productName = match.name;
    ok(`product selected: ${productName} (${productId})`);
  } catch (e) {
    bad(`Could not list products: ${e instanceof Error ? e.message : e}`);
    return null;
  }

  // The local mirror must point at the same ServiceSuite product, or the console
  // and the lender's book disagree about what was sold.
  const local = await p.product.findFirst({
    where: { orgId: row.id, serviceSuiteProductId: productId },
    select: { name: true, isActive: true, minPrincipal: true, maxPrincipal: true },
  });
  if (!local) bad(`No local product mirrors ServiceSuite product ${productId} — run scripts/seed-micro-eazy.ts --ss-me=… --ss-mem=…`);
  else {
    ok(`local mirror: "${local.name}" ${local.isActive ? "active" : "[31mINACTIVE[0m"} · ${kes(Number(local.minPrincipal))}–${kes(Number(local.maxPrincipal))}`);
    if (!local.isActive) bad("The local product is inactive — the portal would not sell it.");
    if (PRINCIPAL < Number(local.minPrincipal) || PRINCIPAL > Number(local.maxPrincipal)) {
      bad(`--principal=${PRINCIPAL} is outside the product band.`);
    }
  }

  // The workflow the finalizing stage routes into.
  const wf = await p.workflow.findFirst({ where: { orgId: row.id, title: "Micro Eazy" }, select: { id: true } });
  if (!wf) bad('No local workflow "Micro Eazy" — run scripts/seed-micro-eazy.ts.');
  else {
    const stages = await p.workflowStage.findMany({
      where: { workflowId: wf.id }, orderBy: { order: "asc" },
      select: { title: true, canFinalize: true, disbursementRoute: true },
    });
    const fin = stages.find((s) => s.canFinalize);
    ok(`workflow: ${stages.map((s) => s.title).join(" → ")}`);
    if (!fin) bad("No finalizing stage — an approved loan would have nowhere to go.");
    else if (fin.disbursementRoute !== "LENDER_BRIDGE") {
      bad(`Finalizing stage routes ${fin.disbursementRoute ?? "nowhere"}, not LENDER_BRIDGE — this would not post to Micromart.`);
    } else ok("finalize → LENDER_BRIDGE (Micromart's own process disburses)");
  }

  // The service account the loan is attributed to. A missing/unknown UserMaster
  // is the single most common cause of a posting failure that looks like a
  // permissions problem.
  const createdBy = Number(process.env.LMS_SERVICESUITE_CREATED_BY || 0);
  if (!createdBy) bad("LMS_SERVICESUITE_CREATED_BY is not set — postLoan refuses without a service account.");
  else {
    try {
      const { rows } = await runReadOnlyQuery(
        postOrg,
        "SELECT ID, UserName FROM UserMaster WHERE ID = @id",
        [{ name: "id", type: mssql.Int, value: createdBy }],
        { timeoutMs: 20000, maxRows: 1 },
      );
      if (rows.length) ok(`service account: UserMaster ${createdBy} (${String(rows[0].UserName ?? "").trim()})`);
      else bad(`LMS_SERVICESUITE_CREATED_BY=${createdBy} does not exist in UserMaster.`);
    } catch (e) {
      info(`could not verify UserMaster (${e instanceof Error ? e.message : e}) — not fatal, posting will tell us`);
    }
  }

  // The stored procedure's real signature on THIS server.
  try {
    const { rows } = await runReadOnlyQuery(
      postOrg,
      `SELECT p.name FROM sys.parameters p
       JOIN sys.objects o ON o.object_id = p.object_id
       WHERE o.name = 'sp_InsertLoan'`,
      [], { timeoutMs: 20000, maxRows: 50 },
    );
    if (!rows.length) bad("sp_InsertLoan not found on the posting server.");
    else ok(`sp_InsertLoan takes: ${rows.map((r) => String(r.name)).join(" ")}`);
  } catch (e) {
    bad(`Could not inspect sp_InsertLoan: ${e instanceof Error ? e.message : e}`);
  }

  // The posting gate itself.
  if (isPostingEnabled()) ok('LMS_POSTING_ENABLED="true" — writes are permitted');
  else info('LMS_POSTING_ENABLED is not "true" — writes are blocked by the library (this is the safe state)');

  // The rehearsal identity, and who currently owns that number on the book.
  if (!TEST_PHONE) {
    info("no rehearsal phone supplied (--phone= or REHEARSAL_TEST_PHONE) — required only for an armed run");
  } else {
    const who = await findBorrowerByPhone(postOrg, entityId, TEST_PHONE, TEST_NID || null);
    if (who.kind === "found") ok(`rehearsal identity resolves to existing borrower ${who.borrowerId} on entity ${entityId}`);
    else if (who.kind === "ambiguous") bad(`rehearsal identity is AMBIGUOUS on the book: ${who.reason} — resolve before arming.`);
    else ok("rehearsal identity is new to this entity — it would be registered");
  }

  await p.$disconnect();
  return { org, postOrg, entityId, productId, productName };
}

async function armedRun(pf: Preflight, run: number): Promise<Record<string, unknown>> {
  console.log(`\n[1m2.${run} · ARMED RUN ${run} of ${RUNS} — WRITING TO PRODUCTION[0m\n`);
  const applicationId = `rehearsal-${Date.now()}-${run}`;

  const reg = await ensureBorrower(pf.postOrg, pf.entityId, {
    phone: TEST_PHONE,
    firstName: TEST_FIRST,
    otherName: TEST_OTHER,
    nationalId: TEST_NID || null,
  });
  if (!reg.ok) { bad(`borrower: ${reg.message}`); return { run, stage: "borrower", ok: false, message: reg.message }; }
  ok(`borrower ${reg.borrowerId} (${reg.created ? "REGISTERED — new record on their book" : "existing"})`);

  const res = await postLoan(pf.postOrg, {
    borrowerId: reg.borrowerId,
    principal: PRINCIPAL,
    productId: pf.productId,
    applicationId,
  });
  if (!res.ok) { bad(`post: ${res.message}${res.code ? ` (code ${res.code})` : ""}`); return { run, stage: "post", ok: false, borrowerId: reg.borrowerId, message: res.message }; }
  ok(`loan posted — LoanID ${res.loanId} · ${kes(PRINCIPAL)} · ${pf.productName}`);

  // Read it back. A stored procedure returning 200 is a claim; the row is proof.
  let verified: Record<string, unknown> | null = null;
  try {
    const { rows } = await runReadOnlyQuery(
      pf.postOrg,
      `SELECT TOP 1 ID, BorrowerId, LoanAmount, isApproved, LoanCleared, BorrowDate, ProductId
       FROM Loans WHERE ID = @id`,
      [{ name: "id", type: mssql.Int, value: Number(res.loanId) }],
      { timeoutMs: 20000, maxRows: 1 },
    );
    verified = rows[0] ?? null;
    if (!verified) bad("posted, but the loan could not be read back — investigate before posting again.");
    else {
      ok(`read back: borrower ${verified.BorrowerId} · ${kes(Number(verified.LoanAmount))} · isApproved=${verified.isApproved}`);
      if (Number(verified.isApproved) !== 0) {
        bad(`isApproved=${verified.isApproved} — expected 0. An auto-approved rehearsal loan is NOT reversible by a queue rejection.`);
      } else ok("isApproved=0 — sitting in Micromart's queue, reversible by their officer");
    }
  } catch (e) {
    bad(`read-back failed: ${e instanceof Error ? e.message : e}`);
  }

  return {
    run, ok: true, applicationId,
    loanId: res.loanId, borrowerId: reg.borrowerId, borrowerCreated: reg.created,
    principal: PRINCIPAL, productId: pf.productId, productName: pf.productName,
    entityId: pf.entityId, postedAt: new Date().toISOString(), readBack: verified,
  };
}

async function main() {
  console.log("\n[1mMICRO EAZY — bridge rehearsal[0m");
  const armed = has("arm") && has("yes-post-to-production");
  console.log(armed ? "[41m[97m MODE: ARMED — this run WRITES to production [0m" : "MODE: dry run — nothing will be written");

  const pf = await preflight();
  if (!pf) { console.log(`\n[31mPreflight could not complete.[0m\n`); process.exit(1); }

  if (failures > 0) {
    console.log(`\n[31m${failures} preflight problem(s).[0m Fix these before arming.\n`);
    process.exit(1);
  }
  console.log("\n[32mPreflight clean.[0m");

  if (!armed) {
    console.log(
      "\nDry run complete — nothing was written.\n" +
      "To rehearse for real, all THREE must be true:\n" +
      '  1. LMS_POSTING_ENABLED="true" in the environment\n' +
      "  2. --arm --yes-post-to-production on the command line\n" +
      "  3. --phone= (or REHEARSAL_TEST_PHONE) set to a number YOU control\n",
    );
    return;
  }

  if (!isPostingEnabled()) {
    console.log('\n[31mArmed, but LMS_POSTING_ENABLED is not "true".[0m Nothing was written.\n');
    process.exit(1);
  }
  if (!TEST_PHONE) {
    console.log("\n[31mArmed, but no rehearsal phone.[0m Refusing to post against an unspecified identity.\n");
    process.exit(1);
  }

  const results: Record<string, unknown>[] = [];
  for (let i = 1; i <= RUNS; i++) results.push(await armedRun(pf, i));

  // ── The rollback record. An armed run that cannot write this has failed. ──
  const dir = join(process.cwd(), "reports");
  const file = join(dir, `rehearsal-micro-eazy-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify({
      rehearsedAt: new Date().toISOString(),
      org: ORG_SLUG, postingTo: pf.postOrg.slug, entityId: pf.entityId,
      identity: { phone: TEST_PHONE, nationalId: TEST_NID || null, firstName: TEST_FIRST, otherName: TEST_OTHER },
      runs: results,
      rollback:
        "Each LoanID below is a PENDING loan (isApproved=0) at the root stage of Micromart's " +
        "'Micro Eazy' workflow. Reverse it the way any pending application is reversed — a " +
        "Micromart officer rejects or cancels it in ServiceSuite. Do NOT delete rows directly.",
    }, null, 2), "utf8");
    console.log(`\n[1mRollback record:[0m ${file}`);
  } catch (e) {
    bad(`COULD NOT WRITE THE ROLLBACK RECORD: ${e instanceof Error ? e.message : e}`);
    console.log("\n[41m[97m Loans were posted with no rollback record. Capture these IDs NOW: [0m");
    console.log(JSON.stringify(results, null, 2));
  }

  const posted = results.filter((r) => r.ok).map((r) => r.loanId);
  console.log(`\nPosted ${posted.length}/${RUNS}: ${posted.join(", ") || "none"}`);
  console.log("\nHand these LoanIDs to Micromart to reject in their queue. The rehearsal is not");
  console.log("finished until they have been reversed.\n");
  if (failures > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
