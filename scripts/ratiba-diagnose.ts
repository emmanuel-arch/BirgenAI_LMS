// ─────────────────────────────────────────────────────────────────────────────
// IS M-PESA RATIBA ACTUALLY ENABLED? One command, one answer.
//
//   npm run ratiba:diagnose
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
// A Ratiba refusal and a Ratiba misconfiguration look identical from the console:
// "Ratiba request failed (401)". They are not the same problem and they have
// different owners — one is a Safaricom onboarding step, the other is ours. This
// separates them by running THREE products against ONE token:
//
//   1. OAuth            — do these credentials authenticate at all?
//   2. STK query        — a made-up CheckoutRequestID. A 500 "transaction does
//                         not Exist" is a BUSINESS error, which proves the token
//                         is accepted and the Daraja app IS subscribed to STK.
//   3. Standing Order   — the same token, the same shortcode.
//
// One token, two products, one refusal ⇒ the credentials are good and Standing
// Order is simply not enabled for that app/shortcode. Nothing in our code can fix
// that; it is a product subscription on the Daraja app plus, for a production
// paybill, Safaricom enabling Standing Order for the shortcode itself.
//
// ── IT TRIES EVERY CREDENTIAL MICROMART HAS, NOT JUST THE VAULT'S ────────────
// Micromart runs TWO Daraja apps, one per book, and only the SME one was ever
// copied into our vault. Transactions.dbo.StkParams on their own server holds
// both — EntityId 3002 (paybill 4038021, the branch book) and EntityId 3005
// (paybill 4329635, Micro Eazy). "We toggled Ratiba on" is only ever true of ONE
// app, so testing one and reporting "Ratiba is off" would be a guess. Every row
// is tried and each is reported separately.
//
// READ-ONLY. Credentials are decrypted in memory and never printed. The Ratiba
// call is a mandate REQUEST: it debits nothing, and it only reaches a handset if
// the product is enabled — which is the thing being tested.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { runReadOnlyQuery } from "../src/lib/enterprise/mssql";
import { decipherLegacy } from "../src/lib/enterprise/servicesuite-config";
import { getOrg } from "../src/lib/enterprise/connections";
import { ratibaCallbackUrl } from "../src/lib/mpesa/daraja";

const BASE = "https://api.safaricom.co.ke";

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : d;
};

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};
const ymd = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;

type Creds = { entityId: number; key: string; secret: string; passkey: string; shortCode: string };

