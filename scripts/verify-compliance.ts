// Tests for COMPLIANCE & RETENTION (item 21, blueprint §12) — the retention
// policy, the right to erasure, and the export.
//
//   npm run test:compliance     (hits the live DB: builds a scratch org, erases
//                                people inside it, then deletes the org itself)
//
// The claims under test. Each one is a way this feature could quietly become a
// LIE — which is the only way a compliance feature ever fails. Nobody notices a
// broken delete button; they notice it four years later, in a hearing.
//
//   THE FLOOR IS NOT SWEEPABLE. POCAMLA s.46 makes us keep the money and the CDD
//     file for seven years. A retention sweep that could reach those classes is a
//     sweep that could destroy the evidence a regulator will ask for.
//   "DELETE ME" IS ANSWERED HONESTLY. A borrower who never took a loan is deleted
//     completely. A borrower who did is ANONYMISED, because the DPA's right to
//     erasure yields to a legal obligation — and a screen that promised otherwise
//     would be lying to the customer.
//   AN ANONYMISED PERSON IS ACTUALLY GONE. This is the one that bites. The funnel
//     denormalises phone/nationalId/borrowerName onto every LoanApplication, and
//     the payer's phone (plus Daraja's raw callback, which carries their names)
//     onto every receipt and disbursement. Nulling the Borrower row alone leaves
//     FOUR intact copies of the person behind. Every one is asserted gone here.
//   THE MONEY SURVIVES THE PERSON. The loan, its balance and its M-Pesa reference
//     must still be there afterwards, or we have destroyed the record we were
//     legally obliged to keep in the act of honouring a request.
//   THE EXPORT NEVER LEAKS A SECRET. No password hash, no OTP secret, no vault
//     credential — asserted against the real column names, not a promise.
//   A CSV CANNOT EXECUTE. A borrower named `=cmd|...` must not run code in Excel
//     when the compliance officer opens their own export.
import "dotenv/config";
import { platformPrisma } from "../prisma/seed-client";
import {
  RETENTION_POLICY, AML_FLOOR_DAYS, sweepableClasses, cutoffFor, POLICY_BY_KEY,
} from "@/lib/compliance/retention";
import { assessErasure, eraseBorrower, maskPhone } from "@/lib/compliance/erasure";
import { exportBorrower, exportOrgTable, toCsv, ORG_TABLES } from "@/lib/compliance/export";
import { deleteTenant, tenantDeletionBlockers } from "@/lib/compliance/tenant";
import { ALL_RIGHTS_SET, RIGHT_GROUPS, RIGHT_LABELS, MODERN_RIGHTS, LEGACY_DEFAULT_RIGHTS, ADMIN_ONLY_RIGHTS } from "@/lib/rbac/rights";
import { NAV_REGISTRY } from "@/lib/nav/registry";
import { enterPlatform } from "@/lib/db/context";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); }
};
const section = (s: string) => console.log(`\n${s}`);

const DAY = 86_400_000;

