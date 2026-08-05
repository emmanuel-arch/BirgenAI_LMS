// ─────────────────────────────────────────────────────────────────────────────
// Publish Micromart's credit policy — ServiceSuite parity, with the two departures
// named in lib/decision/policy.ts (MICROMART_POLICY).
//
//   npx tsx scripts/seed-micromart-policy.ts --dry     # show the impact, write nothing
//   npx tsx scripts/seed-micromart-policy.ts           # publish it
//
// ALWAYS RUNS THE IMPACT FIRST. A credit policy is the most expensive document a
// lender owns; publishing one without knowing who it moves is how a book gets
// repriced by accident. `--dry` is the same arithmetic minus the write.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { platformPrisma } from "../prisma/seed-client";
import { enterPlatform, runWithOrg } from "../src/lib/db/context";
import { read, publish } from "../src/lib/config/store";
import { MICROMART_POLICY, validateCreditPolicy, type CreditPolicy } from "../src/lib/decision/policy";
import { creditPolicyImpact } from "../src/lib/risk/policy-impact";

const kes = (n: number) => `KES ${Math.round(n).toLocaleString("en-KE")}`;

async function main() {
  const dry = process.argv.includes("--dry");
  const p = platformPrisma();
  enterPlatform();

  const org = await p.org.findUnique({ where: { slug: "micromart" }, select: { id: true, name: true } });
  if (!org) throw new Error('No org with slug "micromart".');
  console.log(`Org: ${org.name}\n`);

  const issues = validateCreditPolicy(MICROMART_POLICY);
  if (issues.length) {
    console.log("Policy is invalid — nothing published:");
    for (const i of issues) console.log(`  ${i.path}: ${i.message}`);
    process.exit(1);
  }
  console.log("Policy validates.");

  const current = await read<CreditPolicy>(org.id, "credit");
  console.log(current.isDefault ? "Currently: platform defaults (never published)." : `Currently: v${current.version}.`);

  const impact = await runWithOrg(org.id, () =>
    creditPolicyImpact(org.id, current.value, MICROMART_POLICY, { sample: 250, includeNames: false }),
  );
  console.log(
    `\nImpact on the live book — ${impact.changed} of ${impact.sampled} sampled land somewhere else` +
    (impact.truncated ? ` (book is ${impact.book})` : ""),
  );
  console.log(`  scoreable   ${impact.scored}/${impact.sampled}`);
  console.log(`  bands       ${impact.bands.map((b) => `${b.label} ${b.before}→${b.after}`).join(" · ")}`);
  console.log(`  moves       ${JSON.stringify(impact.moves)}`);
  console.log(`  exposure    ${kes(impact.exposureBefore)} → ${kes(impact.exposureAfter)}  (Δ ${kes(impact.limitDelta)})`);
  if (impact.movers.length) {
    console.log("  biggest movers (worst first):");
    for (const m of impact.movers.slice(0, 5)) {
      console.log(`    ${m.borrowerId.slice(0, 8)}  ${kes(m.before.limit)} → ${kes(m.after.limit)}  (${m.limitDelta >= 0 ? "+" : "−"}${kes(Math.abs(m.limitDelta))})  ${m.before.categoryLabel ?? "unscored"} → ${m.after.categoryLabel ?? "unscored"}`);
    }
  }

  console.log("\nWhat this policy says:");
  const b = MICROMART_POLICY.behaviour;
  const g = MICROMART_POLICY.graduation;
  const c = MICROMART_POLICY.capacity;
  console.log(`  scoring     ${b.factors.filter((f) => f.enabled).map((f) => `${f.label} ${f.weight}%`).join(" + ")} over the last ${b.window.lookbackLoans} loan(s)${b.window.includeActive ? " incl. live" : ", cleared only"}`);
  console.log(`  categories  ${b.categories.map((x) => `${x.label} ≥${x.minScore} earns ${x.graduationPercent}%`).join(" · ")}`);
  console.log(`  graduation  ${g.requireClearedLoans} cleared, ${g.requireSamePrincipalCycles} at the same principal · basis ${g.basis} · cap ${kes(g.capPerStep)}/step · ${g.trigger}`);
  console.log(`  reference   ${c.referenceTermCount} ${c.referenceTermUnit}s at ${c.referenceAllInPct}% all-in (Micro Eazy's own shape)`);
  console.log(`  ceilings    ${Object.entries(MICROMART_POLICY.scoreCeilings).map(([k, v]) => `${k} ${kes(v)}`).join(" · ")}`);
  console.log(`  verdict     decline below ${MICROMART_POLICY.verdict.autoDeclineBelow} · auto-approve above ${MICROMART_POLICY.verdict.autoApproveAbove} (nothing auto-approves at launch)`);

  if (dry) {
    console.log("\n--dry: nothing written.");
    await p.$disconnect();
    return;
  }

  const res = await publish(org.id, "credit", MICROMART_POLICY, null);
  if (!res.ok) {
    console.log("\nRejected:");
    for (const i of res.issues) console.log(`  ${i.path}: ${i.message}`);
    process.exit(1);
  }
  console.log(`\nPublished as v${res.version}. The previous revision is kept — the credit screen can roll back to it.`);
  await p.$disconnect();
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
