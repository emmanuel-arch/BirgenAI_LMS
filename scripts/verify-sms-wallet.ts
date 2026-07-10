// Tests for the SMS credits wallet — who pays for a message, and in what order.
//
//   npm run test:sms        (needs the database; no app server)
//
// The order of payment is the contract: own provider (free of charge) → plan
// allowance → prepaid credits → overdraft for CRITICAL templates only. Getting
// it wrong either spends the platform's Africa's Talking money unbounded, or
// locks a borrower out of signing their own loan because of a billing lapse.
// Both are company-ending in different currencies, so every branch is pinned.
import "dotenv/config";

// This suite must NEVER dispatch a real SMS. The local .env carries live
// Africa's Talking credentials (the platform provider), so we remove them from
// this process before any send path can resolve a provider. Every sendSms below
// therefore queues — which is itself the behaviour under test.
delete process.env.AFRICASTALKING_API_KEY;
delete process.env.AFRICASTALKING_USERNAME;
delete process.env.AFRICASTALKING_SENDER_ID;

import { prisma } from "@/lib/prisma";
import { runAsPlatform, runWithOrg } from "@/lib/db/context";
import { entitlementsFor, invalidateEntitlements } from "@/lib/billing/entitlements";
import { meter } from "@/lib/billing/meter";
import { SMS_PACKS, smsPack, isBillableKind, UNIT_PRICE_KES } from "@/lib/billing/plans";
import { fundSms, refundSmsCredit, creditTopUp, smsBalance, smsWalletSummary, isCriticalTemplate } from "@/lib/sms/wallet";
import { sendSms, flushQueuedSms, hasSmsProvider } from "@/lib/sms/send";
import { signSmsTopup, hubSmsTopupUrl } from "@/lib/billing/hub";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); }
};

