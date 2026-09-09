// Read-only: a workflow and its stages, in order — the chain both the officer
// console and the customer's tracker screen render.
//
//   node scripts/show-workflow.cjs [orgSlug]
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
const slug = process.argv[2] || "micromart";

(async () => {
  const c = new Client({ connectionString: m[1], ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    const wf = await c.query(
      `SELECT w.id, w.title, w.kind, w."isActive", w."multiApproval"
         FROM "Workflow" w JOIN "Org" o ON o.id = w."orgId"
        WHERE o.slug = $1 ORDER BY w.title`,
      [slug],
    );
    if (!wf.rows.length) return console.log(`No workflows for ${slug}.`);

    for (const w of wf.rows) {
      console.log(`\n── ${w.title}  (${w.kind}${w.isActive ? "" : ", INACTIVE"}) ──`);
      console.log(`   ${w.id}`);
      const st = await c.query(
        `SELECT title, "order", "accessTier", "canFinalize", "otpRequired",
                "crbRequired", "slaHours", "maxAmount"
           FROM "WorkflowStage" WHERE "workflowId" = $1 ORDER BY "order"`,
        [w.id],
      );
      if (!st.rows.length) console.log("   (no stages)");
      for (const s of st.rows) {
        console.log(
          `   ${s.order}. ${s.title}` +
            `  tier=${s.accessTier}` +
            (s.canFinalize ? "  FINALIZES" : "") +
            (s.otpRequired ? "  otp" : "") +
            (s.crbRequired ? "  crb" : "") +
            `  sla=${s.slaHours}h` +
            (s.maxAmount ? `  cap=${s.maxAmount}` : ""),
        );
      }
    }
    console.log("");
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
