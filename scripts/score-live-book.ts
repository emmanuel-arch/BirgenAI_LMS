// ─────────────────────────────────────────────────────────────────────────────
// SCORE A BRIDGED LENDER'S WHOLE BOOK.
//
//   npm run score:live -- --org micromart --entity 3005 --dry
//   npm run score:live -- --org micromart --entity 3005 --write
//
// DRY IS THE DEFAULT AND IS NOT A FORMALITY. The sweep's output moves credit
// limits, so the first thing it prints is how far our engine lands from the
// lender's OWN stored RiskScore across the sample it just scored. Those two
// numbers agreeing to within a point or so is the evidence that we are reading
// their schedule the way their procedure does; if that distribution ever widens,
// something about the book changed and nobody should be writing anything.
//
// WHAT --write ACTUALLY WRITES, and where:
//
//   · ScoreSnapshot, one row per customer, keyed on `serviceSuiteBorrowerId` —
//     OUR opinion of THEIR customer. This is not a mirror of the book (see the
//     header of lib/lms/score-live-book.ts): it is the derived number, filed so
//     the console can read a score for somebody nobody has opened yet.
//   · Borrower.behaviouralScore / riskBand / lastScoredAt, but ONLY for people
//     who already have a row here — i.e. customers an officer has resolved. No
//     row is created. Scoring the book must never become a back door that
//     mirrors it.
//
// NOTHING IS WRITTEN TO THE LENDER'S DATABASE. Their RiskScore is theirs, written
// by their own job, and a console that quietly overwrites the number a lender's
// limits were set from has stopped being a console.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { ORGS, isOrgConfigured, type OrgSlug } from "../src/lib/enterprise/connections";
import { scoreBookPage, type ScoredCustomer } from "../src/lib/lms/score-live-book";
import { mergeCreditPolicy, type CreditPolicy } from "../src/lib/decision/policy";
import { readCreditPolicy } from "../src/lib/config/store";
import { prisma } from "../src/lib/prisma";
import { runAsPlatform } from "../src/lib/db/context";

const arg = (name: string, fallback?: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
};
const flag = (name: string) => process.argv.includes(`--${name}`);

const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
const pad = (s: string | number, n: number) => String(s).padStart(n);

