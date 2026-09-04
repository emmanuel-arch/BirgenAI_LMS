// Prove the statement the console will now render for a live customer.
//   npx tsx scripts/probe-statement.ts [orgSlug] [borrowerId]
import "dotenv/config";
import { ORGS, isOrgConfigured, type OrgSlug } from "../src/lib/enterprise/connections";
import { getCustomerStatementLive } from "../src/lib/lms/servicesuite-statement";

async function main() {
  const org = ORGS[(process.argv[2] ?? "micromart-fintech") as OrgSlug];
  if (!isOrgConfigured(org)) throw new Error("not configured");
  const st = await getCustomerStatementLive(org, 3005, Number(process.argv[3] ?? 141483), { take: 1000 });
  if (!st) return console.log("NOT FOUND");
  console.log("BORROWER", JSON.stringify(st.borrower, null, 2));
  console.log("TOTALS", JSON.stringify(st.totals, null, 2), "truncated:", st.truncated);
  console.log("LOANS", st.loans.length);
  console.table(st.loans.map((l) => ({ id: l.loanId, product: l.product, term: l.installments, principal: l.principal, balance: l.balance, arrears: l.arrears, dpd: l.daysInArrears, taken: l.borrowDate, status: l.status })));
  console.log("LEDGER", st.transactions.length, "rows rendered");
  console.table(st.transactions.map((t) => ({ when: t.at.slice(0, 16).replace("T", " "), what: t.narration, ref: t.reference, loan: t.loanId, dir: t.direction, amount: t.amount, after: t.loanBalance })));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
