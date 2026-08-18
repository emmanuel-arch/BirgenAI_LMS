// ─────────────────────────────────────────────────────────────────────────────
// MICRO EAZY — Micromart's live shelf, mirrored into BirgenAI_LMS.
//
//   npx tsx scripts/seed-micro-eazy.ts
//   npx tsx scripts/seed-micro-eazy.ts --ss-me=<Products.ID> --ss-mem=<Products.ID>
//   npx tsx scripts/seed-micro-eazy.ts --dormancy-days=365
//   npx tsx scripts/seed-micro-eazy.ts --down          # reverse it
//
// EVERY NUMBER HERE IS TRANSCRIBED FROM MICROMART'S OWN PRODUCT SCREENS
// (verified 6 August 2026). Nothing is invented, because the point of the demo is
// that their board recognises their own product — not a near-miss of it.
//
//   Micro Eazy (ME)          KES 5,000–100,000 · flat 8.25% PER WEEK  · 10 (Week)
//   Micro Eazy Monthly (MEM) KES 5,000–100,000 · flat 22.00% PER MONTH · 2 (Month)
//   both: rollover penalty 20% · min credit score 500 · no guarantor · no security
//         · a standing guarantor cannot borrow · workflow "Micro Eazy" new + repeat
//   MEM only: minimum loan limit KES 5,000
//
// THREE THINGS THAT ARE NOT A STRAIGHT TRANSCRIPTION, and why:
//
//   1. RATE. `Product.interestRate` is the rate for the WHOLE TERM (see
//      lib/lms/servicesuite-products.ts, which proves it against real loans), so
//      8.25%/week × 10 = 82.5% and 22%/month × 2 = 44%. The per-period rate on
//      their screen is recovered exactly by dividing back out.
//
//   2. THE TERM IS A RANGE, NOT A CONSTANT. Their screen says "10 (Week)". We book
//      `minRepaymentPeriod = 1`, so every term from 1 to 10 weeks is a real offer
//      and the decision engine picks the one the borrower's cashflow carries — a
//      customer good for four weeks is offered four weeks instead of being declined
//      for ten. Same for MEM at 1–2 months. This is additive: a lender who wants
//      the fixed term back sets minRepaymentPeriod = null.
//
//   3. DISBURSEMENT IS THE WORKFLOW'S CHOICE. The finalizing stage carries
//      `disbursementRoute = LENDER_BRIDGE`, so an approved Micro Eazy loan is
//      posted into Micromart's OWN workflow and their process pays it out. Flip
//      that one field to LMS_NATIVE and the same workflow disburses through our
//      B2C queue instead. Nothing else changes.
//
// CHARGES are org-wide and band-scoped (productId = null, KES 5,000–100,000)
// rather than duplicated per product: `Charge` is unique on (orgId, code), both
// products carry the identical fee sheet, and the upfront gate already reads
// org-wide fees for whichever product is being priced.
//
// IDEMPOTENT. Matched by (orgId, name) for products and (orgId, code) for charges.
// Safe to re-run; `--down` reverses it without deleting anything that has loans.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { platformPrisma } from "../prisma/seed-client";
import { enterPlatform } from "../src/lib/db/context";

const WORKFLOW_TITLE = "Micro Eazy";
const ME = "Micro Eazy";
const MEM = "Micro Eazy Monthly";
/**
 * Superseded by Micro Eazy: identical economics (8.25%/wk × 10), narrower band.
 *
 * TASK 0.11 — THE TYPO. This product was transcribed as "MIROMART FINTECH":
 * missing the C, and shouted. It is deactivated, but it is NOT invisible — 31
 * loans and 7 applications point at it, and a product's name is what their
 * statements, schedules and reports print. A retired product still narrates
 * history, so the typo is on customer-facing paper until it is fixed.
 *
 * The rename is therefore the fix, not a cosmetic pass: renaming in place carries
 * all 38 records with it, where creating a correctly-spelled twin would strand
 * them on the misspelling forever.
 *
 * Both spellings are matched wherever this product is looked up, so the script
 * stays idempotent and `--down` still finds it after the rename has run.
 */
const RETIRED = "Micromart Fintech";
const RETIRED_TYPO = "MIROMART FINTECH";
/** Matches the product whichever spelling it currently carries. */
const RETIRED_ANY = { in: [RETIRED, RETIRED_TYPO] };

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const intArg = (name: string): number | null => {
  const v = arg(name);
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`--${name} must be a positive integer.`);
  return n;
};

