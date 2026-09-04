// Exercise the two new live readers against the real book.
//   npx tsx scripts/probe-loan-file.ts [orgSlug] [loanId] [borrowerId]
import "dotenv/config";
import { ORGS, isOrgConfigured, type OrgSlug } from "../src/lib/enterprise/connections";
import { getLoanLive } from "../src/lib/lms/servicesuite-loan";
import { getBorrowerAttachmentsLive } from "../src/lib/lms/servicesuite-attachments";

async function main() {
  const org = ORGS[(process.argv[2] ?? "micromart-fintech") as OrgSlug];
  if (!isOrgConfigured(org)) throw new Error("not configured");
  const entityId = 3005;
  const loanId = Number(process.argv[3] ?? 444259);
  const borrowerId = Number(process.argv[4] ?? 141483);

  const file = await getLoanLive(org, entityId, loanId);
  if (!file) return console.log("LOAN NOT FOUND");
  console.log("LOAN", JSON.stringify(file.loan, null, 2));
  console.log("BORROWER", JSON.stringify(file.borrower, null, 2));
  console.log("TOTALS", JSON.stringify(file.totals, null, 2));
  console.log("SCHEDULE", file.schedule.length, "rows");
  console.table(file.schedule.map((s) => ({ seq: s.seq, due: s.dueDate, amount: s.due, paid: s.paid, out: s.outstanding, status: s.status })));
  console.log("LEDGER", file.ledger.length, "rows");
  console.table(file.ledger.slice(0, 10).map((t) => ({ at: t.at.slice(0, 10), what: t.narration, ref: t.reference, dir: t.direction, amt: t.amount, bal: t.loanBalance })));

  const atts = await getBorrowerAttachmentsLive(org, entityId, borrowerId);
  console.log("ATTACHMENTS", atts.length);
  console.table(atts.map((a) => ({ id: a.id, label: a.label, group: a.group, kind: a.kind, at: a.capturedAt?.slice(0, 10) ?? "", url: a.thumbUrl.slice(0, 60) })));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
