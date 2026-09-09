// Probe Micromart's AvailableLoanProducts to learn (a) whether it needs a Bearer
// token and (b) the exact field names it returns, before writing a mapper
// against guessed ones.
//
//   node scripts/probe-micromart-products.cjs [entityId] [phone] [password]
//
// With no credentials it tries unauthenticated. With them it signs in first and
// retries with the token, so the difference between the two answers is the
// actual auth requirement rather than an assumption about it.
const API = "https://micromartafrica.co.ke/MicromartAPI/Mobile/Application";

const entityId = Number(process.argv[2] || 3005);
const phone = process.argv[3] || "";
const password = process.argv[4] || "";

async function products(token, phoneNumber) {
  const res = await fetch(`${API}/AvailableLoanProducts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ PhoneNumber: String(phoneNumber ?? ""), EntityId: entityId, RequestFlag: 0 }),
    signal: AbortSignal.timeout(25_000),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 400);
  }
  return { status: res.status, body };
}

(async () => {
  console.log(`entity ${entityId}`);

  console.log("\n── without a token ──");
  try {
    const r = await products(null, phone);
    console.log(`status ${r.status}`);
    console.log(JSON.stringify(r.body, null, 2).slice(0, 2500));
  } catch (e) {
    console.log(`threw: ${e.message}`);
  }

  if (!phone || !password) {
    console.log("\n(no phone/password given — skipping the authenticated probe)");
    return;
  }

  console.log("\n── signing in ──");
  const login = await fetch(`${API}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ AccountNumber: phone, password, entityId }),
    signal: AbortSignal.timeout(25_000),
  });
  const who = await login.json().catch(() => null);
  console.log(`status ${login.status}`);
  // Print the KEYS only — the token and the customer's own details are not
  // something to spray into a terminal transcript.
  console.log(`keys: ${who ? Object.keys(who).join(", ") : "(none)"}`);
  if (!who?.borrowerId) return console.log("no borrowerId — cannot continue");
  console.log(`borrowerId present, token present: ${Boolean(who.token)}`);

  console.log("\n── with a token ──");
  const r2 = await products(who.token, who.accountNo ?? phone);
  console.log(`status ${r2.status}`);
  console.log(JSON.stringify(r2.body, null, 2).slice(0, 3500));
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
