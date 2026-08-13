// Try to RECOVER a mistyped VAULT_MASTER_KEY before anyone rotates it away.
//
//   DOTENV_CONFIG_PATH=.env.local npx tsx scripts/recover-vault-key.ts
//   DOTENV_CONFIG_PATH=.env.local npx tsx scripts/recover-vault-key.ts --apply
//
// WHY THIS IS WORTH TRYING. The key must be exactly 64 hex characters. A value that
// is 63 or 65 characters long is almost never "a different key" — it is the right
// key with a character dropped or doubled by a copy-paste. The search space for a
// single-character slip is tiny (64 positions x 16 digits = 1024 candidates for a
// deletion; 65 for an insertion), and AES-256-GCM authenticates its ciphertext, so a
// wrong key CANNOT produce a false positive: it fails the tag check every time.
//
// Rotating the key destroys nothing on disk, but it does strand every stored
// credential permanently. Spending a second on 1024 candidates first is the cheap
// option, and it either recovers five credential sets or rules recovery out.
//
// --apply writes the recovered key into .env.local. The key is NEVER printed.
import "dotenv/config";
import { createDecipheriv } from "crypto";
import { readFileSync, writeFileSync } from "fs";
import { platformPrisma } from "../prisma/seed-client";
import { enterPlatform } from "../src/lib/db/context";

const flag = (k: string) => process.argv.includes(`--${k}`);
const HEX = "0123456789abcdef";
const ENV_PATH = process.env.DOTENV_CONFIG_PATH ?? ".env.local";

/** Does this key decrypt this blob? The GCM auth tag is the oracle. */
function decrypts(keyHex: string, payload: string): boolean {
  try {
    const key = Buffer.from(keyHex, "hex");
    if (key.length !== 32) return false;
    const raw = Buffer.from(payload, "base64");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(raw.length - 16);
    const data = raw.subarray(12, raw.length - 16);
    const d = createDecipheriv("aes-256-gcm", key, iv);
    d.setAuthTag(tag);
    const out = Buffer.concat([d.update(data), d.final()]);
    JSON.parse(out.toString("utf8"));
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const raw = process.env.VAULT_MASTER_KEY ?? "";
  const key = raw.trim();

  // Precise shape report — invisible characters are exactly the sort of thing that
  // makes a correct paste look wrong.
  const codes = [...key].map((c) => c.charCodeAt(0));
  const nonHex = [...key].map((c, i) => ({ c, i })).filter((x) => !/^[0-9a-fA-F]$/.test(x.c));
  console.log(`\nVAULT_MASTER_KEY shape`);
  console.log(`  raw length        ${raw.length}   trimmed ${key.length}`);
  console.log(`  needs             exactly 64 hex characters (32 bytes)`);
  console.log(`  non-hex positions ${nonHex.length === 0 ? "none" : nonHex.map((x) => `${x.i}:U+${x.c.charCodeAt(0).toString(16).padStart(4, "0")}`).join(", ")}`);
  console.log(`  charcode range    ${Math.min(...codes)}–${Math.max(...codes)}`);

  const p = platformPrisma();
  enterPlatform();
  const sample = await p.orgIntegration.findFirst({
    select: { configEnc: true, kind: true, org: { select: { slug: true } } },
    orderBy: { updatedAt: "desc" },
  });
  if (!sample) {
    console.log(`\nNo stored credentials to test against — nothing to recover. Generate a fresh key freely.\n`);
    await p.$disconnect();
    return;
  }
  console.log(`  testing against   ${sample.org.slug} / ${sample.kind}\n`);

  if (key.length === 64 && decrypts(key.toLowerCase(), sample.configEnc)) {
    console.log("The key in your env ALREADY decrypts the vault. Nothing to recover.\n");
    await p.$disconnect();
    return;
  }

  const candidates: string[] = [];
  const lower = key.toLowerCase();
  if (/^[0-9a-f]{63}$/.test(lower)) {
    // A dropped character: reinsert every digit at every position.
    for (let i = 0; i <= 63; i++) for (const h of HEX) candidates.push(lower.slice(0, i) + h + lower.slice(i));
    console.log(`63 hex chars — testing ${candidates.length} single-insertion candidates…`);
  } else if (/^[0-9a-f]{65}$/.test(lower)) {
    // A doubled character: remove each position.
    for (let i = 0; i < 65; i++) candidates.push(lower.slice(0, i) + lower.slice(i + 1));
    console.log(`65 hex chars — testing ${candidates.length} single-deletion candidates…`);
  } else if (/^[0-9a-f]{64}$/.test(lower)) {
    console.log(`64 hex chars but it does not decrypt — this is a DIFFERENT key, not a typo. No recovery possible.`);
  } else {
    console.log(`Not a hex string of length 63/64/65, so a single-character slip is not the explanation.`);
    console.log(`If you pasted a passphrase rather than the generated key, the vault key was never that value.`);
  }

  let found: string | null = null;
  for (const c of candidates) {
    if (decrypts(c, sample.configEnc)) { found = c; break; }
  }

  if (!found) {
    if (candidates.length) console.log(`\nNone of the ${candidates.length} candidates decrypted the vault.`);
    console.log(`\nRecovery has been ruled out. Rotating to a fresh key is now the only path:`);
    console.log(`  1. generate a new 64-hex VAULT_MASTER_KEY`);
    console.log(`  2. npx tsx scripts/vault-audit.ts --mark-stale`);
    console.log(`  3. re-enter each lender's credentials in the console\n`);
    await p.$disconnect();
    return;
  }

  console.log(`\nRECOVERED — a single-character slip. The corrected key decrypts the vault.`);
  const readable = await (async () => {
    const rows = await p.orgIntegration.findMany({ select: { configEnc: true, kind: true, org: { select: { slug: true } } } });
    return rows.filter((r) => decrypts(found!, r.configEnc));
  })();
  console.log(`  it reads ${readable.length} of the stored credential set(s): ${readable.map((r) => `${r.org.slug}/${r.kind}`).join(", ")}`);

  if (!flag("apply")) {
    console.log(`\nDRY RUN — env not modified. Re-run with --apply to write the corrected key.\n`);
    await p.$disconnect();
    return;
  }

  const txt = readFileSync(ENV_PATH, "utf8");
  const line = /^(\s*VAULT_MASTER_KEY\s*=).*$/m;
  if (!line.test(txt)) throw new Error(`VAULT_MASTER_KEY line not found in ${ENV_PATH}`);
  writeFileSync(ENV_PATH, txt.replace(line, (_m, k) => `${k}"${found}"`));
  console.log(`\nAPPLIED — ${ENV_PATH} now holds the corrected 64-character key (not printed).`);
  console.log(`  Restart the dev server so it is picked up.\n`);

  await p.$disconnect();
}

main().then(() => process.exit(0)).catch((e) => { console.error(`\n${e instanceof Error ? e.message : e}\n`); process.exit(1); });
