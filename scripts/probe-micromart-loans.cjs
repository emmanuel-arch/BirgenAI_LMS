// Learn the shape of Micromart's borrower-facing loan endpoints, so Home and
// Repay can be wired against what they actually return rather than against a
// guess.
//
//   node scripts/probe-micromart-loans.cjs <entityId> <phone> <password>
//
// Reads only. AccountPreview and Loans are GETs; LoanDetails is a POST that
// takes a loan id. Nothing here writes, and Repayment (which raises an STK push
// to a real handset) is deliberately NOT called.
const API = "https://micromartafrica.co.ke/MicromartAPI/Mobile/Application";

const [entityId, phone, password] = [Number(process.argv[2] || 3005), process.argv[3], process.argv[4]];
if (!phone || !password) {
  console.error("usage: node scripts/probe-micromart-loans.cjs <entityId> <phone> <password>");
  process.exit(1);
}

/** Print the SHAPE of a response rather than dumping it — key names, types, and
 *  one sample value each. A borrower's real balances are not something to spray
 *  into a terminal transcript that may be pasted somewhere. */
function shape(label, data, depth = 0) {
  const pad = "  ".repeat(depth + 1);
  if (Array.isArray(data)) {
    console.log(`${pad}${label}: array(${data.length})`);
    if (data[0] && typeof data[0] === "object") shape("[0]", data[0], depth + 1);
    return;
  }
  if (data && typeof data === "object") {
    console.log(`${pad}${label}: object`);
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === "object") shape(k, v, depth + 1);
      else console.log(`${pad}  ${k}: ${typeof v} = ${JSON.stringify(v)}`);
    }
    return;
  }
  console.log(`${pad}${label}: ${typeof data} = ${JSON.stringify(data)}`);
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
  const auth = { Authorization: `Bearer ${who.token}`, "Content-Type": "application/json" };
  console.log(`signed in · borrowerId ${who.borrowerId} · entity ${entityId}\n`);

  for (const [label, url] of [
    ["AccountPreview", `${API}/AccountPreview`],
    ["Loans", `${API}/Loans?Limit=5&Offset=0`],
    ["ProfileProgress", `${API}/ProfileProgress`],
    ["GetAlerts", `${API}/GetAlerts`],
  ]) {
    try {
      const method = label === "Loans" ? "GET" : "POST";
      const r = await fetch(url, { method, headers: auth, signal: AbortSignal.timeout(25_000) });
      const text = await r.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        body = text.slice(0, 200);
      }
      console.log(`── ${label} — HTTP ${r.status} ──`);
      shape(label, body);
      console.log("");

      // Chain LoanDetails off the first loan we find, since it needs an id.
      if (label === "Loans") {
        const rows = Array.isArray(body) ? body : Array.isArray(body?.Table) ? body.Table : [];
        const id = rows[0]?.ID ?? rows[0]?.LoanId ?? rows[0]?.Id;
        if (id != null) {
          const d = await fetch(`${API}/LoanDetails`, {
            method: "POST",
            headers: auth,
            body: JSON.stringify({
              ProductId: id, // their naming — this field carries the LOAN id
              EntityId: entityId,
              AgentId: Number(who.borrowerId),
              PhoneNumber: "",
            }),
            signal: AbortSignal.timeout(25_000),
          });
          const db = await d.json().catch(() => null);
          console.log(`── LoanDetails (loan ${id}) — HTTP ${d.status} ──`);
          shape("LoanDetails", db);
          console.log("");
        } else {
          console.log("(no loans on this account — LoanDetails skipped)\n");
        }
      }
    } catch (e) {
      console.log(`── ${label} — threw: ${e.message}\n`);
    }
  }
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
