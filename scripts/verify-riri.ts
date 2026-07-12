// Tests for the Riri semantic layer — the metric catalogue, the SQL guard, and the
// guarded read path.
//
//   npm run test:riri        (needs the database; no app server)
//
// The claims under test, each one a way this could lie or leak:
//
//   THE GUARD — a statement that writes, that reaches a base table, that names the
//     catalogue, that smuggles a second statement, or that calls a function we never
//     sanctioned, is refused. Not because we recognise the attack, but because it is
//     not on the allowlist.
//   THE READ PATH — and if the guard were WRONG, the database still refuses: a write
//     run through it fails on the read-only transaction, and a query that names no
//     org still cannot see another org's rows. That is the layered claim, and it is
//     the one worth testing, because it is the one that survives our own bugs.
//   THE VIEWS — `security_invoker` is on every one of them. Without it the views
//     execute as `postgres` (BYPASSRLS) and every lender reads every other lender's
//     book. Tested against a real second org, not by reading the DDL back.
//   THE CATALOGUE — the compiled SQL agrees with the Prisma aggregates the console
//     has always used. If the semantic layer and the dashboard disagree about OLB,
//     one of them is lying to a lender.
//   THE PLANNER — a question routes to the metric a person would expect, with the
//     period, the slice and the ranking they asked for.
//   THE OVERLAY — a lender may teach Riri their words and set a target; they may not
//     redefine the arithmetic or invent a metric.
import "dotenv/config";
import { prisma, rawPrisma } from "@/lib/prisma";
import { runAsPlatform, runWithOrg } from "@/lib/db/context";
import { validateReadSql, READ_SURFACE } from "@/lib/riri/guard";
import { runReadQuery, displaySql, MAX_ROWS } from "@/lib/riri/readpath";
import { METRICS, metricSpec, compile, bind, isMetricId, type MetricSpec } from "@/lib/riri/catalog";
import { plan, detectRange, previousRange, ALL_TIME } from "@/lib/riri/planner";
import { metricsFor, validateOverlay, saveOverlay, invalidateMetrics, targetVerdict } from "@/lib/riri/definitions";
import { analyze } from "@/lib/riri/analyst";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); }
};
const section = (s: string) => console.log(`\n${s}`);

const D = (daysAgo: number) => new Date(Date.now() - daysAgo * 86400000);
const nearly = (a: number, b: number, tol = 0.51) => Math.abs(a - b) <= tol;

