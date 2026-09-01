// ─────────────────────────────────────────────────────────────────────────────
// SEND ONE REAL M-PESA RATIBA MANDATE, TO PROVE THE INTEGRATION.
//
//   npm run ratiba:test -- --org micromart --phone 2547XXXXXXXX            # dry
//   npm run ratiba:test -- --org micromart --phone 2547XXXXXXXX --send     # sends
//
// ── WHAT THIS ACTUALLY DOES, AND WHAT IT DOES NOT ────────────────────────────
// It asks Safaricom to raise a STANDING ORDER MANDATE against a phone number.
// The handset receives a request to authorise it, and NOTHING IS DEBITED by that
// request — the customer approves it with their M-PESA PIN, and only then does
// Safaricom start moving money, on the dates in the mandate. Declining it, or
// ignoring it, costs nobody anything.
//
// It is still a real request from a production paybill to a real handset, so:
//   · --send is required. Dry prints the exact body that would go.
//   · The amount and the window are deliberately small. A test mandate that
//     somebody approves by reflex should not be able to take a month's salary.
//   · The order is filed PENDING with Safaricom's own reference, so the callback
//     (/api/mpesa/ratiba-callback/<slug>) has something to turn ACTIVE — which is
//     the half of the integration a request alone does not prove.
//
// ── STATUS ON MICROMART, 2 SEP 2026: THE PRODUCT IS NOT SUBSCRIBED ───────────
// Run against paybill 4038021 on production credentials, this comes back
// 401 "Unauthorised-Invalid Access Token" from
// /standingorder/v1/createStandingOrderExternal. That is NOT a bug here, and it
// is worth writing down because it looks exactly like one. Isolated:
//
//   1. OAuth  /oauth/v1/generate    → 200, token obtained, 3599s expiry
//   2. STK    /mpesa/stkpushquery   → 500 "The transaction does not Exist" — a
//                                     BUSINESS error on a made-up id, so the
//                                     same token authenticates fine and the app
//                                     IS subscribed to STK Push
//   3. Ratiba /standingorder/v1/…   → 401, with that same token
//
// One token, two products, one refusal: the credentials are good and the Daraja
// app is simply not subscribed to M-PESA Ratiba / Standing Order (or the
// shortcode has not been enabled for it by Safaricom). Everything on our side —
// endpoint, body shape, auth, frequency mapping, callback URL — is right, which
// is why the answer comes back inside the Ratiba protocol's own envelope rather
// than as a 404.
//
// TO FIX: add the Standing Order product to the Daraja app in the portal, or ask
// Safaricom to enable it for the shortcode. Then re-run this script. Nothing in
// the code needs to change.
//
// ── WHY IT DOES NOT NEED A LOAN ──────────────────────────────────────────────
// The customer-facing route derives the plan from an active loan, which is right
// for a customer and wrong for a test: the thing being proved here is the
// TRANSPORT — credentials, token, endpoint, callback URL, and whether the
// handset rings. So the plan is supplied, `loanId` stays null, and nothing about
// this row can be mistaken for a real repayment mandate.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import type { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { runAsPlatform } from "../src/lib/db/context";
import { getIntegration } from "../src/lib/vault/integrations";
import { createStandingOrder, ratibaCallbackUrl, type RatibaFrequency } from "../src/lib/mpesa/daraja";

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : d;
};
const flag = (n: string) => process.argv.includes(`--${n}`);
const ymd = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  const slug = arg("org", "micromart")!;
  const phone = (arg("phone") ?? "").replace(/\D/g, "");
  const amount = Math.max(1, Math.round(Number(arg("amount", "10"))));
  const frequency = (arg("frequency", "MONTHLY") as RatibaFrequency);
  const weeks = Number(arg("weeks", "4"));
  const send = flag("send");

  if (!phone) throw new Error("Give me a handset: --phone 2547XXXXXXXX");

  const org = await runAsPlatform(() => prisma.org.findFirst({ where: { slug }, select: { id: true, name: true, slug: true } }));
  if (!org) throw new Error(`No org with slug "${slug}".`);

  const borrower = await runAsPlatform(() => prisma.borrower.findFirst({
    where: { orgId: org.id, phone },
    select: { id: true, firstName: true, otherName: true, erasedAt: true },
  }));
  if (!borrower) throw new Error(`No borrower on ${org.name} with phone ${phone}.`);
  if (borrower.erasedAt) throw new Error("That customer was erased.");

  const cfg = await runAsPlatform(() => getIntegration(org.id, "MPESA_STK"));
  if (!cfg) throw new Error(`${org.name} has no M-PESA configuration in the vault.`);
  const c = cfg as unknown as Record<string, string>;

  // Start TOMORROW, not today: Safaricom reject a start date that has already
  // begun, and a mandate that fails validation proves nothing about the handset.
  const startDate = new Date(Date.now() + 86_400_000);
  const endDate = new Date(startDate.getTime() + weeks * 7 * 86_400_000);
  const name = `${(borrower.firstName ?? "").trim()} test`.slice(0, 32) || "Ratiba test";
  const accountReference = `TEST${borrower.id.slice(0, 8).toUpperCase()}`.slice(0, 12);

  console.log(`\n\x1b[1m${org.name}\x1b[0m → \x1b[1m${(borrower.firstName ?? "") + " " + (borrower.otherName ?? "")}\x1b[0m  ${phone}`);
  console.log(`  paybill      ${c.shortCode} · ${c.environment}`);
  console.log(`  callback     ${ratibaCallbackUrl(org.slug).split("?")[0]}`);
  console.log(`  mandate      KES ${amount} ${frequency.toLowerCase()}, ${ymd(startDate)} → ${ymd(endDate)}`);
  console.log(`  reference    ${accountReference}`);
  console.log(`  mode         ${send ? "\x1b[33mSENDING — a real request to a real handset\x1b[0m" : "\x1b[2mdry run\x1b[0m"}\n`);

  if (!send) {
    console.log("\x1b[2mDry run — nothing sent. Re-run with --send.\x1b[0m\n");
    return;
  }

  // runAsPlatform: createStandingOrder reads the M-PESA credentials out of the
  // vault, and row-level security refuses that query without a tenant context. A
  // staff request has one from the session; a script has to say so.
  const res = await runAsPlatform(() =>
    createStandingOrder(org.id, org.slug, {
      phone, amount, accountReference, name, startDate, endDate, frequency,
      description: "Ratiba test",
    }),
  );

  console.log(res.ok ? "\x1b[32m  ACCEPTED BY SAFARICOM\x1b[0m" : "\x1b[31m  REFUSED\x1b[0m");
  console.log(`  ${res.message}`);
  if (res.ref) console.log(`  reference: ${res.ref}`);
  if (res.raw) console.log(`  raw: ${JSON.stringify(res.raw).slice(0, 500)}`);

  if (!res.ok) {
    console.log("\n\x1b[2mNothing was filed — a refused mandate is not a standing order.\x1b[0m\n");
    return;
  }

  // Filed PENDING. The callback is what turns it ACTIVE, and that is the half of
  // the integration a successful request does not prove.
  const row = await runAsPlatform(() =>
    prisma.standingOrder.create({
      data: {
        orgId: org.id,
        borrowerId: borrower.id,
        phone, amount, frequency, startDate, endDate,
        reference: accountReference,
        name,
        status: "PENDING",
        externalRef: res.ref ?? null,
        simulated: false,
        raw: (res.raw ?? {}) as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    }),
  );

  console.log(`\n  Filed as PENDING (${row.id}).`);
  console.log("  \x1b[1mCheck the handset.\x1b[0m Approving it debits nothing today — Safaricom would begin on");
  console.log(`  ${ymd(startDate)}. Ignore it, or decline it, and the mandate simply expires.`);
  console.log("  Once approved, Safaricom calls the callback above and the row turns ACTIVE.\n");
}

main().then(() => process.exit(0)).catch((e) => { console.error("\n\x1b[31m" + (e instanceof Error ? e.message : String(e)) + "\x1b[0m\n"); process.exit(1); });
