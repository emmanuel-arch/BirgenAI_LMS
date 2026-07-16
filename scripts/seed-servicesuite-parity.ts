// Mirror a ServiceSuite lender's REAL product shelf onto an LMS org.
//
//   npx tsx scripts/seed-servicesuite-parity.ts techcrast micromart          (dry run)
//   npx tsx scripts/seed-servicesuite-parity.ts techcrast micromart --apply
//   npx tsx scripts/seed-servicesuite-parity.ts techcrast micromart --apply --min-loans=0
//
// THE SHELF IS REPLACED, NOT ADDED TO. Anything on the target org that the lender does
// not have is removed — deleted if nothing points at it, switched off if it has history.
// A product with loans against it is never deleted: the loans are the record.
//
// --min-loans=N (default 20) drops the products the lender barely uses. Micromart has
// configured products with 0–2 loans ever; carrying them across would pad the shelf with
// things nobody sells. Volume is counted from THEIR loan book, per product.
//
// WHY THIS READS THE LIVE DB RATHER THAN A LIST I TYPED
// The demo's whole claim is "this is how you already work". A hand-written shelf is a
// guess that rots the first time an admin reprices a product; reading Micromart is the
// only version that stays true. Their DB is the source, ours is the mirror.
//
// STRICTLY READ-ONLY on the lender's side. Nothing here writes to ServiceSuite.
//
// WHAT COMES ACROSS
//   Workflows + their stage chains (ApprovalWorkflow / ApprovalWorkflowStage)
//   Products  (all of them, active AND switched off — mirrored as they are)
//   Fees      (ProductFees: banded, fixed-or-%, with the clamp)
//
// The translation lives in src/lib/lms/servicesuite-products.ts and is tested by
// `npm run test:parity` — read the header there for why the rate is multiplied out.
//
// Idempotent: products match on (orgId, serviceSuiteProductId), fees on (orgId, code),
// workflows on (orgId, title). Re-running reprices rather than duplicating.
import "dotenv/config";
import { platformPrisma } from "../prisma/seed-client";
import { enterPlatform } from "../src/lib/db/context";
import { getOrg, isOrgConfigured } from "../src/lib/enterprise/connections";
import { runReadOnlyQuery } from "../src/lib/enterprise/mssql";
import {
  mapProduct, mapFee, DISBURSEMENT_MODE,
  type ServiceSuiteProduct, type ServiceSuiteFee,
} from "../src/lib/lms/servicesuite-products";

type Stage = {
  ID: number; WorkflowID: number; Title: string; ParentStage: number | null;
  CanFinalize: number | null; AccessID: number | null; RoleID: string | null; CanUpdate: number | null;
};
type Wf = { ID: number; Title: string; Description: string | null };

const money = (v: unknown) => `KES ${Math.round(Number(v)).toLocaleString()}`;

