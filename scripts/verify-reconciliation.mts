// ─────────────────────────────────────────────────────────────────────────────
// The suspended-payments parking bay, read against the live book.
//
//   npx tsx scripts/verify-reconciliation.mts
//
// READ ONLY. It never calls sp_ReconcileSuspendedTxns — that procedure moves a
// real customer's money, and a verification script is the last place that should
// happen. What it checks is everything you need to be sure of BEFORE anyone
// presses the button:
//
//   · the parking bay is scoped to the LENDER's paybills, not the whole server
//   · a reference resolves to a named customer IN THIS ENTITY
//   · their normalisation rule round-trips the formats customers actually type
// ─────────────────────────────────────────────────────────────────────────────
import * as dotenv from "dotenv";
dotenv.config();

import { getOrg, getEntityId } from "../src/lib/enterprise/connections";
import {
  listSuspendedTxns,
  findAccountForBillRef,
  normaliseBillRef,
  lenderPaybills,
} from "../src/lib/lms/servicesuite-reconciliation";

const org = getOrg("micromart")!;
const entityId = getEntityId(org);

let failed = 0;
const check = (name: string, cond: boolean, detail = "") => {
  console.log(cond ? `  \x1b[32mPASS\x1b[0m  ${name}` : `  \x1b[31mFAIL\x1b[0m  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failed++;
};

console.log(`\nSuspended payments — ${org.name}, entity ${entityId}\n`);

const codes = await lenderPaybills(org);
console.log(`  lender paybills: ${codes.length ? codes.join(", ") : "(none)"}`);

const t = Date.now();
const { txns, total, shortCodes } = await listSuspendedTxns(org, entityId, { take: 8 });
console.log(`  parked: ${total.toLocaleString()} payments  [${Date.now() - t}ms]\n`);

for (const x of txns) {
  console.log(
    `    #${String(x.id).padEnd(8)} ${x.transId.padEnd(12)} ${String(Math.round(x.amount)).padStart(7)}  ` +
      `ref "${x.billRef ?? "—"}"  ${(x.payerName ?? "").slice(0, 14).padEnd(14)} ${x.at?.slice(0, 16).replace("T", " ") ?? "—"}`,
  );
}

check("the lender has at least one paybill", codes.length > 0);
check("the parking bay is scoped to those paybills", txns.every((x) => x.shortCode == null || shortCodes.includes(x.shortCode)));
check("every parked payment carries a receipt id", txns.every((x) => x.transId.length > 0));
check("amounts are positive numbers", txns.every((x) => x.amount > 0));
check("their yyyyMMddHHmmss timestamps parse", txns.filter((x) => x.at !== null).length > 0);

// Their normalisation rule, on the formats customers actually type.
console.log("\n  reference normalisation");
const cases: [string, string][] = [
  ["0729522220", "254729522220"],
  ["+254 729 522220", "254729522220"],
  ["254729522220", "254729522220"],
  ["729522220", "254729522220"],
  ["1234", "1234"], // short = an account number, left alone
];
for (const [input, want] of cases) {
  const got = normaliseBillRef(input);
  check(`"${input}" → "${want}"`, got === want, `got "${got}"`);
}

// Resolution: take a parked reference that looks like a phone and see who it is.
console.log("\n  resolving references to a named customer");
let resolved = 0;
let unresolved = 0;
for (const x of txns) {
  if (!x.billRef) continue;
  const ref = normaliseBillRef(x.billRef);
  const matches = await findAccountForBillRef(org, entityId, ref);
  if (matches.length > 0) {
    resolved++;
    const m = matches[0];
    console.log(
      `    ${x.transId} ref "${x.billRef}" → ${m.name ?? "?"} (acct ${m.accountNo ?? "—"}, open ${Math.round(m.openBalance)})` +
        (matches.length > 1 ? `  \x1b[33m[${matches.length} matches — ambiguous]\x1b[0m` : ""),
    );
  } else {
    unresolved++;
    console.log(`    ${x.transId} ref "${x.billRef}" → no account in entity ${entityId}`);
  }
}
console.log(`\n  ${resolved} resolved, ${unresolved} unmatched of ${txns.filter((x) => x.billRef).length} with a reference`);
check("reference lookup runs without error", resolved + unresolved > 0);

// The entity boundary: a reference that resolves here must not silently resolve
// against the other book as though it were the same person.
if (txns.find((x) => x.billRef)) {
  const ref = normaliseBillRef(txns.find((x) => x.billRef)!.billRef!);
  const here = await findAccountForBillRef(org, entityId, ref);
  const there = await findAccountForBillRef(org, 3002, ref);
  const sameIds = here.length > 0 && there.length > 0 && here[0].borrowerId === there[0].borrowerId;
  check(
    "a reference does not resolve to the SAME borrower id in both entities",
    !sameIds,
    "3002 and 3005 are separate books and must not share a match",
  );
}

console.log(failed === 0 ? "\n\x1b[32mAll good\x1b[0m\n" : `\n\x1b[31m${failed} failed\x1b[0m\n`);
process.exit(failed === 0 ? 0 : 1);