async function main() {
  // ── 1. The guard: pure, no database ────────────────────────────────────────
  section("1. The guard refuses everything that is not a read of the published surface");

  const refused = (sql: string) => !validateReadSql(sql).ok;
  const allowed = (sql: string) => validateReadSql(sql).ok;

  ok("a plain aggregate over a view is allowed", allowed("select sum(balance) as value from riri_loans l where l.org_id = $1"));
  ok("a join across two views is allowed", allowed("select p.name, sum(l.balance) from riri_loans l join riri_products p on p.id = l.product_id group by p.name"));
  ok("a CTE over views is allowed", allowed("with x as (select balance from riri_loans) select sum(balance) from x"));

  ok("UPDATE is refused", refused("update riri_loans set balance = 0"));
  ok("DELETE is refused", refused("delete from riri_loans"));
  ok("INSERT is refused", refused("insert into riri_loans values (1)"));
  ok("DROP is refused", refused("drop view riri_loans"));
  ok("SELECT … INTO (a CREATE TABLE in disguise) is refused", refused("select * into evil from riri_loans"));
  ok("a second statement is refused", refused("select 1 from riri_loans; drop table \"Loan\""));
  ok("a comment is refused", refused("select sum(balance) from riri_loans -- and then"));

  // The load-bearing one: every Prisma base table needs a quoted identifier.
  ok("a raw base table is refused (quoted identifier)", refused(`select * from "Loan"`));
  ok("the staff password hash is unreachable", refused(`select "passwordHash" from "StaffUser"`));
  ok("the vault is unreachable", refused(`select * from "OrgIntegration"`));
  ok("an unquoted base table is not a relation and is refused", refused("select * from loan"));
  ok("an unpublished table is refused by name", refused("select * from otp_challenge"));

  ok("the pg catalogue is refused", refused("select * from pg_tables"));
  ok("information_schema is refused", refused("select * from information_schema.columns"));
  ok("current_setting (the tenant fence itself) is refused", refused("select current_setting('app.org_id') from riri_loans"));
  ok("pg_sleep is refused", refused("select pg_sleep(10) from riri_loans"));
  ok("an unsanctioned function is refused", refused("select md5(name) from riri_borrowers"));
  ok("a comma join is refused (it hides a table from the scan)", refused("select 1 from riri_loans, riri_borrowers"));
  ok("a query that reads no table is refused", refused("select 1"));
  ok("the refusal explains itself in a lender's words", /read-only|never change it/i.test((validateReadSql("update riri_loans set balance = 0") as { reason: string }).reason));

  // ── 2. Fixtures: two orgs, so isolation can be tested for real ──────────────
  section("2. Fixtures");
  const stamp = Date.now();
  const orgA = await runAsPlatform(() => prisma.org.create({
    data: { slug: `riritest-a-${stamp}`, name: "Riri Test A", plan: "PREMIUM", mode: "NATIVE", status: "ACTIVE" },
  }));
  const orgB = await runAsPlatform(() => prisma.org.create({
    data: { slug: `riritest-b-${stamp}`, name: "Riri Test B", plan: "PREMIUM", mode: "NATIVE", status: "ACTIVE" },
  }));
  console.log(`  org A=${orgA.slug}  org B=${orgB.slug}`);

  const A = <T>(fn: () => Promise<T>) => runWithOrg(orgA.id, fn);
  const B = <T>(fn: () => Promise<T>) => runWithOrg(orgB.id, fn);

  try {
    // Org A: two products, three active loans (one 40 days in arrears), one cleared.
    const fixtures = await A(async () => {
      const p1 = await prisma.product.create({
        data: { orgId: orgA.id, name: "Boda Loan", minPrincipal: 1000, maxPrincipal: 100000, interestRate: 10, repaymentPeriod: 4 },
      });
      const p2 = await prisma.product.create({
        data: { orgId: orgA.id, name: "Shop Stock", minPrincipal: 1000, maxPrincipal: 200000, interestRate: 12, repaymentPeriod: 8 },
      });
      const b1 = await prisma.borrower.create({ data: { orgId: orgA.id, phone: `2547${stamp % 100000000}`.slice(0, 12), firstName: "Amina", otherName: "W", kycStatus: "VERIFIED" } });
      const b2 = await prisma.borrower.create({ data: { orgId: orgA.id, phone: `2548${stamp % 100000000}`.slice(0, 12), firstName: "Brian", otherName: "K" } });

      // Loan 1 — healthy, active, 10,000 outstanding on Boda.
      const l1 = await prisma.loan.create({
        data: { orgId: orgA.id, borrowerId: b1.id, productId: p1.id, principal: 10000, interest: 1000, loanAmount: 11000, balance: 10000, status: "ACTIVE", disbursedAt: D(20) },
      });
      await prisma.installment.create({ data: { orgId: orgA.id, loanId: l1.id, seq: 1, dueDate: D(-7), amountDue: 5500, principalDue: 5000, interestDue: 500, status: "UPCOMING" } });

      // Loan 2 — 40 days in arrears, 25,000 outstanding on Shop Stock. PAR-30 material.
      const l2 = await prisma.loan.create({
        data: { orgId: orgA.id, borrowerId: b2.id, productId: p2.id, principal: 25000, interest: 3000, loanAmount: 28000, balance: 25000, status: "ACTIVE", disbursedAt: D(90) },
      });
      await prisma.installment.create({ data: { orgId: orgA.id, loanId: l2.id, seq: 1, dueDate: D(40), amountDue: 7000, principalDue: 6250, interestDue: 750, amountPaid: 1000, status: "OVERDUE" } });

      // Loan 3 — 5 days late only: in arrears, but NOT past 30 days. The boundary case.
      const l3 = await prisma.loan.create({
        data: { orgId: orgA.id, borrowerId: b1.id, productId: p1.id, principal: 5000, interest: 500, loanAmount: 5500, balance: 5000, status: "ACTIVE", disbursedAt: D(30) },
      });
      await prisma.installment.create({ data: { orgId: orgA.id, loanId: l3.id, seq: 1, dueDate: D(5), amountDue: 2750, principalDue: 2500, interestDue: 250, status: "OVERDUE" } });

      // A cleared loan — must NOT count toward the outstanding book.
      await prisma.loan.create({
        data: { orgId: orgA.id, borrowerId: b1.id, productId: p1.id, principal: 3000, interest: 300, loanAmount: 3300, balance: 0, status: "CLEARED", clearedAt: D(2) },
      });

      // Money: a confirmed disbursement, a paybill receipt and a successful STK.
      await prisma.disbursement.create({ data: { orgId: orgA.id, loanId: l1.id, amount: 10000, phone: "254700000001", state: "CONFIRMED" } });
      await prisma.c2BReceipt.create({ data: { orgId: orgA.id, transId: `T${stamp}`, amount: 1000, allocatedLoanId: l2.id } });
      await prisma.paymentIntent.create({ data: { orgId: orgA.id, loanId: l1.id, phone: "254700000001", amount: 500, state: "SUCCESS", mpesaReceipt: `S${stamp}` } });

      // Applications: 2 approved, 1 declined, 1 waiting; outcomes 1 repaid 1 defaulted.
      await prisma.loanApplication.create({ data: { orgId: orgA.id, borrowerId: b1.id, productId: p1.id, amountRequested: 10000, status: "APPROVED", outcome: "REPAID" } });
      await prisma.loanApplication.create({ data: { orgId: orgA.id, borrowerId: b2.id, productId: p2.id, amountRequested: 25000, status: "DISBURSED", outcome: "DEFAULTED" } });
      await prisma.loanApplication.create({ data: { orgId: orgA.id, borrowerId: b2.id, productId: p1.id, amountRequested: 5000, status: "DECLINED" } });
      await prisma.loanApplication.create({ data: { orgId: orgA.id, borrowerId: b1.id, productId: p1.id, amountRequested: 7000, status: "OFFICER_REVIEW" } });

      return { p1, p2, b1, b2, l1, l2, l3 };
    });

    // Org B: one big loan. If it EVER shows up in an org-A answer, the fence is broken.
    await B(async () => {
      const p = await prisma.product.create({
        data: { orgId: orgB.id, name: "Rival Product", minPrincipal: 1000, maxPrincipal: 999999, interestRate: 9, repaymentPeriod: 4 },
      });
      const b = await prisma.borrower.create({ data: { orgId: orgB.id, phone: `2549${stamp % 100000000}`.slice(0, 12), firstName: "Rival", otherName: "Lender" } });
      await prisma.loan.create({
        data: { orgId: orgB.id, borrowerId: b.id, productId: p.id, principal: 999000, interest: 1000, loanAmount: 1000000, balance: 999000, status: "ACTIVE" },
      });
    });
    ok("fixtures created", true, "A: 3 active loans (10k + 25k@40dpd + 5k@5dpd), 1 cleared; B: one 999k loan");

    // ── 3. security_invoker: the views are tenant-scoped for real ─────────────
    section("3. The views are RLS-scoped (security_invoker), proven against a second org");

    const viewCount = await runReadQuery(orgA.id, "select count(*) as value, coalesce(sum(balance),0) as n from riri_loans");
    ok("org A reads its own loans through the view", viewCount.ok && Number(viewCount.rows[0].value) === 4, viewCount.ok ? `${viewCount.rows[0].value} loans` : "");
    ok(
      "org B's 999,000 loan is INVISIBLE to org A through the view",
      viewCount.ok && Number(viewCount.rows[0].n) === 40000,
      viewCount.ok ? `sum(balance)=${viewCount.rows[0].n} (A's 10k+25k+5k+0, not B's 999k)` : "",
    );

    const bView = await runReadQuery(orgB.id, "select coalesce(sum(balance),0) as value from riri_loans");
    ok("org B sees its own book and only its own", bView.ok && Number(bView.rows[0].value) === 999000);

    // A statement that names NO org at all — RLS, not the WHERE clause, is the fence.
    const noOrgFilter = await runReadQuery(orgA.id, "select count(*) as value from riri_borrowers");
    ok("a query with no org filter still sees only its own tenant", noOrgFilter.ok && Number(noOrgFilter.rows[0].value) === 2, "2 borrowers, not 3");

    // The PII the views deliberately do not publish.
    const pii = await runReadQuery(orgA.id, "select phone_masked from riri_borrowers limit 1");
    ok("the borrower phone is masked in the read surface", pii.ok && /^\*\*\*/.test(String(pii.rows[0].phone_masked)), pii.ok ? String(pii.rows[0].phone_masked) : "");
    const idLeak = await runReadQuery(orgA.id, "select national_id from riri_borrowers");
    ok("the national ID is not published at all", !idLeak.ok);

    // ── 4. The read path holds even if the guard were wrong ───────────────────
    section("4. The read path is physically read-only, whatever the guard thinks");

    // The property itself, asked of Postgres directly. This is the layer that has to
    // hold on the day guard.ts has a bug, so it is worth proving rather than assuming.
    const ro = await runReadQuery(orgA.id, "select current_setting('transaction_read_only') as value");
    ok("the transaction really is READ ONLY", ro.ok && String(ro.rows[0].value) === "on", ro.ok ? `transaction_read_only=${ro.rows[0].value}` : "");

    // And a write handed straight to the path — no guard in the loop — never runs.
    // (It cannot even parse: the row cap wraps every statement in a subquery, and an
    // UPDATE is not a table expression. Two independent reasons it fails, which is
    // the point — but the read-only transaction above is the one that would still
    // hold if the wrapper were ever removed.)
    const writeAttempt = await runReadQuery(orgA.id, `update "Loan" set balance = 0 where "orgId" = $1`, [orgA.id]);
    ok("an UPDATE handed straight to the read path never runs", !writeAttempt.ok);

    const stillThere = await A(() => prisma.loan.findUnique({ where: { id: fixtures.l2.id }, select: { balance: true } }));
    ok("the book was NOT modified by the attempted write", Number(stillThere?.balance) === 25000, `balance=${stillThere?.balance}`);

    // The attack that WOULD parse inside a subquery wrapper if Postgres allowed it —
    // a data-modifying CTE. The guard rejects it on the keyword long before that.
    ok("a data-modifying CTE is refused by the guard", refused(`with x as (update "Loan" set balance = 0 returning id) select * from riri_loans`));

    const capped = await runReadQuery(orgA.id, "select id from riri_installments", [], { maxRows: 2 });
    ok("the row cap is enforced by the path, not by the caller", capped.ok && capped.rows.length <= 2 && capped.truncated);
    ok("MAX_ROWS keeps a chat panel from becoming a data export", MAX_ROWS <= 500, `${MAX_ROWS}`);

    // ── 5. The catalogue agrees with the console's own arithmetic ─────────────
    section("5. The compiled SQL agrees with the Prisma aggregates the console has always used");

    const run = async (spec: MetricSpec, opts = {}) => {
      const q = compile(spec, opts);
      const { sql, params } = bind(q, orgA.id);
      const guard = validateReadSql(sql);
      if (!guard.ok) return { value: NaN, n: NaN, sql, guarded: false as const, reason: guard.reason };
      const r = await runReadQuery(orgA.id, sql, params);
      if (!r.ok) return { value: NaN, n: NaN, sql, guarded: true as const, reason: r.error };
      return { value: Number(r.rows[0]?.value ?? 0), n: Number(r.rows[0]?.n ?? 0), sql, guarded: true as const, reason: "" };
    };

    // Every metric in the catalogue must survive its OWN guard. If we ever compile a
    // statement our guard rejects, the lender sees a refusal, not a number.
    let allGuarded = true;
    for (const spec of METRICS) {
      const { sql } = bind(compile(spec), orgA.id);
      if (!validateReadSql(sql).ok) { allGuarded = false; console.log(`        ${spec.id}: ${(validateReadSql(sql) as { reason: string }).reason}`); }
    }
    ok(`all ${METRICS.length} catalogue metrics pass our own guard`, allGuarded);

    const olbPrisma = await A(() => prisma.loan.aggregate({ where: { orgId: orgA.id, status: "ACTIVE" }, _sum: { balance: true }, _count: true }));
    const olb = await run(metricSpec("olb")!);
    ok("OLB matches the Prisma aggregate", nearly(olb.value, Number(olbPrisma._sum.balance)), `catalogue ${olb.value} vs prisma ${olbPrisma._sum.balance}`);
    ok("OLB counts active loans only (the cleared loan is excluded)", olb.n === olbPrisma._count && olb.n === 3);

    const par30Cutoff = new Date(Date.now() - 30 * 86400000);
    const parPrisma = await A(() => prisma.loan.aggregate({
      where: { orgId: orgA.id, status: "ACTIVE", installments: { some: { status: "OVERDUE", dueDate: { lt: par30Cutoff } } } },
      _sum: { balance: true }, _count: true,
    }));
    const atRisk = await run(metricSpec("at_risk")!);
    ok("value at risk matches the Prisma aggregate", nearly(atRisk.value, Number(parPrisma._sum.balance)), `catalogue ${atRisk.value} vs prisma ${parPrisma._sum.balance}`);
    ok("the 5-days-late loan is NOT in PAR 30 (only the 40-day one)", atRisk.n === 1 && nearly(atRisk.value, 25000), `${atRisk.n} loan, ${atRisk.value}`);

    const par30 = await run(metricSpec("par30")!);
    ok("PAR 30 is at-risk over the book, as a percentage", nearly(par30.value, (25000 / 40000) * 100, 0.1), `${par30.value.toFixed(1)}% (25k of 40k)`);

    const collected = await run(metricSpec("collected")!, { range: ALL_TIME });
    ok("collected unions paybill AND STK into one number", nearly(collected.value, 1500), `${collected.value} = 1000 paybill + 500 STK`);

    const disbursed = await run(metricSpec("disbursed")!, { range: ALL_TIME });
    ok("disbursed counts confirmed disbursements", nearly(disbursed.value, 10000), `${disbursed.value}`);

    const approval = await run(metricSpec("approval_rate")!, { range: ALL_TIME });
    ok("approval rate ignores the undecided application", nearly(approval.value, (2 / 3) * 100, 0.1), `${approval.value.toFixed(1)}% (2 approved of 3 decided)`);

    const defaults = await run(metricSpec("default_rate")!, { range: ALL_TIME });
    ok("default rate counts only realised outcomes", nearly(defaults.value, 50, 0.1), `${defaults.value.toFixed(1)}% (1 default of 2 finished)`);

    const waiting = await run(metricSpec("apps_waiting")!, { range: ALL_TIME });
    ok("applications waiting counts the undecided queue", waiting.value === 1, `${waiting.value}`);

    const arrears = await run(metricSpec("arrears")!, { range: ALL_TIME });
    ok("arrears is the unpaid part of overdue installments, not the whole loan", nearly(arrears.value, 8750), `${arrears.value} = (7000-1000) + 2750`);

    // ── 6. Slices: the capability the old handlers never had ──────────────────
    section("6. Slices and rankings");

    const byProduct = compile(metricSpec("olb")!, { dimension: "product" });
    const bp = bind(byProduct, orgA.id);
    const bpRes = await runReadQuery(orgA.id, bp.sql, bp.params);
    ok("OLB by product returns one row per product, biggest first", bpRes.ok && bpRes.rows.length === 2 && String(bpRes.rows[0].label) === "Shop Stock", bpRes.ok ? bpRes.rows.map((r) => `${r.label}=${r.value}`).join(", ") : "");

    const byBorrower = compile(metricSpec("olb")!, { dimension: "borrower", limit: 1 });
    const bb = bind(byBorrower, orgA.id);
    const bbRes = await runReadQuery(orgA.id, bb.sql, bb.params);
    ok("top-1 borrower by balance is the 25k one", bbRes.ok && bbRes.rows.length === 1 && Number(bbRes.rows[0].value) === 25000, bbRes.ok ? String(bbRes.rows[0].label) : "");

    // ── 7. The planner ────────────────────────────────────────────────────────
    section("7. The planner routes a question the way a person would read it");

    const metrics = await metricsFor(orgA.id);
    const route = (q: string) => plan(q, metrics);

    const p1 = route("what's my outstanding loan book?");
    ok("'outstanding loan book' → olb", p1.kind === "metric" && p1.metricId === "olb");

    const p2 = route("what's my PAR 30 by product?");
    ok("'PAR 30 by product' → par30, sliced by product", p2.kind === "metric" && p2.metricId === "par30" && p2.dimension === "product");

    const p3 = route("how much did we collect last month?");
    ok("'collect last month' → collected, last month", p3.kind === "metric" && p3.metricId === "collected" && p3.range.label === "last month");

    const p4 = route("top 5 borrowers by balance");
    ok("'top 5 borrowers' → olb sliced by borrower, limit 5", p4.kind === "metric" && p4.metricId === "olb" && p4.dimension === "borrower" && p4.limit === 5);

    const p5 = route("how many applications are waiting?");
    ok("the qualifier beats the noun: 'applications waiting' → apps_waiting", p5.kind === "metric" && p5.metricId === "apps_waiting");

    const p6 = route("show me disbursements over time");
    ok("'over time' → a trend series", p6.kind === "metric" && p6.metricId === "disbursed" && p6.series);

    const p7 = route("who is about to default?");
    ok("'who is about to default' → the risk model, not SQL", p7.kind === "engine");

    const p8 = route("hi");
    ok("a greeting → help", p8.kind === "help");

    const p9 = route("what is my default rate?");
    ok("'default rate' beats the bare word 'rate'", p9.kind === "metric" && p9.metricId === "default_rate");

    ok("a stock metric ignores a period (an OLB 'last month' is not a sentence)", route("outstanding book last month").kind === "metric" && (route("outstanding book last month") as { range: { label: string } }).range.label === "all-time");

    // THE "DON'T INVENT" RULE. "Average shoe size of my borrowers" once matched the
    // `borrowers` metric on one word and was answered with a confident number.
    ok("an average of something Riri does not average is NOT answered", route("what is the average shoe size of my borrowers?").kind === "unknown");
    ok("a median is never faked (we compute none)", route("what's the median loan size?").kind === "unknown");
    ok("…but a real average still routes", (route("what is my average loan size?") as { metricId?: string }).metricId === "avg_loan_size");
    ok("an unknown question is 'unknown', never the help menu", route("how many hippos are in my branch?").kind === "unknown");

    // A population's default period is ALL of them, not "since the 1st".
    const popRange = route("how many borrowers do I have?") as { range: { label: string } };
    ok("'how many borrowers' means all of them, not this month's new ones", popRange.range.label === "all-time");
    const flowRange = route("how much did we collect?") as { range: { label: string } };
    ok("…while a money flow with no period given means this month", flowRange.range.label === "this month");

    // Periods, and the like-for-like comparison.
    const thisMonth = detectRange("this month", ALL_TIME);
    const prev = previousRange(thisMonth)!;
    ok("'this month' compares against the same span of the month before", prev !== null && prev.label === "the month before" && prev.end !== null);
    ok("all-time has no comparable predecessor", previousRange(ALL_TIME) === null);

    // ── 8. The overlay: their words, our arithmetic ───────────────────────────
    section("8. The overlay — a lender may teach Riri their words, not redefine the measure");

    ok("a metric outside the code catalogue does not exist", !isMetricId("profit_margin"));
    ok("…and it cannot be created by an overlay", !validateOverlay("profit_margin", { label: "Profit" }).ok);

    await saveOverlay(orgA.id, "par30", { label: "Delinquency", synonyms: ["bad book", "delinquency"], target: 5, targetDirection: "below" });
    invalidateMetrics(orgA.id);
    const after = await metricsFor(orgA.id);
    const parM = after.find((m) => m.id === "par30")!;
    ok("the lender's label is used", parM.displayLabel === "Delinquency");
    ok("the lender's words route to the metric", (plan("how is my bad book?", after) as { metricId?: string }).metricId === "par30");
    ok("a target is stored with its direction", parM.target === 5 && parM.targetDirection === "below");
    ok("62.5% PAR against a ≤5% target reads as bad", targetVerdict(parM, 62.5) === "bad");
    ok("3% PAR against a ≤5% target reads as good", targetVerdict(parM, 3) === "good");

    // The arithmetic is NOT theirs: the SQL is still the catalogue's.
    const parAfter = await run(metricSpec("par30")!);
    ok("renaming PAR did not change what PAR counts", nearly(parAfter.value, par30.value, 0.01), `${parAfter.value.toFixed(1)}%`);

    await saveOverlay(orgA.id, "avg_score", { enabled: false });
    invalidateMetrics(orgA.id);
    const hidden = await metricsFor(orgA.id);
    ok("a hidden metric is never routed to", (plan("what is my average credit score?", hidden) as { kind: string; metricId?: string }).metricId !== "avg_score");

    // ── 9. End to end, through the analyst ───────────────────────────────────
    section("9. The analyst answers with real numbers and shows the SQL");

    const a1 = await analyze(orgA.id, "what's my outstanding loan book?");
    ok("the analyst answers OLB from the live book", a1.ok && a1.answer.includes("40,000"), a1.answer.slice(0, 80));
    ok("…and shows the SQL that produced it", Boolean(a1.sql) && a1.sql!.includes("riri_loans"));
    ok("…tagged as a governed metric", a1.route === "catalog" && a1.metricId === "olb");
    ok("…with the SQL shown scoped to this org, no placeholders left", a1.sql!.includes(orgA.id) && !a1.sql!.includes("$1"));

    const a2 = await analyze(orgA.id, "PAR 30 by product");
    ok("a sliced question returns a table", a2.ok && Boolean(a2.table) && a2.table!.rows.length === 2);

    const a3 = await analyze(orgA.id, "what is the airspeed velocity of an unladen swallow?");
    ok("a question outside the catalogue is declined, never guessed", a3.ok && /can't answer that one from my metric catalogue/i.test(a3.answer));
    ok("…and no SQL was invented for it", !a3.sql);

    ok("displaySql inlines params for the lender without ever executing them", displaySql("select $1, $2", ["a'b", 3]) === "select 'a''b', 3");
    ok("displaySql does not corrupt $10 when inlining $1", displaySql("select $1, $10", ["x", 1, 1, 1, 1, 1, 1, 1, 1, "y"]) === "select 'x', 'y'");

    ok("the read surface is exactly the published views", READ_SURFACE.length === 14 && READ_SURFACE.every((v) => v.startsWith("riri_")));
  } finally {
    await runAsPlatform(async () => {
      for (const id of [orgA.id, orgB.id]) {
        const w = { orgId: id };
        await rawPrisma.$executeRawUnsafe(`SELECT set_config('app.platform','on',TRUE)`);
        await prisma.ririQueryLog.deleteMany({ where: w });
        await prisma.metricDefinition.deleteMany({ where: w });
        await prisma.c2BReceipt.deleteMany({ where: w });
        await prisma.paymentIntent.deleteMany({ where: w });
        await prisma.disbursement.deleteMany({ where: w });
        await prisma.installment.deleteMany({ where: w });
        await prisma.loanApplication.deleteMany({ where: w });
        await prisma.loan.deleteMany({ where: w });
        await prisma.borrower.deleteMany({ where: w });
        await prisma.product.deleteMany({ where: w });
        await prisma.usageEvent.deleteMany({ where: w });
        await prisma.auditLog.deleteMany({ where: w });
        await prisma.orgSubscription.deleteMany({ where: w });
        await prisma.org.delete({ where: { id } });
      }
    });
    console.log("\nfixtures cleaned up");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
