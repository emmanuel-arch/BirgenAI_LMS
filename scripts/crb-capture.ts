// ─────────────────────────────────────────────────────────────────────────────
// CAPTURE METROPOL'S EXACT ANSWERS FOR ONE NATIONAL ID, AND FILE THEM TO DISK.
//
//   npx tsx scripts/crb-capture.ts --id 30058967 --only 5,10,13,14,1,2,6
//   npx tsx scripts/crb-capture.ts --id 30058967 --only 5,10,13,14 --live
//
// ── HOW THIS DIFFERS FROM crb-pull-all.ts ────────────────────────────────────
// That script pulls a BORROWER's file and writes a KycCheck row against them —
// the right shape for underwriting, and the wrong shape here. This one exists
// for a single purpose: capturing the bureau's response byte for byte so the
// Interchange preview gallery can show what a live request actually returns.
//
// So it differs in three ways that matter:
//
//   1. IT TAKES A NATIONAL ID, not a phone. There is no borrower lookup, so a
//      subject who is not on this lender's book can still be captured.
//   2. IT WRITES NOTHING TO THE DATABASE. A capture for a gallery has no
//      business creating customer records on a production LMS that ten
//      companies share. The vault is read, and nothing else is touched.
//   3. IT KEEPS THE WIRE FORMAT. Each answer is written verbatim with its
//      SHA-256, because "Metropol's exact response" is a product promise, and
//      a response that has been through a mapper is no longer that.
//
// ── IT SPENDS REAL MONEY ─────────────────────────────────────────────────────
// Dry is the default and prints exactly what would be pulled. --live is the
// only way a request leaves the building, and the run is recorded in a manifest
// beside the captures so a bill can be reconciled against it afterwards.
//
// The request leaves through the CRB relay (CRB_RELAY_URL) on the whitelisted
// host — Metropol drop anything from an unregistered source address without so
// much as a 403, so a direct call from here would simply hang.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { prisma } from "../src/lib/prisma";
import { runAsPlatform } from "../src/lib/db/context";
import { getIntegration } from "../src/lib/vault/integrations";
import { pullSingleReport, type SingleReportResult } from "../src/lib/crb/metropol";
import { CRB_REPORTS, REPORT_REASON } from "../src/lib/crb/catalogue";
import { crbRelayEnabled, crbRelayUrl } from "../src/lib/crb/relay";

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : d;
};
const flag = (n: string) => process.argv.includes(`--${n}`);
const pad = (s: string | number, n: number) => String(s).padEnd(n);
const rpad = (s: string | number, n: number) => String(s).padStart(n);
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function main() {
  const slug = arg("org", "micromart")!;
  const identityNumber = (arg("id") ?? "").replace(/\s+/g, "");
  const identityType = arg("idtype", "001")!;
  const live = flag("live");
  const loanAmount = Number(arg("amount", "10000"));
  const reason = Number(arg("reason", String(REPORT_REASON.NEW_APPLICATION)));
  const only = (arg("only") ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);

  if (!identityNumber) throw new Error("Give me a subject: --id 30058967");
  if (!only.length) throw new Error("Say which reports: --only 5,10,13,14");

  const outRoot = resolve(arg("out", "../reports/crb")!);
  const stamp = new Date().toISOString().slice(0, 10);
  const outDir = join(outRoot, `CRB-${identityNumber}-${stamp}-raw`);

  const org = await runAsPlatform(() => prisma.org.findFirst({ where: { slug }, select: { id: true, name: true } }));
  if (!org) throw new Error(`No org with slug "${slug}".`);

  // Order the run the way the catalogue orders it, whatever order --only gave,
  // so two runs of the same set are comparable line for line.
  const wanted = CRB_REPORTS.filter((r) => only.includes(r.code)).sort((a, b) => a.code - b.code);
  const missing = only.filter((c) => !wanted.some((w) => w.code === c));
  const cost = wanted.reduce((s, r) => s + r.indicativeTariff, 0);

  console.log(`\n\x1b[1m${org.name}\x1b[0m · subject ID \x1b[1m${identityNumber}\x1b[0m (type ${identityType})`);
  console.log(`relay : ${crbRelayEnabled() ? crbRelayUrl() : "\x1b[31mNOT CONFIGURED\x1b[0m"}`);
  console.log(`mode  : ${live ? "\x1b[33mLIVE — these pulls are billed\x1b[0m" : "\x1b[2mdry run\x1b[0m"}`);
  console.log(`out   : ${outDir}`);
  console.log(`plan  : ${wanted.length} reports · indicative KES ${cost.toLocaleString()} \x1b[2m(placeholder tariffs)\x1b[0m`);
  if (missing.length) console.log(`\x1b[33mnote  : ${missing.join(", ")} are not in the catalogue and will not be pulled.\x1b[0m`);
  console.log();

  for (const r of wanted) {
    const already = existsSync(join(outDir, `report-${r.code}.json`));
    console.log(`  ${rpad(r.code, 4)}  ${pad(r.name, 32)} ${rpad(r.indicativeTariff, 5)}  ${already ? "\x1b[2malready captured today\x1b[0m" : ""}`);
  }

  if (!live) {
    console.log("\n\x1b[2mDry run — nothing pulled, nothing billed. Re-run with --live.\x1b[0m\n");
    return;
  }

  const cfg = await runAsPlatform(() => getIntegration(org.id, "CRB"));
  if (!cfg) throw new Error(`${org.name} has no CRB integration in the vault.`);
  if (!crbRelayEnabled()) {
    throw new Error("The CRB relay is not configured and this address is not whitelisted with Metropol. Set CRB_RELAY_URL and CRB_RELAY_SECRET.");
  }

  mkdirSync(outDir, { recursive: true });
  console.log();

  // Serial, never parallel. Seven simultaneous requests from one relay address
  // is the exact shape a bureau rate-limits, and a 429 halfway through leaves a
  // half-captured set that has still been billed for.
  const results: (SingleReportResult & { sha256?: string })[] = [];
  for (const def of wanted) {
    process.stdout.write(`  ${rpad(def.code, 4)}  ${pad(def.name, 32)} … `);
    const r = await pullSingleReport(
      cfg as Parameters<typeof pullSingleReport>[0],
      { identityNumber, identityType },
      def.code,
      { loanAmount, reportReason: reason as 1 | 2 | 3 | 4 },
    );

    let hash: string | undefined;
    if (r.ok && r.json) {
      // Two spaces, stable key order as the bureau sent it. The hash is over
      // the bytes we write, so "the file on disk is what Metropol said" is a
      // claim anyone can re-check without our code.
      const body = JSON.stringify(r.json, null, 2) + "\n";
      hash = sha256(body);
      writeFileSync(join(outDir, `report-${def.code}.json`), body);
      writeFileSync(
        join(outDir, `report-${def.code}.meta.json`),
        JSON.stringify(
          {
            reportType: def.code,
            reportKey: def.key,
            reportName: def.name,
            subject: { identityNumber, identityType },
            pulledAt: new Date().toISOString(),
            ms: r.ms,
            sha256: hash,
            reportReason: reason,
            loanAmount,
            bureau: "Metropol Credit Reference Bureau",
            via: crbRelayUrl(),
            note: "Metropol's response body exactly as sent. Nothing mapped, merged or reordered.",
          },
          null,
          2,
        ) + "\n",
      );
    }
    results.push({ ...r, sha256: hash });

    console.log(
      r.ok ? `\x1b[32mOK\x1b[0m   ${rpad(r.ms, 5)}ms  ${Object.keys(r.json ?? {}).length} fields  ${hash?.slice(0, 12)}…`
      : r.skipped ? `\x1b[2mskip\x1b[0m  ${r.message}`
      : `\x1b[33m${r.apiCode ?? "ERR"}\x1b[0m  ${(r.message ?? "").slice(0, 80)}`,
    );
  }

  // ── The manifest ───────────────────────────────────────────────────────────
  // Appended to, never overwritten: a second run on another day is another set
  // of billed pulls and the record of what was spent has to survive it.
  const manifestPath = join(outDir, "captures.json");
  const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { runs: [] };
  previous.runs.push({
    ranAt: new Date().toISOString(),
    org: org.name,
    subject: { identityNumber, identityType },
    reportReason: reason,
    loanAmount,
    via: crbRelayUrl(),
    reports: results.map((r) => ({
      reportType: r.code,
      name: r.name,
      ok: r.ok,
      apiCode: r.apiCode,
      message: r.message,
      ms: r.ms,
      sha256: r.sha256 ?? null,
      indicativeTariff: CRB_REPORTS.find((d) => d.code === r.code)?.indicativeTariff ?? null,
    })),
    billedReports: results.filter((r) => r.ok).length,
    indicativeSpend: results.filter((r) => r.ok).reduce((s, r) => s + (CRB_REPORTS.find((d) => d.code === r.code)?.indicativeTariff ?? 0), 0),
  });
  writeFileSync(manifestPath, JSON.stringify(previous, null, 2) + "\n");

  const ok = results.filter((r) => r.ok);
  const soft = results.filter((r) => !r.ok && !r.skipped);
  const skipped = results.filter((r) => r.skipped);
  console.log(`\n\x1b[1mResult\x1b[0m  ${ok.length} answered · ${soft.length} refused · ${skipped.length} not callable`);
  if (soft.length) {
    console.log("\n  Refused, and what the code means:");
    for (const r of soft) console.log(`    ${rpad(r.code, 4)}  ${pad(r.name, 32)} ${r.apiCode ?? "—"}  ${r.message ?? ""}`);
  }
  console.log(`\n  Written to ${outDir}`);
  console.log(`  Indicative spend this run: KES ${ok.reduce((s, r) => s + (CRB_REPORTS.find((d) => d.code === r.code)?.indicativeTariff ?? 0), 0).toLocaleString()}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n\x1b[31m" + (e instanceof Error ? e.message : String(e)) + "\x1b[0m\n");
    process.exit(1);
  });