async function diagnose(c: Creds, phone: string, slug: string) {
  console.log(`\n${bold(`EntityId ${c.entityId}`)} · paybill ${bold(c.shortCode)}`);

  // 1 ── OAuth
  const auth = "Basic " + Buffer.from(`${c.key}:${c.secret}`).toString("base64");
  const tRes = await fetch(`${BASE}/oauth/v1/generate?grant_type=client_credentials`, { headers: { Authorization: auth } });
  const tTxt = await tRes.text();
  if (!tRes.ok) {
    console.log(`  1. OAuth          ${red(String(tRes.status))}  ${tTxt.replace(/\s+/g, " ").slice(0, 160)}`);
    console.log(`     ${red("These credentials do not authenticate. Nothing downstream can work.")}`);
    return;
  }
  const token = JSON.parse(tTxt).access_token as string;
  console.log(`  1. OAuth          ${green("200")}  token acquired`);
  const bearer = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  // 2 ── STK query with a deliberately non-existent id
  const ts = stamp();
  const password = Buffer.from(`${c.shortCode}${c.passkey}${ts}`).toString("base64");
  const qRes = await fetch(`${BASE}/mpesa/stkpushquery/v1/query`, {
    method: "POST", headers: bearer,
    body: JSON.stringify({ BusinessShortCode: c.shortCode, Password: password, Timestamp: ts, CheckoutRequestID: "ws_CO_00000000000000000000" }),
  });
  const qTxt = (await qRes.text()).replace(/\s+/g, " ").trim();
  const stkSubscribed = qRes.status !== 401 && qRes.status !== 403;
  console.log(`  2. STK query      ${stkSubscribed ? green(String(qRes.status)) : red(String(qRes.status))}  ${qTxt.slice(0, 130)}`);

  // 3 ── Standing Order, same token
  const start = new Date(Date.now() + 86_400_000);
  const end = new Date(start.getTime() + 28 * 86_400_000);
  const rRes = await fetch(`${BASE}/standingorder/v1/createStandingOrderExternal`, {
    method: "POST", headers: bearer,
    body: JSON.stringify({
      StandingOrderName: `Diagnose ${Date.now().toString().slice(-5)}`,
      StartDate: ymd(start), EndDate: ymd(end),
      BusinessShortCode: c.shortCode,
      TransactionType: "Standing Order Customer Pay Bill",
      ReceiverPartyIdentifierType: "4",
      Amount: "10", PartyA: phone,
      CallBackURL: ratibaCallbackUrl(slug),
      AccountReference: "DIAGNOSE", TransactionDesc: "Diagnostic", Frequency: "4",
    }),
  });
  const rTxt = (await rRes.text()).replace(/\s+/g, " ").trim();
  const ratibaOk = rRes.status >= 200 && rRes.status < 300;
  console.log(`  3. Standing Order ${ratibaOk ? green(String(rRes.status)) : red(String(rRes.status))}  ${rTxt.slice(0, 200)}`);

  console.log();
  if (ratibaOk) {
    console.log(`     ${green("RATIBA IS LIVE on this app.")} A mandate request has gone to ${phone}.`);
  } else if (stkSubscribed && rRes.status === 401) {
    console.log(`     ${yellow("VERDICT: credentials good, Standing Order NOT enabled for this app.")}`);
    console.log(dim(`     The same token STK accepted was refused by Standing Order. That is a`));
    console.log(dim(`     subscription on Safaricom's side, not a defect here: add the Standing`));
    console.log(dim(`     Order product to THIS Daraja app (the one signing for paybill`));
    console.log(dim(`     ${c.shortCode}) and have Safaricom enable it for the shortcode.`));
  } else {
    console.log(`     ${red("VERDICT: unexpected.")} Read the two responses above — they disagree with`);
    console.log(dim(`     the usual "credentials fine, product off" pattern.`));
  }
}

async function main() {
  const slug = arg("org", "micromart")!;
  const phone = (arg("phone", "254758517032") ?? "").replace(/\D/g, "");
  const org = getOrg(slug);
  if (!org) throw new Error(`No connection registry entry for "${slug}".`);

  console.log(bold(`\nM-Pesa Ratiba diagnostic — ${org.name}`));
  console.log(dim(`handset ${phone} · callback ${ratibaCallbackUrl(slug).split("?")[0]}`));

  const { rows } = await runReadOnlyQuery(
    org,
    `SELECT EntityId, ConsumerKey, ConsumerSecrete, passkey, shortCode
     FROM Transactions.dbo.StkParams ORDER BY EntityId`,
    [], { timeoutMs: 30000 },
  );
  if (!rows.length) throw new Error("No StkParams rows on that server.");

  for (const row of rows) {
    const c: Creds = {
      entityId: Number(row.EntityId),
      key: decipherLegacy(String(row.ConsumerKey ?? "")) ?? "",
      secret: decipherLegacy(String(row.ConsumerSecrete ?? "")) ?? "",
      passkey: decipherLegacy(String(row.passkey ?? "")) ?? "",
      shortCode: decipherLegacy(String(row.shortCode ?? "")) ?? "",
    };
    if (!c.key || !c.secret || !c.shortCode) {
      console.log(`\n${bold(`EntityId ${c.entityId}`)} — ${red("credentials could not be decrypted")}, skipped.`);
      continue;
    }
    await diagnose(c, phone, slug);
  }
  console.log();
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
