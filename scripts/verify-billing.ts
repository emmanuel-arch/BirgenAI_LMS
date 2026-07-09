// Tests for plan gating, metering and invoice arithmetic.
//
//   npm run test:billing        (needs the database; no app server)
//
// Two things must hold or we either give features away or bill the wrong amount:
//   • a plan grants exactly its features, overrides bend that, and a lapsed
//     subscription revokes the metered ones WITHOUT touching the loan book
//   • a usage event freezes the price it was charged at, so an invoice computed
//     from history never moves when the catalogue does
import "dotenv/config";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { runAsPlatform, runWithOrg } from "@/lib/db/context";
import { entitlementsFor, invalidateEntitlements, overageFor } from "@/lib/billing/entitlements";
import { meter, usageBetween } from "@/lib/billing/meter";
import { PLANS, UNIT_PRICE_KES, cheapestPlanWith } from "@/lib/billing/plans";
import { hubCheckoutUrl, hubBillingMode } from "@/lib/billing/hub";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); }
};

async function main() {
  const slug = `billtest-${Date.now()}`;
  const org = await runAsPlatform(() => prisma.org.create({ data: { slug, name: "Billing Test", plan: "STARTER" } }));
  console.log(`fixture org ${slug} (${org.id})\n`);

  try {
    console.log("1. The ladder ascends and each tier is a superset of the last");
    ok("prices ascend 10k → 15k → 20k → 30k",
      PLANS.STARTER.monthlyKes === 10_000 && PLANS.ENTERPRISE.monthlyKes === 15_000 &&
      PLANS.ADVANCED.monthlyKes === 20_000 && PLANS.PREMIUM.monthlyKes === 30_000);
    ok("Enterprise ⊇ Starter", PLANS.STARTER.features.every((f) => PLANS.ENTERPRISE.features.includes(f)));
    ok("Advanced ⊇ Enterprise", PLANS.ENTERPRISE.features.every((f) => PLANS.ADVANCED.features.includes(f)));
    ok("Premium ⊇ Advanced", PLANS.ADVANCED.features.every((f) => PLANS.PREMIUM.features.includes(f)));
    ok("cheapestPlanWith('crb') is Enterprise, not Premium", cheapestPlanWith("crb")?.key === "ENTERPRISE");
    ok("cheapestPlanWith('portfolio-scan') is Premium", cheapestPlanWith("portfolio-scan")?.key === "PREMIUM");
    ok("only Premium has unlimited seats", PLANS.PREMIUM.seats === null && PLANS.ADVANCED.seats !== null);

    console.log("\n2. A Starter org gets Starter, and nothing more");
    let ent = await entitlementsFor(org.id);
    ok("has the cruncher", ent.features.has("statement-cruncher"));
    ok("does NOT have CRB", !ent.features.has("crb"));
    ok("does NOT have Riri", !ent.features.has("riri"));
    ok("does NOT have early-warning", !ent.features.has("portfolio-scan"));
    ok("starts on a trial, so onboarding never hits a paywall", ent.status === "TRIALING" && ent.paying);
    ok("seats come from the plan", ent.seats === PLANS.STARTER.seats);

    console.log("\n3. A negotiated override bends the plan");
    await runWithOrg(org.id, () => prisma.orgSubscription.update({
      where: { orgId: org.id },
      data: { featureOverrides: { crb: true } as Prisma.InputJsonValue, includedOverrides: { crb: 250 } as Prisma.InputJsonValue, seatsOverride: 12 },
    }));
    invalidateEntitlements(org.id);
    ent = await entitlementsFor(org.id);
    ok("granted CRB on a Starter plan", ent.features.has("crb"));
    ok("raised the CRB allowance to 250", ent.included.crb === 250);
    ok("seat override wins over the plan", ent.seats === 12);
    ok("the override did NOT leak other features", !ent.features.has("riri"));

    console.log("\n4. A lapsed subscription revokes metered features — never the loan book");
    await runWithOrg(org.id, () => prisma.org.update({ where: { id: org.id }, data: { plan: "PREMIUM" } }));
    await runWithOrg(org.id, () => prisma.orgSubscription.update({
      where: { orgId: org.id },
      data: { status: "PAST_DUE", featureOverrides: Prisma.DbNull },
    }));
    invalidateEntitlements(org.id);
    ent = await entitlementsFor(org.id);
    ok("PAST_DUE is not paying", !ent.paying);
    ok("CRB revoked", !ent.features.has("crb"));
    ok("identity verification revoked", !ent.features.has("id-verify"));
    ok("Riri revoked", !ent.features.has("riri"));
    ok("early-warning revoked", !ent.features.has("portfolio-scan"));
    ok("SCORING survives — borrowers must still be able to be assessed", ent.features.has("credit-score"));
    ok("the cruncher survives", ent.features.has("statement-cruncher"));

    console.log("\n5. An expired trial lapses on its own, without a cron having run");
    await runWithOrg(org.id, () => prisma.orgSubscription.update({
      where: { orgId: org.id },
      data: { status: "TRIALING", trialEndsAt: new Date(Date.now() - 86_400_000) },
    }));
    invalidateEntitlements(org.id);
    ent = await entitlementsFor(org.id);
    ok("an expired trial reads as PAST_DUE", ent.status === "PAST_DUE" && !ent.paying);

    console.log("\n6. Usage freezes the price it was charged at");
    await runWithOrg(org.id, () => prisma.orgSubscription.update({ where: { orgId: org.id }, data: { status: "ACTIVE", trialEndsAt: null } }));
    invalidateEntitlements(org.id);
    await meter(org.id, "crb", 3, { test: true });
    await meter(org.id, "score", 2, { test: true });
    const events = await runWithOrg(org.id, () => prisma.usageEvent.findMany({ where: { orgId: org.id }, orderBy: { createdAt: "asc" } }));
    const crbEvent = events.find((e) => e.kind === "crb")!;
    ok("the unit cost is stamped onto the event", Number(crbEvent.unitCost) === UNIT_PRICE_KES.crb, `${crbEvent.unitCost}`);
    ok("quantity is recorded, not one row per unit", crbEvent.qty === 3);
    ok("CRB is priced at the Hub's rate card (KES 35)", UNIT_PRICE_KES.crb === 35);

    const from = new Date(Date.now() - 3_600_000), to = new Date(Date.now() + 3_600_000);
    const totals = await runWithOrg(org.id, () => usageBetween(org.id, from, to));
    ok("usageBetween sums quantities per kind", totals.crb === 3 && totals.score === 2, JSON.stringify(totals));

    console.log("\n7. Overage arithmetic");
    ent = await entitlementsFor(org.id); // PREMIUM: 1000 crb included
    const under = overageFor(ent, "crb", 3);
    ok("inside the allowance costs nothing", under.overage === 0 && under.costKes === 0);
    const over = overageFor(ent, "crb", ent.included.crb! + 4);
    ok("4 units over bills 4 × 35 = 140", over.overage === 4 && over.costKes === 140, `${over.costKes}`);
    const noAllowance = overageFor(ent, "document", 10);
    ok("a kind with an allowance still bills only the excess", noAllowance.overage === Math.max(0, 10 - (ent.included.document ?? 0)));

    console.log("\n8. Money leaves through the Hub, and only the Hub");
    const url = hubCheckoutUrl(slug, "ADVANCED", "https://lms.birgenai.com/console/billing");
    ok("checkout points at the Hub's /transact", url.includes("/transact"), url);
    ok("it carries the org slug and plan", url.includes(`lms=${slug}`) && url.includes("plan=ADVANCED"));
    ok("it carries a return URL", url.includes("return="));
    ok("no HUB_BILLING_SECRET ⇒ simulation, not a silent failure", hubBillingMode() === (process.env.HUB_BILLING_SECRET ? "live" : "simulation"));
  } finally {
    await runAsPlatform(async () => {
      await prisma.usageEvent.deleteMany({ where: { orgId: org.id } });
      await prisma.orgSubscription.deleteMany({ where: { orgId: org.id } });
      await prisma.auditLog.deleteMany({ where: { orgId: org.id } });
      await prisma.org.delete({ where: { id: org.id } });
    });
    console.log(`\n${pass} passed, ${fail} failed`);
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