async function main() {
  // ── 1. The policy ──────────────────────────────────────────────────────────
  section("The retention policy is a legal position, and reads like one");

  ok("seven years is seven years", AML_FLOOR_DAYS === 7 * 365, `${AML_FLOOR_DAYS} days`);
  ok("every class has a label, a description and a legal basis",
    RETENTION_POLICY.every((c) => c.label.trim() && c.what.trim() && c.basis.trim()));
  ok("no duplicate keys", new Set(RETENTION_POLICY.map((c) => c.key)).size === RETENTION_POLICY.length);

  const floors = RETENTION_POLICY.filter((c) => c.floor);
  ok("the floor is exactly the money, the CDD file and the audit trail",
    floors.length === 3 && ["cdd", "money", "audit"].every((k) => POLICY_BY_KEY.get(k)?.floor === true),
    floors.map((f) => f.key).join(", "));
  ok("a floor class has NO window (it is never on a clock)", floors.every((c) => c.days === null));

  const sweepable = sweepableClasses();
  ok("THE SWEEP CANNOT REACH THE FLOOR", sweepable.every((c) => !c.floor && c.days !== null),
    `${sweepable.length} sweepable classes`);
  ok("no sweepable window is absurd (1 day–3 years)", sweepable.every((c) => c.days! >= 1 && c.days! <= 3 * 365));

  let threw = false;
  try { cutoffFor(POLICY_BY_KEY.get("money")!); } catch { threw = true; }
  ok("asking a floor class for a cutoff date is an error, not a date", threw);

  const bio = POLICY_BY_KEY.get("kyc-biometrics")!;
  ok("a liveness selfie dies before a year is out", bio.days! <= 365 && bio.disposal === "purge-objects");
  ok("a registry payload is REDACTED, not deleted (the CDD outcome must survive)",
    POLICY_BY_KEY.get("kyc-check-payloads")!.disposal === "redact");

  // ── 2. Rights & nav ────────────────────────────────────────────────────────
  section("The rights exist, are grantable, and are nobody's by inheritance");

  ok("compliance.view + compliance.manage are real rights",
    ALL_RIGHTS_SET.has("compliance.view") && ALL_RIGHTS_SET.has("compliance.manage"));
  for (const r of ["compliance.view", "compliance.manage"] as const) {
    const groups = RIGHT_GROUPS.filter((g) => (g.rights as readonly string[]).includes(r));
    ok(`${r} appears in exactly one group of the role editor`, groups.length === 1, groups[0]?.label ?? "none");
    ok(`${r} is explained in plain language`, !!RIGHT_LABELS[r]?.trim());
    ok(`${r} is granted only deliberately (never legacy, never inherited from admin)`,
      (MODERN_RIGHTS as string[]).includes(r)
      && !(LEGACY_DEFAULT_RIGHTS as string[]).includes(r)
      && !(ADMIN_ONLY_RIGHTS as string[]).includes(r));
  }

  const navItem = NAV_REGISTRY.flatMap((m) => m.items).find((i) => i.key === "compliance");
  ok("Compliance is on the sidebar behind compliance.view", navItem?.right === "compliance.view");
  ok("Compliance is on EVERY plan — a data-protection duty is not a feature we sell back",
    navItem !== undefined && navItem.feature === undefined);

  // ── 3. CSV ─────────────────────────────────────────────────────────────────
  section("A CSV cannot execute");

  const nasty = toCsv([{ name: "=cmd|'/c calc'!A1", note: 'He said "hello", then left', town: "Nairobi\nKenya" }]);
  ok("a formula-shaped cell is neutered with a leading quote", nasty.includes("'=cmd"));
  ok("quotes inside a cell are doubled", nasty.includes('""hello""'));
  ok("a cell with a newline is quoted", /"Nairobi\nKenya"/.test(nasty));
  const union = toCsv([{ a: 1 }, { b: 2 }]);
  ok("columns are the union across rows (a ragged export loses nothing)", union.split("\r\n")[0] === "a,b");
  ok("an empty table is an empty string, not a crash", toCsv([]) === "");

  ok("maskPhone keeps a handle without keeping the person", maskPhone("254712345678") === "2547••••5678");

  ok("the export allowlist never names the vault or the credentials",
    !(ORG_TABLES as readonly string[]).some((t) => /integration|otp|secret|credential/i.test(t)));

  // ── 4. The live database ───────────────────────────────────────────────────
  section("Erasure, against real rows");

  const p = platformPrisma();
  enterPlatform(); // the compliance libs use the app client; let them cross tenants here

  const stamp = Date.now();
  const org = await p.org.create({
    data: { slug: `ctest-${stamp}`, name: "Compliance Test Ltd", status: "ACTIVE" },
  });
  const branch = await p.branch.create({ data: { orgId: org.id, name: "HQ" } });
  const product = await p.product.create({
    data: { orgId: org.id, name: "Test", minPrincipal: 1000, maxPrincipal: 50000, interestRate: 10, repaymentPeriod: 30 },
  });

  const mkBorrower = (n: string, phone: string) =>
    p.borrower.create({
      data: {
        orgId: org.id, phone, firstName: n, otherName: "Tester", nationalId: `ID${phone.slice(-6)}`,
        email: `${n}@test.local`, kycStatus: "VERIFIED", branchId: branch.id,
        lat: -1.28, lng: 36.81, locationAddress: "Nairobi", nextOfKin: { name: "Kin", phone: "254700000000" },
        portraitKey: "sim/portrait.jpg", selfieKey: "sim/selfie.jpg",
      },
    });

  // A: never borrowed. B: live loan. C: loan cleared eight years ago.
  const A = await mkBorrower("Alice", "254700000001");
  const B = await mkBorrower("Brian", "254700000002");
  const C = await mkBorrower("Carol", "254700000003");

  // Everyone gets the denormalised identity trail the funnel really writes.
  const mkApp = (borrowerId: string) =>
    p.loanApplication.create({
      data: {
        orgId: org.id, borrowerId, productId: product.id, amountRequested: 10000,
        phone: "254700000002", nationalId: "ID000002", borrowerName: "Brian Tester",
        deviceFingerprint: "dev-abc", lat: -1.28, lng: 36.81, locationAddress: "Nairobi",
        consent: { mpesaAnalysis: true },
      },
    });
  await mkApp(A.id);
  const appB = await mkApp(B.id);
  const appC = await mkApp(C.id);

  const mkLoan = (borrowerId: string, applicationId: string, status: "ACTIVE" | "CLEARED", clearedAt: Date | null) =>
    p.loan.create({
      data: {
        orgId: org.id, borrowerId, applicationId, productId: product.id,
        principal: 10000, interest: 1000, loanAmount: 11000, balance: status === "CLEARED" ? 0 : 11000,
        status, clearedAt, branchId: branch.id,
      },
    });
  const loanB = await mkLoan(B.id, appB.id, "ACTIVE", null);
  const loanC = await mkLoan(C.id, appC.id, "CLEARED", new Date(Date.now() - 8 * 365 * DAY));

  await p.disbursement.create({
    data: { orgId: org.id, loanId: loanB.id, amount: 10000, phone: "254700000002", payeeName: "Brian Tester", raw: { Result: "ok" } },
  });
  await p.c2BReceipt.create({
    data: { orgId: org.id, transId: `T${stamp}`, amount: 5000, phone: "254700000002", allocatedLoanId: loanB.id, raw: { FirstName: "BRIAN" } },
  });
  await p.consent.create({ data: { orgId: org.id, borrowerId: B.id, version: "2026-07", grants: {}, ip: "1.2.3.4" } });
  await p.kycCheck.create({
    data: { orgId: org.id, borrowerId: B.id, kind: "IPRS", passed: true, score: 0.97, provider: "spinmobile", payload: { first_name: "BRIAN", date_of_birth: "1990-01-01" } },
  });

  // ── The assessments ───────────────────────────────────────────────────────
  const aA = await assessErasure(org.id, A.id);
  ok("a customer who never borrowed is deleted OUTRIGHT", aA?.mode === "HARD_DELETE", aA?.mode);
  ok("…and nothing is withheld from them", aA?.retains.length === 0);

  const aB = await assessErasure(org.id, B.id);
  ok("a customer with a LIVE loan is ANONYMISED, not deleted", aB?.mode === "ANONYMISE", aB?.mode);
  ok("…and the seven-year clock has not even started (the relationship is open)", aB?.floorLiftsAt === null);
  ok("…and the officer is told what the law makes them keep", (aB?.retains.length ?? 0) >= 3);
  ok("…in words they can read to the customer", !!aB?.summary.includes("seven years") || !!aB?.summary.includes("still open"));

  const aC = await assessErasure(org.id, C.id);
  ok("a customer whose last loan closed 8 years ago IS deleted (the floor has lifted)", aC?.mode === "HARD_DELETE", aC?.mode);

  // ── Execute on B: the anonymisation ───────────────────────────────────────
  section("Anonymisation: the person goes, the money stays");

  const outB = await eraseBorrower(org.id, B.id);
  ok("the erasure reports itself as an anonymisation", outB.mode === "ANONYMISE");

  const bAfter = await p.borrower.findUnique({ where: { id: B.id } });
  ok("the borrower ROW survives (the loan hangs off it)", !!bAfter);
  ok("it is stamped as erased", !!bAfter?.erasedAt);
  ok("the name is gone", bAfter?.firstName === null && bAfter?.otherName === null);
  ok("the national ID is gone", bAfter?.nationalId === null);
  ok("the email is gone", bAfter?.email === null);
  ok("the next of kin is gone", bAfter?.nextOfKin === null);
  ok("the face is gone", bAfter?.portraitKey === null && bAfter?.selfieKey === null);
  ok("the location is gone", bAfter?.lat === null && bAfter?.locationAddress === null);
  ok("the phone is an unusable tombstone, not a reachable number",
    !!bAfter?.phone.startsWith("erased:") && !/^2547\d{8}$/.test(bAfter!.phone), bAfter?.phone);

  // THE FOUR HIDDEN COPIES.
  const appAfter = await p.loanApplication.findUnique({ where: { id: appB.id } });
  ok("★ the APPLICATION's denormalised phone is gone", appAfter?.phone === null);
  ok("★ the APPLICATION's denormalised national ID is gone", appAfter?.nationalId === null);
  ok("★ the APPLICATION's denormalised name is gone", appAfter?.borrowerName === null);
  ok("★ the APPLICATION's device fingerprint and location are gone",
    appAfter?.deviceFingerprint === null && appAfter?.lat === null);
  ok("…but the amount it asked for survives (that IS the lending record)", Number(appAfter?.amountRequested) === 10000);

  const disbAfter = await p.disbursement.findFirst({ where: { loanId: loanB.id } });
  ok("★ the DISBURSEMENT's payee phone is gone", disbAfter?.phone === "");
  ok("★ the DISBURSEMENT's payee name and raw B2C result are gone",
    disbAfter?.payeeName === null && disbAfter?.raw === null);
  ok("…but the amount that went out survives", Number(disbAfter?.amount) === 10000);

  const rcptAfter = await p.c2BReceipt.findFirst({ where: { allocatedLoanId: loanB.id } });
  ok("★ the RECEIPT's payer phone is gone", rcptAfter?.phone === null);
  ok("★ the RECEIPT's raw Daraja callback (which carried their names) is gone", rcptAfter?.raw === null);
  ok("…but the M-Pesa reference and the amount survive — that is the transaction record",
    rcptAfter?.transId === `T${stamp}` && Number(rcptAfter?.amount) === 5000);

  const kycAfter = await p.kycCheck.findFirst({ where: { borrowerId: B.id } });
  ok("★ the registry PAYLOAD (the government's copy of them) is gone", kycAfter?.payload === null);
  ok("…but the CDD evidence survives: we checked, it passed, by whom, when",
    kycAfter?.passed === true && kycAfter?.provider === "spinmobile");

  const consentAfter = await p.consent.findFirst({ where: { borrowerId: B.id } });
  ok("the consent record survives (it is our own defence)", !!consentAfter);
  ok("…with the IP address it was given from stripped", consentAfter?.ip === null);

  const loanAfter = await p.loan.findUnique({ where: { id: loanB.id } });
  ok("★★ THE LOAN SURVIVES, with its balance intact",
    loanAfter?.status === "ACTIVE" && Number(loanAfter?.balance) === 11000);

  // ── Execute on A: the hard delete ─────────────────────────────────────────
  section("Hard delete: nothing is owed to anyone, so nothing is kept");

  const outA = await eraseBorrower(org.id, A.id);
  ok("the erasure reports itself as a hard delete", outA.mode === "HARD_DELETE");
  ok("the borrower row is GONE", (await p.borrower.findUnique({ where: { id: A.id } })) === null);
  ok("their application is gone with them", (await p.loanApplication.count({ where: { borrowerId: A.id } })) === 0);

  // ── Export ────────────────────────────────────────────────────────────────
  section("The export gives them everything, and gives away nothing");

  const bundle = await exportBorrower(org.id, C.id);
  ok("a subject-access bundle carries who they are, their loans and their consent",
    !!bundle && !!bundle.whoYouAre && Array.isArray(bundle.loans) && !!bundle.creditAssessment);
  ok("…and explains their rights in the file itself", !!bundle?._about.yourRights.includes("Data Protection Act"));

  const staffRows = await exportOrgTable(org.id, "staff");
  const staffCols = new Set(staffRows.flatMap((r) => Object.keys(r)));
  ok("★ the staff export carries NO password hash", !staffCols.has("passwordHash"));
  ok("★ the staff export carries NO OTP secret", !staffCols.has("otpSecret"));

  // ── Tenant deletion ───────────────────────────────────────────────────────
  section("A tenant cannot be destroyed carelessly");

  const blocked = await tenantDeletionBlockers(org.id);
  ok("an org with a LIVE loan may not be deleted", blocked.some((b) => b.code === "OPEN_LOANS"), blocked.map((b) => b.code).join(","));
  ok("an org that never exported its book may not be deleted", blocked.some((b) => b.code === "NO_EXPORT"));

  // Clear the way: close the loan, and let them take their copy.
  await p.loan.update({ where: { id: loanB.id }, data: { status: "CLEARED", balance: 0, clearedAt: new Date() } });
  await p.complianceRequest.create({
    data: { orgId: org.id, kind: "ORG_EXPORT", status: "COMPLETED", reason: "They took their book." },
  });
  const clear = await tenantDeletionBlockers(org.id);
  ok("with the loans closed and a copy taken, the way is clear", clear.length === 0, clear.map((b) => b.code).join(","));

  const gone = await deleteTenant(org.id);
  ok("the tenant is destroyed", (await p.org.findUnique({ where: { id: org.id } })) === null, `${Object.values(gone.rowsDeleted).reduce((a, b) => a + b, 0)} rows`);
  ok("every borrower went with it", (await p.borrower.count({ where: { orgId: org.id } })) === 0);
  ok("every loan went with it", (await p.loan.count({ where: { orgId: org.id } })) === 0);

  const trail = await p.auditLog.findFirst({ where: { orgId: org.id, action: "org.deleted" } });
  ok("★ THE AUDIT TRAIL OUTLIVES THE TENANT", !!trail, trail ? `slug ${(trail.meta as { slug?: string })?.slug}` : "");

  // Leave nothing behind: the audit rows are the only trace, and they are ours.
  await p.auditLog.deleteMany({ where: { orgId: org.id } });
  await p.$disconnect();

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
