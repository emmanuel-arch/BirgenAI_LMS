// Set Micromart's pilot branding: dark-brown gradient + larger logo rendering.
//
//   npx tsx scripts/set-micromart-brand.ts
//
// Founder direction (Jul 2026, Micromart pilot): the logo-derived palette landed
// on yellow (#e4ba14) and the mark's transparent padding made it render small.
// The pilot brand is the DARKER brown gradient, and the logo dialled up to 150%.
// DB values win over the static registry (src/lib/lms/branding.ts), so this row
// is what the portal and console actually wear. Idempotent — re-run freely.
import "dotenv/config";
import { platformPrisma } from "../prisma/seed-client";
import { enterPlatform } from "../src/lib/db/context";

const BRAND = {
  accent: "#78350f", // dark brown (buttons, links, active nav)
  accent2: "#451a03", // near-black brown — the far end of the hero gradient
  accentSoft: "rgba(120,53,15,0.12)",
  logoScale: 150,
};

async function main() {
  const p = platformPrisma();
  enterPlatform();
  const org = await p.org.findUnique({ where: { slug: "micromart" }, select: { id: true, name: true, accent: true, logoScale: true } });
  if (!org) throw new Error('No org with slug "micromart".');
  console.log(`Org: ${org.name} — accent ${org.accent} → ${BRAND.accent}, logoScale ${org.logoScale}% → ${BRAND.logoScale}%`);
  await p.org.update({ where: { id: org.id }, data: BRAND });
  console.log("Micromart now wears the dark-brown gradient. Portal picks it up immediately; console on next page load.");
  await p.$disconnect();
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
