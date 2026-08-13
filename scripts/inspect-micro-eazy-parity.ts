// CUSTOMER PARITY — what the LMS holds for a bridged lender vs what their live
// ServiceSuite entity actually holds. Read-only on BOTH sides; writes nothing.
//
//   npx tsx scripts/inspect-micro-eazy-parity.ts
//   npx tsx scripts/inspect-micro-eazy-parity.ts --org=micromart
//
// Run it with .env.local loaded:  DOTENV_CONFIG_PATH=.env.local npx tsx ...
//
// WHY THIS EXISTS. The Micro Eazy demo claim is "these are your customers, scored
// on your own book". That only holds if our Borrower table mirrors theirs. This
// prints the gap and, crucially, whether the inputs our RISK engines need are
// present — a mirrored identity with no repayment history cannot be behaviourally
// scored, and a risk demonstration with no history is a chart of nothing.
//
// The behavioural score is computed from a borrower's last two CLEARED loans, so
// "cleared loans per borrower" is the number that decides whether the risk story
// is demonstrable at all.
import "dotenv/config";
import { platformPrisma } from "../prisma/seed-client";
import { enterPlatform } from "../src/lib/db/context";
import { getOrg, getPostingOrg, getEntityId, isOrgConfigured } from "../src/lib/enterprise/connections";
import { runReadOnlyQuery, mssql } from "../src/lib/enterprise/mssql";

const arg = (k: string, d: string) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d);
const ORG = arg("org", "micromart");

const n = (v: unknown) => Number(v ?? 0);
const fmt = (v: number) => v.toLocaleString("en-KE");
const kes = (v: number) => `KES ${Math.round(v).toLocaleString("en-KE")}`;
const pct = (a: number, b: number) => (b === 0 ? "—" : `${((a / b) * 100).toFixed(1)}%`);

