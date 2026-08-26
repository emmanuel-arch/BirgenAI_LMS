// ─────────────────────────────────────────────────────────────────────────────
// Who is actually on this network, and how big is their book?
//
//   npx tsx scripts/probe-interchange-members.ts
//
// The Interchange onboards ServiceSuite ENTITIES, not companies. One company can
// hold several entities on one server — Axe runs Boresha (3003) and Stawi (3004)
// on axemicro; Micromart runs 3002 and Fintech 3005 on services. Each entity is
// its own book, its own borrowers and its own EntityId scope, so each is its own
// member with its own key, its own filter and its own node.
//
// This reads BsEntity plus the loan and borrower counts per entity, on every
// ServiceSuite server this host can reach, so member sizing is measured rather
// than assumed. Read-only throughout.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { ORGS, isOrgConfigured, getEntityId, type OrgDef, type OrgSlug } from "../src/lib/enterprise/connections";
import { runReadOnlyQuery } from "../src/lib/enterprise/mssql";

const B = (s: string) => `\x1b[1m${s}\x1b[0m`;
const D = (s: string) => `\x1b[2m${s}\x1b[0m`;
const G = (s: string) => `\x1b[32m${s}\x1b[0m`;
const R = (s: string) => `\x1b[31m${s}\x1b[0m`;
const Y = (s: string) => `\x1b[33m${s}\x1b[0m`;

/** One row per server, not per org — several orgs share a connection string. */
const SERVERS: { label: string; slug: OrgSlug }[] = [
  { label: "Micromart (services)", slug: "micromart-fintech" },
  { label: "Axe (axemicro)", slug: "axe" },
];

const n = (v: unknown) => (v == null ? 0 : Number(v));
const ksh = (v: number) =>
  v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `${Math.round(v / 1_000)}k` : String(v);

async function probe(label: string, org: OrgDef) {
  console.log(`\n${B(label)}  ${D(`${org.slug} · default entity ${org.defaultEntityId} · ${org.connEnv}`)}`);

  if (!isOrgConfigured(org)) {
    console.log(`  ${R("unconfigured")} — ${org.connEnv} is not set on this host.`);
    return;
  }

  // BsEntity first, on its own. If the credential or the route is wrong this is
  // the cheap query that says so, before a book-wide aggregate times out.
  let entities;
  try {
    entities = await runReadOnlyQuery(
      org,
      `SELECT ID, EntityName, EntityPhoneNo, EntityEmail, EntityCountry, EntityCounty,
              primaryColor, secondaryColor, theme, AccountStatus, CreatedDate
       FROM BsEntity ORDER BY ID`,
      [],
      { timeoutMs: 20000, maxRows: 200 },
    );
  } catch (e) {
    console.log(`  ${R("unreachable")} — ${(e as Error).message.split("\n")[0]}`);
    return;
  }

  console.log(`  ${G("connected")} ${D(`${entities.rowCount} entities · ${entities.elapsedMs}ms`)}`);

  // The book, per entity. Same predicates the group overview uses so the numbers
  // agree with what the console already shows.
  const book = await runReadOnlyQuery(
    org,
    `SELECT e.ID AS entityId,
            ISNULL(b.borrowers, 0)   AS borrowers,
            ISNULL(l.loans, 0)       AS loans,
            ISNULL(l.openLoans, 0)   AS openLoans,
            ISNULL(l.olb, 0)         AS olb,
            ISNULL(l.loans30d, 0)    AS loans30d,
            l.lastLoanAt
     FROM BsEntity e
     LEFT JOIN (SELECT EntityId, COUNT(*) AS borrowers FROM Borrowers GROUP BY EntityId) b
            ON b.EntityId = e.ID
     LEFT JOIN (
       SELECT EntityId,
              COUNT(*) AS loans,
              SUM(CASE WHEN LoanCleared = 0 AND LoanBalance > 0 THEN 1 ELSE 0 END) AS openLoans,
              SUM(CASE WHEN LoanCleared = 0 THEN CAST(LoanBalance AS BIGINT) ELSE 0 END) AS olb,
              SUM(CASE WHEN BorrowDate >= DATEADD(day, -30, GETDATE()) THEN 1 ELSE 0 END) AS loans30d,
              MAX(BorrowDate) AS lastLoanAt
       FROM Loans WHERE isApproved = 1 GROUP BY EntityId
     ) l ON l.EntityId = e.ID
     ORDER BY ISNULL(l.olb, 0) DESC`,
    [],
    { timeoutMs: 120000, maxRows: 200 },
  );

  const byId = new Map(book.rows.map((r) => [n(r.entityId), r]));
  const configured = getEntityId(org);

  console.log(
    D(
      `  ${"id".padStart(5)}  ${"entity".padEnd(30)} ${"borrowers".padStart(10)} ${"loans".padStart(8)}` +
        ` ${"open".padStart(7)} ${"OLB".padStart(9)} ${"30d".padStart(5)}  last loan`,
    ),
  );

  for (const e of entities.rows) {
    const id = n(e.ID);
    const s = byId.get(id);
    const loans = n(s?.loans);
    if (loans === 0 && n(s?.borrowers) === 0) continue; // dormant shells add noise

    const last = s?.lastLoanAt instanceof Date ? (s.lastLoanAt as Date).toISOString().slice(0, 10) : "—";
    const mark = id === configured ? G("◀ this org") : "";
    const dark =
      String(e.primaryColor ?? "").toLowerCase() === "#000000" &&
      String(e.secondaryColor ?? "").toLowerCase() === "#000000"
        ? Y(" ⚠ black-on-black branding")
        : "";

    console.log(
      `  ${String(id).padStart(5)}  ${String(e.EntityName ?? "").slice(0, 30).padEnd(30)}` +
        ` ${ksh(n(s?.borrowers)).padStart(10)} ${ksh(loans).padStart(8)} ${ksh(n(s?.openLoans)).padStart(7)}` +
        ` ${ksh(n(s?.olb)).padStart(9)} ${ksh(n(s?.loans30d)).padStart(5)}  ${last} ${mark}${dark}`,
    );
  }
}

async function main() {
  console.log(`\n${B("ServiceSuite entities reachable from this host")}`);
  for (const s of SERVERS) await probe(s.label, ORGS[s.slug]);
  console.log("");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
