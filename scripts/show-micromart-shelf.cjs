// Read-only: the full terms of Micromart's ACTIVE products, so the app's sample
// book can be corrected against what the lender actually sells rather than
// against what somebody typed once.
//
//   node scripts/show-micromart-shelf.cjs
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const root = path.resolve(__dirname, "..");
const envText = fs.readFileSync(path.join(root, ".env"), "utf8");
const m = envText.match(/^DIRECT_URL\s*=\s*"?([^"\r\n]+)"?/m);
if (!m) {
  console.error("DIRECT_URL not found in .env");
  process.exit(1);
}

(async () => {
  const c = new Client({ connectionString: m[1], ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    const r = await c.query(
      `SELECT p.* FROM "Product" p
         JOIN "Org" o ON o.id = p."orgId"
        WHERE o.slug = 'micromart' AND p."isActive" = true
        ORDER BY p.name`,
    );
    for (const p of r.rows) {
      console.log(`\n── ${p.name} ──`);
      for (const [k, v] of Object.entries(p)) {
        if (v === null || v === "" || k === "id" || k === "orgId") continue;
        console.log(`  ${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`);
      }
    }
    const charges = await c.query(
      `SELECT c.name, c.amount, c.percent, c."appliesTo", c.trigger, c."applyAt", c."isActive"
         FROM "Charge" c JOIN "Org" o ON o.id = c."orgId"
        WHERE o.slug = 'micromart' ORDER BY c.name`,
    );
    console.log(`\n── Charges (${charges.rows.length}) ──`);
    for (const x of charges.rows) console.log(`  ${JSON.stringify(x)}`);
    console.log("");
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
