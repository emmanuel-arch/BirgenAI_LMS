// ─────────────────────────────────────────────────────────────────────────────
// Does the live loan book actually read?
//
// Runs the REAL adapter functions against Micromart's ServiceSuite, through the
// same runReadOnlyQuery every console screen uses — so it exercises the road
// selection, the parameter binding and the row mapping, not a hand-written
// approximation of them.
//
//   npx tsx scripts/verify-live-loans.mts
//
// Needs a route to the book: either this host is on the tailnet with
// MICROMART_FINTECH / SERVICESUITE_CONN_MICROMART set, or a relay is configured.
//
// THE ASSERTION THAT MATTERS is the arrears one. LoanSchedule.UnPaidAmount is
// NULL on an unpaid instalment, so the obvious query returns "nothing due, no
// arrears" for the entire book and looks perfectly healthy while doing it. If
// this script ever reports zero loans in arrears against a book with running
// loans, suspect that column before believing the lender collected everything.
// ─────────────────────────────────────────────────────────────────────────────
import * as dotenv from "dotenv";
dotenv.config();

import { getOrg, getEntityId } from "../src/lib/enterprise/connections";
import { listLoansLive, getLoanBookStats } from "../src/lib/lms/servicesuite-loans";

const org = getOrg("micromart");
if (!org) {
  console.error("No registry entry for 'micromart'.");
  process.exit(1);
}
const entityId = getEntityId(org);

console.log(`\nLive loan book — ${org.name}, entity ${entityId}\n`);
if (entityId !== 3005) {
  console.log(`  \x1b[33mNOTE\x1b[0m  entity is ${entityId}, not 3005. 3002 and 3005 hold DIFFERENT PEOPLE.\n`);
}

let failed = 0;
const check = (name: string, cond: boolean, detail = "") => {
  console.log(cond ? `  \x1b[32mPASS\x1b[0m  ${name}` : `  \x1b[31mFAIL\x1b[0m  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failed++;
};

const t0 = Date.now();
const stats = await getLoanBookStats(org, entityId);
console.log(
  `  book: ${stats.total.toLocaleString()} loans · ${stats.active} active · ${stats.cleared.toLocaleString()} cleared · ` +
    `${stats.pending} pending · ${stats.inArrears} in arrears (KSh ${Math.round(stats.arrearsValue).toLocaleString()}) · ` +
    `OLB KSh ${Math.round(stats.olb).toLocaleString()}  [${Date.now() - t0}ms]\n`,
);

check("the book has loans", stats.total > 0);
check("actives and cleareds both present", stats.active > 0 && stats.cleared > 0);
check(
  "arrears is not silently zero across a live book",
  stats.inArrears > 0,
  "every running loan reports no overdue instalment — check LoanSchedule.UnPaidAmount vs amounttopay-AmountPaid",
);

const t1 = Date.now();
const { loans, total } = await listLoansLive(org, entityId, { status: "active", take: 5 });
console.log(`\n  active page: ${loans.length} of ${total} [${Date.now() - t1}ms]`);
for (const l of loans) {
  console.log(
    `    #${l.serviceSuiteId} ${(l.borrowerName ?? "?").slice(0, 22).padEnd(22)} ${(l.product ?? "-").slice(0, 14).padEnd(14)} ` +
      `bal ${String(Math.round(l.balance)).padStart(7)} next ${l.nextDue ? l.nextDue.date.slice(0, 10) : "—"} ` +
      `arrears ${Math.round(l.arrears)}${l.daysInArrears != null ? ` (${l.daysInArrears}d)` : ""}`,
  );
}

check("a page of active loans came back", loans.length > 0);
check("every row carries a borrower name", loans.every((l) => !!l.borrowerName));
check("every active row has a balance", loans.every((l) => l.balance > 0));
check("active rows are typed ACTIVE", loans.every((l) => l.status === "ACTIVE"));
check(
  "at least one active loan has a next instalment",
  loans.some((l) => l.nextDue !== null),
  "no running loan has an outstanding instalment — the UnPaidAmount trap again",
);

const { loans: late, total: lateTotal } = await listLoansLive(org, entityId, { status: "arrears", take: 3 });
console.log(`\n  arrears page: ${late.length} of ${lateTotal}`);
for (const l of late) {
  console.log(
    `    #${l.serviceSuiteId} ${(l.borrowerName ?? "?").slice(0, 22).padEnd(22)} arrears ${Math.round(l.arrears)} (${l.daysInArrears}d)`,
  );
}
check("the arrears filter agrees with the header count", lateTotal === stats.inArrears, `${lateTotal} vs ${stats.inArrears}`);
check("every arrears row actually owes something overdue", late.every((l) => l.arrears > 0 && (l.daysInArrears ?? 0) > 0));

// Search has to find a real customer by their own name.
if (loans[0]?.borrowerName) {
  const term = loans[0].borrowerName.split(/\s+/)[0];
  const { loans: found } = await listLoansLive(org, entityId, { status: "all", q: term, take: 5 });
  check(`search by name ("${term}") returns rows`, found.length > 0);
}

// And by loan id, which is how a support call actually starts.
if (loans[0]) {
  const { loans: byId } = await listLoansLive(org, entityId, { status: "all", q: String(loans[0].serviceSuiteId), take: 2 });
  check("search by loan id finds that exact loan", byId.some((l) => l.serviceSuiteId === loans[0].serviceSuiteId));
}

console.log(failed === 0 ? "\n\x1b[32mAll good\x1b[0m\n" : `\n\x1b[31m${failed} failed\x1b[0m\n`);
process.exit(failed === 0 ? 0 : 1);
