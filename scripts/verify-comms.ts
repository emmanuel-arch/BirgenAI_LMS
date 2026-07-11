// Tests for comms — branded email templates, the email log, the daily
// sign-in code, and SMS campaigns.
//
//   npm run test:comms        (needs the database; no app server, NO real sends)
//
// ⚠ The .env on this machine can hold REAL SMTP and Africa's Talking
// credentials. This suite blanks them before anything runs — every "send"
// below must end in a log row or a queued row, never in somebody's inbox.
import "dotenv/config";

for (const k of ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "AFRICASTALKING_API_KEY", "AFRICASTALKING_USERNAME"]) {
  delete process.env[k];
}

import { prisma } from "@/lib/prisma";
import { runAsPlatform, runWithOrg } from "@/lib/db/context";
import { emailBrandFor, escapeHtml } from "@/lib/email/layout";
import { staffInviteEmail, loginOtpEmail, approvalOtpEmail, resetCodeEmail, welcomeOrgEmail } from "@/lib/email/templates";
import { sendTemplatedEmail } from "@/lib/email/send";
import { issueDailyLoginOtp, verifyDailyLoginOtp, verifyOtp, issueOtp, endOfDayNairobi, LOGIN_PURPOSE } from "@/lib/otp";
import { enumerateAudience, renderCampaignMessage, sendCampaign, campaignStats } from "@/lib/sms/campaign";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); }
};

const D = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400000);