async function main() {
  const down = process.argv.includes("--down");
  const ssMe = intArg("ss-me");
  const ssMem = intArg("ss-mem");
  // Their screen says "1" with no unit. One DAY would make the whole book dormant
  // overnight, so this is not transcribed blind — it is a flag with a safe default
  // and a loud note. Confirm the unit with Micromart and re-run.
  const dormancyDays = intArg("dormancy-days") ?? 365;

  const p = platformPrisma();
  enterPlatform();

  const org = await p.org.findUnique({ where: { slug: "micromart" }, select: { id: true, name: true, mode: true } });
  if (!org) throw new Error('No org with slug "micromart".');
  console.log(`Org: ${org.name} (micromart · ${org.mode})\n`);

  if (down) return teardown(p, org.id);

  // ── 1 · Workflow: Risk → Customer Service ──────────────────────────────────
  // Mirrors their Approval Stages screen exactly: Risk is the Initiator and does
  // NOT finalize; Customer Service is the Authorizor, sits UNDER Risk in the stage
  // tree, and finalizes.
  const opsRole = await p.role.findFirst({
    where: { orgId: org.id, title: { contains: "Operation", mode: "insensitive" } },
    select: { id: true, title: true },
  });
  const roleIds = opsRole ? [opsRole.id] : [];
  console.log(opsRole ? `Role for both stages: ${opsRole.title}` : "No 'Operations' role found — stages seeded unrestricted by role.");

  const existingWf = await p.workflow.findFirst({ where: { orgId: org.id, title: WORKFLOW_TITLE }, select: { id: true } });
  const wf = existingWf ?? await p.workflow.create({
    data: {
      orgId: org.id,
      title: WORKFLOW_TITLE,
      description: "Micromart's live Micro Eazy approval: Risk initiates, Customer Service authorises and finalizes. Finalizing posts the loan into Micromart's own ServiceSuite workflow.",
    },
    select: { id: true },
  });

  // Rebuild the stages from scratch each run so a re-run is a true mirror. Children
  // first — WorkflowStage.parentId is a self-relation.
  const oldStages = await p.workflowStage.findMany({ where: { workflowId: wf.id }, select: { id: true } });
  const oldIds = oldStages.map((s) => s.id);
  if (oldIds.length) {
    const pinned = await p.loanApplication.count({ where: { orgId: org.id, currentStageId: { in: oldIds } } });
    if (pinned > 0) {
      console.log(`  ! ${pinned} application(s) currently sit on these stages — leaving the workflow untouched.`);
    } else {
      await p.workflowStage.deleteMany({ where: { workflowId: wf.id, parentId: { not: null } } });
      await p.workflowStage.deleteMany({ where: { workflowId: wf.id } });
    }
  }

  let riskId: string;
  let csId: string;
  const have = await p.workflowStage.count({ where: { workflowId: wf.id } });
  if (have === 0) {
    const risk = await p.workflowStage.create({
      data: {
        workflowId: wf.id, title: "Risk", order: 1, accessTier: 1, roleIds,
        canFinalize: false, canUpdate: true, otpRequired: false,
        // The one "pending" item on Micromart's own Micro Biz list — a CRB check
        // inside the application flow. On our side it is a gate, not a feature
        // request: this stage will not advance without a pull under 30 days old.
        crbRequired: true,
        maxAmount: null,
      },
      select: { id: true },
    });
    const cs = await p.workflowStage.create({
      data: {
        workflowId: wf.id, title: "Customer Service", order: 2, accessTier: 2, roleIds,
        parentId: risk.id, canFinalize: true, canUpdate: false, otpRequired: true,
        crbRequired: false, maxAmount: null,
        disbursementRoute: "LENDER_BRIDGE",
      },
      select: { id: true },
    });
    riskId = risk.id; csId = cs.id;
    console.log(`Workflow "${WORKFLOW_TITLE}" — Risk (Initiator, CRB gate) → Customer Service (Authorizor, finalize → LENDER_BRIDGE)`);
  } else {
    const stages = await p.workflowStage.findMany({ where: { workflowId: wf.id }, orderBy: { order: "asc" }, select: { id: true, title: true } });
    riskId = stages[0].id; csId = stages[stages.length - 1].id;
    console.log(`Workflow "${WORKFLOW_TITLE}" — kept existing ${stages.length} stage(s): ${stages.map((s) => s.title).join(" → ")}`);
  }
  void riskId; void csId;

  // ── 2 · The two products ───────────────────────────────────────────────────
  const shared = {
    orgId: org.id,
    minPrincipal: 5_000,
    maxPrincipal: 100_000,
    interestMethod: "flat",
    interestType: "fixed",
    principalType: "standard",
    interestPeriodUnit: "term" as const,
    gracePeriodDays: 0,
    penaltyRate: 20, // "Rollover Penalty 20.00%"
    earlySettlementEnabled: false,
    earlySettlementDays: null,
    earlySettlementRate: null,
    repaymentOrder: "penalty,interest,principal,fees",
    minCreditScore: 500,
    guarantorRequired: false,
    guarantorReborrow: false, // "Guarantor Status: In-Active (Can not Borrow)"
    securityRequired: false,
    securityCoverPct: 100,
    // Bridged: Micromart's own process releases the money. The workflow's
    // finalizing stage is what actually decides this — see disbursementRoute.
    disbursementMode: "LENDER_SIDE" as const,
    newWorkflowId: wf.id,
    repeatWorkflowId: wf.id,
    isActive: true,
  };

  const products = [
    {
      name: ME,
      description: "Weekly working capital — up to ten weekly instalments at 8.25% per week. No guarantor, no security.",
      interestRate: 82.5, // 8.25%/week × 10 weeks, whole-term
      repaymentPeriod: 10,
      minRepaymentPeriod: 1, // 1–10 weeks; the engine picks what the cashflow carries
      repaymentPeriodUnit: "week",
      minLoanLimit: null as number | null,
      serviceSuiteProductId: ssMe,
      perPeriod: "8.25% per week",
    },
    {
      name: MEM,
      description: "Monthly working capital — up to two monthly instalments at 22% per month. No guarantor, no security.",
      interestRate: 44, // 22%/month × 2 months, whole-term
      repaymentPeriod: 2,
      minRepaymentPeriod: 1, // 1–2 months
      repaymentPeriodUnit: "month",
      minLoanLimit: 5_000 as number | null,
      serviceSuiteProductId: ssMem,
      perPeriod: "22.00% per month",
    },
  ];

  const ids: string[] = [];
  for (const spec of products) {
    const { perPeriod, ...cols } = spec;
    const data = { ...shared, ...cols };
    const existing = await p.product.findFirst({ where: { orgId: org.id, name: spec.name }, select: { id: true } });
    const row = existing
      ? await p.product.update({ where: { id: existing.id }, data, select: { id: true } })
      : await p.product.create({ data, select: { id: true } });
    ids.push(row.id);
    console.log(
      `${existing ? "updated" : "created"}  ${spec.name.padEnd(20)} KES 5,000–100,000 · flat ${perPeriod} ` +
      `· ${spec.minRepaymentPeriod}–${spec.repaymentPeriod} ${spec.repaymentPeriodUnit} · whole-term ${spec.interestRate}% ` +
      `· ss-id ${spec.serviceSuiteProductId ?? "NOT SET"}`,
    );
  }

  // ── 2b · Task 0.11 · the typo ──────────────────────────────────────────────
  // Renamed in place so the loans and applications already pointing at it print
  // the corrected name too. Idempotent: after the first run there is nothing
  // spelled the old way left to match.
  const typo = await p.product.findFirst({ where: { orgId: org.id, name: RETIRED_TYPO }, select: { id: true } });
  if (typo) {
    const [loans, apps] = await Promise.all([
      p.loan.count({ where: { productId: typo.id } }),
      p.loanApplication.count({ where: { productId: typo.id } }),
    ]);
    await p.product.update({ where: { id: typo.id }, data: { name: RETIRED } });
    console.log(`\nrenamed   "${RETIRED_TYPO}" -> "${RETIRED}"  (${loans} loan(s), ${apps} application(s) carry the corrected name)`);
  }

  // The shelf is these two. A bridged org's ACTIVE products are what its portal
  // sells, so anything else local goes dark — never deleted, because loans and
  // applications point at it.
  const others = await p.product.updateMany({
    where: { orgId: org.id, id: { notIn: ids }, isActive: true },
    data: { isActive: false },
  });
  if (others.count) console.log(`\nswitched off ${others.count} other local product(s) — including "${RETIRED}", which Micro Eazy supersedes (same 8.25%/wk × 10, narrower band).`);

  // ── 3 · The fee sheet ──────────────────────────────────────────────────────
  const CHARGES = [
    {
      name: "PROCESSING FEE", code: "PF",
      description: "Loan processing fee, collected before disbursement.",
      amount: 6, isPercent: true, minValue: 650, maxValue: 6_000,
    },
    {
      name: "CRB Fee", code: "CRB",
      description: "Credit reference bureau check, collected before disbursement.",
      amount: 100, isPercent: false, minValue: 100, maxValue: 100,
    },
    {
      name: "Security Fee", code: "SF",
      description: "Security fee, collected before disbursement.",
      amount: 50, isPercent: false, minValue: 50, maxValue: 50,
    },
  ];

  console.log();
  for (const c of CHARGES) {
    const data = {
      orgId: org.id, ...c,
      minPrincipal: 5_000, maxPrincipal: 100_000,
      applyAt: "BEFORE_DISBURSEMENT" as const,
      trigger: "ON_APPLICATION" as const,
      beneficiary: "LENDER" as const,
      productId: null, // org-wide, selected by the principal band
      isActive: true,
    };
    const existing = await p.charge.findFirst({ where: { orgId: org.id, code: c.code }, select: { id: true } });
    if (existing) await p.charge.update({ where: { id: existing.id }, data });
    else await p.charge.create({ data });
    const shown = c.isPercent ? `${c.amount}% clamped KES ${c.minValue.toLocaleString()}–${c.maxValue.toLocaleString()}` : `KES ${c.amount}`;
    console.log(`${existing ? "updated" : "created"}  ${c.code.padEnd(4)} ${c.name.padEnd(16)} ${shown} · before disbursement · mandatory`);
  }

  // ── 4 · Borrower onboarding rules ──────────────────────────────────────────
  // read → modify → publish: publish() merges the INCOMING document over platform
  // defaults, not over what is stored, so a partial write would silently reset
  // every other borrower setting this org has.
  const { read, publish } = await import("../src/lib/config/store");
  const current = await read<Record<string, unknown>>(org.id, "borrower");
  const rules = (current.value.rules ?? {}) as Record<string, unknown>;
  const next = {
    ...current.value,
    rules: {
      ...rules,
      age: { enabled: true, min: 22, max: 70 },
      joiningFee: { enabled: false, amount: 0 },
      dormancy: { enabled: true, afterDays: dormancyDays },
      reactivationFee: { enabled: false, amount: 0 },
      referees: { enabled: true, min: 1, max: 1 },
    },
  };
  const res = await publish(org.id, "borrower", next, null);
  if (!res.ok) {
    console.log("\n! Borrower rules rejected:");
    for (const i of res.issues) console.log(`   ${i.path}: ${i.message}`);
  } else {
    console.log(`\nBorrower rules v${res.version} — age 22–70 · referees 1–1 · dormancy after ${dormancyDays}d · no joining fee · no reactivation fee`);
    console.log(`  ! dormancy: Micromart's screen shows "1" with no unit. Defaulted to ${dormancyDays} days — confirm and re-run with --dormancy-days=<n>.`);
  }

  if (!ssMe || !ssMem) {
    console.log(
      `\n! serviceSuiteProductId is unset for ${!ssMe ? ME : ""}${!ssMe && !ssMem ? " and " : ""}${!ssMem ? MEM : ""}.` +
      `\n  The shelf and the decisioning work now; POSTING into Micromart's workflow cannot until it is set.` +
      `\n  Get Products.ID for each from their DB and re-run with --ss-me=<id> --ss-mem=<id>.`,
    );
  }

  const live = await p.product.count({ where: { orgId: org.id, isActive: true } });
  console.log(`\nmicromart shelf: ${live} active product(s).`);
  await p.$disconnect();
}

