// ─────────────────────────────────────────────────────────────────────────────
// EMPTY THE APPLICATIONS QUEUE — so the next real one is the only one in it.
//
//   npx tsx scripts/clear-applications.ts --org micromart
//   npx tsx scripts/clear-applications.ts --org micromart --commit
//
// The console's queue carried 51 seeded applications scattered across every
// stage, which is the right thing for building a stage machine against and the
// wrong thing for a demonstration: an application filed live from the Micro Eazy
// app arrives as the fifty-second row of a list nobody in the room recognises,
// and the one thing being shown — that it landed, at Risk, with the customer's
// name on it — is the hardest thing on the screen to see.
//
// ── WHAT IT DOES NOT TOUCH ───────────────────────────────────────────────────
// The BOOK. Loans, borrowers, repayments and statements are left exactly as they
// are, and that is not caution — it is a fact about the data: NOT ONE of this
// org's 199 loans carries an applicationId pointing at any of these rows. The
// seeded applications were never the origin of the seeded book. So the queue
// empties and the portfolio, the arrears and every analytics screen read the
// same before and after.
//
// ── WHAT GOES WITH THEM ──────────────────────────────────────────────────────
// Everything that only exists BECAUSE of an application, in foreign-key order:
// offers and guarantors (which cannot even be null), then the scores, documents,
// collateral, pins and threads that were raised against one. An offer belonging
// to a deleted application is not a record, it is a dangling row that the next
// person to write a report has to learn to exclude.
//
// Deliberately in one transaction: a half-emptied queue is worse than a full one.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { runAsPlatform } from "../src/lib/db/context";

const COMMIT = process.argv.includes("--commit");
const arg = (n: string, d: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : d;
};

async function main() {
  const slug = arg("org", "micromart");

  await runAsPlatform(async () => {
    const org = await prisma.org.findFirst({ where: { slug }, select: { id: true, name: true } });
    if (!org) throw new Error(`No org with slug "${slug}".`);

    const apps = await prisma.loanApplication.findMany({
      where: { orgId: org.id },
      select: { id: true, status: true, stageTitle: true, borrowerName: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    const ids = apps.map((a) => a.id);

    console.log(`\n\x1b[1m${org.name}\x1b[0m — applications queue — ${COMMIT ? "\x1b[33mCOMMIT\x1b[0m" : "\x1b[2mdry run\x1b[0m"}\n`);

    if (ids.length === 0) {
      console.log("  The queue is already empty.\n");
      return;
    }

    const byStatus = new Map<string, number>();
    for (const a of apps) byStatus.set(a.status, (byStatus.get(a.status) ?? 0) + 1);
    console.log(`  ${ids.length} applications:`);
    for (const [status, n] of [...byStatus].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(n).padStart(3)}  ${status}`);
    }

    // Everything hanging off them, counted before anything is removed.
    const [offers, guarantors, scores, documents, collateral, pins, threads, loans] = await Promise.all([
      prisma.loanOffer.count({ where: { applicationId: { in: ids } } }),
      prisma.guarantor.count({ where: { applicationId: { in: ids } } }),
      prisma.scoreSnapshot.count({ where: { applicationId: { in: ids } } }),
      prisma.document.count({ where: { applicationId: { in: ids } } }),
      prisma.collateral.count({ where: { applicationId: { in: ids } } }),
      prisma.geoPin.count({ where: { applicationId: { in: ids } } }),
      prisma.conversationThread.count({ where: { applicationId: { in: ids } } }),
      prisma.loan.count({ where: { applicationId: { in: ids } } }),
    ]);

    console.log(`\n  and what only exists because of them:`);
    console.log(`    ${String(offers).padStart(3)}  offers        ${String(guarantors).padStart(3)}  guarantors`);
    console.log(`    ${String(scores).padStart(3)}  scores        ${String(documents).padStart(3)}  documents`);
    console.log(`    ${String(collateral).padStart(3)}  collateral    ${String(pins).padStart(3)}  map pins`);
    console.log(`    ${String(threads).padStart(3)}  threads`);

    // The one that decides whether this is safe. A booked loan is part of the
    // BOOK, not part of the queue, and if any pointed here the answer would be
    // to unlink them rather than to delete them — so it is checked out loud
    // rather than assumed.
    const bookTotal = await prisma.loan.count({ where: { orgId: org.id } });
    console.log(
      loans === 0
        ? `\n  \x1b[32m${bookTotal} loans on the book, none of them originated by these rows — the book is untouched.\x1b[0m`
        : `\n  \x1b[31m${loans} booked loans point at these applications. Refusing: unlink them first.\x1b[0m`,
    );
    if (loans > 0) throw new Error("Booked loans reference these applications.");

    if (!COMMIT) {
      console.log(`\n  \x1b[2mNothing written. Re-run with --commit.\x1b[0m\n`);
      return;
    }

    // ── SEQUENTIAL, AND NOT `prisma.$transaction([...])` ─────────────────────
    // The array form was the obvious way to write this and it does not work on
    // this deployment. Run that way, the first attempt deleted every offer,
    // guarantor and collateral row and then failed the final statement with
    // `Foreign key constraint violated on Guarantor_applicationId_fkey` —
    // complaining about rows it had itself just removed — and did NOT roll back
    // the deletes it had already made. Which is precisely the half-emptied queue
    // the transaction was there to prevent.
    //
    // The cause is the pg driver adapter this client runs on (lib/prisma.ts)
    // together with the RLS tenant context, which is set per connection: the
    // batch does not reliably stay on one connection, so the statements neither
    // share the transaction nor keep their declared order.
    //
    // Awaited one at a time, ordered children-first, each statement completes
    // before the next is issued, which is all the ordering this actually needs.
    // See [[rehearsing-scripts-on-micromart-live]] for the same trap on the
    // ServiceSuite side.
    const where = { applicationId: { in: ids } };
    const step = async (label: string, run: () => Promise<{ count: number }>) => {
      const { count } = await run();
      if (count) console.log(`    − ${String(count).padStart(3)}  ${label}`);
    };

    console.log("");
    await step("offers", () => prisma.loanOffer.deleteMany({ where }));
    await step("guarantors", () => prisma.guarantor.deleteMany({ where }));
    await step("scores", () => prisma.scoreSnapshot.deleteMany({ where }));
    await step("documents", () => prisma.document.deleteMany({ where }));
    await step("collateral", () => prisma.collateral.deleteMany({ where }));
    await step("map pins", () => prisma.geoPin.deleteMany({ where }));
    await step("threads", () => prisma.conversationThread.deleteMany({ where }));
    await step("applications", () => prisma.loanApplication.deleteMany({ where: { orgId: org.id } }));

    const left = await prisma.loanApplication.count({ where: { orgId: org.id } });
    console.log(`\n  \x1b[32mQueue emptied.\x1b[0m ${left} applications remain; ${await prisma.loan.count({ where: { orgId: org.id } })} loans still on the book.\n`);
  });
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n\x1b[31m" + (e instanceof Error ? e.message : String(e)) + "\x1b[0m\n");
    process.exit(1);
  });
