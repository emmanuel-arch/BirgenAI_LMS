// PILOT REHEARSAL — book one console-originated test loan into the MIROMART
// FINTECH deployment, end to end, exactly the way the console's final-approval
// does it (same seams: ensureBorrower → postLoan → application updates).
//
//   npx tsx scripts/rehearse-fintech-booking.ts                (defaults below)
//   npx tsx scripts/rehearse-fintech-booking.ts --amount=5000
//
// WHAT IT PROVES for Monday: a customer onboarded on OUR platform exists as a
// first-class borrower in the boss's system (created via THEIR
// sp_NewBorrowerRegistration) and their loan sits at the ROOT stage of workflow
// 55 "FINTECH APPROVAL" (Risk → Customer Service) for their officers to action.
// TransactionRef on the loan = our LoanApplication.id — the outcome join key.
//
// Idempotent-ish: re-running creates a NEW application + a NEW loan for the same
// borrower (their system treats that as a second application, which is honest).
import "dotenv/config";
import { Prisma } from "@prisma/client";
import { platformPrisma } from "../prisma/seed-client";
import { enterPlatform } from "../src/lib/db/context";
import { getPostingOrg, getEntityId } from "../src/lib/enterprise/connections";
import { ensureBorrower, postLoan, isPostingEnabled } from "../src/lib/lms/servicesuite";
import { runReadOnlyQuery, mssql } from "../src/lib/enterprise/mssql";

// The test customer. The founder's own identity (254758517032) is borrower 26706
// there with an ACTIVE 2025 loan — their LoanValidation declines any borrower
// carrying a balance (reason 1), so the rehearsal uses a clean, clearly-labelled
// test identity instead. Override: --phone= --first= --other= --id-no=
const arg = (k: string, d: string) => (process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d);
const TEST = {
  firstName: arg("first", "BIRGENAI"),
  otherName: arg("other", "PILOT TEST"),
  phone: arg("phone", "254700000007"),
  nationalId: arg("id-no", "11223344"),
};

async function main() {
  const amountArg = process.argv.find((a) => a.startsWith("--amount="));
  const amount = amountArg ? Number(amountArg.split("=")[1]) : 5000;
  if (!Number.isFinite(amount) || amount < 5000 || amount > 20000) throw new Error("Amount must be within the product's KES 5,000–20,000.");
  if (!isPostingEnabled()) throw new Error("LMS_POSTING_ENABLED is not true.");

  const p = platformPrisma();
  enterPlatform();

  const org = await p.org.findUnique({ where: { slug: "micromart" }, select: { id: true, name: true } });
  if (!org) throw new Error("No micromart org.");
  const product = await p.product.findFirst({
    where: { orgId: org.id, name: "MIROMART FINTECH", isActive: true },
    select: { id: true, name: true, serviceSuiteProductId: true },
  });
  if (!product?.serviceSuiteProductId) throw new Error("MIROMART FINTECH product missing its fintech Products.ID.");
  const postingOrg = getPostingOrg("micromart");
  if (!postingOrg) throw new Error("Posting target unresolved (MICROMART_FINTECH conn).");
  const entityId = getEntityId(postingOrg);
  console.log(`Booking KES ${amount.toLocaleString()} on ${product.name} → ${postingOrg.name} (entity ${entityId}, product ${product.serviceSuiteProductId})\n`);

  // 1. The customer, as the console-assisted flow records them on our side.
  const borrower = await p.borrower.upsert({
    where: { orgId_phone: { orgId: org.id, phone: TEST.phone } },
    update: { firstName: TEST.firstName, otherName: TEST.otherName, nationalId: TEST.nationalId },
    create: { orgId: org.id, phone: TEST.phone, firstName: TEST.firstName, otherName: TEST.otherName, nationalId: TEST.nationalId, language: "en" },
    select: { id: true },
  });
  console.log(`1. Borrower on our book: ${TEST.firstName} ${TEST.otherName} (${borrower.id})`);

  // 2. The application — the record the console approved (rehearsal-stamped).
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
  console.log(`2. Application ${app.id} (this id rides to ServiceSuite as TransactionRef)`);

  // 3. Register the customer with the lender (their proc; no-op if already there).
  const ensured = await ensureBorrower(postingOrg, entityId, {
    phone: TEST.phone, firstName: TEST.firstName, otherName: TEST.otherName, nationalId: TEST.nationalId,
  });
  if (!ensured.ok) throw new Error(`ensureBorrower failed: ${ensured.message}`);
  console.log(`3. Lender borrower id ${ensured.borrowerId} (${ensured.created ? "REGISTERED just now via sp_NewBorrowerRegistration" : "already existed"})`);

  // 4. Book the loan into their workflow.
  const res = await postLoan(postingOrg, {
    borrowerId: ensured.borrowerId,
    principal: amount,
    productId: product.serviceSuiteProductId,
    applicationId: app.id,
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
  console.log(`4. LOAN BOOKED — ServiceSuite loan ${res.loanId}: ${res.message}`);

  // 5. Read it back from THEIR database — what the boss's team will see.
  const check = await runReadOnlyQuery(postingOrg,
    `SELECT l.ID, l.BorrowerId, l.ProductId, l.LoanAmount, l.LoanBalance, l.isApproved, l.ApprovalStage,
            s.Title AS StageTitle, w.Title AS WorkflowTitle,
            b.firstName, b.otherName, b.AccountNo, b.PhoneNumber, b.NationalID
     FROM Loans l
     JOIN Borrowers b ON b.ID = l.BorrowerId
     LEFT JOIN ApprovalWorkflowStage s ON s.ID = l.ApprovalStage
     LEFT JOIN ApprovalWorkflow w ON w.ID = s.WorkflowID
     WHERE l.ID = @loanId`,
    [{ name: "loanId", type: mssql.Int, value: Number(res.loanId) }],
    { maxRows: 1, timeoutMs: 20000 });
  console.log("\n5. AS THEIR SYSTEM SEES IT:");
  console.log(JSON.stringify(check.rows[0] ?? {}, null, 2));

  await p.$disconnect();
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
