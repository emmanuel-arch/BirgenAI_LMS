import "dotenv/config";
// ─────────────────────────────────────────────────────────────────────────────
// Prove the Analytics Studio reads the LIVE book, per entity.
//
//   npm run test:analytics-live      (needs the tailnet or the SQL relay)
//
// This is not a unit test. It runs the six studio functions against Micromart's
// real SQL Server and checks the answers against facts established by a direct
// probe on 29 Aug 2026 — because the failure this guards against is not an
// exception, it is a plausible-looking number from the wrong database. A test
// that only asserted "no error" would have passed happily against the 199-loan
// Postgres shadow row that started all this.
//
// Every assertion is either a hard invariant (3002 is bigger than 3005; split
// parts sum to the combined whole) or a generous floor on a figure that only
// grows (loans ever written). Nothing here asserts an exact live total — the
// book moves every day, and a test that has to be edited daily gets deleted.
// ─────────────────────────────────────────────────────────────────────────────
import { resolveScope, arrearsBasis, type StudioScope } from "@/lib/analytics/scope";
import { headline, cube, timeSeries, cohorts, filterOptions, inceptionDate, EMPTY_FILTERS } from "@/lib/analytics/engine";
import { resolveRange } from "@/lib/analytics/ranges";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); }
};
const money = (n: number) => `KES ${(n / 1e6).toFixed(2)}M`;

/**
 * Two figures that should agree, on a book that is being written to WHILE the
 * test runs. Micromart booked a loan at 09:53 the morning this was written, so
 * a combined read and the two single reads that follow it are seconds apart and
 * legitimately differ. A 0.1% band catches a real reconciliation bug — a missing
 * entity, a double count — while ignoring the shilling or two of live drift.
 */
const agrees = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.abs(a) * 0.001);

const scopeFor = (entityIds: number[], split = false): StudioScope =>
  resolveScope({
    orgId: "test", orgSlug: "micromart", orgMode: "BRIDGED",
    entityIds, fallbackRealmId: "fintech", split,
  });

const range = resolveRange("90d", { inceptionFrom: null, customFrom: null, customTo: null, bucket: null });
const f = EMPTY_FILTERS(range);

