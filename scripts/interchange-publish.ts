// ─────────────────────────────────────────────────────────────────────────────
// THE NODE'S INGEST CYCLE — publish a member's book to the Interchange.
//
//   npx tsx scripts/interchange-publish.ts [memberCode|--all] [--dry] [--limit N]
//
// This is the job that makes the exposure engine true. Everything else in
// Sprint 3 — the fan-out, the Bloom screening, the 400ms budget — was built and
// proven against four hundred invented borrowers. This reads the real books.
//
// ── THE ORDER MATTERS, AND IT IS THE WHOLE SECURITY ARGUMENT ─────────────────
//
//   1. READ     one entity's live book from Serviceconnect, over Tailscale.
//               National IDs exist in memory here and only here.
//   2. TOKENISE blind locally → Registry evaluates blinded points → finalize
//               locally. The Registry cannot learn an identifier; we cannot
//               learn the ecosystem key.
//   3. DROP     the identifiers. From this line on the process holds tokens.
//   4. PUBLISH  tokens plus four aggregates, in chunks, under a new generation.
//   5. COMMIT   one statement makes the generation visible and rebuilds the
//               member's Bloom filter.
//
// A crash anywhere before step 5 leaves the previously published book serving
// unchanged. There is no window in which a member appears to hold nothing.
//
// ── RUN IT ON A SCHEDULE ─────────────────────────────────────────────────────
// Exposure is a real-time product built on a periodic ingest, so freshness is a
// property the answer has to carry: /api/node/exposure returns `as_of`, and the
// customer-facing screen shows it. Every fifteen minutes matches the filter
// cadence in the blueprint; hourly is defensible for a book that disburses a few
// times a day. Silently letting it go stale is not.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { ORGS, isOrgConfigured } from "../src/lib/enterprise/connections";
import { readBook, bookSummary } from "../src/lib/interchange/book";
import { NODE_MEMBERS, nodeMember, type NodeMember } from "../src/lib/interchange/members";
import {
  deriveTokens,
  memberIdentity,
  publishHoldings,
  interchangeConfigured,
  hasMemberIdentity,
  type HoldingWire,
} from "../src/lib/interchange/registry";

const B = (s: string) => `\x1b[1m${s}\x1b[0m`;
const D = (s: string) => `\x1b[2m${s}\x1b[0m`;
const G = (s: string) => `\x1b[32m${s}\x1b[0m`;
const R = (s: string) => `\x1b[31m${s}\x1b[0m`;
const Y = (s: string) => `\x1b[33m${s}\x1b[0m`;

/** Rows per publish request. The Registry refuses more than 5,000. */
const CHUNK = 2_000;

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const LIMIT = (() => {
  const i = args.indexOf("--limit");
  return i >= 0 ? Number(args[i + 1]) : 0;
})();

