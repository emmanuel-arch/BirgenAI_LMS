// PILOT REHEARSAL — book one console-originated test loan into a bridged lender's
// live ServiceSuite, end to end, through the same seams the console's final
// approval uses (ensureBorrower → postLoan → application updates).
//
//   npx tsx scripts/rehearse-fintech-booking.ts                     # DRY RUN (default)
//   npx tsx scripts/rehearse-fintech-booking.ts --post              # actually book it
//   npx tsx scripts/rehearse-fintech-booking.ts --amount=25000 --term=2
//   npx tsx scripts/rehearse-fintech-booking.ts --org=micromart --product="Micro Eazy Monthly"
//
// DRY RUN IS THE DEFAULT, and that is deliberate. This script writes into a
// production loan book, and the blueprint's standing rule is "never rehearse
// blind". Without --post it runs every pre-flight check, prints exactly what would
// happen, and touches nothing.
//
// WHAT A GREEN RUN PROVES: a customer onboarded on OUR platform exists as a
// first-class borrower in the lender's own system (registered via THEIR
// sp_NewBorrowerRegistration), and their loan sits at the ROOT stage of the
// product's own approval workflow with isApproved = 0, for their officers to
// action. TransactionRef on the loan = our LoanApplication.id, the outcome join key.
//
// For Micromart that root stage is workflow 1022 "Micro Eazy" → stage 2058 "Risk",
// in entity 3005 (MICROMART FINTECH). Note that sp_InsertLoan derives BOTH the
// entity and the workflow from Products.EntityId / Products.WorkflowId, so the
// ServiceSuite product id is what actually decides where a loan lands — passing the
// wrong one is how a loan ends up in the wrong book.
import "dotenv/config";
import { Prisma } from "@prisma/client";
import { platformPrisma } from "../prisma/seed-client";
import { enterPlatform } from "../src/lib/db/context";
import { getPostingOrg, getEntityId } from "../src/lib/enterprise/connections";
import { ensureBorrower, postLoan, findBorrowerByPhone, isPostingEnabled } from "../src/lib/lms/servicesuite";
import { runReadOnlyQuery, mssql } from "../src/lib/enterprise/mssql";

const arg = (k: string, d: string) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d);
const flag = (k: string) => process.argv.includes(`--${k}`);

const ORG = arg("org", "micromart");
const PRODUCT = arg("product", "Micro Eazy Monthly");
const POST = flag("post");

// The test customer. Deliberately a clearly-labelled test identity rather than the
// founder's own: on Micromart's live book 254758517032 is borrower 168346 in entity
// 3005 AND borrower 89296 ("Mr Kipleting") in entity 3002 — one of 13 numbers held
// by different people across the two entities. Override: --phone= --first= --other= --id-no=
const TEST = {
  firstName: arg("first", "BIRGENAI"),
  otherName: arg("other", "PILOT TEST"),
  phone: arg("phone", "254700000007"),
  nationalId: arg("id-no", "11223344"),
};

