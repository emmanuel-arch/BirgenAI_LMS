// Tests for CHARGES + THE CENTRALISED PAYMENT RAIL.
//
//   npm run test:payments    (live DB: builds a scratch org, then deletes it.
//                             NO STK is sent — the vault is left unconfigured, so
//                             requestPayment refuses at the credential check, which
//                             is exactly the boundary we want to test up to.)
//
// Every claim here is a way this could quietly take the wrong money from the wrong
// person and put it in the wrong place — which is the only kind of bug that matters
// in a payment rail, because none of them look like a crash.
//
//   THE PRICE IS NOT THE CLIENT'S TO SET. A charge's amount comes from the Charge
//     row. If a browser can post `amount: 1` against a KES 200 fee, the fee is a
//     suggestion.
//   A FEE IS NOT A REPAYMENT. A processing fee is a PERCENTAGE OF A LOAN, so it
//     carries that loan's id — and the old callback allocated anything with a loanId
//     as a repayment. That would pay down the customer's balance with the lender's
//     fee, silently, forever.
//   A REGISTRATION FEE IS NOT AN EXCEPTION. It has no loan, and the old callback
//     raised a HIGH-severity "find where this money belongs" alarm for anything
//     without one. An exceptions queue that cries wolf on every fee is not read.
//   THE MONEY LANDS IN THE RIGHT TILL. A LENDER fee settles to the lender. A
//     PLATFORM fee is BirgenAI's and settles to ours. One button, two destinations.
//   A RETRIED CALLBACK CANNOT BANK THE SAME SHILLING TWICE. Daraja retries.
//   THE PROMPT GOES TO THE CUSTOMER'S OWN NUMBER — never a number an officer typed,
//     or an officer can pay a customer's fee from their own handset and mark them
//     as having paid.
import "dotenv/config";
import { platformPrisma } from "../prisma/seed-client";
import { enterPlatform } from "@/lib/db/context";
import { requestPayment, askablesFor, chargeAmount } from "@/lib/payments/request";
import { settlePayment } from "@/lib/payments/settle";
import { deleteTenant } from "@/lib/compliance/tenant";
import { setIntegration } from "@/lib/vault/integrations";
import type { PaymentIntent } from "@prisma/client";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); }
};
const section = (s: string) => console.log(`\n${s}`);