// ── Reversal ─────────────────────────────────────────────────────────────────
async function teardown(p: ReturnType<typeof platformPrisma>, orgId: string) {
  console.log("Reversing.\n");

  const me = await p.product.findMany({ where: { orgId, name: { in: [ME, MEM] } }, select: { id: true, name: true } });
  for (const row of me) {
    // Never deleted — loans and applications point at products.
    await p.product.update({ where: { id: row.id }, data: { isActive: false, newWorkflowId: null, repeatWorkflowId: null } });
    console.log(`deactivated  ${row.name}`);
  }

  // Matched on either spelling: `--down` must still find this product whether or
  // not the rename above has run in this environment. The name itself is NOT
  // reverted — the old one was a typo, not a state this seed introduced.
  const restored = await p.product.updateMany({ where: { orgId, name: RETIRED_ANY }, data: { isActive: true } });
  if (restored.count) console.log(`reactivated  ${RETIRED}`);

  // The two fees Micro Eazy introduced. PF predates it, so PF stays.
  const del = await p.charge.deleteMany({ where: { orgId, code: { in: ["CRB", "SF"] } } });
  console.log(`removed      ${del.count} charge(s) (CRB, SF) — PF left alone, it predates Micro Eazy`);

  const wf = await p.workflow.findFirst({ where: { orgId, title: WORKFLOW_TITLE }, select: { id: true } });
  if (wf) {
    const stages = await p.workflowStage.findMany({ where: { workflowId: wf.id }, select: { id: true } });
    const pinned = await p.loanApplication.count({ where: { orgId, currentStageId: { in: stages.map((s) => s.id) } } });
    if (pinned > 0) {
      console.log(`kept         workflow "${WORKFLOW_TITLE}" — ${pinned} application(s) still sit on its stages`);
    } else {
      await p.workflowStage.deleteMany({ where: { workflowId: wf.id, parentId: { not: null } } });
      await p.workflowStage.deleteMany({ where: { workflowId: wf.id } });
      await p.workflow.delete({ where: { id: wf.id } });
      console.log(`removed      workflow "${WORKFLOW_TITLE}" and its stages`);
    }
  }

  console.log("\nBorrower rules are NOT reverted — they are a lender's own settings, not this seed's to unwind.");
  await p.$disconnect();
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