async function main() {
  const slug = (arg("org", "micromart") as OrgSlug)!;
  const entityId = Number(arg("entity", "3005"));
  const write = flag("write");
  const limit = Number(arg("limit", "0")) || 0; // 0 = the whole book
  const pageSize = Number(arg("page", "250"));

  const org = ORGS[slug];
  if (!org) throw new Error(`Unknown org "${slug}". One of: ${Object.keys(ORGS).join(", ")}`);
  if (!isOrgConfigured(org)) throw new Error(`${org.name} has no configured connection (${org.connEnv}).`);

  // The lender's own credit policy where they have published one — the sweep must
  // score them by the rules their console shows, not by ours.
  const row = await runAsPlatform(() => prisma.org.findFirst({ where: { slug }, select: { id: true, name: true } }));
  let policy: CreditPolicy = mergeCreditPolicy(undefined);
  let policyLabel = "platform defaults";
  if (row) {
    const doc = await readCreditPolicy(row.id).catch(() => null);
    if (doc) {
      policy = doc.value;
      policyLabel = doc.isDefault ? "platform defaults" : `${slug} v${doc.version}`;
    }
  }

  console.log(`\n\x1b[1m${org.name}\x1b[0m · entity ${entityId} · policy: ${policyLabel}`);
  console.log(`mode: ${write ? "\x1b[33mWRITE\x1b[0m" : "\x1b[2mdry run\x1b[0m"}${limit ? ` · first ${limit} borrowers` : ""}\n`);

  const t0 = Date.now();
  let after = 0;
  let read = 0;
  const all: ScoredCustomer[] = [];
  const bands = new Map<string, number>();
  let deltaSum = 0, deltaN = 0, within5 = 0;
  let graduate = 0, demote = 0, hold = 0;
  let upliftTotal = 0;

  for (;;) {
    const page = await scoreBookPage(org, entityId, policy, { afterId: after, pageSize });
    read += page.read;
    for (const s of page.scored) {
      all.push(s);
      bands.set(s.band ?? "—", (bands.get(s.band ?? "—") ?? 0) + 1);
      if (s.theirScore != null) {
        const d = s.score - s.theirScore;
        deltaSum += Math.abs(d); deltaN++;
        if (Math.abs(d) <= 5) within5++;
      }
      if (s.move === "graduate") { graduate++; upliftTotal += (s.newLimit ?? 0) - s.currentLimit; }
      else if (s.move === "demote") demote++;
      else hold++;
    }
    process.stdout.write(`\r  read ${pad(read, 6)} · scored ${pad(all.length, 6)} · ${((Date.now() - t0) / 1000).toFixed(1)}s   `);
    if (page.nextAfterId == null) break;
    after = page.nextAfterId;
    if (limit && read >= limit) break;
  }
  const secs = (Date.now() - t0) / 1000;
  console.log(`\r  read ${pad(read, 6)} · scored ${pad(all.length, 6)} · ${secs.toFixed(1)}s          \n`);

  // ── Does our engine agree with theirs? ─────────────────────────────────────
  console.log("\x1b[1mAgreement with the lender's own RiskScore\x1b[0m");
  if (deltaN === 0) {
    console.log("  no stored scores to compare against on this book\n");
  } else {
    console.log(`  compared      ${pad(deltaN, 6)}`);
    console.log(`  mean |Δ|      ${pad((deltaSum / deltaN).toFixed(2), 6)}  points`);
    console.log(`  within 5      ${pad(within5, 6)}  (${((within5 / deltaN) * 100).toFixed(1)}%)\n`);
  }

  // The bands are the POLICY'S, not the platform's. Micromart publish their own
  // three (Minor / Moderate / Major) and a lender on the defaults gets the four
  // (Prime / Strong / Watch / High) — so the report reads its keys off the policy
  // in force rather than naming a vocabulary this lender may not use. Printing a
  // fixed list is how this table came back empty the first time it was run.
  console.log("\x1b[1mBands\x1b[0m \x1b[2m(this lender's own categories)\x1b[0m");
  const order = [...policy.behaviour.categories.map((c) => c.key), "—"];
  for (const key of order) {
    const n = bands.get(key);
    if (!n) continue;
    const label = policy.behaviour.categories.find((c) => c.key === key)?.label ?? key;
    console.log(`  ${label.padEnd(12)} ${pad(n, 6)}  ${((n / Math.max(all.length, 1)) * 100).toFixed(1)}%`);
  }
  console.log(`\n\x1b[1mWhat the ladder would do\x1b[0m`);
  console.log(`  graduate  ${pad(graduate, 6)}   total uplift ${kes(upliftTotal)}`);
  console.log(`  demote    ${pad(demote, 6)}`);
  console.log(`  hold      ${pad(hold, 6)}\n`);

  if (!write) {
    console.log("\x1b[2mDry run — nothing written. Re-run with --write to persist.\x1b[0m\n");
    return;
  }
  if (!row) throw new Error(`No Org row with slug "${slug}" — cannot file scores against a lender we do not have.`);

  // ── Persist ────────────────────────────────────────────────────────────────
  //
  // WHICH OF THESE PEOPLE DO WE ACTUALLY HAVE A ROW FOR? Almost none of them: a
  // bridged lender's customers are read through and only get a Borrower row when
  // an officer opens one. Resolving that ONCE, into a map, is the difference
  // between a handful of queries and seventeen thousand — the first version of
  // this loop ran an updateMany for every scored customer, including the ~99%
  // that could not possibly match anything.
  //
  // It also lets the snapshots carry `borrowerId` where we know it, so a resolved
  // customer's score history on Customer 360 includes the sweep instead of
  // starting from whenever somebody first opened their page.
  const resolved = await runAsPlatform(() =>
    prisma.borrower.findMany({
      where: { orgId: row.id, serviceSuiteBorrowerId: { not: null } },
      select: { id: true, serviceSuiteBorrowerId: true },
    }),
  );
  const localId = new Map(resolved.map((r) => [r.serviceSuiteBorrowerId!, r.id]));

  // Chunked, because a single createMany of seventeen thousand rows is one
  // statement that either works or loses the whole sweep.
  const CHUNK = 500;
  let snapshots = 0;
  for (let i = 0; i < all.length; i += CHUNK) {
    const slice = all.slice(i, i + CHUNK);
    const res = await runAsPlatform(() =>
      prisma.scoreSnapshot.createMany({
        data: slice.map((s) => ({
          orgId: row.id,
          serviceSuiteBorrowerId: s.serviceSuiteBorrowerId,
          borrowerId: localId.get(s.serviceSuiteBorrowerId) ?? null,
          modelKind: "behavioral-v1",
          modelVersion: policyLabel,
          score: Math.round(s.score),
          riskBand: s.band,
          reasons: [s.reason],
          features: {
            clearedLoans: s.clearedLoans,
            installmentsUsed: s.installmentsUsed,
            currentLimit: s.currentLimit,
            ladderMove: s.move,
            newLimit: s.newLimit,
            lenderScore: s.theirScore,
            lenderCategory: s.theirCategory,
          },
          capturedBy: "batch",
        })),
      }),
    );
    snapshots += res.count;
    process.stdout.write(`\r  snapshots ${pad(snapshots, 6)}   `);
  }
  console.log(`\r  snapshots ${pad(snapshots, 6)}   written\n`);

  // Resolved customers get the score on their own row too, so every existing
  // screen picks it up with no changes. Only the ones in the map are touched —
  // and no row is ever CREATED here: scoring the book must not become a back door
  // that mirrors it.
  let updated = 0;
  const now = new Date();
  for (const s of all) {
    const local = localId.get(s.serviceSuiteBorrowerId);
    if (!local) continue;
    await runAsPlatform(() =>
      prisma.borrower.update({
        where: { id: local },
        data: { behaviouralScore: s.score, riskBand: s.band, lastScoredAt: now },
      }),
    ).then(() => { updated++; }).catch(() => { /* a row deleted mid-sweep is not a failure */ });
  }
  console.log(`  borrower rows updated ${pad(updated, 6)}  \x1b[2mof ${resolved.length} resolved here — none created\x1b[0m\n`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error("\n", e); process.exit(1); });
