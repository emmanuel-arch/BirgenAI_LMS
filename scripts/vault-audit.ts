// Which per-lender credentials can the CURRENT VAULT_MASTER_KEY actually read?
//
//   DOTENV_CONFIG_PATH=.env.local npx tsx scripts/vault-audit.ts
//   DOTENV_CONFIG_PATH=.env.local npx tsx scripts/vault-audit.ts --mark-stale
//
// After a key rotation the old ciphertext is still sitting in OrgIntegration, and
// getIntegration() quite deliberately swallows the failure ("treat as
// unconfigured, never crash a flow"). That is the right runtime behaviour and the
// wrong thing to leave unsaid: a row still reading CONFIGURED while its secret is
// unreadable will have someone debugging a silent M-Pesa failure for an afternoon.
//
// So this reports readability per row, and `--mark-stale` flips the unreadable ones
// to UNCONFIGURED with a lastError saying why.
//
// IT NEVER DELETES configEnc. A key that turns up in a password manager next week
// can still decrypt every one of these; a deleted blob is gone for good. The blob
// is worthless to an attacker without the key, which is the entire point of it.
//
// Prints no secret values — only which keys are present in each decrypted config.
import "dotenv/config";
import { platformPrisma } from "../prisma/seed-client";
import { enterPlatform } from "../src/lib/db/context";
import { decryptJson, encryptJson } from "../src/lib/vault/crypto";

const flag = (k: string) => process.argv.includes(`--${k}`);
const MARK = flag("mark-stale");

async function main() {
  const raw = process.env.VAULT_MASTER_KEY?.trim() ?? "";
  const keyShape = raw.length === 64 && /^[0-9a-fA-F]{64}$/.test(raw)
    ? "valid (32 bytes hex)"
    : `INVALID — ${raw.length} chars; masterKey() requires exactly 64 hex`;
  console.log(`\nVAULT_MASTER_KEY: ${keyShape}`);

  // Can the vault take a NEW secret? A key that reads nothing might be wrong, or
  // might simply be new — and those need telling apart before anyone re-enters
  // five sets of credentials into something broken.
  try {
    const probe = encryptJson({ probe: "round-trip" });
    const back = decryptJson<{ probe?: string }>(probe);
    console.log(`  round-trip:     ${back.probe === "round-trip" ? "OK — new credentials can be stored and read" : "FAILED — decrypted to the wrong value"}`);
  } catch (e) {
    console.log(`  round-trip:     FAILED — ${e instanceof Error ? e.message : e}`);
  }

  const p = platformPrisma();
  enterPlatform();

  const rows = await p.orgIntegration.findMany({
    select: {
      id: true, kind: true, status: true, configEnc: true, updatedAt: true, lastError: true,
      org: { select: { slug: true, name: true } },
    },
    orderBy: [{ org: { slug: "asc" } }, { kind: "asc" }],
  });

  if (rows.length === 0) {
    console.log("\nNo integration rows exist yet — nothing was lost to the rotation.\n");
    await p.$disconnect();
    return;
  }

  console.log(`\n${rows.length} stored credential set(s):\n`);
  let readable = 0;
  const stale: string[] = [];

  for (const r of rows) {
    let verdict: string;
    try {
      const cfg = decryptJson<Record<string, unknown>>(r.configEnc);
      const fields = Object.keys(cfg).sort().join(", ");
      verdict = `READABLE — fields: ${fields || "(empty)"}`;
      readable++;
    } catch {
      verdict = "UNREADABLE with this key — must be re-entered";
      // Only rows still ADVERTISING themselves as usable need relabelling; ones
      // already marked UNCONFIGURED are telling the truth.
      if (r.status !== "UNCONFIGURED") stale.push(r.id);
    }
    console.log(`  ${r.org.slug.padEnd(18)} ${String(r.kind).padEnd(13)} ${String(r.status).padEnd(13)} ${verdict}`);
  }

  const unreadable = rows.length - readable;
  console.log(`\n  ${readable} readable · ${unreadable} unreadable${stale.length ? ` · ${stale.length} mislabelled` : ""}`);

  if (stale.length === 0) {
    if (unreadable > 0) {
      console.log(`\nEvery unreadable row is already marked UNCONFIGURED, so the console tells the`);
      console.log(`truth. Re-enter these ${unreadable} credential set(s) to bring them back.\n`);
    } else {
      console.log("");
    }
    await p.$disconnect();
    return;
  }

  if (!MARK) {
    console.log(`\nThe unreadable rows still claim their old status, so the console will say`);
    console.log(`"configured" for credentials nothing can actually read.`);
    console.log(`  Fix the labelling: --mark-stale   (sets UNCONFIGURED; keeps the ciphertext)\n`);
    await p.$disconnect();
    return;
  }

  const res = await p.orgIntegration.updateMany({
    where: { id: { in: stale } },
    data: {
      status: "UNCONFIGURED",
      lastError: "Encrypted with a previous VAULT_MASTER_KEY — re-enter these credentials. The ciphertext is retained in case the original key is recovered.",
    },
  });
  console.log(`\nMARKED ${res.count} row(s) UNCONFIGURED. configEnc left intact.\n`);

  await p.$disconnect();
}

main().then(() => process.exit(0)).catch((e) => { console.error(`\n${e instanceof Error ? e.message : e}\n`); process.exit(1); });
