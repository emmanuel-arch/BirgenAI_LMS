import "dotenv/config";
// ─────────────────────────────────────────────────────────────────────────────
// Prove the reporting layer against the LIVE books, and prove the files it makes.
//
//   npm run test:reporting        (needs the tailnet or the SQL relay)
//
// Two questions, and the second is the one that gets skipped everywhere:
//   1. does every report run, entity-scoped, and return sane rows?
//   2. does every export actually PRODUCE A VALID FILE? An .xlsx that Excel
//      refuses to open is indistinguishable from a working one until somebody
//      double-clicks it in front of a client, so the magic bytes are asserted.
// ─────────────────────────────────────────────────────────────────────────────
import { resolveScope, type StudioScope } from "@/lib/analytics/scope";
import { REPORTS, reportById } from "@/lib/reporting/definitions";
import { runReport, SCREEN_ROWS } from "@/lib/reporting/run";
import { toCsv, toExcel, toPdf } from "@/lib/reporting/export";
import { reportFilename } from "@/lib/reporting/naming";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); }
};

const scopeFor = (slug: string, ids: number[], fallback: string): StudioScope =>
  resolveScope({ orgId: "t", orgSlug: slug, orgMode: "BRIDGED", entityIds: ids, fallbackRealmId: fallback, split: false });

const to = new Date();
const from = new Date(to.getTime() - 30 * 86400000);
const base = { from, to, branchIds: [] as number[], officerIds: [] as number[] };