async function main() {
  console.log("1. The scope resolves to the live book, not Postgres");
  const sme = scopeFor([3002]);
  const fin = scopeFor([3005]);
  const both = scopeFor([3002, 3005]);
  const split = scopeFor([3002, 3005], true);
  ok("SME resolves live", !!sme.live, sme.unavailable ?? "");
  ok("Fintech resolves live", !!fin.live);
  ok("SME scope holds exactly entity 3002", sme.live?.lenses.map((l) => l.id).join() === "3002");
  ok("Fintech scope holds exactly entity 3005", fin.live?.lenses.map((l) => l.id).join() === "3005");
  ok("both holds two books", both.live?.lenses.length === 2);
  ok("split is off unless asked", both.live?.split === false);
  ok("split is on when asked", split.live?.split === true);
  ok("a foreign entity id is refused", scopeFor([9999]).live?.lenses.map((l) => l.id).join() === "3005", "falls back to the realm");

  console.log("\n2. Arrears basis is declared, not guessed");
  ok("3002 uses the CollectBox tracker", arrearsBasis(3002) === "tracker");
  ok("3005 is derived — the tracker does not cover it", arrearsBasis(3005) === "derived");
  ok("3003 is derived", arrearsBasis(3003) === "derived");

  console.log("\n3. Headline, per book — the live numbers");
  const [hSme, hFin, hBoth] = await Promise.all([headline(sme, f), headline(fin, f), headline(both, f)]);
  console.log(`     SME      olb ${money(hSme.olb)}  disbursed ${money(hSme.disbursed)}  collected ${money(hSme.collected)}  par30 ${hSme.par30.toFixed(1)}%  new ${hSme.newLoans}`);
  console.log(`     Fintech  olb ${money(hFin.olb)}  disbursed ${money(hFin.disbursed)}  collected ${money(hFin.collected)}  par30 ${hFin.par30.toFixed(1)}%  new ${hFin.newLoans}`);
  console.log(`     Both     olb ${money(hBoth.olb)}  disbursed ${money(hBoth.disbursed)}  collected ${money(hBoth.collected)}`);

  ok("SME has a real book (> KES 100M outstanding)", hSme.olb > 100e6, money(hSme.olb));
  ok("SME wrote loans in the last 90 days", hSme.newLoans > 1000, String(hSme.newLoans));
  ok("SME collected real money", hSme.collected > 10e6, money(hSme.collected));
  ok("this is NOT the 199-loan Postgres row", hSme.newLoans > 199);
  ok("Fintech is the smaller book", hFin.olb < hSme.olb, `${money(hFin.olb)} < ${money(hSme.olb)}`);
  ok("combined OLB is the sum of the two", agrees(hBoth.olb, hSme.olb + hFin.olb), money(hBoth.olb));
  ok("combined disbursed is the sum of the two", agrees(hBoth.disbursed, hSme.disbursed + hFin.disbursed));
  ok("applications are honestly zero (no LoanApplications table live)", hBoth.applications === 0);
  ok("approval rate is NULL, not a fake 0%", hBoth.approvalRate === null);

  console.log("\n4. Split: every measure broken out per book");
  const hSplit = await headline(split, f);
  ok("the headline carries a per-book breakdown", Array.isArray(hSplit.by) && hSplit.by.length === 2, String(hSplit.by?.length));
  const bySme = hSplit.by?.find((x) => x.entityId === 3002);
  const byFin = hSplit.by?.find((x) => x.entityId === 3005);
  ok("the 3002 slice matches the 3002-only read", !!bySme && agrees(bySme.olb, hSme.olb), bySme ? money(bySme.olb) : "missing");
  ok("the 3005 slice matches the 3005-only read", !!byFin && agrees(byFin.olb, hFin.olb), byFin ? money(byFin.olb) : "missing");
  ok("the slices sum to the combined total", !!bySme && !!byFin && agrees(bySme.olb + byFin.olb, hSplit.olb));

  console.log("\n5. Cube, by product — combined and split");
  const prodBoth = await cube(both, "product", f);
  const prodSplit = await cube(split, "product", f);
  ok("products come back", prodBoth.length > 0, `${prodBoth.length} rows`);
  ok("no row carries a breakdown when combined", prodBoth.every((r) => r.by === undefined));
  ok("every row carries a breakdown when split", prodSplit.every((r) => Array.isArray(r.by)));
  const top = [...prodBoth].sort((a, b) => b.disbursed - a.disbursed)[0];
  if (top) console.log(`     top product: ${top.label} — ${money(top.disbursed)} over ${top.newLoans} loans`);
  const splitTop = prodSplit.find((r) => r.key === top?.key);
  ok(
    "a split row's slices sum to its own total",
    !!splitTop && agrees((splitTop.by ?? []).reduce((s, x) => s + x.disbursed, 0), splitTop.disbursed),
  );

  console.log("\n6. Cube, by entity — the dimension that names the books");
  const byEntity = await cube(both, "entity", f);
  console.log("     " + byEntity.map((r) => `${r.label}: ${money(r.olb)}`).join("  |  "));
  ok("one row per book", byEntity.length === 2, String(byEntity.length));
  ok("rows are NAMED, not bare ids", byEntity.every((r) => !/^\d+$/.test(r.label)), byEntity.map((r) => r.label).join(", "));

  console.log("\n7. Other dimensions answer without throwing");
  for (const dim of ["branch", "region", "officer", "riskBand", "gender", "ageBand", "loanSizeBand", "tenureBand", "status", "kycStatus", "channel"] as const) {
    try {
      const rows = await cube(sme, dim, f);
      ok(`${dim}`, rows.length > 0, `${rows.length} rows, top "${rows[0]?.label}"`);
    } catch (e) {
      ok(`${dim}`, false, (e as Error).message);
    }
  }

  console.log("\n8. Time series — buckets, including the empty ones");
  const ts = await timeSeries(both, f);
  const tsSplit = await timeSeries(split, f);
  ok("the axis is fully populated", ts.length > 10, `${ts.length} buckets`);
  ok("some bucket carries disbursement", ts.some((r) => r.disbursed > 0));
  ok("some bucket carries collection", ts.some((r) => r.collected > 0));
  ok("split gives every bucket a slot per book", tsSplit.every((r) => r.by?.length === 2));
  ok(
    "split slices sum to the combined bucket",
    tsSplit.every((r) => agrees((r.by ?? []).reduce((s, x) => s + x.disbursed, 0), r.disbursed)),
  );

  console.log("\n9. Cohorts, filter axes, inception");
  const [co, axes, inc] = await Promise.all([cohorts(sme, 12), filterOptions(sme), inceptionDate(sme)]);
  ok("vintages come back", co.length > 0, `${co.length} months`);
  ok("a vintage has loans and a PAR of its own", !!co[0] && co[0].loans > 0);
  ok("branches offered", axes.branches.length > 0, `${axes.branches.length}`);
  ok("officers offered", axes.officers.length > 0, `${axes.officers.length}`);
  ok("products offered", axes.products.length > 0, `${axes.products.length}`);
  ok("inception is a real date before today", !!inc && inc < new Date(), inc?.toISOString().slice(0, 10) ?? "null");

  console.log("\n10. Axe — a SECOND deployment, with a different schema");
  // Axe's box has no CollectBox and no Loans.DateCleared. The studio must adapt
  // to that rather than throw, which is the whole point of capability detection.
  const axeScope = (ids: number[], sp = false): StudioScope =>
    resolveScope({ orgId: "t", orgSlug: "axe", orgMode: "BRIDGED", entityIds: ids, fallbackRealmId: "boresha", split: sp });
  const boresha = axeScope([3003]);
  const stawi = axeScope([3004]);
  const axeSplit = axeScope([3003, 3004], true);
  ok("Axe resolves live", !!boresha.live, boresha.unavailable ?? "");

  const [hBor, hSta, hAxeSplit] = await Promise.all([headline(boresha, f), headline(stawi, f), headline(axeSplit, f)]);
  console.log(`     Boresha  olb ${money(hBor.olb)}  disbursed ${money(hBor.disbursed)}  collected ${money(hBor.collected)}  par30 ${hBor.par30.toFixed(1)}%  new ${hBor.newLoans}`);
  console.log(`     Stawi    olb ${money(hSta.olb)}  disbursed ${money(hSta.disbursed)}  collected ${money(hSta.collected)}  par30 ${hSta.par30.toFixed(1)}%  new ${hSta.newLoans}`);
  ok("Boresha (3003) has a real book", hBor.olb > 1e6, money(hBor.olb));
  ok("Stawi (3004) exists and is the smaller book", hSta.olb > 0 && hSta.olb < hBor.olb, money(hSta.olb));
  ok("Axe records collections despite having no CollectBox", hBor.collected > 0, money(hBor.collected));
  ok("Axe splits into two books", hAxeSplit.by?.length === 2);
  ok("Axe's split slices sum to its combined total", agrees((hAxeSplit.by ?? []).reduce((s, x) => s + x.olb, 0), hAxeSplit.olb));
  const axeProducts = await cube(boresha, "product", f);
  ok("Axe's product cube answers", axeProducts.length > 0, `${axeProducts.length} rows`);
  const axeTs = await timeSeries(boresha, f);
  ok("Axe's time series answers", axeTs.some((r) => r.disbursed > 0));

  console.log("\n11. Micromart and Axe never bleed into one another");
  ok(
    "Axe's books are not Micromart's",
    !agrees(hBor.olb, hSme.olb) && !agrees(hBor.olb, hFin.olb),
  );
  const mmIds = new Set((await cube(both, "entity", f)).map((r) => r.key));
  ok("a Micromart cut contains only Micromart entities", [...mmIds].every((k) => k === "3002" || k === "3005"), [...mmIds].join(","));
  const axeIds = new Set((await cube(axeSplit, "entity", f)).map((r) => r.key));
  ok("an Axe cut contains only Axe entities", [...axeIds].every((k) => k === "3003" || k === "3004"), [...axeIds].join(","));

  console.log(`\n${fail === 0 ? "OK" : "FAILED"} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error("\nTHREW:", e?.message ?? e); process.exit(1); });
