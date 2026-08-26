// ─────────────────────────────────────────────────────────────────────────────
// Mint this node's Ed25519 identity for one or more Interchange members.
//
//   npx tsx scripts/interchange-keygen.ts KE/LENDER/AXE-3003 KE/LENDER/AXE-3004
//
// ── WHY THIS RUNS HERE AND NOT IN THE REGISTRY ───────────────────────────────
// The Registry has a generate-keys script and its own header calls it a
// development fixture, for the right reason: a file holding every member's
// PRIVATE key would let whoever holds it impersonate the entire ecosystem, which
// defeats the point of signing rather than sharing a secret.
//
// So the private half is born here, in the node that will use it, and never
// travels. Only the public half goes to the Registry — and a public key is
// exactly the thing that is safe to publish.
//
// ── THE SECRET IS NEVER PRINTED ──────────────────────────────────────────────
// It is written straight into INTERCHANGE_NODE_KEYS in .env. A private key echoed
// to a terminal ends up in scrollback, in a screen share, and in whatever
// captures CI output — and a leaked node key is impersonation of a lender inside
// a credit network. What this prints is the public key and the command to
// register it.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { ed25519 } from "@noble/curves/ed25519.js";

const ENV_FILE = ".env";
const VAR = "INTERCHANGE_NODE_KEYS";

function hex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** Read the current key map out of .env without disturbing anything else. */
function readKeys(env: string): Record<string, string> {
  const m = env.match(new RegExp(`^${VAR}\\s*=\\s*'([^']*)'`, "m"));
  if (!m) return {};
  try {
    return JSON.parse(m[1]) as Record<string, string>;
  } catch {
    throw new Error(`${VAR} in ${ENV_FILE} is not valid JSON. Fix it by hand before re-running.`);
  }
}

/**
 * Single-quoted, because the value is JSON full of double quotes and dotenv
 * treats single quotes as a literal string with no expansion.
 */
function writeKeys(env: string, keys: Record<string, string>): string {
  const line = `${VAR}='${JSON.stringify(keys)}'`;
  const re = new RegExp(`^${VAR}\\s*=.*$`, "m");
  if (re.test(env)) return env.replace(re, line);
  return `${env.replace(/\s*$/, "")}\n\n# Ed25519 node identities — one per Interchange member this deployment speaks for.\n# Private keys. Never commit, never send, never print.\n${line}\n`;
}

const codes = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (codes.length === 0) {
  console.error("\nUsage: npx tsx scripts/interchange-keygen.ts <MEMBER_CODE> [MEMBER_CODE...]\n");
  process.exit(2);
}

const env = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
const keys = readKeys(env);

const minted: { code: string; publicKey: string }[] = [];
const kept: string[] = [];

for (const code of codes) {
  if (keys[code]) {
    // Re-minting would silently invalidate the key the Registry has on file for
    // this member, and every signed request would start failing with no clue why.
    kept.push(code);
    continue;
  }
  const secretKey = ed25519.utils.randomSecretKey();
  keys[code] = hex(secretKey);
  minted.push({ code, publicKey: hex(ed25519.getPublicKey(secretKey)) });
}

if (minted.length > 0) {
  writeFileSync(ENV_FILE, writeKeys(env, keys), "utf8");
}

console.log("");
for (const c of kept) {
  console.log(`  \x1b[2m${c} — key already present, left alone\x1b[0m`);
}
for (const { code, publicKey } of minted) {
  console.log(`  \x1b[32m✓\x1b[0m ${code}`);
  console.log(`    secret  \x1b[2mwritten to ${ENV_FILE} → ${VAR}\x1b[0m`);
  console.log(`    public  ${publicKey}`);
}

if (minted.length > 0) {
  console.log(`\n\x1b[2m  Register each public key from the Interchange repo:\x1b[0m`);
  for (const { code, publicKey } of minted) {
    console.log(`  npm run member:register -- --code "${code}" --public-key ${publicKey} \\`);
    console.log(`    --name "<entity name>" --host "<host,port>" --entity <EntityId>`);
  }
}
console.log("");
