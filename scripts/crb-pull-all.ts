// ─────────────────────────────────────────────────────────────────────────────
// PULL EVERY METROPOL REPORT FOR ONE PERSON, AND FILE EACH ONE.
//
//   npm run crb:all -- --org micromart --phone 254758517032          # dry
//   npm run crb:all -- --org micromart --phone 254758517032 --live   # pulls
//   npm run crb:all -- --org micromart --phone 2547… --live --only 1,3,12
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
// A bureau pull in the console is a DECISION: it runs the report set the lender
// bought, merges the answers into one file, and bills for it. That is the right
// shape for underwriting and the wrong shape for two other questions:
//
//   1. WHICH of Metropol's fourteen reports is this lender actually entitled to,
//      and what does each return for a real person? Nobody could answer that
//      without pulling them one at a time and watching what came back.
//   2. What does the MASTER FILE look like when every scrutiny is its own
//      artifact rather than a merged summary — "Metropol Report 12, pulled on
//      the 2nd, said this", which is the form a report has to be in before it
//      can be aged, weighed, or contributed to the Interchange.
//
// So this pulls each report SEPARATELY, keeps the bureau's raw answer, and files
// each as its own KycCheck row. The merged console pull is untouched and still
// does its job.
//
// ── IT SPENDS REAL MONEY, SO IT REFUSES TO BY DEFAULT ────────────────────────
// Every live pull is billed per report and the tariff scales with depth. Dry is
// the default and prints exactly what WOULD be pulled and the indicative cost;
// --live is the only way to make a request leave the building. There is no
// "pull the whole catalogue for every borrower" mode and there should not be.
//
// ── AND IT GOES OUT THROUGH THE RELAY ────────────────────────────────────────
// Metropol answer only whitelisted IPs, and this laptop is not one. The request
// leaves through the CRB relay on the tailnet (CRB_RELAY_URL), which runs on the
// box that egresses from a whitelisted address — see scripts/crb-relay.mjs. If
// the relay is not configured this script says so rather than timing out against
// the bureau's edge.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import type { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { runAsPlatform } from "../src/lib/db/context";
import { getIntegration } from "../src/lib/vault/integrations";
import { pullSingleReport, type SingleReportResult } from "../src/lib/crb/metropol";
import { CRB_REPORTS, REPORT_REASON } from "../src/lib/crb/catalogue";
import { crbRelayEnabled, crbRelayUrl } from "../src/lib/crb/relay";
import { PER_REPORT_PROVIDER } from "../src/lib/crb/rows";


const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : d;
};
const flag = (n: string) => process.argv.includes(`--${n}`);
const pad = (s: string | number, n: number) => String(s).padEnd(n);
const rpad = (s: string | number, n: number) => String(s).padStart(n);

