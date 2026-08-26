// ─────────────────────────────────────────────────────────────────────────────
// Does the demo account actually have anything to show?
//
//   npx tsx scripts/check-demo-account.ts 254758517032
//
// The portal resolves a borrower by PHONE within ONE EntityId. Micromart runs
// three books on one server and the same phone number can exist in more than one
// of them belonging to DIFFERENT people — 13 such collisions were found between
// 3002 and 3005. So "my account works" is not a question about the phone, it is
// a question about the phone IN THE ENTITY THE APP IS POINTED AT.
//
// This prints what each entity holds for the number, so a demo never opens on a
// screen that is empty because the app is looking in the wrong book.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import mssql from "mssql";
import { ORGS } from "../src/lib/enterprise/connections";
import { runReadOnlyQuery } from "../src/lib/enterprise/mssql";

const B = (s: string) => `\x1b[1m${s}\x1b[0m`;
const D = (s: string) => `\x1b[2m${s}\x1b[0m`;
const G = (s: string) => `\x1b[32m${s}\x1b[0m`;
const R = (s: string) => `\x1b[31m${s}\x1b[0m`;
const Y = (s: string) => `\x1b[33m${s}\x1b[0m`;

const phone = (process.argv[2] ?? "254758517032").replace(/\D/g, "");
const last9 = phone.slice(-9);

async function main() {
  console.log(`\n${B(`Demo account ${phone}`)} ${D(`matching on the last 9 digits: ${last9}`)}`);

  const { rows } = await runReadOnlyQuery(
    ORGS["micromart-fintech"],
    `SELECT b.EntityId, b.ID AS borrowerId, b.NationalID, b.PhoneNumber,
            b.LoanLimit, b.CreditScore, b.AccountStatus, b.CreatedDate,
            (SELECT COUNT(*) FROM Loans l WHERE l.BorrowerId = b.ID AND l.EntityId = b.EntityId) AS loans,
            (SELECT COUNT(*) FROM Loans l WHERE l.BorrowerId = b.ID AND l.EntityId = b.EntityId
               AND l.isApproved = 1 AND l.LoanCleared = 0 AND l.LoanBalance > 0) AS openLoans,
            (SELECT SUM(CAST(l.LoanBalance AS BIGINT)) FROM Loans l WHERE l.BorrowerId = b.ID
               AND l.EntityId = b.EntityId AND l.LoanCleared = 0) AS balance,
            (SELECT MAX(l.BorrowDate) FROM Loans l WHERE l.BorrowerId = b.ID AND l.EntityId = b.EntityId) AS lastLoan
       FROM Borrowers b
      WHERE RIGHT(REPLACE(REPLACE(LTRIM(RTRIM(b.PhoneNumber)),' ',''),'+',''), 9) = @last9
      ORDER BY b.EntityId, b.CreatedDate DESC`,
    [{ name: "last9", type: mssql.VarChar(9), value: last9 }],
    { timeoutMs: 120_000, maxRows: 50 },
  );

  if (rows.length === 0) {
    console.log(`\n  ${R("Not found in ANY entity on this server.")}`);
    console.log(`  ${D("The portal will answer \"we could not match that ID to an account on this number\".")}\n`);
    process.exit(1);
  }

  const configured = Number(process.env.VITE_ENTITY_ID ?? 3005);

  for (const r of rows) {
    const eid = Number(r.EntityId);
    const mark =
      eid === configured ? G("  ◀ the entity the PWA is pointed at") : D("    (a different book)");
    console.log(
      `\n  ${B(`Entity ${eid}`)}  borrower #${r.borrowerId}${mark}\n` +
        `    national ID   ${r.NationalID ?? R("(none — the portal's second factor will fail)")}\n` +
        `    phone         ${r.PhoneNumber}\n` +
        `    loan limit    ${r.LoanLimit ?? "(none)"}\n` +
        `    credit score  ${r.CreditScore ?? "(none)"}\n` +
        `    loans         ${r.loans} total · ${r.openLoans} open · balance ${r.balance ?? 0}\n` +
        `    last loan     ${r.lastLoan instanceof Date ? r.lastLoan.toISOString().slice(0, 10) : "never"}`,
    );
  }

  const inConfigured = rows.filter((r) => Number(r.EntityId) === configured);
  console.log("");
  if (inConfigured.length === 0) {
    console.log(
      `  ${R(`No account in entity ${configured}`)} — the app is pointed there and will show nothing.\n` +
        `  ${D(`Found instead in: ${[...new Set(rows.map((r) => r.EntityId))].join(", ")}`)}\n`,
    );
  } else {
    const r = inConfigured[0];
    const missingId = !r.NationalID;
    const noLoans = Number(r.loans) === 0;
    console.log(`  ${G(`Account present in entity ${configured}.`)}`);
    if (missingId) console.log(`  ${Y("But it has no national ID")} — the portal's second factor cannot pass.`);
    if (noLoans) console.log(`  ${Y("But it has no loans")} — every loan screen will render its empty state.`);
    if (!missingId && !noLoans) console.log(`  ${D("It has an ID and a loan history. The portal screens will have data.")}`);
    console.log("");
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(`\n  ${R("failed")} — ${(e as Error).message.split("\n")[0]}\n`);
  process.exit(1);
});