const kes = (n: number) => `KES ${n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function main() {
  const amount = Number(arg("amount", "25000"));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("--amount must be a positive number.");
  const termArg = process.argv.find((a) => a.startsWith("--term="));
  const term = termArg ? Number(termArg.split("=")[1]) : null;
  if (term != null && (!Number.isInteger(term) || term < 1)) throw new Error("--term must be a positive integer.");

  const p = platformPrisma();
  enterPlatform();

  const org = await p.org.findUnique({ where: { slug: ORG }, select: { id: true, name: true } });
  if (!org) throw new Error(`No org with slug "${ORG}".`);
  const product = await p.product.findFirst({
    where: { orgId: org.id, name: PRODUCT, isActive: true },
    select: { id: true, name: true, serviceSuiteProductId: true, repaymentPeriod: true, minRepaymentPeriod: true, repaymentPeriodUnit: true },
  });
  if (!product) throw new Error(`No active product named "${PRODUCT}" on ${org.name}.`);
  if (!product.serviceSuiteProductId) {
    throw new Error(
      `"${product.name}" has no serviceSuiteProductId — the loan cannot be routed to the lender's book.\n` +
      `  Fix: npx tsx scripts/seed-micro-eazy.ts --ss-me=30219 --ss-mem=30220`,
    );
  }
  const postingOrg = getPostingOrg(ORG);
  if (!postingOrg) throw new Error(`Posting target for "${ORG}" is unresolved — its connection env is unset.`);
  const entityId = getEntityId(postingOrg);
  const ssProductId = product.serviceSuiteProductId;

  console.log(`\n${POST ? "LIVE BOOKING" : "DRY RUN"} — ${kes(amount)} on ${product.name}`);
  console.log(`  target      ${postingOrg.name}  entity ${entityId}  ServiceSuite product ${ssProductId}`);
  console.log(`  customer    ${TEST.firstName} ${TEST.otherName}  ${TEST.phone}  ID ${TEST.nationalId}`);
  console.log(`  posting     LMS_POSTING_ENABLED=${isPostingEnabled()}\n`);

  // ── 1. Pre-flight against the lender's own configuration ──────────────────
  // Read the product as THEY have it, and price the pre-disbursement charges the
  // way dbo.LoanValidation does — all FeeType-1 fees, percentages on principal.
  // That is the figure the borrower's wallet has to cover, and it is NOT always
  // the figure sp_InsertLoan charges (which counts only mandatory fees and varies
  // the base by FeeRef). The gate is what blocks a booking, so the gate wins.
  const cfg = await runReadOnlyQuery(
    postingOrg,
    `SELECT p.ProductName, p.EntityId, p.IsActive, p.MinPrincipal, p.MaxPrincipal,
            p.RepaymentPeriod, p.RepaymentPeriodType, p.InterestRate, p.MinCreditScore,
            p.WorkflowId, w.Title AS WorkflowTitle,
            (SELECT TOP 1 s.ID FROM ApprovalWorkflowStage s WHERE s.WorkflowID = p.WorkflowId AND s.ParentStage = 0) AS RootStageId,
            (SELECT TOP 1 s.Title FROM ApprovalWorkflowStage s WHERE s.WorkflowID = p.WorkflowId AND s.ParentStage = 0) AS RootStageTitle,
            ISNULL((SELECT SUM(CASE WHEN f.FeeValueType = 2 THEN f.FeeValue ELSE 0 END)
                         + (SUM(CASE WHEN f.FeeValueType = 1 THEN f.FeeValue ELSE 0 END) / 100.0) * @principal
                    FROM ProductFees f WHERE f.ProductId = p.ID AND f.FeeType = 1), 0) AS GateCharges
     FROM Products p
     LEFT JOIN ApprovalWorkflow w ON w.ID = p.WorkflowId
     WHERE p.ID = @productId`,
    [
      { name: "productId", type: mssql.Int, value: ssProductId },
      { name: "principal", type: mssql.Decimal(18, 2), value: amount },
    ],
    { maxRows: 1, timeoutMs: 20000 },
  );
  const c = cfg.rows[0];
  if (!c) throw new Error(`ServiceSuite product ${ssProductId} does not exist on ${postingOrg.name}. This is the wrong deployment.`);

  const gateCharges = Number(c.GateCharges ?? 0);
  console.log("1. THE LENDER'S PRODUCT, AS THEY HAVE IT");
  console.log(`   ${c.ProductName}  entity ${c.EntityId}  active=${c.IsActive}`);
  console.log(`   principal ${kes(Number(c.MinPrincipal))} – ${kes(Number(c.MaxPrincipal))}   rate ${c.InterestRate}   min score ${c.MinCreditScore}`);
  console.log(`   workflow ${c.WorkflowId} "${c.WorkflowTitle}" → root stage ${c.RootStageId} "${c.RootStageTitle}"`);
  console.log(`   pre-disbursement charges on ${kes(amount)}: ${kes(gateCharges)}`);
  if (Number(c.EntityId) !== entityId) {
    console.log(`   ! product entity ${c.EntityId} != configured entity ${entityId} — sp_InsertLoan books by PRODUCT, so the loan lands in ${c.EntityId}.`);
  }
  if (amount < Number(c.MinPrincipal) || amount > Number(c.MaxPrincipal)) {
    throw new Error(`${kes(amount)} is outside the product's ${kes(Number(c.MinPrincipal))}–${kes(Number(c.MaxPrincipal))} range.`);
  }

  // ── 2. Who this books against, at the lender ──────────────────────────────
  const match = await findBorrowerByPhone(postingOrg, entityId, TEST.phone, TEST.nationalId);
  console.log("\n2. THE BORROWER AT THE LENDER");
  if (match.kind === "ambiguous") {
    console.error(`   REFUSED — ${match.reason}`);
    for (const cand of match.candidates) console.error(`     candidate ${cand.borrowerId}  ${cand.name}  ID ${cand.nationalId ?? "(none)"}`);
    throw new Error("Identity could not be confirmed. Reconcile the lender's records before rehearsing.");
  }
  if (match.kind === "none") {
    console.log(`   not registered yet — ${POST ? "will be created via their sp_NewBorrowerRegistration" : "would be created (dry run: skipped)"}`);
  } else {
    console.log(`   borrower ${match.borrowerId}  ${match.name}`);
  }

  // ── 3. The gate, before we ever call sp_InsertLoan ────────────────────────
  if (match.kind === "found") {
    const gate = await runReadOnlyQuery(
      postingOrg,
      `SELECT dbo.LoanValidation(@borrowerId, @productId, @principal) AS code,
              b.LoanLimit, b.CreditScore,
              ISNULL((SELECT s.Amount FROM Transactions.dbo.AccountSavings s WHERE s.BorrowerId = b.ID), 0) AS Wallet
       FROM Borrowers b WHERE b.ID = @borrowerId`,
      [
        { name: "borrowerId", type: mssql.Int, value: match.borrowerId },
        { name: "productId", type: mssql.Int, value: ssProductId },
        { name: "principal", type: mssql.Decimal(18, 2), value: amount },
      ],
      { maxRows: 1, timeoutMs: 20000 },
    );
    const g = gate.rows[0] ?? {};
    const code = Number(g.code ?? -1);
    const wallet = Number(g.Wallet ?? 0);
    console.log("\n3. THE LENDER'S OWN GATE  dbo.LoanValidation");
    console.log(`   loan limit ${kes(Number(g.LoanLimit ?? 0))}   credit score ${g.CreditScore}   wallet ${kes(wallet)}`);

    if (code !== 0) {
      const why = await runReadOnlyQuery(
        postingOrg,
        `SELECT Description FROM DeclinedStatus WHERE id = @code`,
        [{ name: "code", type: mssql.Int, value: code }],
        { maxRows: 1, timeoutMs: 15000 },
      );
      const reason = String(why.rows[0]?.Description ?? "unknown reason");
      console.error(`   BLOCKED — code ${code}: ${reason}`);
      if (code === 2) {
        console.error(`   The wallet must cover the charges before a loan can be created.`);
        console.error(`     required ${kes(gateCharges)}   held ${kes(wallet)}   short ${kes(Math.max(0, gateCharges - wallet))}`);
        console.error(`     Production path: collect by STK, then EXEC sp_CreateAccountSavings @BorrowerId, @Amount, @Narration.`);
        console.error(`     NOTE: sp_UpdateSavings is a bare UPDATE and credits NOTHING when the borrower has no row yet.`);
      }
      throw new Error(`Pre-flight failed (code ${code}). sp_InsertLoan would return 400 and write a DeclinedLoans row.`);
    }
    console.log(`   PASS — code 0, sp_InsertLoan will accept this booking.`);
  }

  // The term the customer signed for. On a flexible-tenor product, omitting this
  // makes sp_InsertLoan fall back to the product's ceiling — the most expensive
  // term it sells.
  const maxTerm = product.repaymentPeriod;
  const minTerm = product.minRepaymentPeriod ?? maxTerm;
  const selectedPeriod = term ?? minTerm;
  if (selectedPeriod < minTerm || selectedPeriod > maxTerm) {
    throw new Error(`--term=${selectedPeriod} is outside this product's ${minTerm}–${maxTerm} ${product.repaymentPeriodUnit}(s).`);
  }
  console.log(`\n4. TERM  ${selectedPeriod} ${product.repaymentPeriodUnit}(s)  (product sells ${minTerm}–${maxTerm}; ceiling would be ${maxTerm})`);

  if (!POST) {
    console.log(`\nDRY RUN COMPLETE — nothing was written.`);
    console.log(`  Re-run with --post to book it into ${postingOrg.name}.\n`);
    await p.$disconnect();
    return;
  }
  if (!isPostingEnabled()) throw new Error("LMS_POSTING_ENABLED is not true — refusing to pretend a booking happened.");

  // ── 5. Our side: the customer and the application the console approved ────
  const borrower = await p.borrower.upsert({
    where: { orgId_phone: { orgId: org.id, phone: TEST.phone } },
    update: { firstName: TEST.firstName, otherName: TEST.otherName, nationalId: TEST.nationalId },
    create: { orgId: org.id, phone: TEST.phone, firstName: TEST.firstName, otherName: TEST.otherName, nationalId: TEST.nationalId, language: "en" },
    select: { id: true },
  });
  const app = await p.loanApplication.create({
    data: {
      orgId: org.id,
      borrowerId: borrower.id,
      productId: product.id,
      phone: TEST.phone,
      nationalId: TEST.nationalId,
      borrowerName: `${TEST.firstName} ${TEST.otherName}`,
      productName: product.name,
      amountRequested: new Prisma.Decimal(amount),
      status: "OFFICER_REVIEW",
      stageTitle: "Final Approval",
      decision: "APPROVE",
      score: 741,
      pd: new Prisma.Decimal(0.06),
      scoreModelVersion: "rehearsal",
      consent: { note: "pilot rehearsal booking — founder-authorized", at: new Date().toISOString() } as Prisma.InputJsonValue,
      decidedAt: new Date(),
    },
    select: { id: true },
  });
  console.log(`\n5. Application ${app.id} (rides to ServiceSuite as TransactionRef)`);

  const ensured = await ensureBorrower(postingOrg, entityId, {
    phone: TEST.phone, firstName: TEST.firstName, otherName: TEST.otherName, nationalId: TEST.nationalId,
  });
  if (!ensured.ok) throw new Error(`ensureBorrower failed: ${ensured.message}`);
  console.log(`   lender borrower ${ensured.borrowerId} (${ensured.created ? "REGISTERED just now" : "already existed"})`);

  const res = await postLoan(postingOrg, {
    borrowerId: ensured.borrowerId,
    principal: amount,
    productId: ssProductId,
    applicationId: app.id,
    selectedPeriod,
  });
  if (!res.ok) {
    await p.loanApplication.update({ where: { id: app.id }, data: { postError: res.message } });
    throw new Error(`postLoan failed: [${res.code ?? "-"}] ${res.message}`);
  }
  await p.loanApplication.update({
    where: { id: app.id },
    data: {
      status: "APPROVED",
      stageTitle: `Booked to ${postingOrg.name} — lender approval`,
      postedToServiceSuite: true,
      serviceSuiteLoanId: res.loanId,
      decidedAt: new Date(),
    },
  });
  console.log(`   LOAN BOOKED — ServiceSuite loan ${res.loanId}: ${res.message}`);

  // ── 6. Read it back from THEIR database ──────────────────────────────────
  const check = await runReadOnlyQuery(
    postingOrg,
    `SELECT l.ID, l.BorrowerId, l.ProductId, l.EntityId, l.Principal, l.Interest, l.LoanAmount,
            l.AmountToDisburse, l.SelectedPeriod, l.isApproved, l.ApprovalStage, l.ChannelUsed, l.TransactionRef,
            s.Title AS StageTitle, w.Title AS WorkflowTitle,
            b.firstName, b.otherName, b.AccountNo, b.PhoneNumber, b.NationalID, b.EntityUnit
     FROM Loans l
     JOIN Borrowers b ON b.ID = l.BorrowerId
     LEFT JOIN ApprovalWorkflowStage s ON s.ID = l.ApprovalStage
     LEFT JOIN ApprovalWorkflow w ON w.ID = s.WorkflowID
     WHERE l.ID = @loanId`,
    [{ name: "loanId", type: mssql.Int, value: Number(res.loanId) }],
    { maxRows: 1, timeoutMs: 20000 },
  );
  console.log("\n6. AS THEIR SYSTEM SEES IT:");
  console.log(JSON.stringify(check.rows[0] ?? {}, null, 2));
  console.log(`\nROLLBACK: this loan is unapproved (isApproved = 0) at the root stage. To reverse, have the`);
  console.log(`lender decline it in their own workflow — do not delete the row from under their audit trail.\n`);

  await p.$disconnect();
}

main().then(() => process.exit(0)).catch((e) => { console.error(`\n${e instanceof Error ? e.message : e}\n`); process.exit(1); });
