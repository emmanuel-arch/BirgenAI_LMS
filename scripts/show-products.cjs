// Read-only: what is actually on each org's shelf, and how it maps to the
// lender's own product ids. Answers "are the three fintech products configured"
// without opening Prisma Studio.
//
//   node scripts/show-products.cjs
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
      `SELECT o.slug, o.mode, o."serviceSuiteEntityId",
              p.name, p."isActive", p."serviceSuiteProductId",
              p."minPrincipal", p."maxPrincipal",
              p."interestRate", p."interestPeriodUnit",
              p."repaymentPeriod", p."repaymentPeriodUnit"
         FROM "Org" o
         LEFT JOIN "Product" p ON p."orgId" = o.id
        ORDER BY o.slug, p.name`,
    );
    if (!r.rows.length) return console.log("No orgs.");
    let last = null;
    for (const x of r.rows) {
      if (x.slug !== last) {
        console.log(`\n${x.slug}  (${x.mode}, entity ${x.serviceSuiteEntityId ?? "—"})`);
        last = x.slug;
      }
      if (!x.name) {
        console.log("  (no products on the local shelf — the live mirror is used)");
        continue;
      }
      console.log(
        `  ${x.isActive ? "•" : "×"} ${x.name}` +
          `  ss=${x.serviceSuiteProductId ?? "—"}` +
          `  ${x.minPrincipal ?? "?"}–${x.maxPrincipal ?? "?"}` +
          `  ${x.interestRate ?? "?"}%/${x.interestPeriodUnit ?? "?"}` +
          `  ${x.repaymentPeriod ?? "?"} ${x.repaymentPeriodUnit ?? "?"}`,
      );
    }
    console.log("");
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
