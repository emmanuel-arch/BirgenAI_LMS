// TEMP DIAGNOSTIC — read-only assessment of the shared ServiceSuite book on
// 213.148.17.198, to pick the Interchange founding cohort. Delete when done.
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.probe" });
import sql from "mssql";

const cfg: sql.config = {
  server: "213.148.17.198",
  port: 4420,
  database: "Serviceconnect",
  user: process.env.P198_USER!,
  password: process.env.P198_PASS!,
  options: { encrypt: true, trustServerCertificate: true },
  connectionTimeout: 25000,
  requestTimeout: 180000,
};

(async () => {
  const pool = await sql.connect(cfg);
  console.log("connected → 213.148.17.198:4420 / Serviceconnect\n");

  const q = async (label: string, text: string) => {
    try {
      const r = await pool.request().query(text);
      console.log(`\n── ${label} ──`);
      console.table(r.recordset);
    } catch (e: any) {
      console.log(`\n── ${label} ── ERROR: ${e.message}`);
    }
  };

  await q("Entities", `SELECT TOP 60 ID AS EntityId, EntityName FROM Entity ORDER BY ID`);

  await q("Book size per entity", `
    SELECT b.EntityID AS EntityId,
           COUNT(DISTINCT b.id) AS Borrowers,
           COUNT(DISTINCT l.id) AS Loans,
           MAX(l.DisbursedDate) AS LastDisbursed
    FROM Borrowers b
    LEFT JOIN Loans l ON l.BorrowerId = b.id
    GROUP BY b.EntityID
    ORDER BY COUNT(DISTINCT l.id) DESC`);

  await pool.close();
})().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
