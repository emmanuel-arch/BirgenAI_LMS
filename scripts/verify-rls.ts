import "dotenv/config";
import { prisma, orgTx } from "@/lib/prisma";
import { runWithOrg, runAsPlatform } from "@/lib/db/context";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); }
};
async function throws(fn: () => Promise<unknown>): Promise<string | null> {
  try { await fn(); return null; } catch (e) { return e instanceof Error ? e.message.split("\n")[0] : String(e); }
}

async function main() {
  // ── Fixtures: two isolated tenants ────────────────────────────────────────
  const { a, b } = await runAsPlatform(async () => {
    const a = await prisma.org.create({ data: { slug: `rlstest-a-${Date.now()}`, name: "RLS Test A" } });
    const b = await prisma.org.create({ data: { slug: `rlstest-b-${Date.now()}`, name: "RLS Test B" } });
    await prisma.borrower.create({ data: { orgId: a.id, phone: "254700000001", firstName: "AliceA" } });
    await prisma.borrower.create({ data: { orgId: a.id, phone: "254700000002", firstName: "AaronA" } });
    await prisma.borrower.create({ data: { orgId: b.id, phone: "254700000003", firstName: "BobB" } });
    return { a, b };
  });
  const bBorrower = await runAsPlatform(() => prisma.borrower.findFirstOrThrow({ where: { orgId: b.id } }));
  console.log(`fixtures: org A=${a.slug} (2 borrowers), org B=${b.slug} (1 borrower)\n`);

  try {
    console.log("1. No tenant context is fail-CLOSED (never fail-open)");
    const noCtx = await throws(() => prisma.borrower.findMany());
    ok("unscoped query throws", !!noCtx && noCtx.includes("[rls]"), noCtx ?? "did not throw");

    console.log("\n2. The forgotten `where: { orgId }` — the breach RLS exists to stop");
    await runWithOrg(a.id, async () => {
      const all = await prisma.borrower.findMany(); // NO where clause at all
      ok("findMany() with no filter returns ONLY org A", all.length === 2 && all.every((x) => x.orgId === a.id), `${all.length} rows`);
      const count = await prisma.borrower.count();
      ok("count() with no filter counts ONLY org A", count === 2, `${count}`);
    });

    console.log("\n3. Explicitly asking for another tenant's rows");
    await runWithOrg(a.id, async () => {
      const foreign = await prisma.borrower.findMany({ where: { orgId: b.id } });
      ok("findMany({ orgId: B }) from A returns nothing", foreign.length === 0, `${foreign.length} rows`);
      const byId = await prisma.borrower.findUnique({ where: { id: bBorrower.id } });
      ok("findUnique(B's primary key) from A returns null", byId === null);
    });

    console.log("\n4. Writes cannot cross the fence");
    await runWithOrg(a.id, async () => {
      const created = await throws(() => prisma.borrower.create({ data: { orgId: b.id, phone: "254700000009", firstName: "Injected" } }));
      ok("create() stamped with B's orgId is rejected", !!created && /row-level security/i.test(created), created ?? "did not throw");

      // The row is invisible to A, so the UPDATE matches nothing. Prisma may raise
      // P2025 or simply affect zero rows — the security property is that B's data
      // is untouched either way, so that is what we assert.
      const updated = await throws(() => prisma.borrower.update({ where: { id: bBorrower.id }, data: { firstName: "Hacked" } }));
      console.log(`        (update outcome: ${updated ?? "no error, 0 rows affected"})`);
      const updMany = await prisma.borrower.updateMany({ where: { orgId: b.id }, data: { firstName: "Hacked" } });
      ok("updateMany({ orgId: B }) from A updates nothing", updMany.count === 0, `${updMany.count} updated`);

      const deleted = await prisma.borrower.deleteMany({ where: { orgId: b.id } });
      ok("deleteMany({ orgId: B }) from A deletes nothing", deleted.count === 0, `${deleted.count} deleted`);
    });
    const bAfter = await runAsPlatform(() => prisma.borrower.findUnique({ where: { id: bBorrower.id } }));
    ok("B's borrower row survived A's attacks", !!bAfter, bAfter ? "present" : "DELETED");
    ok("B's borrower data was NOT modified by A", bAfter?.firstName === "BobB", `firstName=${bAfter?.firstName}`);

    console.log("\n5. Transactions carry the fence too (orgTx)");
    await runWithOrg(a.id, async () => {
      const rows = await orgTx((tx) => tx.borrower.findMany());
      ok("orgTx tx.findMany() sees only org A", rows.length === 2 && rows.every((x) => x.orgId === a.id), `${rows.length} rows`);
    });

    console.log("\n6. Platform scope still crosses tenants (the one legitimate escape)");
    await runAsPlatform(async () => {
      const all = await prisma.borrower.findMany({ where: { orgId: { in: [a.id, b.id] } } });
      ok("platform sees both orgs", all.length === 3, `${all.length} rows`);
    });

    console.log("\n7. Nested scope: entering org B inside a request cannot leak A");
    await runWithOrg(b.id, async () => {
      const rows = await prisma.borrower.findMany();
      ok("org B sees only its own borrower", rows.length === 1 && rows[0].orgId === b.id, `${rows.length} rows`);
    });
  } finally {
    await runAsPlatform(async () => {
      await prisma.borrower.deleteMany({ where: { orgId: { in: [a.id, b.id] } } });
      await prisma.org.deleteMany({ where: { id: { in: [a.id, b.id] } } });
    });
    console.log("\nfixtures cleaned up");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await prisma.$disconnect();
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
