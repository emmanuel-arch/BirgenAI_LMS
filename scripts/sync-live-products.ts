// ─────────────────────────────────────────────────────────────────────────────
// PULL THE LENDER'S SHELF INTO OUR MIRROR — so the console cannot offer a loan
// their own system will refuse.
//
//   npm run products:sync                 # DRY RUN — prints every drift
//   npm run products:sync -- --apply      # writes the mirror
//   npm run products:sync -- --org=micromart --entity=3005
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
// The bridged pilot keeps a LOCAL Product row per ServiceSuite product, because
// the funnel, the limit engine and the offer all need a product in our own
// vocabulary. Those rows were hand-transcribed off the lender's product page
// (scripts/seed-micromart-fintech.ts, "verified 2026-07-17") and nothing has
// re-read them since. They have drifted, and the drift is not cosmetic:
//
//   Micro Eazy, our mirror : principal KES 5,000 – 100,000
//   Micro Eazy, live 3005  : principal KES 10,901 – 100,000
//
// An officer offering KES 5,000 passes every check the console makes, gets an
// offer signed, and is refused at the very last step by the lender's own
// LoanValidation — after the customer has been told yes. The mirror has to be
// read from the shelf it mirrors, not typed in beside it.
//
// src/lib/lms/servicesuite-products.ts already translates their vocabulary into
// ours, rule by rule, each one proved against real loans. It had no runtime
// caller — only a test. This is the caller.
//
// ── WHAT IT WILL AND WILL NOT TOUCH ─────────────────────────────────────────
// Only rows already linked by serviceSuiteProductId, and only the LENDER-OWNED
// commercial terms: principal band, rate, term, method, credit floor, active
// flag. Fields that are OURS — the disbursement mode, the display name a lender
// chose in our console, workflow bindings, charges — are left alone. A product
// on the live shelf that we have no mirror for is REPORTED, never created:
// creating one silently would put a product on the funnel that nobody decided
// to sell.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import mssql from "mssql";
import { prisma } from "../src/lib/prisma";
import { runAsPlatform } from "../src/lib/db/context";
import { resolveOrg } from "../src/lib/tenancy";
import { getPostingOrg, getEntityId } from "../src/lib/enterprise/connections";
import { runReadOnlyQuery } from "../src/lib/enterprise/mssql";
import { mapProduct, type ServiceSuiteProduct } from "../src/lib/lms/servicesuite-products";

const arg = (k: string, d?: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;
const flag = (k: string) => process.argv.includes(`--${k}`);

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;

const kes = (n: number) => `KES ${Number(n).toLocaleString("en-KE")}`;

async function main() {
  const slug = arg("org", "micromart")!;
  const apply = flag("apply");

  const org = await resolveOrg(slug);
  if (!org) throw new Error(`No org "${slug}".`);

  // The shelf that matters is the one loans BOOK into — getPostingOrg, the same
  // resolution the approval path uses. Reading the other book would mirror
  // products that no pilot loan can ever be created against.
  const target = getPostingOrg(slug);
  if (!target) throw new Error(`No configured posting target for "${slug}".`);
  const entityId = Number(arg("entity", String(getEntityId(target))));

  console.log(bold(`\n${org.name} → ${target.name}  entity ${entityId}`));
  console.log(dim(apply ? "  applying changes" : "  dry run — nothing is written"));

  const { rows } = await runReadOnlyQuery(
    target,
    `SELECT ID, ProductName, ProductDesc, MinPrincipal, MaxPrincipal, InterestMethod,
            InterestRate, RepaymentPeriod, RepaymentPeriodType, RepaymentOrder,
            MinCreditScore, IsActive, WorkflowId, repeatWorkflowId,
            guarantorRequired, guarantorReborrow, securityRequired,
            securityLimitType, securityLimitValue, minLoanLimit, PrincipalType,
            EnableEarlyRate, EarlyPaymentDays, EarlyPaymentRate
     FROM Products WHERE EntityId = @e ORDER BY ID`,
    [{ name: "e", type: mssql.Int, value: entityId }],
    { timeoutMs: 30000 },
  );
  console.log(dim(`  ${rows.length} product(s) on the live shelf\n`));

  const mirrors = await runAsPlatform(() => prisma.product.findMany({
    where: { orgId: org.id, serviceSuiteProductId: { not: null } },
    select: {
      id: true, name: true, serviceSuiteProductId: true, minPrincipal: true, maxPrincipal: true,
      interestRate: true, interestMethod: true, repaymentPeriod: true, repaymentPeriodUnit: true,
      minCreditScore: true, minLoanLimit: true, isActive: true,
    },
  }));

  let drifted = 0, written = 0;

  for (const raw of rows) {
    const live = mapProduct(raw as unknown as ServiceSuiteProduct);
    const mirror = mirrors.find((m) => m.serviceSuiteProductId === live.serviceSuiteProductId);

    if (!mirror) {
      console.log(`  ${bold(live.name)}  ${dim(`ss:${live.serviceSuiteProductId}`)}`);
      console.log(`    ${dim("no local mirror — reported, not created (see the header for why)")}`);
      continue;
    }

    // Compare only what the lender owns. Decimal columns come back as Prisma
    // Decimal, so everything is compared as a Number.
    const diffs: string[] = [];
    const cmp = (label: string, ours: unknown, theirs: unknown, fmt: (v: never) => string = String as never) => {
      const a = typeof theirs === "number" ? Number(ours) : ours;
      if (String(a) !== String(theirs)) diffs.push(`${label}: ${fmt(a as never)} → ${fmt(theirs as never)}`);
    };

    cmp("min principal", mirror.minPrincipal, live.minPrincipal, kes as never);
    cmp("max principal", mirror.maxPrincipal, live.maxPrincipal, kes as never);
    cmp("rate (term)", mirror.interestRate, live.interestRate, ((v: number) => `${v}%`) as never);
    cmp("method", mirror.interestMethod, live.interestMethod);
    cmp("term", mirror.repaymentPeriod, live.repaymentPeriod);
    cmp("term unit", mirror.repaymentPeriodUnit, live.repaymentPeriodUnit);
    cmp("min credit score", mirror.minCreditScore, live.minCreditScore);
    cmp("min loan limit", mirror.minLoanLimit, live.minLoanLimit);
    cmp("active", mirror.isActive, live.isActive);

    console.log(`  ${bold(live.name)}  ${dim(`ss:${live.serviceSuiteProductId} → ${mirror.name}`)}`);
    if (!diffs.length) {
      console.log(`    ${green("in step")}`);
      continue;
    }
    drifted++;
    for (const d of diffs) console.log(`    ${red("drift")}  ${d}`);

    if (apply) {
      await runAsPlatform(() => prisma.product.update({
        where: { id: mirror.id },
        data: {
          minPrincipal: live.minPrincipal,
          maxPrincipal: live.maxPrincipal,
          interestRate: live.interestRate,
          interestMethod: live.interestMethod,
          repaymentPeriod: live.repaymentPeriod,
          repaymentPeriodUnit: live.repaymentPeriodUnit,
          minCreditScore: live.minCreditScore,
          minLoanLimit: live.minLoanLimit,
          isActive: live.isActive,
        },
      }));
      written++;
      console.log(`    ${green("updated")}`);
    }
  }

  console.log();
  if (!drifted) console.log(green("  Every mirrored product agrees with the lender's shelf."));
  else if (apply) console.log(green(`  ${written} product(s) brought back in step.`));
  else console.log(red(`  ${drifted} product(s) have drifted. Re-run with --apply to fix.`));
  console.log();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