async function main() {
  console.log("1. Every report runs on Micromart SME (3002)");
  const sme = scopeFor("micromart", [3002], "sme");
  const totals: Record<string, number> = {};
  for (const def of REPORTS) {
    try {
      const r = await runReport(sme, def.id, { ...base, limit: SCREEN_ROWS });
      totals[def.id] = r.rows.length;
      const cols = new Set(Object.keys(r.rows[0] ?? {}));
      const missing = def.columns.filter((c) => r.rows.length > 0 && !cols.has(c.key)).map((c) => c.key);
      ok(`${def.name}`, r.rows.length >= 0 && missing.length === 0,
        `${r.rows.length} rows in ${r.elapsedMs}ms${missing.length ? ` — MISSING ${missing.join(",")}` : ""}`);
    } catch (e) {
      ok(`${def.name}`, false, (e as Error).message.slice(0, 150));
    }
  }

  console.log("\n2. The numbers are the live book, not a shadow of it");
  const olb = await runReport(sme, "olb", { ...base, limit: 5000 });
  const olbSum = olb.rows.reduce((s, r) => s + Number(r.olb ?? 0), 0);
  ok("OLB returns real loans", olb.rows.length > 100, `${olb.rows.length} rows`);
  ok("OLB rows carry a balance", olbSum > 1_000_000, `KES ${(olbSum / 1e6).toFixed(1)}M in the top ${olb.rows.length}`);
  const arrears = await runReport(sme, "arrears", { ...base, limit: 5000 });
  ok("Arrears is a POSITION, not one row", arrears.rows.length > 100, `${arrears.rows.length} rows (theirs returned 1)`);
  ok("Arrears is sorted worst-first", arrears.rows.length < 2 || Number(arrears.rows[0].dpd) >= Number(arrears.rows[1].dpd));
  const par = await runReport(sme, "par-branch", { ...base, limit: 200 });
  ok("PAR by branch covers the network", par.rows.length > 5, `${par.rows.length} branches`);
  ok("PAR % is a real ratio", par.rows.every((r) => Number(r.par30Pct) >= 0 && Number(r.par30Pct) <= 100));

  console.log("\n3. Every report is entity-scoped — the fintech book is its own");
  const fin = scopeFor("micromart", [3005], "fintech");
  const finOlb = await runReport(fin, "olb", { ...base, limit: 5000 });
  const finSum = finOlb.rows.reduce((s, r) => s + Number(r.olb ?? 0), 0);
  ok("fintech OLB is much smaller than SME", finSum < olbSum, `KES ${(finSum / 1e6).toFixed(2)}M vs ${(olbSum / 1e6).toFixed(1)}M`);
  ok("fintech returns its own rows", finOlb.rows.length > 0 && finOlb.rows.length !== olb.rows.length);

  console.log("\n4. Axe runs the same reports on its own server");
  const axe = scopeFor("axe", [3003], "boresha");
  for (const id of ["olb", "arrears", "disbursement", "par-branch", "collection-rate"]) {
    try {
      const r = await runReport(axe, id, { ...base, limit: 200 });
      ok(`Axe · ${reportById(id)!.name}`, true, `${r.rows.length} rows in ${r.elapsedMs}ms`);
    } catch (e) {
      ok(`Axe · ${id}`, false, (e as Error).message.slice(0, 130));
    }
  }

  console.log("\n5. The files are real files");
  const r = await runReport(sme, "par-branch", { ...base, limit: 500 });
  const csv = toCsv(r, "Micromart Africa");
  ok("CSV has provenance and a header row", csv.startsWith("# Lender:") && csv.includes("Branch,"));
  // The real risk: a customer called "O'Brien, Ltd" silently becoming two
  // columns, which shifts every field after it by one for that row only.
  const nasty = {
    def: { ...r.def, columns: [{ key: "a", label: "Name", format: "text" as const }, { key: "b", label: "Amount", format: "money" as const }] },
    rows: [{ a: 'O\'Brien, Ltd "Trading"', b: 1200 }, { a: "line\nbreak", b: 5 }],
    truncated: false, elapsedMs: 0, books: r.books, params: r.params,
  };
  const nastyCsv = toCsv(nasty, "Test");
  ok("a comma inside a value is quoted", nastyCsv.includes('"O\'Brien, Ltd ""Trading"""'));
  ok("an embedded quote is doubled", nastyCsv.includes('""Trading""'));
  ok("a newline inside a value is quoted", nastyCsv.includes('"line\nbreak"'));

  const xlsx = await toExcel(r, "Micromart Africa");
  // PK\x03\x04 — an xlsx is a zip. Anything else will not open.
  ok("XLSX is a real workbook", xlsx.length > 5000 && xlsx[0] === 0x50 && xlsx[1] === 0x4b, `${(xlsx.length / 1024).toFixed(0)} KB`);

  const pdf = await toPdf(r, "Micromart Africa");
  ok("PDF is a real PDF", pdf.length > 2000 && pdf.subarray(0, 5).toString() === "%PDF-", `${(pdf.length / 1024).toFixed(0)} KB`);

  console.log("\n6. The naming convention");
  const stock = reportFilename({ org: "Micromart Africa", books: ["SME"], subject: "Outstanding book (OLB)", period: null, ext: "xlsx", at: new Date(2026, 7, 29, 14, 32) });
  const ranged = reportFilename({ org: "Micromart Africa", books: ["SME"], subject: "Arrears", period: { from: new Date(2026, 6, 30), to: new Date(2026, 7, 29) }, ext: "pdf", at: new Date(2026, 7, 29, 14, 32) });
  const both = reportFilename({ org: "Axe Capital", books: ["Boresha", "Stawi"], subject: "PAR by branch", period: null, ext: "csv", at: new Date(2026, 7, 29, 9, 5) });
  console.log(`     ${stock}\n     ${ranged}\n     ${both}`);
  ok("a stock report is named as-at", stock === "Micromart-Africa_SME_Outstanding-book-OLB_as-at-2026-08-29_20260829-1432.xlsx", stock);
  ok("a period report carries both dates", ranged.includes("2026-07-30_2026-08-29"), ranged);
  ok("two books are never named after one", both.includes("_All-Books_"), both);
  ok("nothing hostile to a filesystem survives", [stock, ranged, both].every((n) => !/[\\/:*?"<>| ]/.test(n)));

  console.log("\n7. An unreachable book refuses rather than returning an empty report");
  const dead = resolveScope({ orgId: "t", orgSlug: "buysimu", orgMode: "BRIDGED", entityIds: [], fallbackRealmId: null, split: false });
  let refused = false;
  try { await runReport(dead, "olb", { ...base, limit: 10 }); } catch { refused = true; }
  ok("a report on an unconfigured book throws, not returns []", refused);

  console.log(`\n${fail === 0 ? "OK" : "FAILED"} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error("\nTHREW:", e?.message ?? e); process.exit(1); });
