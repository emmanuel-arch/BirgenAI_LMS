// ─────────────────────────────────────────────────────────────────────────────
// MIRROR ONE LIVE PRODUCT, AND BIND IT TO A WORKFLOW — on a decision, never silently.
//
//   npx tsx scripts/mirror-live-product.ts --ss=30221 --workflow="Micro Eazy"            # dry run
//   npx tsx scripts/mirror-live-product.ts --ss=30221 --workflow="Micro Eazy" --apply    # write
//
// scripts/sync-live-products.ts REPORTS a live product with no mirror and refuses
// to create one, because a product nobody decided to sell must not appear on the
// funnel. This is the other half: the deliberate decision. Micromart's own ladder
// starts at Micro Chap Chap (KSh 5,000 – 10,900); a new customer whose starting
// limit is under KSh 10,901 has no other product, and without a mirror their
// application has no LMS workflow to enter — it would bypass Risk entirely.
//
// Terms come from the lender's live row through the same mapper the sync uses.
// Ours to set: the workflow binding, the term range (flat products may be repaid
// over 1…N periods — the customer chooses) and a LENDER_SIDE disbursement mode.
// Idempotent: an existing mirror is reported and left alone.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import mssql from "mssql";
import { prisma } from "../src/lib/prisma";
import { runAsPlatform } from "../src/lib/db/context";
import { resolveOrg } from "../src/lib/tenancy";
import { getPostingOrg, getEntityId } from "../src/lib/enterprise/connections";
import { runReadOnlyQuery } from "../src/lib/enterprise/mssql";
import { mapProduct, type ServiceSuiteProduct } from "../src/lib/lms/servicesuite-products";

const arg = (k: string, d?: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=").slice(1).join("=") ?? d;
const apply = process.argv.includes("--apply");

async function main() {
  const slug = arg("org", "micromart")!;
  const ssId = Number(arg("ss"));
  const workflowTitle = arg("workflow", "Micro Eazy")!;
  if (!Number.isInteger(ssId) || ssId <= 0) throw new Error("Pass --ss=<ServiceSuite product id>.");

  const org = await resolveOrg(slug);
  if (!org) throw new Error(`No org "${slug}".`);
  const target = getPostingOrg(slug);
  if (!target) throw new Error(`No posting target for "${slug}".`);
  const entityId = Number(arg("entity", String(getEntityId(target))));

  const { rows } = await runReadOnlyQuery(
    target,
    `SELECT ID, ProductName, ProductDesc, MinPrincipal, MaxPrincipal, InterestMethod, InterestRate,
            RepaymentPeriod, RepaymentPeriodType, RepaymentOrder, MinCreditScore, IsActive, WorkflowId,
            repeatWorkflowId, guarantorRequired, guarantorReborrow, securityRequired, securityLimitType,
            securityLimitValue, minLoanLimit, PrincipalType, EnableEarlyRate, EarlyPaymentDays, EarlyPaymentRate
       FROM Products WHERE EntityId = @e AND ID = @id`,
    [{ name: "e", type: mssql.Int, value: entityId }, { name: "id", type: mssql.Int, value: ssId }],
    { timeoutMs: 30000 },
  );
  if (!rows.length) throw new Error(`Product ${ssId} is not on entity ${entityId}'s shelf.`);
  const live = mapProduct(rows[0] as unknown as ServiceSuiteProduct);

  const [existing, workflow] = await runAsPlatform(() => Promise.all([
    prisma.product.findFirst({ where: { orgId: org.id, serviceSuiteProductId: ssId }, select: { id: true, name: true, isActive: true } }),
    prisma.workflow.findFirst({ where: { orgId: org.id, title: workflowTitle, isActive: true }, select: { id: true, title: true } }),
  ]));

  console.log(`\n${org.name} · entity ${entityId} · ss:${ssId} ${live.name}`);
  console.log(`  KES ${live.minPrincipal.toLocaleString()} – ${live.maxPrincipal.toLocaleString()} · ${live.ratePerPeriod}%/${live.repaymentPeriodUnit} · up to ${live.repaymentPeriod} ${live.repaymentPeriodUnit}s · ${live.interestMethod} · active ${live.isActive}`);
  if (existing) { console.log(`  already mirrored as "${existing.name}" (${existing.id}) — nothing to do.\n`); return; }
  if (!workflow) throw new Error(`No active workflow titled "${workflowTitle}" on ${org.name}.`);
  console.log(`  → new mirror, bound to workflow "${workflow.title}" for new and repeat borrowers`);
  if (!apply) { console.log("  dry run — re-run with --apply to write it.\n"); return; }

  const created = await runAsPlatform(() => prisma.product.create({
    data: {
      orgId: org.id,
      name: live.name,
      description: live.description,
      minPrincipal: live.minPrincipal,
      maxPrincipal: live.maxPrincipal,
      interestRate: live.interestRate,
      interestMethod: live.interestMethod,
      interestType: live.interestType,
      principalType: live.principalType,
      interestPeriodUnit: live.interestPeriodUnit,
      repaymentPeriod: live.repaymentPeriod,
      minRepaymentPeriod: live.interestMethod === "flat" ? 1 : null,
      repaymentPeriodUnit: live.repaymentPeriodUnit,
      minCreditScore: live.minCreditScore,
      minLoanLimit: live.minLoanLimit,
      isActive: live.isActive,
      serviceSuiteProductId: ssId,
      disbursementMode: "LENDER_SIDE",
      newWorkflowId: workflow.id,
      repeatWorkflowId: workflow.id,
    },
    select: { id: true },
  }));
  console.log(`  created ${created.id}\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
