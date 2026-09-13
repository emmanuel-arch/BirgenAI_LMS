// Does the runtime role ACTUALLY enforce tenant isolation?
//
//   LMS_APP_URL="postgresql://lms_app.<ref>:<pw>@<host>:6543/postgres" \
//     npx tsx scripts/verify-rls-role.ts
//
// Run this against the NEW connection string BEFORE moving DATABASE_URL onto it,
// and again afterwards. It is the only thing that distinguishes "we created a role"
// from "the fence is up" — and on 11 Sep 2026 this database looked entirely correct
// from the catalogue while enforcing nothing, so the catalogue is not evidence.
//
// WHY A SEPARATE SCRIPT FROM verify-rls.ts
// ----------------------------------------
// That one runs as whatever DATABASE_URL is and proves the POLICIES are right. This
// one proves the ROLE cannot step around them, which is a property of the connection,
// not of the schema. Both can pass while the system is wide open — that is precisely
// what was happening — so this takes its connection string as an argument and does
// not read DATABASE_URL at all.
//
// Read-only: it SELECTs, and every statement runs inside a rolled-back transaction.
import "dotenv/config";
import { Client } from "pg";

const url = process.env.LMS_APP_URL;
if (!url) {
  console.error(
    "Set LMS_APP_URL to the candidate runtime connection string.\n" +
    "Deliberately not DATABASE_URL: the point is to test the role you are about to\n" +
    "switch to, while the app is still safely on the old one.",
  );
  process.exit(2);
}

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); }
};

/** One statement, inside a transaction that is always rolled back. */
async function q<T = Record<string, unknown>>(
  c: Client, sql: string, opts: { org?: string; platform?: boolean } = {},
): Promise<T[]> {
  await c.query("BEGIN");
  try {
    if (opts.platform) await c.query("SELECT set_config('app.platform','on',TRUE)");
    else if (opts.org) await c.query("SELECT set_config('app.org_id',$1,TRUE)", [opts.org]);
    const r = await c.query(sql);
    return r.rows as T[];
  } finally {
    await c.query("ROLLBACK");
  }
}

async function main() {
  const c = new Client({ connectionString: url });
  await c.connect();

  try {
    // ── 1. The role itself ───────────────────────────────────────────────────
    console.log("1. The connection's own identity");
    const who = (await q<{ u: string; bypass: boolean | null; su: boolean | null }>(c,
      `select current_user as u,
              (select rolbypassrls from pg_roles where rolname = current_user) as bypass,
              (select rolsuper     from pg_roles where rolname = current_user) as su`))[0];
    console.log(`   connected as: ${who.u}`);
    ok("the role does NOT have BYPASSRLS", who.bypass === false, `rolbypassrls=${who.bypass}`);
    ok("the role is NOT a superuser", who.su === false, `rolsuper=${who.su}`);
    ok("it is not postgres", who.u !== "postgres", who.u);

    // Everything below is meaningless if the above failed — say so rather than
    // printing a page of green that proves nothing.
    if (who.bypass !== false || who.su !== false) {
      console.log("\n  ⚠ STOPPING: this role steps around RLS, so no isolation test below is meaningful.");
      console.log(`\nFAILURES — ${pass} passed, ${fail} failed`);
      process.exit(1);
    }

    // ── 2. Two orgs, and the fence between them ──────────────────────────────
    console.log("\n2. Isolation, measured against real rows");
    const orgs = await q<{ id: string; name: string }>(c,
      `select id, name from "Org" order by "createdAt" limit 2`);

    if (orgs.length < 2) {
      console.log("   (needs two orgs on this database to compare — skipped)");
    } else {
      const [a, b] = orgs;
      console.log(`   org A: ${a.name}\n   org B: ${b.name}`);

      const countFor = async (org: string) =>
        Number((await q<{ n: string }>(c, `select count(*) as n from "Loan"`, { org }))[0].n);
      const distinctFor = async (org: string) =>
        Number((await q<{ n: string }>(c, `select count(distinct "orgId") as n from "Loan"`, { org }))[0].n);

      const [nA, nB] = [await countFor(a.id), await countFor(b.id)];
      const [dA, dB] = [await distinctFor(a.id), await distinctFor(b.id)];

      ok("org A sees exactly one org's loans", dA <= 1, `${nA} loans across ${dA} org(s)`);
      ok("org B sees exactly one org's loans", dB <= 1, `${nB} loans across ${dB} org(s)`);

      const total = Number((await q<{ n: string }>(c, `select count(*) as n from "Loan"`, { platform: true }))[0].n);
      ok("neither org sees the whole book", nA < total || nB < total || total === 0,
        `A=${nA} B=${nB} total=${total}`);

      // The one that actually matters: a statement with NO where clause at all.
      // RLS, not the application's SQL, has to be the fence.
      const noFilter = await q<{ orgid: string }>(c,
        `select distinct "orgId" as orgid from "Borrower"`, { org: a.id });
      ok("a query with no org filter still sees one tenant",
        noFilter.length <= 1 && (noFilter.length === 0 || noFilter[0].orgid === a.id),
        `${noFilter.length} distinct org(s)`);

      // And through the views Riri reads.
      const viaView = await q<{ n: string }>(c, `select count(distinct org_id) as n from riri_loans`, { org: a.id })
        .catch(() => [{ n: "err" }]);
      ok("the riri_loans view is scoped too", viaView[0].n === "0" || viaView[0].n === "1",
        `${viaView[0].n} distinct org(s)`);
    }

    // ── 3. Fail closed with no context ───────────────────────────────────────
    console.log("\n3. With no tenant context, it returns nothing — not everything");
    const bare = Number((await q<{ n: string }>(c, `select count(*) as n from "Loan"`))[0].n);
    ok("an unstamped query sees zero rows", bare === 0, `${bare} rows`);

    // ── 4. The deliberate exceptions still work ──────────────────────────────
    console.log("\n4. The tables rls.sql deliberately leaves open still work");
    for (const t of ["Org", "RateLimit"]) {
      const r = await q<{ n: string }>(c, `select count(*) as n from "${t}"`).catch(() => null);
      ok(`${t} is readable without a tenant context`, r !== null, r ? `${r[0].n} rows` : "not readable");
    }

    // ── 5. The role is not more powerful than it needs to be ─────────────────
    console.log("\n5. Least privilege");
    const canTruncate = await c.query(`select has_table_privilege(current_user, '"Loan"', 'TRUNCATE') as v`);
    ok("cannot TRUNCATE the loan book", canTruncate.rows[0].v === false);
    const canCreate = await c.query(`select has_schema_privilege(current_user, 'public', 'CREATE') as v`);
    ok("cannot create objects in public", canCreate.rows[0].v === false);
  } finally {
    await c.end();
  }

  console.log(`\n${fail === 0 ? "ALL GREEN — safe to move DATABASE_URL onto this role" : "FAILURES — do NOT cut over"} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