async function main() {
  // ── Pure arithmetic ────────────────────────────────────────────────────────
  section("What a charge costs");

  ok("a flat fee is the flat fee", chargeAmount({ amount: 200, isPercent: false }) === 200);
  ok("a percentage fee is a percentage OF THE PRINCIPAL", chargeAmount({ amount: 2.5, isPercent: true }, 20000) === 500);
  ok("a percentage fee with no loan to be a percentage of is nothing, not a crash",
    chargeAmount({ amount: 2.5, isPercent: true }) === 0);

  // ── Live DB ────────────────────────────────────────────────────────────────
  const p = platformPrisma();
  enterPlatform();

  const stamp = Date.now();
  const org = await p.org.create({ data: { slug: `paytest-${stamp}`, name: "Pay Test Ltd", status: "ACTIVE" } });
  const branch = await p.branch.create({ data: { orgId: org.id, name: "HQ" } });
  const product = await p.product.create({
    data: { orgId: org.id, name: "Boost", minPrincipal: 1000, maxPrincipal: 50000, interestRate: 10, repaymentPeriod: 30 },
  });
  const borrower = await p.borrower.create({
    data: { orgId: org.id, phone: "254799000001", firstName: "Test", otherName: "Payer", kycStatus: "VERIFIED", branchId: branch.id },
  });

  const regFee = await p.charge.create({
    data: { orgId: org.id, code: "REGFEE", name: "Registration fee", amount: 100, trigger: "ON_REGISTRATION", beneficiary: "LENDER" },
  });
  const procFee = await p.charge.create({
    data: { orgId: org.id, code: "PROCFEE", name: "Processing fee", amount: 2, isPercent: true, trigger: "ON_APPLICATION", beneficiary: "LENDER" },
  });
  const platformFee = await p.charge.create({
    data: { orgId: org.id, code: "BIRGENFEE", name: "BirgenAI fee", amount: 50, beneficiary: "PLATFORM" },
  });

  const app = await p.loanApplication.create({
    data: { orgId: org.id, borrowerId: borrower.id, productId: product.id, amountRequested: 20000 },
  });
  const loan = await p.loan.create({
    data: {
      orgId: org.id, borrowerId: borrower.id, applicationId: app.id, productId: product.id,
      principal: 20000, interest: 2000, loanAmount: 22000, balance: 22000, status: "ACTIVE", branchId: branch.id,
    },
  });
  await p.installment.create({
    data: { orgId: org.id, loanId: loan.id, seq: 1, dueDate: new Date(), amountDue: 5500, principalDue: 5000, interestDue: 500, amountPaid: 0 },
  });

  // ── What can be asked of this customer ─────────────────────────────────────
  section("What it makes sense to ask this customer for");

  const asks = await askablesFor(org.id, borrower.id);
  const inst = asks.find((a) => a.kind === "installment");
  ok("the installment they owe is offered first", asks[0]?.kind === "installment");
  ok("…for the amount actually due, not the whole balance", inst?.amount === 5500, String(inst?.amount));

  const proc = asks.find((a) => a.id === procFee.id);
  ok("★ a PERCENTAGE fee is priced off their real loan (2% of 20,000)", proc?.amount === 400, String(proc?.amount));

  const plat = asks.find((a) => a.id === platformFee.id);
  ok("★ a PLATFORM fee is flagged as ours, not the lender's", plat?.beneficiary === "PLATFORM");
  ok("a lender fee is flagged as theirs", asks.find((a) => a.id === regFee.id)?.beneficiary === "LENDER");

  // ── An unconfigured lender never gets as far as a record ──────────────────
  section("An unconfigured lender cannot ask for money");

  const unconfigured = await requestPayment({
    orgId: org.id, orgSlug: org.slug, purpose: "CHARGE", chargeId: regFee.id,
    borrowerId: borrower.id, channel: "c360", requestedById: null,
  });
  ok("no M-Pesa in the vault ⇒ refused, with the fix named", !unconfigured.ok && /Settings → Vault/.test(unconfigured.message));
  ok("★ …and NO intent row is left behind (nothing was pushed, so there is nothing to record)",
    (await p.paymentIntent.count({ where: { orgId: org.id } })) === 0);

  // Now connect a WELL-SHAPED but bogus Till, so the request travels the whole road:
  // amount resolved → phone resolved → intent WRITTEN → push attempted → push fails.
  // Daraja rejects the credentials, which is exactly what we want: it proves the row
  // is written BEFORE the push, not after it.
  await setIntegration(org.id, "MPESA_STK", {
    consumerKey: "test-consumer-key",
    consumerSecret: "test-consumer-secret",
    shortCode: "4123456",
    passkey: "test-passkey",
    transactionType: "CustomerBuyGoodsOnline",
    tillNumber: "9876543",
    environment: "sandbox",
  });

  // ── The price is not the client's to set ──────────────────────────────────
  section("The price is the lender's, not the browser's");

  const cheated = await requestPayment({
    orgId: org.id, orgSlug: org.slug, purpose: "CHARGE", chargeId: regFee.id,
    borrowerId: borrower.id, amount: 1, channel: "c360", requestedById: null,
  });
  const cheatIntent = await p.paymentIntent.findFirst({ where: { orgId: org.id, chargeId: regFee.id }, orderBy: { createdAt: "desc" } });
  ok("★★ A CLIENT-SUPPLIED AMOUNT IS IGNORED FOR A CHARGE (posted 1, charged 100)",
    Number(cheatIntent?.amount) === 100, `intent = ${cheatIntent?.amount}`);
  ok("the bogus Till was rejected by Daraja, as it should be", !cheated.ok);

  // ── The record is written BEFORE the push ─────────────────────────────────
  ok("★★ THE INTENT ROW EXISTS EVEN THOUGH THE PUSH FAILED — money must never leave without a record",
    !!cheatIntent && cheatIntent.state === "FAILED");
  ok("…and it remembers what it was for, who for, and who asked",
    cheatIntent?.purpose === "CHARGE" && cheatIntent?.borrowerId === borrower.id && cheatIntent?.channel === "c360");

  // ── The prompt goes to the registered number ──────────────────────────────
  section("The prompt goes to the customer, not to whoever typed a number");

  await requestPayment({
    orgId: org.id, orgSlug: org.slug, purpose: "CHARGE", chargeId: regFee.id,
    borrowerId: borrower.id, phone: "254700111222", channel: "counter", requestedById: null,
  });
  const spoofed = await p.paymentIntent.findFirst({ where: { orgId: org.id, channel: "counter" }, orderBy: { createdAt: "desc" } });
  ok("★★ AN OFFICER CANNOT REDIRECT THE PROMPT TO THEIR OWN HANDSET",
    spoofed?.phone === "254799000001", `went to ${spoofed?.phone}`);

  // ── Never ask for more than they owe ──────────────────────────────────────
  const over = await requestPayment({
    orgId: org.id, orgSlug: org.slug, purpose: "INSTALLMENT", loanId: loan.id,
    borrowerId: borrower.id, amount: 999999, channel: "collections", requestedById: null,
  });
  const overIntent = await p.paymentIntent.findFirst({ where: { orgId: org.id, channel: "collections" }, orderBy: { createdAt: "desc" } });
  ok("★ a customer is never asked for more than their balance", Number(overIntent?.amount) === 22000, String(overIntent?.amount));
  void over;

  // ── SETTLEMENT: the part that used to be wrong ────────────────────────────
  section("Settlement: a fee is not a repayment");

  const before = await p.loan.findUnique({ where: { id: loan.id }, select: { balance: true } });

  // A PROCESSING FEE, which legitimately carries the loan's id.
  const feeIntent = await p.paymentIntent.create({
    data: {
      orgId: org.id, purpose: "CHARGE", chargeId: procFee.id, loanId: loan.id, borrowerId: borrower.id,
      phone: borrower.phone, amount: 400, beneficiary: "LENDER", reference: "PROCFEE",
      state: "SUCCESS", checkoutRequestId: `ws_CO_fee_${stamp}`,
    },
  });
  const feeOut = await settlePayment(org.id, org.name, feeIntent as PaymentIntent, 400, "QK1FEE");
  const afterFee = await p.loan.findUnique({ where: { id: loan.id }, select: { balance: true } });

  ok("★★ A PROCESSING FEE DOES NOT PAY DOWN THE LOAN",
    Number(afterFee?.balance) === Number(before?.balance),
    `balance ${before?.balance} -> ${afterFee?.balance}`);
  ok("…it is recorded as a charge paid", feeOut.applied && feeOut.how.startsWith("charge:"), feeOut.how);

  const exAfterFee = await p.reconciliationException.count({ where: { orgId: org.id } });
  ok("★★ A FEE RAISES NO RECONCILIATION EXCEPTION (the old code alarmed on every one)", exAfterFee === 0);

  // A REGISTRATION FEE — no loan at all.
  const regIntent = await p.paymentIntent.create({
    data: {
      orgId: org.id, purpose: "CHARGE", chargeId: regFee.id, borrowerId: borrower.id,
      phone: borrower.phone, amount: 100, beneficiary: "LENDER", reference: "REGFEE",
      state: "SUCCESS", checkoutRequestId: `ws_CO_reg_${stamp}`,
    },
  });
  const regOut = await settlePayment(org.id, org.name, regIntent as PaymentIntent, 100, "QK1REG");
  ok("a registration fee with no loan settles cleanly", regOut.applied);
  ok("…and still raises no exception", (await p.reconciliationException.count({ where: { orgId: org.id } })) === 0);

  // ── A REAL REPAYMENT still works ──────────────────────────────────────────
  section("Settlement: a repayment IS a repayment");

  const payIntent = await p.paymentIntent.create({
    data: {
      orgId: org.id, purpose: "INSTALLMENT", loanId: loan.id, borrowerId: borrower.id,
      phone: borrower.phone, amount: 5500, beneficiary: "LENDER",
      state: "SUCCESS", checkoutRequestId: `ws_CO_pay_${stamp}`,
    },
  });
  const payOut = await settlePayment(org.id, org.name, payIntent as PaymentIntent, 5500, "QK1PAY");
  const afterPay = await p.loan.findUnique({ where: { id: loan.id }, select: { balance: true } });
  ok("★ a real installment DOES pay down the loan", Number(afterPay?.balance) === 22000 - 5500, `balance ${afterPay?.balance}`);
  ok("…and says so", payOut.applied && payOut.how.startsWith("loan:"), payOut.how);

  // ── Idempotency ───────────────────────────────────────────────────────────
  section("Daraja retries. The same shilling must not be banked twice.");

  const fresh = await p.paymentIntent.findUnique({ where: { id: payIntent.id } });
  const again = await settlePayment(org.id, org.name, fresh as PaymentIntent, 5500, "QK1PAY");
  const afterRetry = await p.loan.findUnique({ where: { id: loan.id }, select: { balance: true } });
  ok("★★ A RETRIED CALLBACK DOES NOTHING", again.how === "already-settled");
  ok("…and the balance did not fall by money nobody paid",
    Number(afterRetry?.balance) === Number(afterPay?.balance), `${afterPay?.balance} -> ${afterRetry?.balance}`);

  // ── Cleanup ───────────────────────────────────────────────────────────────
  await p.loan.updateMany({ where: { orgId: org.id }, data: { status: "CLEARED", balance: 0, clearedAt: new Date() } });
  await p.complianceRequest.create({
    data: { orgId: org.id, kind: "ORG_EXPORT", status: "COMPLETED", reason: "Test teardown." },
  });
  await deleteTenant(org.id);
  await p.auditLog.deleteMany({ where: { orgId: org.id } });
  ok("the scratch org is gone", (await p.org.findUnique({ where: { id: org.id } })) === null);

  await p.$disconnect();

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
