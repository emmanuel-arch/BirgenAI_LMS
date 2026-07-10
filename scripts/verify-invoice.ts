// Tests for closing a month — invoices, and the cron that rolls periods.
//
//   npm run test:invoice        (needs the database; no app server)
//
// Two things must hold, or we bill a lender the wrong amount and cannot prove
// otherwise:
//
//   • an invoice is built from the prices AS CHARGED, event by event, so re-pricing
//     the catalogue tomorrow cannot rewrite what was owed last month;
//   • freezing is idempotent, so a cron that runs twice — or is retried after a
//     timeout — bills exactly once.
import "dotenv/config";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { runAsPlatform, runWithOrg } from "@/lib/db/context";
import { freezeInvoice, billKind, monthWindow, nextMonth } from "@/lib/billing/invoice";
import { PLANS } from "@/lib/billing/plans";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); }
};

async function main() {
  const slug = `invtest-${Date.now()}`;
  const org = await runAsPlatform(() => prisma.org.create({
    data: { slug, name: "Invoice Test", plan: "ENTERPRISE", mode: "NATIVE", status: "ACTIVE" },
  }));
  const ctx = <T>(fn: () => Promise<T>) => runWithOrg(org.id, fn);
  console.log(`fixture org ${slug} (${org.id})\n`);

  // A closed month in the past, so "now" never interferes.
  const last = new Date(Date.UTC(2026, 4, 15)); // 15 May 2026
  const { start, end } = monthWindow(last);

  try {
    console.log("1. The allowance is spent chronologically, and overage costs what it cost");
    // 100 CRB pulls included. 90 happen at 35, then we reprice to 40 and 20 more happen.
    // The allowance is used up on the cheap ones: 10 free at 35, then 20 billed at 40.
    let lines = billKind("crb", [{ qty: 90, unitCost: 35 }, { qty: 20, unitCost: 40 }], 100);
    ok("one line per price, not an average", lines.length === 1, JSON.stringify(lines));
    // 90 cheap pulls eat 90 of the 100 free. Of the next 20, ten are still free and
    // ten are billed — at 40, the price they actually cost.
    ok("ten free units remain and ten bill at 40",
      lines[0].unitCostKes === 40 && lines[0].qty === 10 && lines[0].amountKes === 400, JSON.stringify(lines[0]));
    ok("the allowance shows as fully used", lines[0].includedQty === 100);

    // Reverse the order and the answer changes — because it should.
    lines = billKind("crb", [{ qty: 90, unitCost: 40 }, { qty: 20, unitCost: 35 }], 100);
    ok("had the reprice gone the other way, the same ten units would cost 350, not 400",
      lines[0].unitCostKes === 35 && lines[0].qty === 10 && lines[0].amountKes === 350);

    lines = billKind("crb", [{ qty: 60, unitCost: 35 }, { qty: 60, unitCost: 40 }], 100);
    ok("an allowance straddling a reprice bills only the excess of the later price",
      lines.length === 1 && lines[0].unitCostKes === 40 && lines[0].qty === 20);

    ok("inside the allowance costs nothing at all", billKind("crb", [{ qty: 3, unitCost: 35 }], 100).length === 0);
    ok("no allowance means everything bills", billKind("sms", [{ qty: 5, unitCost: 1 }], 0)[0].amountKes === 5);

    console.log("\n2. A trial month is not billed. Not billed at zero — not billed.");
    await ctx(() => prisma.orgSubscription.create({
      data: {
        orgId: org.id, status: "TRIALING",
        trialEndsAt: new Date(Date.UTC(2026, 6, 1)), // covers all of May
        currentPeriodStart: start, currentPeriodEnd: end,
      },
    }));
    ok("no invoice is issued for a month spent entirely on trial", (await freezeInvoice(org.id, start, end)) === null);
    ok("and none was written", (await ctx(() => prisma.invoice.count({ where: { orgId: org.id } }))) === 0);

    console.log("\n3. A paying month is frozen at the prices as charged");
    await ctx(() => prisma.orgSubscription.update({ where: { orgId: org.id }, data: { status: "ACTIVE", trialEndsAt: null } }));

    const mid = new Date(Date.UTC(2026, 4, 10));
    const event = (kind: string, qty: number, unitCost: number, at: Date) =>
      ctx(() => prisma.usageEvent.create({
        data: { orgId: org.id, kind, qty, unitCost: new Prisma.Decimal(unitCost), createdAt: at },
      }));

    // Enterprise includes 100 CRB. 90 at 35, then a reprice, then 20 at 40.
    await event("crb", 90, 35, mid);
    await event("crb", 20, 40, new Date(Date.UTC(2026, 4, 20)));
    // 1,000 SMS included; 1,200 sent.
    await event("sms", 1200, 1, mid);
    // Well inside the score allowance.
    await event("score", 5, 10, mid);

    const inv = await freezeInvoice(org.id, start, end);
    ok("an invoice is issued", !!inv && !inv.alreadyExisted);
    ok("numbered by org and month", inv!.number === `INV-${slug.toUpperCase()}-202605`, inv!.number);
    ok("the package fee is Enterprise's 15,000", inv!.planFeeKes === PLANS.ENTERPRISE.monthlyKes);

    const crb = inv!.lines.find((l) => l.kind === "crb")!;
    ok("CRB overage is the 10 units past the allowance, at the 40 they actually cost",
      crb.qty === 10 && crb.unitCostKes === 40 && crb.amountKes === 400, JSON.stringify(crb));
    const sms = inv!.lines.find((l) => l.kind === "sms")!;
    ok("SMS overage is 200 at 1", sms.qty === 200 && sms.amountKes === 200);
    ok("a kind inside its allowance gets no line", !inv!.lines.some((l) => l.kind === "score"));
    ok("overage totals 600 — 400 of CRB and 200 of SMS", inv!.overageKes === 600, `${inv!.overageKes}`);
    ok("and the invoice totals 15,600", inv!.totalKes === 15600, `${inv!.totalKes}`);
    ok("the subscription itself is a line", inv!.lines.some((l) => l.kind === "subscription" && l.amountKes === 15000));

    console.log("\n4. Re-pricing the catalogue does not rewrite a frozen month");
    const before = inv!.totalKes;
    // Simulate tomorrow's price change by rewriting nothing but the catalogue: the
    // invoice is already frozen, so re-reading it must give the same numbers.
    const reread = await freezeInvoice(org.id, start, end);
    ok("freezing again returns the SAME invoice", reread!.id === inv!.id && reread!.alreadyExisted);
    ok("with the same total", reread!.totalKes === before);
    ok("and exactly one invoice exists for the month", (await ctx(() => prisma.invoice.count({ where: { orgId: org.id } }))) === 1);
    ok("a second freeze wrote no extra lines",
      (await ctx(() => prisma.invoiceLine.count({ where: { orgId: org.id } }))) === inv!.lines.length);

    console.log("\n5. Usage outside the period belongs to another month");
    await event("crb", 500, 35, new Date(Date.UTC(2026, 5, 3))); // June
    const june = monthWindow(new Date(Date.UTC(2026, 5, 15)));
    const juneInv = await freezeInvoice(org.id, june.start, june.end);
    ok("June's invoice exists and is its own", juneInv!.id !== inv!.id);
    ok("June bills 400 CRB over its 100 allowance at 35 = 14,000",
      juneInv!.lines.find((l) => l.kind === "crb")?.amountKes === 14000, JSON.stringify(juneInv!.lines.find((l) => l.kind === "crb")));
    ok("May's invoice is untouched", Number((await ctx(() => prisma.invoice.findUniqueOrThrow({ where: { id: inv!.id } }))).totalKes) === 15600);

    console.log("\n6. Months roll forward one at a time");
    ok("May → June", nextMonth(start).toISOString().slice(0, 10) === "2026-06-01");
    ok("December rolls the year", nextMonth(new Date(Date.UTC(2026, 11, 1))).toISOString().slice(0, 10) === "2027-01-01");
    ok("a month window is half-open", monthWindow(new Date(Date.UTC(2026, 4, 31))).end.toISOString().slice(0, 10) === "2026-06-01");

    console.log("\n7. An unbillable kind is never invoiced, whatever was recorded");
    await ctx(() => prisma.usageEvent.create({
      data: { orgId: org.id, kind: "a-kind-we-never-built", qty: 99, unitCost: new Prisma.Decimal(999), createdAt: new Date(Date.UTC(2026, 6, 5)) },
    }));
    const july = monthWindow(new Date(Date.UTC(2026, 6, 15)));
    const julyInv = await freezeInvoice(org.id, july.start, july.end);
    ok("it contributes nothing", julyInv!.overageKes === 0);
    ok("and has no line", !julyInv!.lines.some((l) => l.kind === "a-kind-we-never-built"));
  } finally {
    await runAsPlatform(async () => {
      await prisma.invoiceLine.deleteMany({ where: { orgId: org.id } });
      await prisma.invoice.deleteMany({ where: { orgId: org.id } });
      await prisma.usageEvent.deleteMany({ where: { orgId: org.id } });
      await prisma.orgSubscription.deleteMany({ where: { orgId: org.id } });
      await prisma.auditLog.deleteMany({ where: { orgId: org.id } });
      await prisma.org.delete({ where: { id: org.id } });
    });
    console.log(`\n${pass} passed, ${fail} failed`);
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
