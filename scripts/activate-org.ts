// ─────────────────────────────────────────────────────────────────────────────
// Activate an org's subscription (clears a lapsed trial / PAST_DUE).
//
//   npm run org:activate -- micromart            # keep current plan, go ACTIVE
//   npm run org:activate -- micromart PREMIUM     # also set the plan
//
// A lapsed TRIALING subscription resolves to PAST_DUE, which strips the METERED
// features (CRB, id-verify, Riri) and returns 402 on those calls. This sets the
// subscription ACTIVE and refreshes the billing period so those features return.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { runAsPlatform, runWithOrg } from "@/lib/db/context";
import { invalidateEntitlements, entitlementsFor } from "@/lib/billing/entitlements";
import type { OrgPlan } from "@prisma/client";

async function main() {
  const slug = process.argv[2] || "micromart";
  const plan = process.argv[3] as OrgPlan | undefined;

  const org = await runAsPlatform(() =>
    prisma.org.findFirst({ where: { slug }, select: { id: true, name: true, plan: true } }),
  );
  if (!org) { console.error(`No org with slug "${slug}".`); process.exit(1); }

  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  if (plan) {
    await runAsPlatform(() => prisma.org.update({ where: { id: org.id }, data: { plan } }));
  }

  await runWithOrg(org.id, () =>
    prisma.orgSubscription.upsert({
      where: { orgId: org.id },
      create: { orgId: org.id, status: "ACTIVE", currentPeriodStart: start, currentPeriodEnd: end, trialEndsAt: null },
      update: { status: "ACTIVE", currentPeriodStart: start, currentPeriodEnd: end, trialEndsAt: null },
    }),
  );

  invalidateEntitlements(org.id);
  const ent = await entitlementsFor(org.id);
  console.log(`✓ ${org.name} (${slug}) → plan ${ent.plan.key}, status ${ent.status}, paying ${ent.paying}`);
  console.log(`  CRB enabled: ${ent.features.has("crb")} | features: ${[...ent.features].join(", ")}`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
