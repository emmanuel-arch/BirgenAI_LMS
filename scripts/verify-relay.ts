// ─────────────────────────────────────────────────────────────────────────────
// PROVE THE RELAY — the check to run before the demo, and in front of the room
// if anyone asks how the cloud is reading a database with no public address.
//
//   npm run test:relay
//
// It signs a real request, sends it to whatever SERVICESUITE_RELAY_URL points
// at, and reports what came back. It is deliberately an OUTSIDE-IN test: it uses
// the same client code Vercel uses and no privileged shortcut, so a pass here
// means the deployment will work, not that this workstation can reach SQL.
//
// The four failures it separates, because they look identical on a dashboard and
// have completely different fixes:
//
//   · relay not running            → start it on the tailnet host
//   · relay running, not published → `tailscale funnel 8787`
//   · published, secret mismatch   → 401; the two halves disagree
//   · reachable, SQL unreachable   → the relay host has fallen off the tailnet
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { getOrg, isOrgConfigured } from "../src/lib/enterprise/connections";
import { relayEnabled, relayUrl, relayQuery, RelayError } from "../src/lib/enterprise/relay";
import { P } from "../src/lib/collectbox/client";

const B = (s: string) => `\x1b[1m${s}\x1b[0m`;
const OK = (s: string) => `\x1b[32m${s}\x1b[0m`;
const BAD = (s: string) => `\x1b[31m${s}\x1b[0m`;
const DIM = (s: string) => `\x1b[2m${s}\x1b[0m`;

let failed = 0;
const pass = (m: string, d?: string) => console.log(`  ${OK("✓")} ${m}${d ? `\n     ${DIM(d)}` : ""}`);
const fail = (m: string, d?: string) => {
  failed++;
  console.log(`  ${BAD("✗")} ${m}${d ? `\n     ${DIM(d)}` : ""}`);
};

async function main() {
  console.log(`\n${B("SQL RELAY — end to end")}`);

  // ── 1 · Configuration ──────────────────────────────────────────────────────
  console.log(`\n${B("1 · Configuration")}`);
  if (!relayEnabled()) {
    fail(
      "SERVICESUITE_RELAY_URL / SERVICESUITE_RELAY_SECRET are not both set",
      "Without them this deployment dials SQL directly — correct on the tailnet, impossible on Vercel.",
    );
    console.log(`\n${BAD("RELAY NOT CONFIGURED")} — nothing further to test.\n`);
    process.exit(1);
  }
  pass(`relay configured`, relayUrl());

  const org = getOrg("micromart");
  if (!org) {
    fail(`no org "micromart"`);
    process.exit(1);
  }
  console.log(
    `  ${DIM(`this host ${isOrgConfigured(org) ? "also has" : "does NOT have"} a direct connection string — irrelevant to the test below`)}`,
  );

  // ── 2 · Liveness ───────────────────────────────────────────────────────────
  console.log(`\n${B("2 · Is the relay answering?")}`);
  try {
    const res = await fetch(`${relayUrl()}/health`, { cache: "no-store", signal: AbortSignal.timeout(10000) });
    const j = (await res.json()) as { ok?: boolean; since?: string; served?: number; refused?: number };
    if (j.ok) pass(`relay is up`, `since ${j.since} · ${j.served} served · ${j.refused} refused`);
    else fail(`relay answered but not ok`, JSON.stringify(j));
  } catch (e) {
    fail(
      `no answer from ${relayUrl()}/health`,
      `${e instanceof Error ? e.message : e}\n     Start it on the tailnet host (npm run relay), then publish it (tailscale funnel 8787).`,
    );
    console.log(`\n${BAD("RELAY UNREACHABLE")}\n`);
    process.exit(1);
  }

  // ── 3 · A signed read ──────────────────────────────────────────────────────
  console.log(`\n${B("3 · A signed read, through the relay")}`);
  try {
    const t0 = Date.now();
    const { rows, elapsedMs } = await relayQuery(
      "read",
      org,
      `SELECT COUNT(*) AS tracked,
              -- TOP 1 … DESC, matching the app. MAX() has no index to use here
              -- and scans 1.16M rows; this check should measure the relay, not
              -- a query shape the suite no longer issues.
              (SELECT TOP 1 DatePaid FROM CollectBox.dbo.PayedAmount ORDER BY DatePaid DESC) AS lastPayment,
              (SELECT COUNT(*) FROM Serviceconnect.dbo.Loans WHERE EntityId = @entityId AND LoanCleared = 0) AS openFintech
         FROM CollectBox.dbo.CollectionTracker`,
      [P.int("entityId", 3005)],
      { timeoutMs: 20000, maxRows: 1 },
    );
    const r = rows[0] as { tracked?: number; lastPayment?: unknown; openFintech?: number } | undefined;
    if (!r) {
      fail("the read returned no rows");
    } else {
      pass(
        `read ${Number(r.tracked).toLocaleString("en-KE")} tracked loans through the relay`,
        `SQL ${elapsedMs}ms · round trip ${Date.now() - t0}ms · entity 3005 open: ${Number(r.openFintech).toLocaleString("en-KE")}`,
      );

      // The codec's real job: a DATETIME must arrive as a Date, not a string that
      // merely looks like one. If this regresses, every "last payment 4m ago"
      // stamp in the suite renders a plausible lie instead of failing.
      if (r.lastPayment instanceof Date) {
        pass(`DATETIME survived the wire as a Date`, `last payment ${r.lastPayment.toISOString()}`);
      } else {
        fail(
          `DATETIME came back as ${typeof r.lastPayment}, not a Date`,
          `The value codec in lib/enterprise/relay.ts is not tagging dates. Every relative timestamp in the suite is now wrong rather than absent.`,
        );
      }
    }
  } catch (e) {
    if (e instanceof RelayError) fail(`the relay refused or failed the read`, e.message);
    else fail(`unexpected error`, e instanceof Error ? e.message : String(e));
  }

  // ── 4 · The write posture ──────────────────────────────────────────────────
  console.log(`\n${B("4 · Write posture")}`);
  try {
    await relayQuery("exec", org, `UPDATE CollectBox.dbo.CollectionTracker SET LoanId = LoanId WHERE 1 = 0`, [], {
      timeoutMs: 8000,
    });
    console.log(
      `  ${BAD("!")} this relay is ARMED FOR WRITES` +
        `\n     ${DIM("Correct only if you meant it. For the demo, unset SQL_RELAY_ALLOW_WRITES and restart the relay.")}`,
    );
  } catch (e) {
    if (e instanceof RelayError && /read-only/i.test(e.message)) {
      pass(`writes refused at the relay`, `Micromart's database cannot be written to from the cloud, whatever the app believes.`);
    } else {
      fail(`writes failed for the wrong reason`, e instanceof Error ? e.message : String(e));
    }
  }

  console.log(
    failed === 0
      ? `\n${OK(B("ALL CHECKS PASSED"))} — the deployment can read Micromart.\n`
      : `\n${BAD(B(`${failed} CHECK${failed > 1 ? "S" : ""} FAILED`))}\n`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