async function main() {
  const slug = `commstest-${Date.now()}`;
  const org = await runAsPlatform(() => prisma.org.create({
    data: {
      slug, name: "Comms Test Ltd", plan: "STARTER", mode: "NATIVE", status: "ACTIVE",
      accent: "#E11D48", accent2: "#7F1D1D", tagline: "Test tagline.",
      logoUrl: "data:image/png;base64,AAAA", // sim logo — must NOT reach an email
    },
  }));
  console.log(`fixture org ${slug} (${org.id})\n`);
  const ctx = <T>(fn: () => Promise<T>) => runWithOrg(org.id, fn);

  try {
    console.log("1. The brand resolves safely for email");
    const brand = await ctx(() => emailBrandFor(org.id));
    ok("org name, slug, accent carried", brand.name === "Comms Test Ltd" && brand.slug === slug && brand.accent === "#E11D48");
    ok("a data-URL logo is DROPPED (inbox clients strip them)", brand.logoUrl === null);

    console.log("\n2. Template builders — branded, complete, XSS-safe");
    const invite = staffInviteEmail(brand, { name: "Achieng", email: "a@x.test", tempPassword: "Tmp-9GkQ2z", roleTitle: "Loan Officer" });
    ok("invite carries the credentials", invite.html.includes("Tmp-9GkQ2z") && invite.text.includes("Tmp-9GkQ2z") && invite.html.includes("a@x.test"));
    ok("invite explains the daily code", invite.html.includes("whole day") && invite.text.includes("whole day"));
    ok("invite wears the lender's brand", invite.html.includes("#E11D48") && invite.html.includes("Comms Test Ltd") && invite.html.includes(`${slug}.birgenai.com`));
    ok("no logo ⇒ wordmark tile, not a broken <img>", !invite.html.includes("<img") && invite.html.includes(">C</span>"));
    ok("footer credits the platform", invite.html.includes("BirgenAI LMS"));

    const evil = staffInviteEmail(brand, { name: `<script>alert(1)</script>`, email: "e@x.test", tempPassword: "p".repeat(10) });
    ok("user-supplied name is escaped", !evil.html.includes("<script>") && evil.html.includes("&lt;script&gt;"));

    const login = loginOtpEmail(brand, { name: "Achieng", email: "a@x.test", code: "123456" });
    ok("login code leads the subject", login.subject.startsWith("123456"));
    ok("login email says it lasts the whole day", login.html.includes("whole day") && login.html.includes("midnight"));

    const approval = approvalOtpEmail(brand, { name: "Amina", code: "654321" });
    ok("approval email names the ACT it authorises", approval.html.toLowerCase().includes("finalize a loan approval"));
    const reset = resetCodeEmail(brand, { name: "Amina", email: "a@x.test", code: "111222" });
    ok("reset email carries its code", reset.subject.startsWith("111222") && reset.html.includes("111222"));
    const welcome = welcomeOrgEmail(brand, { name: "Amina", email: "a@x.test" });
    ok("welcome names the portal", welcome.html.includes(`${slug}.birgenai.com`));
    ok("escapeHtml round-trip", escapeHtml(`<&">`) === "&lt;&amp;&quot;&gt;");

    console.log("\n3. Every send leaves a log row (SMTP blanked — nothing real goes out)");
    const sent = await ctx(() => sendTemplatedEmail(org.id, "log@x.test", invite, "staff_invite"));
    ok("send reports failure honestly with no SMTP", sent === false);
    const logRow = await ctx(() => prisma.emailMessage.findFirst({ where: { orgId: org.id, to: "log@x.test" } }));
    ok("the attempt is logged with template + reason", logRow?.state === "FAILED" && logRow?.template === "staff_invite" && (logRow?.error ?? "").includes("SMTP"), logRow?.error ?? "");

    console.log("\n4. The daily sign-in code — one a morning, reusable until midnight");
    const staff = await ctx(() => prisma.staffUser.create({
      data: { orgId: org.id, email: `officer@${slug}.test`, phone: "254700000222", firstName: "Okoth", status: "ACTIVE" },
    }));
    const eod = endOfDayNairobi(new Date("2026-07-11T10:00:00Z"));
    ok("expiry is midnight Nairobi (21:00 UTC)", eod.toISOString() === "2026-07-11T21:00:00.000Z", eod.toISOString());

    const issue1 = await ctx(() => issueDailyLoginOtp(org.id, staff.id));
    ok("first issue creates + returns a dev code outside production", issue1.issued && !!issue1.devCode);
    const code = issue1.devCode!;
    const issue2 = await ctx(() => issueDailyLoginOtp(org.id, staff.id));
    ok("second sign-in the same day does NOT reissue (the morning email still works)", !issue2.issued && issue2.delivered);

    ok("the code verifies", await ctx(() => verifyDailyLoginOtp(org.id, staff.id, code)));
    ok("…and verifies AGAIN (reusable, not consumed)", await ctx(() => verifyDailyLoginOtp(org.id, staff.id, code)));
    ok("a wrong code is refused", !(await ctx(() => verifyDailyLoginOtp(org.id, staff.id, "000000"))));
    ok("the right code still works after a typo (attempts forgiven on success)", await ctx(() => verifyDailyLoginOtp(org.id, staff.id, code)));

    for (let i = 0; i < 5; i++) await ctx(() => verifyDailyLoginOtp(org.id, staff.id, "999999"));
    ok("five straight wrong guesses burn the code", !(await ctx(() => verifyDailyLoginOtp(org.id, staff.id, code))));
    const issue3 = await ctx(() => issueDailyLoginOtp(org.id, staff.id));
    ok("a burned code reissues fresh", issue3.issued && !!issue3.devCode && issue3.devCode !== code);

    const smsRow = await ctx(() => prisma.smsMessage.findFirst({ where: { orgId: org.id, templateKey: "login_code" } }));
    ok("the code also queued as SMS (flushes when a provider exists)", smsRow?.state === "QUEUED" && smsRow.message.includes(issue1.devCode!));
    const challenge = await ctx(() => prisma.otpChallenge.findFirst({ where: { orgId: org.id, staffId: staff.id, purpose: LOGIN_PURPOSE, usedAt: null } }));
    ok("the live challenge expires today, Nairobi time", !!challenge && (challenge.expiresAt.getTime() + 3 * 3600_000) % 86_400_000 === 0);

    console.log("\n5. Action codes stay single-use (approval/reset unchanged)");
    await ctx(() => issueOtp(org.id, staff.id, "test:action"));
    const actionRow = await ctx(() => prisma.otpChallenge.findFirst({ where: { orgId: org.id, staffId: staff.id, purpose: "test:action", usedAt: null } }));
    ok("action challenge exists with a 10-minute-scale expiry", !!actionRow && actionRow.expiresAt.getTime() - Date.now() < 11 * 60_000);
    ok("a wrong action code is refused", !(await ctx(() => verifyOtp(org.id, staff.id, "test:action", "000000"))));

    console.log("\n6. Campaign audiences come from the live book");
    const { activeB, arrearsB } = await ctx(async () => {
      const product = await prisma.product.create({
        data: { orgId: org.id, name: "T", minPrincipal: 1000, maxPrincipal: 100000, interestRate: 10, repaymentPeriod: 4 },
      });
      const mkBorrower = (n: number, name: string) => prisma.borrower.create({ data: { orgId: org.id, phone: `25470000030${n}`, firstName: name } });
      const activeB = await mkBorrower(1, "Active");
      const arrearsB = await mkBorrower(2, "Late");
      const clearedB = await mkBorrower(3, "Done");
      await mkBorrower(4, "Fresh"); // no loans at all
      const mkLoan = async (borrowerId: string, status: "ACTIVE" | "CLEARED", overdue: boolean) => {
        const loan = await prisma.loan.create({
          data: { orgId: org.id, borrowerId, productId: product.id, principal: 10000, interest: 1000, loanAmount: 11000, balance: status === "CLEARED" ? 0 : 11000, status, borrowDate: D(60) },
        });
        await prisma.installment.create({
          data: { orgId: org.id, loanId: loan.id, seq: 1, dueDate: overdue ? D(10) : D(-10), amountDue: 2750, principalDue: 2500, interestDue: 250, status: overdue ? "OVERDUE" : "UPCOMING" },
        });
        return loan;
      };
      await mkLoan(activeB.id, "ACTIVE", false);
      const lateLoan = await mkLoan(arrearsB.id, "ACTIVE", true);
      await mkLoan(clearedB.id, "CLEARED", false);
      await prisma.promiseToPay.create({
        data: { orgId: org.id, loanId: lateLoan.id, borrowerId: arrearsB.id, amount: 5000, dueDate: D(3), status: "BROKEN", createdBy: staff.id },
      });
      return { activeB, arrearsB };
    });

    const [all, act, arr, clr, ptp] = await ctx(() => Promise.all([
      enumerateAudience(org.id, "ALL"),
      enumerateAudience(org.id, "ACTIVE_LOANS"),
      enumerateAudience(org.id, "ARREARS"),
      enumerateAudience(org.id, "CLEARED"),
      enumerateAudience(org.id, "BROKEN_PTP"),
    ]));
    ok("ALL = every borrower with a phone", all.length === 4);
    ok("ACTIVE_LOANS = the two live loans", act.length === 2 && act.some((r) => r.borrowerId === activeB.id));
    ok("ARREARS = only the overdue one", arr.length === 1 && arr[0].borrowerId === arrearsB.id);
    ok("CLEARED = repaid with nothing active", clr.length === 1);
    ok("BROKEN_PTP = the broken promise", ptp.length === 1 && ptp[0].borrowerId === arrearsB.id);

    ok("{name} renders per borrower, with a fallback", renderCampaignMessage("Hi {name}!", "Okoth") === "Hi Okoth!" && renderCampaignMessage("Hi {name}!", null) === "Hi customer!");

    console.log("\n7. Sending a campaign queues real rows on the SMS rails");
    const result = await ctx(() => sendCampaign({ orgId: org.id, name: "Test blast", message: "Hi {name}, karibu!", audience: "ACTIVE_LOANS", createdBy: staff.id }));
    ok("campaign reports its reach", result.recipients === 2 && result.queued === 2);
    const camp = await ctx(() => prisma.smsCampaign.findUniqueOrThrow({ where: { id: result.id } }));
    ok("campaign row settled SENT with counts", camp.status === "SENT" && camp.recipients === 2 && camp.queued === 2);
    const rows = await ctx(() => prisma.smsMessage.findMany({ where: { orgId: org.id, templateKey: `campaign:${result.id}` } }));
    ok("each recipient got a tagged row, personalized, QUEUED (no provider)", rows.length === 2 && rows.every((r) => r.state === "QUEUED") && rows.some((r) => r.message.includes("Hi Active,")));
    const stats = await ctx(() => campaignStats(org.id, [result.id]));
    ok("delivery stats read off the tagged rows", stats.get(result.id)?.queued === 2 && stats.get(result.id)?.sent === 0);
  } finally {
    await runAsPlatform(async () => {
      const w = { orgId: org.id };
      await prisma.smsMessage.deleteMany({ where: w });
      await prisma.smsCampaign.deleteMany({ where: w });
      await prisma.emailMessage.deleteMany({ where: w });
      await prisma.otpChallenge.deleteMany({ where: w });
      await prisma.promiseToPay.deleteMany({ where: w });
      await prisma.installment.deleteMany({ where: w });
      await prisma.loan.deleteMany({ where: w });
      await prisma.borrower.deleteMany({ where: w });
      await prisma.product.deleteMany({ where: w });
      await prisma.staffUser.deleteMany({ where: w });
      await prisma.smsTemplate.deleteMany({ where: w });
      await prisma.orgSubscription.deleteMany({ where: w });
      await prisma.auditLog.deleteMany({ where: w });
      await prisma.org.delete({ where: { id: org.id } });
    });
    console.log("\nfixture cleaned up");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
