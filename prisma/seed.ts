// Seed the four launch organizations.
// BirgenAI Hub runs NATIVE (demo + our own book); the three lenders start
// BRIDGED (loan book stays in their ServiceSuite; adapter reads + posts).
import { OrgMode, OrgStatus, OrgPlan } from "@prisma/client";
import { platformPrisma } from "./seed-client";

// Seeds write across orgs, so they connect platform-scoped (see seed-client.ts).
const prisma = platformPrisma();

const ORGS = [
  {
    slug: "hub",
    name: "BirgenAI Hub",
    mode: OrgMode.NATIVE,
    plan: OrgPlan.PREMIUM,
    accent: "#F97316",
    accentSoft: "rgba(249,115,22,0.12)",
    tagline: "Credit that understands your cashflow.",
    blurb: "The BirgenAI native lending demo organization",
    serviceSuiteEntityId: null as number | null,
  },
  {
    slug: "micromart",
    name: "Micromart Africa",
    mode: OrgMode.BRIDGED,
    plan: OrgPlan.PREMIUM,
    accent: "#F97316",
    accentSoft: "rgba(249,115,22,0.12)",
    tagline: "Grow your business with credit you've earned.",
    blurb: "Business, school-fees & personal loans",
    serviceSuiteEntityId: 3002,
  },
  {
    slug: "axe",
    name: "Axe Capital",
    mode: OrgMode.BRIDGED,
    plan: OrgPlan.ADVANCED,
    accent: "#3B82F6",
    accentSoft: "rgba(59,130,246,0.12)",
    tagline: "Fast, fair credit for traders and earners.",
    blurb: "Quick personal credit & trader advances",
    serviceSuiteEntityId: 3003,
  },
  {
    slug: "buysimu",
    name: "Buy Simu",
    mode: OrgMode.BRIDGED,
    plan: OrgPlan.ADVANCED,
    accent: "#E11D48",
    accentSoft: "rgba(225,29,72,0.12)",
    tagline: "Get the phone you want now — pay in easy instalments.",
    blurb: "Buy a phone on credit · iPhone & more",
    serviceSuiteEntityId: 8,
  },
];

async function main() {
  for (const o of ORGS) {
    await prisma.org.upsert({
      where: { slug: o.slug },
      update: { name: o.name, mode: o.mode, plan: o.plan, serviceSuiteEntityId: o.serviceSuiteEntityId },
      create: { ...o, status: OrgStatus.ACTIVE },
    });
    console.log(`seeded org: ${o.slug} (${o.mode})`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
