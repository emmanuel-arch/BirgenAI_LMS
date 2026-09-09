// The lender's live shelf, one line per product — the compact form of
// probe-micromart-products.cjs, for when the full JSON is too long to read in a
// terminal.
//
//   node scripts/micromart-shelf.cjs <entityId> <phone> <password>
const API = "https://micromartafrica.co.ke/MicromartAPI/Mobile/Application";

const [entityId, phone, password] = [Number(process.argv[2] || 3005), process.argv[3], process.argv[4]];
if (!phone || !password) {
  console.error("usage: node scripts/micromart-shelf.cjs <entityId> <phone> <password>");
  process.exit(1);
}

(async () => {
  const login = await fetch(`${API}/Login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ AccountNumber: phone, password, entityId }),
    signal: AbortSignal.timeout(25_000),
  });
  const who = await login.json().catch(() => null);
  if (!who?.borrowerId) {
    console.error(`login failed (${login.status}): ${who?.message ?? "no borrowerId"}`);
    process.exit(1);
  }

  const res = await fetch(`${API}/AvailableLoanProducts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${who.token}` },
    body: JSON.stringify({ PhoneNumber: String(who.accountNo ?? phone), EntityId: entityId, RequestFlag: 0 }),
    signal: AbortSignal.timeout(25_000),
  });
  const data = await res.json();
  const rows = Array.isArray(data) ? data : Array.isArray(data?.Table) ? data.Table : [];

  console.log(`entity ${entityId} — ${rows.length} product(s)\n`);
  for (const p of rows) {
    console.log(
      `${String(p.ID).padEnd(6)} ${String(p.ProductName ?? "").padEnd(22)}` +
        ` ${p.IsActive === 1 ? "active  " : "RETIRED "}` +
        ` ${p.InterestRate}%/${p.InterestPeriodName}` +
        ` · ${p.RepaymentPeriod} ${p.RepaymentPeriodName}` +
        ` · ${p.methodName}` +
        ` · ${p.MinPrincipal}–${p.MaxPrincipal}` +
        ` · score ${p.MinCreditScore ?? "—"}` +
        ` · wf ${p.WorkflowTitle ?? p.WorkflowId ?? "—"}`,
    );
  }
  console.log("");
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
