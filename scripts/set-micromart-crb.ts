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
import { setIntegration, setIntegrationStatus, type CrbConfig } from "@/lib/vault/integrations";

const SLUG = process.env.MICROMART_SLUG || "micromart";

async function main() {
  const publicKey = process.env.METROPOL_PUBLIC_KEY;
  const privateKey = process.env.METROPOL_PRIVATE_KEY;
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
    host: process.env.METROPOL_HOST || "api.metropol.co.ke",
    port: process.env.METROPOL_PORT || "5555",
    apiVersion: process.env.METROPOL_VERSION || "v2_1",
    reportDepth: (process.env.METROPOL_DEPTH as CrbConfig["reportDepth"]) || "full",
  };

  await setIntegration(org.id, "CRB", cfg);
  await setIntegrationStatus(org.id, "CRB", "CONFIGURED").catch(() => {});
  console.log(`✓ Saved Metropol CRB for ${org.name} (${SLUG}) → https://${cfg.host}:${cfg.port}/${cfg.apiVersion}, depth=${cfg.reportDepth}`);
  console.log("  Verify from the console: /api/console/crb/test, or run any borrower's Run CRB check.");
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
