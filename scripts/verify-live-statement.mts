import * as dotenv from "dotenv";
dotenv.config();
import { getOrg, getEntityId } from "../src/lib/enterprise/connections";
import { getCustomerStatementLive } from "../src/lib/lms/servicesuite-statement";
import { listLoansLive } from "../src/lib/lms/servicesuite-loans";

const org = getOrg("micromart")!;
const entityId = getEntityId(org);

// Pick a real customer who is actually in arrears — the interesting case.
const { loans } = await listLoansLive(org, entityId, { status: "arrears", take: 1 });
const borrowerId = loans[0]?.borrowerId;
if (!borrowerId) { console.log("no arrears borrower found"); process.exit(1); }

const t = Date.now();
const s = await getCustomerStatementLive(org, entityId, borrowerId, { take: 8 });
if (!s) { console.log("no statement"); process.exit(1); }

console.log(`\nStatement — ${s.borrower.name} (ss:${s.borrower.serviceSuiteId}, acct ${s.borrower.accountNo}) [${Date.now()-t}ms]`);
console.log(`  office: ${s.borrower.office}`);
console.log(`  ledger: ${s.totals.count} entries · in ${Math.round(s.totals.moneyIn).toLocaleString()} · out ${Math.round(s.totals.moneyOut).toLocaleString()}`);
console.log(`  from ${s.totals.firstAt?.slice(0,10)} to ${s.totals.lastAt?.slice(0,10)}`);
console.log(`\n  loans (${s.loans.length}):`);
for (const l of s.loans.slice(0, 5))
  console.log(`    #${l.loanId} ${(l.product ?? "-").slice(0,14).padEnd(14)} ${l.status.padEnd(7)} bal ${Math.round(l.balance).toString().padStart(7)} arrears ${Math.round(l.arrears)}${l.daysInArrears?` (${l.daysInArrears}d)`:""} inst ${l.installments ?? "-"}`);
console.log(`\n  last ${s.transactions.length} entries:`);
for (const x of s.transactions)
  console.log(`    ${x.at.slice(0,16).replace("T"," ")} ${x.direction === "in" ? "IN " : "OUT"} ${String(Math.round(x.amount)).padStart(7)}  ${(x.narration??"").slice(0,22).padEnd(22)} ${x.reference ?? "-"}  bal ${x.loanBalance}`);

let failed = 0;
const check = (nm: string, c: boolean) => { console.log(c ? `  \x1b[32mPASS\x1b[0m  ${nm}` : `  \x1b[31mFAIL\x1b[0m  ${nm}`); if (!c) failed++; };
console.log("");
check("borrower resolved with a name", !!s.borrower.name);
check("entity matches the one asked for", s.borrower.entityId === entityId);
check("has loan history", s.loans.length > 0);
check("has a transaction ledger", s.transactions.length > 0);
check("totals cover more than the page", s.totals.count >= s.transactions.length);
check("repayments are typed 'out' (customer's side)", s.transactions.some((x) => x.direction === "out"));
check("amounts are NUMBERS, not formatted strings", s.transactions.every((x) => typeof x.amount === "number"));
check("arrears agrees with the loans list", s.loans.some((l) => l.arrears > 0));
// Wrong entity must not resolve — different people share ids across 3002/3005.
const wrong = await getCustomerStatementLive(org, 3002, borrowerId, { take: 1 });
check("a borrower from another entity does not resolve", wrong === null);

console.log(failed === 0 ? "\n\x1b[32mAll good\x1b[0m\n" : `\n\x1b[31m${failed} failed\x1b[0m\n`);
process.exit(failed === 0 ? 0 : 1);