async function publishOne(m: NodeMember): Promise<boolean> {
  console.log(`\n${B(m.name)} ${D(`${m.code} · entity ${m.entityId} · ${m.sourceHost}`)}`);

  const org = ORGS[m.org];
  if (!isOrgConfigured(org)) {
    console.log(`  ${R("skipped")} — ${org.connEnv} is not set, so this book cannot be read from here.`);
    return false;
  }
  if (!DRY && !hasMemberIdentity(m.code)) {
    console.log(`  ${R("skipped")} — no signing key for ${m.code} in INTERCHANGE_NODE_KEYS.`);
    return false;
  }

  // ── 1. Read ───────────────────────────────────────────────────────────────
  const book = await readBook(org, m.entityId);
  let rows = book.rows;
  if (LIMIT > 0) rows = rows.slice(0, LIMIT);

  const owed = rows.reduce((a, r) => a + r.outstandingKes, 0);
  console.log(
    `  read      ${G(String(rows.length))} borrowers with open money ${D(`· ${book.elapsedMs}ms · KES ${(owed / 1e6).toFixed(1)}M outstanding`)}`,
  );
  if (book.skippedNoIdentifier > 0) {
    // Worth printing every time: these borrowers are invisible to the ecosystem,
    // and the number is a data-quality signal the lender can act on.
    console.log(
      `  ${Y("skipped")}   ${book.skippedNoIdentifier} with no usable national ID ${D("— they cannot be tokenised, so their exposure is invisible to the network")}`,
    );
  }
  if (rows.length === 0) {
    console.log(`  ${Y("nothing to publish")} — no open exposure in this entity.`);
    return false;
  }

  const buckets = rows.reduce<Record<string, number>>((a, r) => {
    a[r.worstBucket] = (a[r.worstBucket] ?? 0) + 1;
    return a;
  }, {});
  console.log(`  buckets   ${D(Object.entries(buckets).map(([k, v]) => `${k} ${v}`).join(" · "))}`);

  if (DRY) {
    console.log(`  ${Y("dry run")} — nothing tokenised, nothing published.`);
    return false;
  }

  // ── 2. Tokenise ───────────────────────────────────────────────────────────
  const who = memberIdentity(m.code);
  const t0 = Date.now();
  const tokens = await deriveTokens(
    who,
    "national_id",
    rows.map((r) => r.identifier),
    "ingest",
    (done, total) => {
      if (done < total) process.stdout.write(`\r  tokenise  ${done}/${total}`);
    },
  );
  process.stdout.write("\r");
  console.log(`  tokenise  ${G(String(tokens.length))} subject tokens ${D(`· ${Date.now() - t0}ms via the blinded OPRF exchange`)}`);

  // ── 3. Drop the identifiers ───────────────────────────────────────────────
  // Paired by index, then the raw column is never referenced again. Anything
  // below this line that wanted an identifier would be a bug worth failing on.
  const wire: HoldingWire[] = rows.map((r, i) => ({
    subject_token: tokens[i],
    active_loans: r.activeLoans,
    outstanding_kes: r.outstandingKes,
    worst_bucket: r.worstBucket,
    newest_disbursed_at: r.newestDisbursedAt ? r.newestDisbursedAt.toISOString() : null,
  }));

  // ── 4/5. Publish and commit ───────────────────────────────────────────────
  // The generation is time-based so two nodes for the same member can never
  // choose the same one, and a later run always sorts after an earlier one.
  const generation = Math.floor(Date.now() / 1000);
  const summary = await bookSummary(org, m.entityId);

  const t1 = Date.now();
  for (let i = 0; i < wire.length; i += CHUNK) {
    const chunk = wire.slice(i, i + CHUNK);
    const last = i + CHUNK >= wire.length;
    const res = await publishHoldings(who, {
      generation,
      holdings: chunk,
      commit: last,
      summary: {
        borrowers: summary.borrowers,
        loans: summary.loans,
        lastLoanAt: summary.lastLoanAt ? summary.lastLoanAt.toISOString() : null,
      },
    });

    if (res.status !== 200) {
      console.log(
        `  ${R("publish failed")} (${res.status}) ${String(res.json.message ?? res.json.error ?? "")}`,
      );
      return false;
    }
    if (last) {
      const f = res.json.filter as { item_count: number; m: number; k: number; fill: number } | undefined;
      console.log(
        `  publish   ${G(String(res.json.holdings ?? wire.length))} holdings committed as generation ${generation}` +
          ` ${D(`· ${Date.now() - t1}ms · dropped ${res.json.dropped_previous ?? 0} from the previous generation`)}`,
      );
      if (f) {
        console.log(
          `  filter    ${f.item_count} tokens in ${(f.m / 8 / 1024).toFixed(1)}KB, k=${f.k} ${D(`· ${(f.fill * 100).toFixed(1)}% full`)}`,
        );
      }
    } else {
      process.stdout.write(`\r  publish   ${Math.min(i + CHUNK, wire.length)}/${wire.length}`);
    }
  }

  return true;
}

async function main() {
  if (!interchangeConfigured()) {
    console.error(
      "\nINTERCHANGE_URL and INTERCHANGE_NODE_KEYS must both be set. Without them this\n" +
        "deployment has no Registry to publish to and no identity to publish as.\n",
    );
    process.exit(2);
  }

  const target = args.find((a) => !a.startsWith("--"));
  const members =
    !target || target === "--all"
      ? NODE_MEMBERS
      : [nodeMember(target)].filter((m): m is NodeMember => m !== null);

  if (members.length === 0) {
    console.error(`\nUnknown member "${target}". Known: ${NODE_MEMBERS.map((m) => m.code).join(", ")}\n`);
    process.exit(2);
  }

  console.log(`\n${B("Interchange ingest")} ${D(`→ ${process.env.INTERCHANGE_URL}`)}`);

  let published = 0;
  for (const m of members) {
    try {
      if (await publishOne(m)) published++;
    } catch (e) {
      console.log(`  ${R("failed")} — ${(e as Error).message.split("\n")[0]}`);
    }
  }

  console.log(`\n${published} of ${members.length} books published.\n`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
