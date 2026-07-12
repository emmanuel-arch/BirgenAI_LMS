// Tests for the approved-limit engine — capacity × risk × the ladder.
//
//   npm run test:limits        (pure — no database, no server)
//
// The danger under test: a limit that flatters. Every ceiling here exists to stop
// a specific loss — the first-cycle cap stops a stranger with a good statement,
// the ladder stops a repeat borrower leaping past their history, the product
// bounds stop the engine promising what the product cannot lend, and a preview
// and an enforcement that disagree would teach borrowers the number is a lie.
import { computeApprovedLimit, classOf, NEW_BORROWER_CAP } from "@/lib/lending/limits";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); }
};

const base = { decision: "APPROVE", priorLoanCount: 0, graduated: false, productMin: 1000, productMax: 300_000 };

console.log("1. Borrower classes");
ok("no history = NEW", classOf({ priorLoanCount: 0, graduated: false }) === "NEW");
ok("one cleared loan = RETURNING", classOf({ priorLoanCount: 1, graduated: false }) === "RETURNING");
ok("five cleared = GRADUATED", classOf({ priorLoanCount: 5, graduated: false }) === "GRADUATED");
ok("the graduated flag alone is enough", classOf({ priorLoanCount: 2, graduated: true }) === "GRADUATED");

console.log("\n2. A new borrower cannot outrun the first-cycle cap");
const richNew = computeApprovedLimit({ ...base, pd: 0.05, avgMonthlyNet: 500_000 });
ok(`KES 500k/month net still caps at ${NEW_BORROWER_CAP.toLocaleString()}`, richNew.approvedLimit === NEW_BORROWER_CAP, String(richNew.approvedLimit));
ok("and the reason says why", richNew.reasons.some((r) => r.code === "LIM_FIRST_CYCLE"));

console.log("\n3. Capacity is 40% of three months' net, discounted by risk");
const modest = computeApprovedLimit({ ...base, pd: 0.05, avgMonthlyNet: 15_000 });
ok("15k net → 18k capacity at low risk", modest.approvedLimit === 18_000, String(modest.approvedLimit));
const risky = computeApprovedLimit({ ...base, pd: 0.3, avgMonthlyNet: 15_000 });
ok("same statement at 30% PD keeps 40% of it (7,000)", risky.approvedLimit === 7_000, String(risky.approvedLimit));
ok("the discount is a named reason", risky.reasons.some((r) => r.code === "LIM_RISK" && r.direction === "down"));

console.log("\n4. The ladder: history with THIS lender raises the ceiling");
const returning = computeApprovedLimit({ ...base, pd: 0.05, avgMonthlyNet: 500_000, priorLoanCount: 2, largestCleared: 30_000 });
ok("2 cleared, largest 30k → 1.5× = 45,000", returning.approvedLimit === 45_000, String(returning.approvedLimit));
const graduated = computeApprovedLimit({ ...base, pd: 0.05, avgMonthlyNet: 500_000, priorLoanCount: 6, graduated: true, largestCleared: 80_000 });
ok("graduated, largest 80k → 2× = 160,000", graduated.approvedLimit === 160_000, String(graduated.approvedLimit));
const smallHistory = computeApprovedLimit({ ...base, pd: 0.05, avgMonthlyNet: 500_000, priorLoanCount: 1, largestCleared: 5_000 });
ok("a tiny history still gets the returning floor (40,000)", smallHistory.approvedLimit === 40_000, String(smallHistory.approvedLimit));

console.log("\n5. The product is the outer wall");
const smallProduct = computeApprovedLimit({ ...base, pd: 0.05, avgMonthlyNet: 500_000, priorLoanCount: 6, graduated: true, largestCleared: 200_000, productMax: 50_000 });
ok("a 50k product caps a 400k ladder at 50k", smallProduct.approvedLimit === 50_000, String(smallProduct.approvedLimit));
const bigMin = computeApprovedLimit({ ...base, pd: 0.05, avgMonthlyNet: 8_000, productMin: 20_000 });
ok("a limit below the product minimum is ZERO, not a small loan", bigMin.approvedLimit === 0, String(bigMin.approvedLimit));
ok("and it says so", bigMin.reasons.some((r) => r.code === "LIM_BELOW_MIN"));

console.log("\n6. Refusals and edges");
ok("a DECLINE decision has no limit", computeApprovedLimit({ ...base, pd: 0.5, decision: "DECLINE", avgMonthlyNet: 100_000 }).approvedLimit === 0);
const noStatement = computeApprovedLimit({ ...base, pd: 0.1, avgMonthlyNet: null });
ok("no statement → history-only floor, capped for a new borrower", noStatement.approvedLimit <= NEW_BORROWER_CAP && noStatement.approvedLimit > 0, String(noStatement.approvedLimit));
ok("…flagged as statement-less", noStatement.reasons.some((r) => r.code === "LIM_NO_STATEMENT"));
const odd = computeApprovedLimit({ ...base, pd: 0.05, avgMonthlyNet: 14_567 });
ok("limits land on 500-shilling steps", odd.approvedLimit % 500 === 0, String(odd.approvedLimit));
ok("every result carries reasons", [richNew, modest, risky, returning, graduated].every((r) => r.reasons.length >= 2));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