async function main() {
  const targetSlug = (process.argv[2] ?? "techcrast").trim().toLowerCase();
  const sourceSlug = (process.argv[3] ?? "micromart").trim().toLowerCase();
  const apply = process.argv.includes("--apply");
  const minLoansArg = process.argv.find((a) => a.startsWith("--min-loans="));
  const minLoans = minLoansArg ? Math.max(0, Number(minLoansArg.split("=")[1]) || 0) : 20;

  const source = getOrg(sourceSlug);
  if (!source) throw new Error(`No ServiceSuite org "${sourceSlug}".`);
  if (!isOrgConfigured(source)) throw new Error(`${source.name} is not connected (${source.connEnv} unset).`);

  const p = platformPrisma();
  enterPlatform();
  const org = await p.org.findUnique({ where: { slug: targetSlug }, select: { id: true, name: true } });
  if (!org) throw new Error(`No LMS org with slug "${targetSlug}".`);

  const entityId = Number(process.env[source.entityEnv] ?? source.defaultEntityId);
  console.log(`Source : ${source.name} — ServiceSuite EntityId ${entityId}`);
  console.log(`Target : ${org.name} (${targetSlug})`);
  console.log(`Filter : products with at least ${minLoans} loan(s) on their book`);
  console.log(apply ? "Mode   : APPLY — writing\n" : "Mode   : DRY RUN — nothing will be written (pass --apply)\n");

  // ── 1. Read the lender's shelf ─────────────────────────────────────────────
  const [wfRes, stageRes, prodRes, feeRes, volRes] = await Promise.all([
    runReadOnlyQuery(source, `SELECT ID, Title, Description FROM ApprovalWorkflow WHERE EntityID=@eid`,
      [{ name: "eid", type: (await import("mssql")).default.Int, value: entityId }], { maxRows: 100 }),
    runReadOnlyQuery(source,
      `SELECT s.ID, s.WorkflowID, s.Title, s.ParentStage, s.CanFinalize, s.AccessID, s.RoleID, s.CanUpdate
       FROM ApprovalWorkflowStage s
       WHERE s.WorkflowID IN (SELECT ID FROM ApprovalWorkflow WHERE EntityID=@eid)
       ORDER BY s.WorkflowID, s.ID`,
      [{ name: "eid", type: (await import("mssql")).default.Int, value: entityId }], { maxRows: 500 }),
    runReadOnlyQuery(source, `SELECT * FROM Products WHERE EntityId=@eid ORDER BY MinPrincipal, ID`,
      [{ name: "eid", type: (await import("mssql")).default.Int, value: entityId }], { maxRows: 500, timeoutMs: 60000 }),
    runReadOnlyQuery(source,
      `SELECT f.* FROM ProductFees f WHERE f.EntityId=@eid AND f.ProductId IN (SELECT ID FROM Products WHERE EntityId=@eid)`,
      [{ name: "eid", type: (await import("mssql")).default.Int, value: entityId }], { maxRows: 500, timeoutMs: 60000 }),
    // How much each product is ACTUALLY used. A configured product nobody sells is
    // not part of how this lender operates, whatever the admin screen says.
    runReadOnlyQuery(source,
      `SELECT ProductId, COUNT(*) AS loans FROM Loans WHERE EntityId=@eid GROUP BY ProductId`,
      [{ name: "eid", type: (await import("mssql")).default.Int, value: entityId }], { maxRows: 500, timeoutMs: 180000 }),
  ]);

  const workflows = wfRes.rows as unknown as Wf[];
  const stages = stageRes.rows as unknown as Stage[];
  const allProducts = prodRes.rows as unknown as ServiceSuiteProduct[];
  const fees = feeRes.rows as unknown as ServiceSuiteFee[];

  const volume = new Map<number, number>();
  for (const r of volRes.rows) volume.set(Number(r.ProductId), Number(r.loans));

  const products = allProducts.filter((p) => (volume.get(Number(p.ID)) ?? 0) >= minLoans);
  const dropped = allProducts.filter((p) => (volume.get(Number(p.ID)) ?? 0) < minLoans);

  console.log(`Read ${workflows.length} workflows · ${stages.length} stages · ${allProducts.length} products · ${fees.length} fees`);
  console.log(`Keeping ${products.length}; dropping ${dropped.length} below ${minLoans} loans:`);
  for (const p of dropped) {
    console.log(`  – ${p.ProductName.trim().padEnd(30)} ${volume.get(Number(p.ID)) ?? 0} loans`);
  }
  console.log("");

  // ── 2. Workflows + stages ──────────────────────────────────────────────────
  // ServiceSuite's stage chain is a linked list via ParentStage; ours keeps the tree
  // AND an explicit order, so walk the chain from the root to number them.
  const wfIdMap = new Map<number, string>();
  for (const w of workflows) {
    const mine = stages.filter((s) => s.WorkflowID === w.ID);
    const ordered: Stage[] = [];
    let cursor = mine.find((s) => !s.ParentStage || s.ParentStage === 0) ?? null;
    const guard = new Set<number>();
    while (cursor && !guard.has(cursor.ID)) {
      guard.add(cursor.ID);
      ordered.push(cursor);
      cursor = mine.find((s) => s.ParentStage === cursor!.ID) ?? null;
    }
    for (const s of mine) if (!guard.has(s.ID)) ordered.push(s); // orphans keep their place

    const title = w.Title.trim();
    console.log(`workflow "${title}" — ${ordered.length} stages: ${ordered.map((s) => s.Title.trim()).join(" → ")}`);

    if (!apply) continue;
    const existing = await p.workflow.findFirst({ where: { orgId: org.id, title }, select: { id: true } });
    const wf = existing
      ? await p.workflow.update({ where: { id: existing.id }, data: { description: w.Description?.trim() || null } })
      : await p.workflow.create({ data: { orgId: org.id, title, description: w.Description?.trim() || null } });
    wfIdMap.set(w.ID, wf.id);

    // Stages are rewritten wholesale — a chain is only meaningful as a whole, and
    // patching one stage of a re-ordered chain would leave a workflow that routes
    // to a stage that no longer follows it.
    await p.workflowStage.deleteMany({ where: { workflowId: wf.id } });
    let parentId: string | null = null;
    for (let i = 0; i < ordered.length; i++) {
      const s: Stage = ordered[i];
      const roleIds: string[] = (s.RoleID ?? "").split(",").map((x) => x.trim()).filter(Boolean);
      const created: { id: string } = await p.workflowStage.create({
        data: {
          workflowId: wf.id,
          title: s.Title.trim(),
          parentId,
          order: i + 1,
          accessTier: s.AccessID ?? 1,
          roleIds,
          canFinalize: s.CanFinalize === 1,
          canUpdate: s.CanUpdate === 1,
        },
        select: { id: true },
      });
      parentId = created.id;
    }
  }

  // ── 3. Products ────────────────────────────────────────────────────────────
  console.log("");
  let created = 0, updated = 0;
  const productIdMap = new Map<number, string>();
  for (const raw of products) {
    const m = mapProduct(raw);
    // A product may name a workflow that no longer exists for this entity (IPF points at
    // 1014, which is gone). Null is correct there — the product falls back to the
    // platform's default two-tier approval rather than routing into nothing.
    const wfId = wfIdMap.get(raw.WorkflowId ?? -1) ?? null;
    const repeatWfId = wfIdMap.get(raw.repeatWorkflowId ?? -1) ?? null;

    console.log(
      `  ${m.isActive ? "●" : "○"} ${m.name.padEnd(30)} ${money(m.minPrincipal)}–${money(m.maxPrincipal)} · ` +
      `${m.ratePerPeriod}%/${m.repaymentPeriodUnit} × ${m.repaymentPeriod} = ${m.interestRate}% ${m.interestMethod} · ` +
      `wf ${raw.WorkflowId ?? "-"} · ${(volume.get(m.serviceSuiteProductId) ?? 0).toLocaleString()} loans` +
      `${m.guarantorRequired ? " · guarantor" : ""}`,
    );
    if (!apply) continue;

    const data = {
      orgId: org.id,
      name: m.name,
      description: m.description,
      minPrincipal: m.minPrincipal,
      maxPrincipal: m.maxPrincipal,
      interestRate: m.interestRate,
      interestMethod: m.interestMethod,
      interestType: m.interestType,
      principalType: m.principalType,
      interestPeriodUnit: m.interestPeriodUnit,
      repaymentPeriod: m.repaymentPeriod,
      repaymentPeriodUnit: m.repaymentPeriodUnit,
      repaymentOrder: m.repaymentOrder,
      minLoanLimit: m.minLoanLimit,
      minCreditScore: m.minCreditScore,
      guarantorRequired: m.guarantorRequired,
      guarantorReborrow: m.guarantorReborrow,
      securityRequired: m.securityRequired,
      securityCoverPct: m.securityCoverPct,
      earlySettlementEnabled: m.earlySettlementEnabled,
      earlySettlementDays: m.earlySettlementDays,
      earlySettlementRate: m.earlySettlementRate,
      disbursementMode: DISBURSEMENT_MODE,
      isActive: m.isActive,
      serviceSuiteProductId: m.serviceSuiteProductId,
      newWorkflowId: wfId,
      repeatWorkflowId: repeatWfId,
    };

    const existing = await p.product.findFirst({
      where: { orgId: org.id, serviceSuiteProductId: m.serviceSuiteProductId },
      select: { id: true },
    });
    const row = existing
      ? await p.product.update({ where: { id: existing.id }, data })
      : await p.product.create({ data });
    productIdMap.set(m.serviceSuiteProductId, row.id);
    if (existing) updated++; else created++;
  }

  // ── 4. Fees ────────────────────────────────────────────────────────────────
  console.log("");
  let feesWritten = 0;
  for (const raw of fees) {
    const m = mapFee(raw);
    const productId = productIdMap.get(m.serviceSuiteProductId) ?? null;
    const band = m.minPrincipal !== null || m.maxPrincipal !== null
      ? ` · P ${money(m.minPrincipal ?? 0)}–${money(m.maxPrincipal ?? 0)}` : "";
    const price = m.isPercent
      ? `${m.amount}%${m.minValue || m.maxValue ? ` clamped ${money(m.minValue ?? 0)}–${money(m.maxValue ?? 0)}` : ""}`
      : money(m.amount);
    console.log(`  ${m.isActive ? "●" : "○"} ${m.code.padEnd(16)} ${m.name.padEnd(18)} ${price}${band} · ${m.applyAt}`);

    if (!apply) continue;
    if (!productId) { console.log(`      (skipped — product ${m.serviceSuiteProductId} not on the shelf)`); continue; }

    const data = {
      orgId: org.id,
      name: m.name,
      code: m.code,
      description: m.description,
      amount: m.amount,
      isPercent: m.isPercent,
      minValue: m.minValue,
      maxValue: m.maxValue,
      minPrincipal: m.minPrincipal,
      maxPrincipal: m.maxPrincipal,
      applyAt: m.applyAt,
      trigger: m.trigger,
      beneficiary: "LENDER" as const,
      productId,
      isActive: m.isActive,
      serviceSuiteFeeId: m.serviceSuiteFeeId,
    };
    const existing = await p.charge.findFirst({ where: { orgId: org.id, code: m.code }, select: { id: true } });
    if (existing) await p.charge.update({ where: { id: existing.id }, data });
    else await p.charge.create({ data });
    feesWritten++;
  }

  // ── 5. Replace, don't accumulate ───────────────────────────────────────────
  // Everything the lender does not have goes: the invented starter shelf, and any
  // product that fell below the volume floor. But a product with loans behind it is
  // NEVER deleted — those loans are somebody's debt and the product is what explains
  // their schedule. Those are switched off instead: gone from the shelf, intact in
  // the record.
  console.log("");
  const mirrored = new Set(productIdMap.values());
  const strays = apply
    ? await p.product.findMany({
        where: { orgId: org.id, id: { notIn: [...mirrored] } },
        select: { id: true, name: true, serviceSuiteProductId: true, _count: { select: { loans: true, applications: true } } },
      })
    : [];
  let removed = 0, retired = 0;
  for (const s of strays) {
    const inUse = s._count.loans > 0 || s._count.applications > 0;
    const why = s.serviceSuiteProductId ? `below the ${minLoans}-loan floor` : "not on the lender's shelf";
    if (inUse) {
      await p.product.update({ where: { id: s.id }, data: { isActive: false } });
      retired++;
      console.log(`  ○ retired  ${s.name} — ${why}, but has ${s._count.loans} loan(s) / ${s._count.applications} application(s)`);
    } else {
      // Its fees go with it — but a fee somebody actually PAID is receipt-backed and
      // is deactivated, never deleted (PaymentIntent.chargeId points at it).
      const feeRows = await p.charge.findMany({
        where: { orgId: org.id, productId: s.id },
        select: { id: true, _count: { select: { payments: true } } },
      });
      for (const f of feeRows) {
        if (f._count.payments > 0) await p.charge.update({ where: { id: f.id }, data: { isActive: false } });
        else await p.charge.delete({ where: { id: f.id } });
      }
      await p.product.delete({ where: { id: s.id } });
      removed++;
      console.log(`  ✕ removed  ${s.name} — ${why}`);
    }
  }

  if (apply) {
    const live = await p.product.count({ where: { orgId: org.id, isActive: true } });
    const off = await p.product.count({ where: { orgId: org.id, isActive: false } });
    console.log(`\n${created} created · ${updated} updated · ${removed} removed · ${retired} retired · ${feesWritten} fees written`);
    console.log(`${org.name}: ${live} live on the shelf, ${off} switched off.`);
  } else {
    console.log("Dry run — nothing written. Re-run with --apply.");
  }
  await p.$disconnect();
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
