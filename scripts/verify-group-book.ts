// Smoke-test the group roll-up against a bridged lender's whole server. READ-ONLY.
//
//   DOTENV_CONFIG_PATH=.env.local npx tsx scripts/verify-group-book.ts
//
// The checks that matter are RECONCILIATION: the per-entity rows must sum to the
// totals, and the aging buckets must sum to the open book. A group view whose
// parts do not add up to its whole is worse than no group view, because a lender
// checks exactly that before believing anything else on the screen.
import "dotenv/config";
import { platformPrisma } from "../prisma/seed-client";
import { enterPlatform } from "../src/lib/db/context";
import { getOrg, isOrgConfigured } from "../src/lib/enterprise/connections";
import { getGroupBook, getGroupTrend, staleShare } from "../src/lib/analytics/group";

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
const ORG = arg("org") ?? "micromart";

const fmt = (v: number) => v.toLocaleString("en-KE");
const kes = (v: number) => `KES ${Math.round(v).toLocaleString("en-KE")}`;
const m = (v: number) => `KES ${(v / 1_000_000).toFixed(1)}M`;
let failures = 0;
const ok = (s: string) => console.log(`  + ${s}`);
const bad = (s: string) => { failures++; console.log(`  ! ${s}`); };

async function main() {
  const p = platformPrisma();
  enterPlatform();
  const row = await p.org.findUnique({ where: { slug: ORG }, select: { name: true, mode: true } });
  if (!row) throw new Error(`No org "${ORG}".`);
  const registry = getOrg(ORG);
  if (!registry || !isOrgConfigured(registry)) throw new Error(`${ORG} read connection is not configured.`);

  console.log(`\n${row.name} — group book across every entity on their server\n`);

  const t0 = Date.now();
  const book = await getGroupBook(registry);
  const ms = Date.now() - t0;

  console.log(`1 · ${book.entities.length} entities in ${ms}ms\n`);
  console.log("  entity  name                       borrowers     loans    open           OLB   30d disbursed");
  console.log("  " + "-".repeat(96));
  for (const e of book.entities) {
    console.log(
      `  ${String(e.entityId).padEnd(7)} ${e.name.padEnd(26).slice(0, 26)}` +
      ` ${fmt(e.borrowers).padStart(9)} ${fmt(e.loans).padStart(9)} ${fmt(e.activeLoans).padStart(7)}` +
      ` ${m(e.olbTotal).padStart(13)} ${m(e.disbursed30d).padStart(13)}`,
    );
  }
  const t = book.totals;
  console.log("  " + "-".repeat(96));
  console.log(
    `  GROUP   ${String(t.activeEntities + " active of " + t.entities).padEnd(26)}` +
    ` ${fmt(t.borrowers).padStart(9)} ${fmt(t.loans).padStart(9)} ${fmt(t.activeLoans).padStart(7)}` +
    ` ${m(t.olbTotal).padStart(13)} ${m(t.disbursed30d).padStart(13)}`,
  );

  // ── The check that matters most ───────────────────────────────────────────
  // These are the figures a Micromart manager can read on their OWN dashboard.
  // If ours differ, ours are wrong — no matter how defensible the arithmetic.
  console.log("\n1b · Parity with the lender's own MainDashboard");
  console.log("     (their screen, 13 Aug 2026 — pinned so drift is visible)\n");
  const PINNED: Record<number, { olbTotal: number; olbClean: number; pqs: number; activeLoans: number }> = {
    3002: { olbTotal: 84_476_131.99, olbClean: 56_045_921.18, pqs: 66.35, activeLoans: 9782 },
    3005: { olbTotal: 613_513.0, olbClean: 606_620.0, pqs: 98.88, activeLoans: 46 },
  };
  for (const [idStr, want] of Object.entries(PINNED)) {
    const id = Number(idStr);
    const e = book.entities.find((x) => x.entityId === id);
    if (!e) { bad(`entity ${id} is missing from the group read`); continue; }
    console.log(`  ${e.name}`);
    // A live book moves between their screenshot and our read, so parity is a
    // TOLERANCE, not equality: 2% on money, and loan counts are reported rather
    // than asserted because a single disbursement changes them.
    const near = (got: number, exp: number, tol = 0.02) => exp === 0 ? got === 0 : Math.abs(got - exp) / exp <= tol;
    for (const [label, got, exp] of [
      ["OLB (TOTAL)", e.olbTotal, want.olbTotal],
      ["OLB (CLEAN)", e.olbClean, want.olbClean],
    ] as const) {
      const drift = exp === 0 ? 0 : ((got - exp) / exp) * 100;
      if (near(got, exp)) ok(`${label.padEnd(12)} ${kes(got).padStart(16)} vs their ${kes(exp)} (${drift >= 0 ? "+" : ""}${drift.toFixed(2)}%)`);
      else bad(`${label.padEnd(12)} ${kes(got).padStart(16)} vs their ${kes(exp)} — ${drift.toFixed(1)}% off, the definition does not match`);
    }
    if (Math.abs(e.pqs - want.pqs) <= 1.0) ok(`PQS          ${e.pqs.toFixed(2)}% vs their ${want.pqs}%`);
    else bad(`PQS          ${e.pqs.toFixed(2)}% vs their ${want.pqs}% — CleanOLB/OLB is not their formula`);
    console.log(`    · active loans ${fmt(e.activeLoans)} (their screen showed ${fmt(want.activeLoans)})`);
    console.log(`    · NPL carved out: ${fmt(e.nplCount)} loans / ${m(e.nplAmount)} — the gap between ${m(e.olbAllOpen)} and ${m(e.olbTotal)}\n`);
  }

  console.log("2 · Parts reconcile to the whole");
  const sum = (pick: (e: typeof book.entities[number]) => number) => book.entities.reduce((s, e) => s + pick(e), 0);
  for (const [label, got, want] of [
    ["borrowers", t.borrowers, sum((e) => e.borrowers)],
    ["loans", t.loans, sum((e) => e.loans)],
    ["active loans", t.activeLoans, sum((e) => e.activeLoans)],
    ["OLB (TOTAL)", t.olbTotal, sum((e) => e.olbTotal)], ["NPL amount", t.nplAmount, sum((e) => e.nplAmount)],
    ["30-day disbursement", t.disbursed30d, sum((e) => e.disbursed30d)],
  ] as const) {
    if (got === want) ok(`${label} total equals the sum of its entities (${fmt(got)})`);
    else bad(`${label}: total ${fmt(got)} but entities sum to ${fmt(want)}`);
  }

  console.log("\n3 · Aging buckets account for every open loan");
  for (const e of [...book.entities, { name: "GROUP", entityId: 0, openLoans: t.openLoansAll, aging: t.aging } as const]) {
    const a = e.aging;
    const bucketed = a.current.loans + a.d1to30.loans + a.d31to90.loans + a.d91to365.loans + a.stale.loans;
    if (bucketed === (("openLoansAll" in e ? e.openLoansAll : e.openLoans))) ok(`${e.name}: ${fmt(bucketed)} open loans all fall in a bucket`);
    else bad(`${e.name}: ${fmt(bucketed)} bucketed vs ${fmt("openLoansAll" in e ? e.openLoansAll : e.openLoans)} open — a loan is in no bucket or two`);
  }

  console.log("\n4 · The stale cohort, which is why this is not called PAR");
  for (const e of book.entities) {
    if (e.openLoansAll === 0) continue;
    const s = staleShare(e.aging);
    const loud = s.pctOlb >= 25;
    console.log(
      `  ${loud ? "!" : "+"} ${e.name.padEnd(26).slice(0, 26)} ${fmt(s.loans).padStart(7)} loans` +
      ` · ${m(s.olb).padStart(12)} · ${s.pctOlb.toFixed(1)}% of its open balance is over a year past due`,
    );
  }
  const g = staleShare(t.aging);
  console.log(`\n  Group: ${fmt(g.loans)} loans / ${kes(g.olb)} — ${g.pctOlb.toFixed(1)}% of the open book, ${g.pctLoans.toFixed(1)}% of open loans.`);
  if (g.pctOlb > 20) {
    console.log("  A naive PAR30 from ExpectedClearDate would report this as portfolio at risk.");
    console.log("  It is held out deliberately — see the note on LoanAging in lib/analytics/group.ts.");
  }

  console.log("\n5 · Location coverage across the group");
  if (t.pinned === 0) console.log(`  ! 0 of ${fmt(t.borrowers)} borrowers carry a coordinate — group-wide, not just Fintech.`);
  else console.log(`  + ${fmt(t.pinned)} of ${fmt(t.borrowers)} pinned (${((t.pinned / t.borrowers) * 100).toFixed(1)}%)`);
  if (t.scored === t.borrowers) ok(`every borrower carries a credit score (${fmt(t.scored)})`);
  else console.log(`  · ${fmt(t.scored)} of ${fmt(t.borrowers)} carry a credit score`);

  console.log("\n6 · Twelve-month trend");
  const t1 = Date.now();
  const trend = await getGroupTrend(registry, 12);
  const trendMs = Date.now() - t1;
  const months = [...new Set(trend.map((x) => x.month))].sort();
  console.log(`  ${trend.length} rows across ${months.length} months in ${trendMs}ms`);
  for (const mo of months.slice(-6)) {
    const pts = trend.filter((x) => x.month === mo);
    const tot = pts.reduce((s, x) => s + x.disbursed, 0);
    const cnt = pts.reduce((s, x) => s + x.loans, 0);
    console.log(`    ${mo}  ${fmt(cnt).padStart(6)} loans  ${m(tot).padStart(12)}  across ${pts.length} entities`);
  }
  if (trend.length > 0) ok("the trend returned data"); else bad("the trend came back empty");
  if (trendMs < 30000) ok(`trend inside the route timeout (${trendMs}ms)`); else bad(`trend took ${trendMs}ms`);

  console.log(failures === 0 ? `\nAll checks passed. Group holds ${fmt(t.borrowers)} borrowers and ${kes(t.olbTotal)} outstanding (performing).\n` : `\n${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(`\n${e instanceof Error ? e.stack : e}\n`); process.exit(1); });