async function main() {
  const slug = `smstest-${Date.now()}`;
  const [orgA, orgB] = await runAsPlatform(() =>
    Promise.all([
      prisma.org.create({ data: { slug, name: "SMS Test", plan: "STARTER", mode: "NATIVE", status: "ACTIVE" } }),
      prisma.org.create({ data: { slug: `${slug}-b`, name: "SMS Test B", plan: "STARTER", mode: "NATIVE", status: "ACTIVE" } }),
    ]),
  );
  const ctx = <T>(fn: () => Promise<T>) => runWithOrg(orgA.id, fn);
  console.log(`fixture orgs ${slug} / ${slug}-b\n`);

  try {
    // A tiny allowance so the boundary is two meters away, not five hundred.
    await entitlementsFor(orgA.id); // lazily creates the subscription
    await ctx(() => prisma.orgSubscription.update({ where: { orgId: orgA.id }, data: { includedOverrides: { sms: 2 } } }));
    invalidateEntitlements(orgA.id);

    console.log("1. The order of payment: own provider → allowance → credit → overdraft");
    ok("a lender's own provider is never charged", (await fundSms(orgA.id, "reminder", false)) === "own-provider");
    ok("and no wallet was conjured for it", (await ctx(() => prisma.smsWallet.count({ where: { orgId: orgA.id } }))) === 0);

    ok("first message rides the allowance", (await fundSms(orgA.id, "reminder", true)) === "allowance");
    await meter(orgA.id, "sms", 1, { via: "allowance" });
    ok("second message still inside it", (await fundSms(orgA.id, "reminder", true)) === "allowance");
    await meter(orgA.id, "sms", 1, { via: "allowance" });

    ok("the third finds the allowance spent and no credit: REFUSED",
      (await fundSms(orgA.id, "reminder", true)) === "refused");
    ok("refusal does not overdraw", (await smsBalance(orgA.id)) === 0);

    ok("but a signing code is critical and goes anyway", (await fundSms(orgA.id, "otp", true)) === "overdraft");
    ok("into overdraft", (await smsBalance(orgA.id)) === -1, `balance ${await smsBalance(orgA.id)}`);
    ok("a guarantor consent link is critical too", isCriticalTemplate("guarantor_invite"));
    ok("dunning is not", !isCriticalTemplate("arrears"));

    console.log("\n2. Top-ups: idempotent by the Hub's settlement id");
    ok("a paid pack credits once", await creditTopUp({ orgId: orgA.id, units: 10, amountKes: 10, source: "HUB", hubReference: "hub-ref-1" }));
    ok("the same settlement again credits ZERO", !(await creditTopUp({ orgId: orgA.id, units: 10, amountKes: 10, source: "HUB", hubReference: "hub-ref-1" })));
    ok("the overdraft was netted off: -1 + 10 = 9", (await smsBalance(orgA.id)) === 9);
    ok("a grant needs no hub reference", await creditTopUp({ orgId: orgA.id, units: 5, amountKes: 0, source: "PLATFORM_GRANT", note: "welcome", createdBy: "platform" }));
    ok("balance 14", (await smsBalance(orgA.id)) === 14);

    ok("now a discretionary message funds from CREDIT", (await fundSms(orgA.id, "reminder", true)) === "credit");
    ok("and the balance moved", (await smsBalance(orgA.id)) === 13);
    await refundSmsCredit(orgA.id);
    ok("a failed dispatch gives the credit back", (await smsBalance(orgA.id)) === 14);

    ok("a zero-unit top-up is refused outright", await creditTopUp({ orgId: orgA.id, units: 0, amountKes: 0, source: "PLATFORM_GRANT" }).then(() => false).catch(() => true));

    console.log("\n3. sendSms with no provider: the row exists, nothing is spent");
    ok("no provider resolves in this process", !(await hasSmsProvider(orgA.id)));
    const beforeEvents = await ctx(() => prisma.usageEvent.count({ where: { orgId: orgA.id, kind: "sms" } }));
    const msgId = await ctx(() => sendSms(orgA.id, "0712345678", "reminder", { org: "SMS Test", amount: 500, date: "tomorrow" }));
    ok("a message row came back", !!msgId);
    const row = await ctx(() => prisma.smsMessage.findUnique({ where: { id: msgId! } }));
    ok("it stays QUEUED", row?.state === "QUEUED");
    ok("nothing was metered for it", (await ctx(() => prisma.usageEvent.count({ where: { orgId: orgA.id, kind: "sms" } }))) === beforeEvents);
    ok("and no credit was taken", (await smsBalance(orgA.id)) === 14);
    ok("an unknown template returns null", (await ctx(() => sendSms(orgA.id, "0712345678", "no-such-template", {}))) === null);

    console.log("\n4. The flush: stale messages expire, fresh ones wait for a provider");
    await ctx(() => prisma.smsMessage.create({
      data: {
        orgId: orgA.id, phone: "254712345678", message: "stale dunning", templateKey: "arrears",
        state: "QUEUED", createdAt: new Date(Date.now() - 3 * 86_400_000),
      },
    }));
    const flushed = await flushQueuedSms(orgA.id);
    ok("the three-day-old message expired instead of sending late", flushed.expired === 1, JSON.stringify(flushed));
    ok("it is FAILED now", (await ctx(() => prisma.smsMessage.count({ where: { orgId: orgA.id, state: "FAILED" } }))) === 1);
    ok("the fresh one keeps waiting (no provider here)", flushed.waiting === 1 && flushed.sent === 0);

    console.log("\n5. The wallet summary the billing page renders");
    const summary = await smsWalletSummary(orgA.id);
    ok("balance, queued and history in one read",
      summary.balance === 14 && summary.queued === 1 && summary.topups.length === 2, JSON.stringify({ b: summary.balance, q: summary.queued, t: summary.topups.length }));
    ok("newest top-up first, with its note", summary.topups[0].source === "PLATFORM_GRANT" && summary.topups[0].note === "welcome");

    console.log("\n6. Tenant isolation: org B sees none of it");
    const [bWallet, bTopups, bMsgs] = await runWithOrg(orgB.id, () =>
      Promise.all([
        prisma.smsWallet.findUnique({ where: { orgId: orgA.id } }),
        prisma.smsTopUp.count({ where: { orgId: orgA.id } }),
        prisma.smsMessage.count({ where: { orgId: orgA.id } }),
      ]),
    );
    ok("not the wallet", bWallet === null);
    ok("not the ledger", bTopups === 0);
    ok("not the messages", bMsgs === 0);

    console.log("\n7. The catalogue: prepaid means prepaid");
    ok("sms never lands on an invoice", !isBillableKind("sms"));
    ok("packs resolve case-insensitively", smsPack("sms_2000")?.units === 2000);
    ok("an unknown pack resolves to nothing", smsPack("SMS_999") === null);
    ok("no pack charges above the catalogue price",
      SMS_PACKS.every((p) => p.priceKes / p.units <= UNIT_PRICE_KES.sms));
    ok("bigger packs never cost more per message",
      SMS_PACKS.every((p, i) => i === 0 || p.priceKes / p.units <= SMS_PACKS[i - 1].priceKes / SMS_PACKS[i - 1].units));
    ok("every pack has whole positive units and a positive price",
      SMS_PACKS.every((p) => Number.isInteger(p.units) && p.units > 0 && p.priceKes > 0));

    console.log("\n8. The top-up token: same HMAC, different shape");
    const hadSecret = process.env.LMS_BILLING_SECRET;
    ok("no shared secret ⇒ no token, not an unsigned one", signSmsTopup(slug, "SMS_500") === null);
    process.env.LMS_BILLING_SECRET = "test-secret-for-this-process";
    const token = signSmsTopup(slug, "SMS_2000");
    const claims = token ? JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8")) : null;
    ok("the token binds org, kind and pack", claims?.org === slug && claims?.kind === "sms" && claims?.pack === "SMS_2000");
    ok("and expires", typeof claims?.exp === "number" && claims.exp * 1000 > Date.now());
    ok("an unknown pack cannot be signed at all", signSmsTopup(slug, "SMS_999") === null);
    const url = hubSmsTopupUrl(slug, "SMS_500", "https://x.example/back");
    ok("the deep link goes to /transact with the pack and the token",
      !!url && url.includes("/transact") && url.includes("sms=SMS_500") && url.includes("t="));
    if (hadSecret === undefined) delete process.env.LMS_BILLING_SECRET; else process.env.LMS_BILLING_SECRET = hadSecret;

    console.log("\n9. Own-provider sends are recorded at cost zero");
    await meter(orgA.id, "sms", 1, { via: "own-provider" }, 0);
    const lastEvent = await ctx(() => prisma.usageEvent.findFirst({ where: { orgId: orgA.id, kind: "sms" }, orderBy: { createdAt: "desc" } }));
    ok("the event says KES 0, because we charged nothing", Number(lastEvent?.unitCost) === 0);

    // The invariant everything above has been circling: the balance is exactly
    // the ledger minus what was funded from it (credit + overdraft − refunds).
    console.log("\n10. The invariant");
    const topupSum = await ctx(() => prisma.smsTopUp.aggregate({ where: { orgId: orgA.id }, _sum: { units: true } }));
    // funded: 1 overdraft + 1 credit − 1 refund = 1 net unit spent
    ok("balance = Σ top-ups − net funded sends", (await smsBalance(orgA.id)) === (topupSum._sum.units ?? 0) - 1,
      `${await smsBalance(orgA.id)} = ${topupSum._sum.units} - 1`);
  } finally {
    await runAsPlatform(async () => {
      for (const org of [orgA, orgB]) {
        await prisma.usageEvent.deleteMany({ where: { orgId: org.id } });
        await prisma.smsMessage.deleteMany({ where: { orgId: org.id } });
        await prisma.smsTopUp.deleteMany({ where: { orgId: org.id } });
        await prisma.smsWallet.deleteMany({ where: { orgId: org.id } });
        await prisma.orgSubscription.deleteMany({ where: { orgId: org.id } });
        await prisma.auditLog.deleteMany({ where: { orgId: org.id } });
        await prisma.org.delete({ where: { id: org.id } });
      }
    });
    console.log(`\n${pass} passed, ${fail} failed`);
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
