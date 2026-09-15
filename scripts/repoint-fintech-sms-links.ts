// Repoint the two Micro Eazy migration procs' customer messages from
// portal.servicesuitecloud.com to microeazy.servicesuitecloud.com.
//
//   npx tsx scripts/repoint-fintech-sms-links.ts            # dry run, writes both versions to disk
//   npx tsx scripts/repoint-fintech-sms-links.ts --apply    # ALTER live
//   (PROBE_OUT=<dir> chooses where the ORIGINAL/REPOINTED copies go; default: OS temp)
//
// WHY: since 15 Sep 2026 portal. is Micromart's own PWA; the fintech app is
// microeazy. — and sp_MicroEazy_MigrateDormantToFintech runs nightly at 23:30,
// sending every moved customer an SMS and email that names the app's address.
// fintech-migration/10, 11 and 13 already carry the new address; this brings
// the live procedures in line without re-running those scripts.
//
// Takes the LIVE definition, changes ONLY the two URL literals, and ALTERs it in
// place — so permissions stay, and nothing else about the procedure can drift.
// Both procedures are ours (created 8 and 10 Sep 2026), referenced by no other
// module, with no explicit grants. Originals are written to PROBE_OUT first; the
// rollback is ALTERing them back. Needs the relay armed for writes (/health).
import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runReadOnlyQuery, execNonQuery } from "../src/lib/enterprise/mssql";
import { getOrg } from "../src/lib/enterprise/connections";

const OUT = process.env.PROBE_OUT?.trim() || join(tmpdir(), "repoint-fintech-sms-links");
mkdirSync(OUT, { recursive: true });
const APPLY = process.argv.includes("--apply");
const FROM = "portal.servicesuitecloud.com";
const TO = "microeazy.servicesuitecloud.com";
const org = getOrg("micromart")!;

async function definition(name: string) {
  const { rows } = await runReadOnlyQuery(org,
    `SELECT m.definition, m.uses_ansi_nulls, m.uses_quoted_identifier FROM sys.sql_modules m JOIN sys.objects o ON o.object_id=m.object_id WHERE o.name='${name}' AND o.schema_id=SCHEMA_ID('dbo')`,
    [], { timeoutMs: 28_000, maxRows: 1 });
  if (rows.length !== 1) throw new Error(`${name}: expected one definition, got ${rows.length}`);
  return rows[0] as { definition: string; uses_ansi_nulls: boolean; uses_quoted_identifier: boolean };
}

async function main() {
  for (const name of ["sp_MicroEazy_MigrateDormantToFintech", "sp_MicroEazy_MoveCustomerToFintech"]) {
    const live = await definition(name);
    const def = String(live.definition);
    const hits = def.split(FROM).length - 1;
    if (!live.uses_ansi_nulls || !live.uses_quoted_identifier) throw new Error(`${name}: created with non-default SET options; refusing`);
    if (hits !== 2) throw new Error(`${name}: expected 2 occurrences of ${FROM}, found ${hits}; refusing`);

    const header = /\bCREATE\s+(?:OR\s+ALTER\s+)?PROC(?:EDURE)?\b/i;
    const m = header.exec(def);
    if (!m) throw new Error(`${name}: no CREATE PROCEDURE header found`);
    // Only comments/whitespace may precede the header.
    const before = def.slice(0, m.index).replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "").trim();
    if (before) throw new Error(`${name}: unexpected text before the header; refusing`);

    const next = def.slice(0, m.index) + "ALTER PROCEDURE" + def.slice(m.index + m[0].length);
    const altered = next.split(FROM).join(TO);

    writeFileSync(`${OUT}/${name}.ORIGINAL.sql`, def);
    writeFileSync(`${OUT}/${name}.REPOINTED.sql`, altered);

    // Everything except the two literals and the header keyword must be identical.
    const anyHeader = /\b(?:CREATE\s+(?:OR\s+ALTER\s+)?|ALTER\s+)PROC(?:EDURE)?\b/i;
    const normalise = (s: string) => s.replace(anyHeader, "HDR").split(FROM).join("URL").split(TO).join("URL");
    if (normalise(def) !== normalise(altered)) throw new Error(`${name}: diff is wider than the URL; refusing`);

    console.log(`${name}: ${hits} literal(s) → ${TO}; header "${m[0]}" → ALTER PROCEDURE`);
    if (!APPLY) { console.log("  (dry run — pass --apply)"); continue; }

    await execNonQuery(org, altered, [], { timeoutMs: 30_000 });
    const after = await definition(name);
    const a = String(after.definition);
    console.log(`  applied. now: ${a.split(FROM).length - 1} × portal, ${a.split(TO).length - 1} × microeazy, ansi_nulls=${after.uses_ansi_nulls} quoted_identifier=${after.uses_quoted_identifier}`);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error("✗", e?.message ?? e); process.exit(1); });
