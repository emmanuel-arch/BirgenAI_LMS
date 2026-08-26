// ─────────────────────────────────────────────────────────────────────────────
// Can this host reach Axe's ServiceSuite, and over which route?
//
//   AXE_CONN="Data Source=...;Initial Catalog=...;User ID=...;Password=..." \
//     npx tsx scripts/probe-axe-link.ts
//
// The connection string is taken from the environment, never from a file in this
// repo — a lender's SQL password committed to git is the one mistake that cannot
// be walked back. `.env` is the place it belongs once a route is proven.
//
// Axe's portal config points at the PUBLIC address 213.148.17.54,4420. This
// checks the TAILNET address first, because that is the route the suite should
// use: device-authenticated, and never on the open internet.
// ─────────────────────────────────────────────────────────────────────────────
import mssql from "mssql";
import { parseDotNetConnString } from "../src/lib/enterprise/connections";

/** axemicro, from `tailscale status`. */
const TAILNET = "100.103.154.73,4420";

async function tryHost(label: string, conn: string, dataSource: string): Promise<boolean> {
  const rewritten = conn.replace(/(Data Source|Server)\s*=\s*[^;]+/i, `Data Source=${dataSource}`);
  const cfg = parseDotNetConnString(rewritten);
  console.log(`\n\x1b[1m${label}\x1b[0m \x1b[2m${dataSource} · ${cfg.database} · user ${cfg.user}\x1b[0m`);

  const pool = new mssql.ConnectionPool({ ...cfg, connectionTimeout: 8000, requestTimeout: 30000 });
  const t0 = Date.now();
  try {
    await pool.connect();
    const r = await pool.request().query(
      `SELECT e.ID, e.EntityName, e.EntityEmail, e.primaryColor, e.secondaryColor, e.theme,
              ISNULL(b.borrowers,0) AS borrowers, ISNULL(l.loans,0) AS loans,
              ISNULL(l.openLoans,0) AS openLoans, ISNULL(l.olb,0) AS olb, l.lastLoanAt
       FROM BsEntity e
       LEFT JOIN (SELECT EntityId, COUNT(*) AS borrowers FROM Borrowers GROUP BY EntityId) b ON b.EntityId = e.ID
       LEFT JOIN (SELECT EntityId, COUNT(*) AS loans,
                         SUM(CASE WHEN LoanCleared = 0 AND LoanBalance > 0 THEN 1 ELSE 0 END) AS openLoans,
                         SUM(CASE WHEN LoanCleared = 0 THEN CAST(LoanBalance AS BIGINT) ELSE 0 END) AS olb,
                         MAX(BorrowDate) AS lastLoanAt
                  FROM Loans WHERE isApproved = 1 GROUP BY EntityId) l ON l.EntityId = e.ID
       ORDER BY e.ID`,
    );
    console.log(`  \x1b[32mconnected\x1b[0m \x1b[2m${Date.now() - t0}ms · ${r.recordset.length} entities\x1b[0m`);
    const k = (v: unknown) => {
      const n = Number(v ?? 0);
      return n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
    };
    for (const e of r.recordset) {
      const dark =
        String(e.primaryColor ?? "").toLowerCase() === "#000000" &&
        String(e.secondaryColor ?? "").toLowerCase() === "#000000"
          ? " \x1b[33m⚠ black-on-black\x1b[0m"
          : "";
      const last = e.lastLoanAt instanceof Date ? e.lastLoanAt.toISOString().slice(0, 10) : "—";
      console.log(
        `    ${String(e.ID).padStart(5)}  ${String(e.EntityName ?? "").slice(0, 26).padEnd(26)}` +
          ` ${k(e.borrowers).padStart(8)} borrowers ${k(e.loans).padStart(7)} loans` +
          ` ${k(e.openLoans).padStart(6)} open ${k(e.olb).padStart(8)} OLB  last ${last}` +
          `  ${e.primaryColor}/${e.secondaryColor}${dark}`,
      );
    }
    return true;
  } catch (e) {
    console.log(`  \x1b[31mfailed\x1b[0m \x1b[2m${Date.now() - t0}ms\x1b[0m — ${(e as Error).message.split("\n")[0]}`);
    return false;
  } finally {
    await pool.close().catch(() => {});
  }
}

async function main() {
  const conn = process.env.AXE_CONN;
  if (!conn) {
    console.error("Set AXE_CONN to the .NET-style connection string before running this.");
    process.exit(2);
  }
  const original = (conn.match(/(?:Data Source|Server)\s*=\s*([^;]+)/i) ?? [])[1] ?? "?";

  if (await tryHost("over the tailnet (axemicro)", conn, TAILNET)) return;
  if (original.toLowerCase().startsWith("localhost")) {
    console.log("\n\x1b[2mThe string was a localhost one — only the tailnet route is meaningful from here.\x1b[0m");
    return;
  }
  await tryHost("over the public address", conn, original);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
