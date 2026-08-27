// ─────────────────────────────────────────────────────────────────────────────
// Save Micromart's Metropol CRB subscription into the org vault (encrypted).
//
//   METROPOL_PUBLIC_KEY=… METROPOL_PRIVATE_KEY=… \
//   METROPOL_HOST=api.metropol.co.ke METROPOL_PORT=5555 METROPOL_VERSION=v2_1 \
//   npm run crb:set-micromart
//
// Secrets come from the ENVIRONMENT, never this file. Idempotent — re-running
// overwrites with whatever env you pass. Prefer Settings → Credit bureau in the
// console for a one-off; this script exists for repeatable provisioning.
//
// Test IDs (Micromart testbed): 550000055, 660000066, 770000077, 880000088,
// 990000099. The keys shipped in "MICROMART AFRICA LIMITED Referencing Keys
// Test.zip" are TEST keys — swap for the production pair before going live.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { runAsPlatform } from "@/lib/db/context";
import { setIntegration, setIntegrationStatus, type CrbConfig } from "@/lib/vault/integrations";

const SLUG = process.env.MICROMART_SLUG || "micromart";

// .env carries these as Metropol_Public_Key / Metropol_Private_Key. On Windows
// process.env is case-insensitive so METROPOL_PUBLIC_KEY resolves anyway — but
// that is a platform accident, not a contract, and relying on it means this
// script silently needs the keys re-typed on the command line on Linux (where
// they would then sit in the shell history). Read every spelling instead, the
// same way verify-metropol-prod.ts does.
const pick = (...names: string[]) => {
  for (const n of names) {
    const v = process.env[n];
    if (v && v.trim()) return v.trim().replace(/^["']|["']$/g, "");
  }
  return "";
};

async function main() {
  const publicKey = pick("METROPOL_PUBLIC_KEY", "Metropol_Public_Key", "METROPOL_PUB_KEY");
  const privateKey = pick("METROPOL_PRIVATE_KEY", "Metropol_Private_Key", "Private_Key");
  if (!publicKey || !privateKey) {
    console.error("Set METROPOL_PUBLIC_KEY and METROPOL_PRIVATE_KEY in the environment first.");
    process.exit(1);
  }

  const org = await prisma.org.findFirst({ where: { slug: SLUG }, select: { id: true, name: true } });
  if (!org) {
    console.error(`No org with slug "${SLUG}". Seed Micromart first (npm run db:seed:… ) or set MICROMART_SLUG.`);
    process.exit(1);
  }

  const cfg: CrbConfig = {
    bureau: "metropol",
    publicKey,
    privateKey,
    host: pick("METROPOL_HOST") || "api.metropol.co.ke",
    // 22225 is PRODUCTION; the test subscription is 5555. Host and version are
    // shared between the two, only the port moves — and production keys on 5555
    // authenticate and then answer E003 on every report, which reads as an
    // unprovisioned subscription rather than as the wrong port. Defaulting to
    // production here matches the keys this repo now carries.
    port: pick("METROPOL_PORT") || "22225",
    apiVersion: pick("METROPOL_VERSION") || "v2_1",
    reportDepth: (pick("METROPOL_DEPTH") as CrbConfig["reportDepth"]) || "full",
  };

  await setIntegration(org.id, "CRB", cfg);
  await setIntegrationStatus(org.id, "CRB", "CONFIGURED").catch(() => {});
  console.log(`✓ Saved Metropol CRB for ${org.name} (${SLUG}) → https://${cfg.host}:${cfg.port}/${cfg.apiVersion}, depth=${cfg.reportDepth}`);
  console.log("  Verify from the console: /api/console/crb/test, or run any borrower's Run CRB check.");
  await prisma.$disconnect();
}

// Row-level security refuses any query without a tenant scope, and a
// provisioning script has no session cookie to resolve one from. runAsPlatform
// is the same wrapper scripts/seed-micromart-vault.ts uses for exactly this.
runAsPlatform(main).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