async function main() {
  const slug = arg("org", "micromart")!;
  const phone = (arg("phone") ?? "").replace(/\D/g, "");
  const live = flag("live");
  const loanAmount = Number(arg("amount", "10000"));
  const only = (arg("only") ?? "").split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);

  if (!phone) throw new Error("Give me a subject: --phone 2547XXXXXXXX");

  const org = await runAsPlatform(() => prisma.org.findFirst({ where: { slug }, select: { id: true, name: true } }));
  if (!org) throw new Error(`No org with slug "${slug}".`);

  const borrower = await runAsPlatform(() => prisma.borrower.findFirst({
    where: { orgId: org.id, phone },
    select: { id: true, firstName: true, otherName: true, nationalId: true, phone: true, erasedAt: true },
  }));
  if (!borrower) throw new Error(`No borrower on ${org.name} with phone ${phone}.`);
  if (borrower.erasedAt) throw new Error("That customer was erased. Nothing may be pulled about them.");
  if (!borrower.nationalId) throw new Error("That customer has no national ID on file — Metropol identify people by ID, not by phone.");

  const name = `${borrower.firstName ?? ""} ${borrower.otherName ?? ""}`.trim();
  const wanted = CRB_REPORTS.filter((r) => (only.length ? only.includes(r.code) : true));
  const cost = wanted.reduce((s, r) => s + r.indicativeTariff, 0);

  console.log(`\n\x1b[1m${org.name}\x1b[0m · subject \x1b[1m${name}\x1b[0m · ID ${borrower.nationalId} · ${borrower.phone}`);
  console.log(`relay: ${crbRelayEnabled() ? crbRelayUrl() : "\x1b[31mNOT CONFIGURED — set CRB_RELAY_URL and CRB_RELAY_SECRET\x1b[0m"}`);
  console.log(`mode : ${live ? "\x1b[33mLIVE — these pulls are billed\x1b[0m" : "\x1b[2mdry run\x1b[0m"}`);
  console.log(`plan : ${wanted.length} reports · indicative cost KES ${cost.toLocaleString()} \x1b[2m(placeholder tariffs — Metropol's sheet is not in the vault yet)\x1b[0m\n`);

  if (!live) {
    console.log("  code  report                          ~KES  depth  what it would add to the master file");
    console.log("  " + "─".repeat(104));
    for (const r of wanted) {
      console.log(`  ${rpad(r.code, 4)}  ${pad(r.name, 30)} ${rpad(r.indicativeTariff, 5)}  ${r.depth.toFixed(2)}   ${r.yields.slice(0, 3).join(", ")}`);
    }
    console.log("\n\x1b[2mDry run — nothing pulled, nothing billed. Re-run with --live.\x1b[0m\n");
    return;
  }

  const cfg = await runAsPlatform(() => getIntegration(org.id, "CRB"));
  if (!cfg) throw new Error(`${org.name} has no CRB integration in the vault.`);
  if (!crbRelayEnabled()) throw new Error("The CRB relay is not configured, and this address is not whitelisted with Metropol. Set CRB_RELAY_URL and CRB_RELAY_SECRET.");

  // Serial, not parallel, and deliberately: fourteen simultaneous requests from
  // one relay is exactly the shape a bureau rate-limits, and a 429 halfway
  // through would leave a half-pulled file that had still been billed for.
  const results: SingleReportResult[] = [];
  for (const def of wanted) {
    process.stdout.write(`  ${rpad(def.code, 4)}  ${pad(def.name, 30)} … `);
    const r = await pullSingleReport(
      cfg as Parameters<typeof pullSingleReport>[0],
      { identityNumber: borrower.nationalId!, identityType: "001" },
      def.code,
      { loanAmount, reportReason: REPORT_REASON.NEW_APPLICATION },
    );
    results.push(r);
    console.log(
      r.ok ? `\x1b[32mOK\x1b[0m   ${rpad(r.ms, 5)}ms  ${Object.keys(r.json ?? {}).length} fields`
      : r.skipped ? `\x1b[2mskip\x1b[0m  ${r.message}`
      : `\x1b[33m${r.apiCode ?? "ERR"}\x1b[0m  ${r.message ?? ""}`.slice(0, 90),
    );
  }

  // ── File each one ──────────────────────────────────────────────────────────
  // Its own row, its own provider, its own raw payload. The merged console pull
  // writes provider "Metropol CRB"; these are told apart by the prefix so the
  // screens that read "the latest bureau file" never pick up a fragment.
  let filed = 0;
  for (const r of results) {
    if (!r.ok) continue;
    const def = CRB_REPORTS.find((d) => d.code === r.code)!;
    await runAsPlatform(() =>
      prisma.kycCheck.create({
        data: {
          orgId: org.id,
          borrowerId: borrower.id,
          kind: "CRB",
          passed: true,
          provider: `${PER_REPORT_PROVIDER}${r.code}`,
          payload: {
            reportCode: r.code,
            reportKey: def.key,
            reportName: def.name,
            answers: def.answers,
            yields: def.yields,
            depth: def.depth,
            indicativeTariff: def.indicativeTariff,
            pulledAt: new Date().toISOString(),
            ms: r.ms,
            // The bureau's own words, untouched. This is the artifact of record.
            raw: r.json,
          } as unknown as Prisma.InputJsonValue,
        },
      }),
    );
    filed++;
  }

  const ok = results.filter((r) => r.ok);
  const soft = results.filter((r) => !r.ok && !r.skipped);
  const skipped = results.filter((r) => r.skipped);
  console.log(`\n\x1b[1mResult\x1b[0m  ${ok.length} answered · ${soft.length} refused · ${skipped.length} not callable`);
  if (soft.length) {
    console.log("\n  Refused, and what the code means:");
    for (const r of soft) console.log(`    ${rpad(r.code, 4)}  ${pad(r.name, 30)} ${r.apiCode ?? "—"}  ${r.message ?? ""}`);
  }
  console.log(`\n  ${filed} report${filed === 1 ? "" : "s"} filed to the master file for ${name}.`);
  console.log(`  Indicative spend: KES ${ok.reduce((s, r) => s + (CRB_REPORTS.find((d) => d.code === r.code)?.indicativeTariff ?? 0), 0).toLocaleString()}\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error("\n\x1b[31m" + (e instanceof Error ? e.message : String(e)) + "\x1b[0m\n"); process.exit(1); });
