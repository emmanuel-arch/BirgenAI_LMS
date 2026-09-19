// ─────────────────────────────────────────────────────────────────────────────
// WHERE THE HOME SCREEN'S SECONDS GO.
//
//   npx tsx scripts/time-home.ts --phone 254758517032
//   npx tsx scripts/time-home.ts --phone … --repeat 3    # warm vs cold
//
// The customer app's Home screen is one request — POST /api/portal/home — and
// that request is an aggregate: our own Postgres, then a chain of reads across
// the bridge into the lender's ServiceSuite. When it takes ten seconds, the
// aggregate is the only thing anybody can see, and "the app is slow" is not a
// finding anyone can act on.
//
// So this runs the same reads, in the same order, with a stopwatch on each, and
// prints them worst-first. Every call here is READ-ONLY; nothing is written and
// nothing is posted to the lender's system. See [[never-disrupt-micromarts-
// shared-server]].
//
// `--repeat` matters more than it looks. The MSSQL pool is cached per process
// (lib/enterprise/mssql), so the FIRST read of a run pays for a TLS handshake
// across the tailnet and every read after it does not. On Vercel that first cost
// is paid again on every cold lambda — so the gap between pass 1 and pass 2 is
// the size of the cold-start problem, stated in milliseconds.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { runAsPlatform } from "../src/lib/db/context";
import { getOrg } from "../src/lib/enterprise/connections";
import { resolveOrg } from "../src/lib/tenancy";
import { findBookBorrower, readBookPosition } from "../src/lib/portal/micromart-book";
import { micromartSavings, micromartScore } from "../src/lib/portal/micromart-standing";

const arg = (n: string, d: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : d;
};

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bar = (ms: number, max: number) => "█".repeat(Math.max(1, Math.round((ms / Math.max(max, 1)) * 34)));
const tone = (ms: number) => (ms > 2000 ? "\x1b[31m" : ms > 800 ? "\x1b[33m" : "\x1b[32m");

type Lap = { label: string; ms: number; note?: string };

async function time<T>(laps: Lap[], label: string, run: () => Promise<T>): Promise<T> {
  const t = Date.now();
  try {
    const out = await run();
    laps.push({ label, ms: Date.now() - t, note: out == null ? "null" : undefined });
    return out;
  } catch (e) {
    laps.push({ label, ms: Date.now() - t, note: `THREW: ${e instanceof Error ? e.message : String(e)}` });
    throw e;
  }
}

async function pass(slug: string, phone: string, nationalId: string, n: number) {
  const laps: Lap[] = [];
  const started = Date.now();
  const registry = getOrg(slug === "micromart" ? "micromart-fintech" : slug);
  if (!registry) throw new Error(`No connection-registry entry for "${slug}".`);

  await runAsPlatform(async () => {
    // resolveOrg is what the route itself calls, so the entity id resolves the
    // same way here as it does in production — override, then row, then registry
    // default (lib/tenancy). Timing a different resolution would be timing a
    // different request.
    const org = await time(laps, "resolve org (postgres)", () => resolveOrg(slug));
    if (!org) throw new Error(`No org "${slug}".`);

    // 1 ── our row
    const borrower = await time(laps, "borrower row (postgres)", () =>
      prisma.borrower.findFirst({
        where: { orgId: org.id, phone: { endsWith: phone.slice(-9) }, ...(nationalId ? { nationalId } : {}) },
        select: { id: true, firstName: true, nationalId: true, serviceSuiteBorrowerId: true },
        orderBy: { createdAt: "desc" },
      }),
    );

    // 2 ── the five side reads, as the route fires them: one batch
    await time(laps, "5 side reads (postgres, parallel)", () =>
      Promise.all([
        borrower ? prisma.conversationThread.aggregate({ where: { orgId: org.id, borrowerId: borrower.id }, _sum: { unreadForBorrower: true } }) : null,
        borrower ? prisma.loanApplication.findFirst({ where: { orgId: org.id, borrowerId: borrower.id, status: { notIn: ["DISBURSED", "WITHDRAWN"] } }, orderBy: { createdAt: "desc" }, select: { id: true } }) : null,
        borrower ? prisma.conversationThread.findMany({ where: { orgId: org.id, borrowerId: borrower.id }, orderBy: { lastAt: "desc" }, take: 2, select: { id: true } }) : [],
        borrower ? prisma.standingOrder.findFirst({ where: { orgId: org.id, borrowerId: borrower.id, status: { in: ["ACTIVE", "PENDING"] } }, select: { status: true } }) : null,
      ]),
    );

    const entity = org.entityId;
    let ssId = borrower?.serviceSuiteBorrowerId ?? null;

    // 3 ── across the bridge
    let position = ssId ? await time(laps, `readBookPosition (mssql, id ${ssId})`, () => readBookPosition(registry, entity, ssId!)) : null;
    if (!position) {
      const who = await time(laps, "findBookBorrower (mssql, by phone)", () =>
        findBookBorrower(registry, entity, phone, borrower?.nationalId ?? null),
      );
      ssId = who.kind === "found" ? who.borrowerId : null;
      if (ssId) position = await time(laps, `readBookPosition (mssql, id ${ssId})`, () => readBookPosition(registry, entity, ssId!));
    }

    if (position) {
      await time(laps, "savings + score (mssql, parallel)", () =>
        Promise.all([micromartSavings(registry, position!.borrowerId), micromartScore(registry, entity, position!.borrowerId)]),
      );
    }
  });

  const total = Date.now() - started;
  const max = Math.max(...laps.map((l) => l.ms));
  console.log(`\n\x1b[1mpass ${n}\x1b[0m — total ${tone(total)}${total} ms\x1b[0m`);
  for (const l of [...laps].sort((a, b) => b.ms - a.ms)) {
    console.log(`  ${tone(l.ms)}${String(l.ms).padStart(6)} ms\x1b[0m  ${bar(l.ms, max).padEnd(34)} ${l.label}${l.note ? dim(`  ${l.note}`) : ""}`);
  }
  return total;
}

async function main() {
  const slug = arg("org", "micromart");
  const phone = arg("phone", "254758517032").replace(/\D/g, "");
  const nationalId = arg("id", "");
  const repeat = Math.max(1, Number(arg("repeat", "2")));

  console.log(`\n\x1b[1mHome aggregate — ${slug} · ${phone}\x1b[0m`);
  console.log(dim(`read-only; ${repeat} pass(es). Pass 1 pays the MSSQL handshake, later passes reuse the pool.`));

  const totals: number[] = [];
  for (let n = 1; n <= repeat; n++) totals.push(await pass(slug, phone, nationalId, n));

  if (totals.length > 1) {
    const cold = totals[0];
    const warm = Math.min(...totals.slice(1));
    console.log(
      `\n  cold ${cold} ms · warm ${warm} ms · \x1b[1m${cold - warm} ms\x1b[0m of the first load is connection setup` +
        dim(" — paid again on every cold serverless invocation"),
    );
  }
  console.log();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n\x1b[31m" + (e instanceof Error ? e.message : String(e)) + "\x1b[0m\n");
    process.exit(1);
  });