async function main() {
  const p = platformPrisma();
  enterPlatform();

  const org = await p.org.findUnique({
    where: { slug: ORG },
    select: { id: true, name: true, mode: true, status: true, plan: true, serviceSuiteEntityId: true },
  });
  if (!org) throw new Error(`No org with slug "${ORG}".`);

  // Where this lender's Micro Eazy book actually lives (the posting target, which
  // for micromart is the Fintech entity rather than the main book).
  const readOrg = getOrg(ORG);
  const bookOrg = getPostingOrg(ORG);
  if (!bookOrg) throw new Error(`No resolvable ServiceSuite connection for "${ORG}".`);
  const entityId = getEntityId(bookOrg);

  console.log(`\n${org.name} — customer parity`);
  console.log(`  LMS org        ${org.mode} · ${org.status} · plan ${org.plan} · serviceSuiteEntityId ${org.serviceSuiteEntityId ?? "(unset)"}`);
  console.log(`  reads from     ${readOrg?.name ?? "?"} ${readOrg && isOrgConfigured(readOrg) ? "(configured)" : "(NOT configured)"}`);
  console.log(`  book target    ${bookOrg.name} · entity ${entityId}\n`);

  // ── OUR SIDE ───────────────────────────────────────────────────────────────
  const [ours, withNid, scored, behavioural, withLimit, withPin, ourLoans, ourOffers, ourApps] = await Promise.all([
    p.borrower.count({ where: { orgId: org.id } }),
    p.borrower.count({ where: { orgId: org.id, nationalId: { not: null } } }),
    p.borrower.count({ where: { orgId: org.id, creditScore: { not: null } } }),
    p.borrower.count({ where: { orgId: org.id, behaviouralScore: { not: null } } }),
    p.borrower.count({ where: { orgId: org.id, loanLimit: { not: null } } }),
    p.borrower.count({ where: { orgId: org.id, lat: { not: null } } }),
    p.loan.count({ where: { orgId: org.id } }),
    p.loanOffer.count({ where: { orgId: org.id } }),
    p.loanApplication.count({ where: { orgId: org.id } }),
  ]);

  console.log("OURS — BirgenAI LMS (Postgres)");
  console.log(`  borrowers            ${fmt(ours)}`);
  console.log(`    with national ID   ${fmt(withNid)}  ${pct(withNid, ours)}`);
  console.log(`    with credit score  ${fmt(scored)}  ${pct(scored, ours)}`);
  console.log(`    behaviourally scored ${fmt(behavioural)}  ${pct(behavioural, ours)}`);
  console.log(`    with loan limit    ${fmt(withLimit)}  ${pct(withLimit, ours)}`);
  console.log(`    with location pin  ${fmt(withPin)}  ${pct(withPin, ours)}`);
  console.log(`  loans                ${fmt(ourLoans)}`);
  console.log(`  applications         ${fmt(ourApps)}`);
  console.log(`  offers               ${fmt(ourOffers)}\n`);

  // ── THEIR SIDE ─────────────────────────────────────────────────────────────
  const theirs = await runReadOnlyQuery(
    bookOrg,
    `SELECT
       (SELECT COUNT(*) FROM Borrowers WHERE EntityId = @e) AS borrowers,
       (SELECT COUNT(*) FROM Borrowers WHERE EntityId = @e AND AccountStatus = 1) AS activeBorrowers,
       (SELECT COUNT(*) FROM Borrowers WHERE EntityId = @e AND NationalID IS NOT NULL AND LTRIM(RTRIM(NationalID)) <> '') AS withNid,
       (SELECT COUNT(*) FROM Borrowers WHERE EntityId = @e AND CreditScore IS NOT NULL) AS withScore,
       (SELECT COUNT(*) FROM Borrowers WHERE EntityId = @e AND LoanLimit IS NOT NULL) AS withLimit,
       (SELECT COUNT(*) FROM Borrowers WHERE EntityId = @e AND Latitude IS NOT NULL AND LTRIM(RTRIM(Latitude)) <> '') AS withPin,
       (SELECT COUNT(DISTINCT RIGHT(REPLACE(PhoneNumber,' ',''),9)) FROM Borrowers WHERE EntityId = @e AND PhoneNumber IS NOT NULL AND LEN(REPLACE(PhoneNumber,' ','')) >= 9) AS distinctPhones,
       (SELECT COUNT(*) FROM Loans WHERE EntityId = @e) AS loans,
       (SELECT COUNT(*) FROM Loans WHERE EntityId = @e AND isApproved = 1) AS approvedLoans,
       (SELECT COUNT(*) FROM Loans WHERE EntityId = @e AND isApproved = 1 AND LoanCleared = 1) AS clearedLoans,
       (SELECT COUNT(*) FROM Loans WHERE EntityId = @e AND isApproved = 1 AND LoanCleared = 0 AND LoanBalance > 0) AS openLoans,
       (SELECT ISNULL(SUM(LoanBalance),0) FROM Loans WHERE EntityId = @e AND isApproved = 1 AND LoanCleared = 0) AS olb,
       (SELECT COUNT(DISTINCT BorrowerId) FROM Loans WHERE EntityId = @e AND isApproved = 1 AND LoanCleared = 1) AS borrowersWithCleared,
       (SELECT COUNT(*) FROM (
          SELECT BorrowerId FROM Loans WHERE EntityId = @e AND isApproved = 1 AND LoanCleared = 1
          GROUP BY BorrowerId HAVING COUNT(*) >= 2) z) AS borrowersWith2Cleared`,
    [{ name: "e", type: mssql.Int, value: entityId }],
    { maxRows: 1, timeoutMs: 90000 },
  );
  const t = theirs.rows[0] ?? {};

  console.log(`THEIRS — ServiceSuite entity ${entityId} (live)`);
  console.log(`  borrowers            ${fmt(n(t.borrowers))}   active ${fmt(n(t.activeBorrowers))}`);
  console.log(`    with national ID   ${fmt(n(t.withNid))}  ${pct(n(t.withNid), n(t.borrowers))}`);
  console.log(`    with credit score  ${fmt(n(t.withScore))}  ${pct(n(t.withScore), n(t.borrowers))}`);
  console.log(`    with loan limit    ${fmt(n(t.withLimit))}  ${pct(n(t.withLimit), n(t.borrowers))}`);
  console.log(`    with location pin  ${fmt(n(t.withPin))}  ${pct(n(t.withPin), n(t.borrowers))}`);
  console.log(`    distinct phones    ${fmt(n(t.distinctPhones))}  ${n(t.distinctPhones) === n(t.borrowers) ? "— unique, safe to key on phone" : "— COLLISIONS, phone alone is not a key"}`);
  console.log(`  loans                ${fmt(n(t.loans))}   approved ${fmt(n(t.approvedLoans))}`);
  console.log(`    cleared            ${fmt(n(t.clearedLoans))}`);
  console.log(`    open               ${fmt(n(t.openLoans))}   OLB ${kes(n(t.olb))}\n`);

  // ── THE GAP THAT MATTERS ───────────────────────────────────────────────────
  const missing = Math.max(0, n(t.borrowers) - ours);
  console.log("THE GAP");
  console.log(`  borrowers to mirror  ${fmt(missing)}   (${fmt(ours)} of ${fmt(n(t.borrowers))} present, ${pct(ours, n(t.borrowers))})`);
  console.log(`  loans to mirror      ${fmt(Math.max(0, n(t.approvedLoans) - ourLoans))}`);
  console.log("");
  console.log("  RISK DEMONSTRABILITY — can our engines actually score this book?");
  console.log(`    borrowers with >=1 cleared loan   ${fmt(n(t.borrowersWithCleared))}  ${pct(n(t.borrowersWithCleared), n(t.borrowers))}`);
  console.log(`    borrowers with >=2 cleared loans  ${fmt(n(t.borrowersWith2Cleared))}  ${pct(n(t.borrowersWith2Cleared), n(t.borrowers))}`);
  console.log(`      ^ the behavioural score reads the last TWO cleared loans, so this`);
  console.log(`        is the population the risk story can be told on today.`);
  console.log("");

  await p.$disconnect();
}

main().then(() => process.exit(0)).catch((e) => { console.error(`\n${e instanceof Error ? e.message : e}\n`); process.exit(1); });
