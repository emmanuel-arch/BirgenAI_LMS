// ─────────────────────────────────────────────────────────────────────────────
// THE SQL RELAY SERVER — the one process that sits on both networks.
//
//   npx tsx scripts/sql-relay.ts               # listens on 127.0.0.1:8787
//   npm run relay                              # same
//
// It must run on a machine that is ON THE TAILNET (this workstation, or the
// always-on `lms` node). It holds the real connection pool to 100.72.35.56 and
// answers signed query requests from the Vercel deployment, which cannot reach
// that address itself. See src/lib/enterprise/relay.ts for why.
//
// ── EXPOSING IT ──────────────────────────────────────────────────────────────
// The relay binds to LOOPBACK on purpose. It is published by a tunnel, never by
// opening a port on a router:
//
//     tailscale funnel 8787
//
// That gives a public HTTPS URL on the tailnet's own *.ts.net domain with a real
// certificate, no DNS work and no inbound firewall rule. The URL is ugly and
// that is fine — no human ever sees it; it goes in SERVICESUITE_RELAY_URL on
// Vercel and nowhere else. Cloudflare Tunnel works identically if preferred.
//
// ── WHY THIS IS NOT AN OPEN SQL PROXY ────────────────────────────────────────
// It is on the public internet and it executes SQL, so the threat model is the
// whole design rather than a footnote:
//
//   1. EVERY request carries an HMAC-SHA256 over `${timestamp}.${exact body}`,
//      verified in constant time. No signature, no execution — there is no
//      unauthenticated code path that touches a database.
//   2. The signature covers the BODY, so a captured request cannot be edited
//      into a different query. It covers the TIMESTAMP, so it cannot be replayed
//      after two minutes.
//   3. WRITES ARE REFUSED unless SQL_RELAY_ALLOW_WRITES=true is set on this
//      process specifically. The demo posture is read-only, and that posture is
//      now enforced on the machine that owns the socket rather than trusted to
//      the caller. Arming Vercel alone cannot write to Micromart.
//   4. The org slug is resolved HERE against the local environment. The caller
//      names "micromart"; it never supplies a server, a database or a
//      credential, so a compromised caller cannot redirect the relay at a host
//      of its choosing.
//   5. Nothing that could carry a credential is ever logged — the log line is
//      slug, kind, row count and duration.
//
// A leaked SERVICESUITE_RELAY_SECRET is the one thing that matters. It is the
// only credential on the public side, it is not the database password, and
// rotating it is: change it here, change it on Vercel, restart. The database
// password never leaves this machine.
// ─────────────────────────────────────────────────────────────────────────────
import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { getOrg, isOrgConfigured } from "../src/lib/enterprise/connections";
import {
  runReadOnlyQueryDirect,
  callStoredProcDirect,
  execNonQueryDirect,
  type QueryParam,
} from "../src/lib/enterprise/mssql";
import {
  decodeType,
  decodeValue,
  encodeRows,
  verify,
  RELAY_SIG_HEADER,
  RELAY_TS_HEADER,
  type RelayRequest,
  type RelayResponse,
} from "../src/lib/enterprise/relay";

const PORT = Number(process.env.SQL_RELAY_PORT || 8787);
const HOST = process.env.SQL_RELAY_HOST || "127.0.0.1";
const SECRET = (process.env.SERVICESUITE_RELAY_SECRET ?? "").trim();
const ALLOW_WRITES = process.env.SQL_RELAY_ALLOW_WRITES === "true";

// ── THE NARROW DOOR ─────────────────────────────────────────────────────────
// A comma-separated list of stored procedures that may be executed EVEN WHEN
// the relay is otherwise read-only. Nothing else changes: `exec` (arbitrary
// SQL) stays refused, and every `proc` not on this list stays refused.
//
// WHY THIS EXISTS RATHER THAN JUST SETTING SQL_RELAY_ALLOW_WRITES=true.
// The borrower app needs exactly one write to go live: the row that puts a
// verification code in Micromart's own SMS outbox. Without it a customer asking
// for a code is told "We couldn't send the code right now", which is the
// front door of the product failing.
//
// Arming the relay wholesale buys that one capability at the price of turning a
// public HTTPS endpoint into an unrestricted write proxy onto a LIVE, SHARED
// lender database — one that also runs their ServiceSuite. The blast radius of
// a leaked relay secret goes from "somebody read the book" to "somebody wrote
// to it". That trade is not worth making for an SMS row.
//
// An allowlist of procedure NAMES is the proportionate version. The names are
// fixed here, on the machine that owns the socket; a caller cannot add to them,
// cannot pass arbitrary SQL, and cannot reach a procedure nobody listed. The
// procedure itself decides what the parameters are allowed to do — which is the
// same guarantee ServiceSuite gives its own callers.
//
// Matching is case-insensitive and compares the FULL name as given, so
// `Notifications.dbo.sp_InsertsmsAndEmails` does not also admit some other
// catalogue's procedure of the same short name.
const ALLOW_PROCS = new Set(
  (process.env.SQL_RELAY_ALLOW_PROCS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);

/** Is this specific request permitted on a relay that is not armed for writes? */
function allowedWhileReadOnly(kind: RelayRequest["kind"], name: string): boolean {
  return kind === "proc" && ALLOW_PROCS.has(name.trim().toLowerCase());
}
/** Bigger than any single read the suite issues; small enough that a body cannot be used to exhaust memory. */
const MAX_BODY = 512 * 1024;

if (!SECRET) {
  console.error(
    "\n✗ SERVICESUITE_RELAY_SECRET is not set.\n\n" +
      "  The relay will not start without one — an unauthenticated relay is an open\n" +
      "  SQL proxy on the public internet. Generate one and put it in .env:\n\n" +
      "    node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"\n",
  );
  process.exit(1);
}
if (SECRET.length < 32) {
  console.error(`\n✗ SERVICESUITE_RELAY_SECRET is only ${SECRET.length} characters. Use at least 32.\n`);
  process.exit(1);
}

function send(res: ServerResponse, status: number, body: RelayResponse | Record<string, unknown>) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(text);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const started = new Date();
let served = 0;
let refused = 0;

const server = createServer(async (req, res) => {
  const url = req.url ?? "/";

  // ── Liveness. Deliberately says nothing about the database or the tailnet:
  // this endpoint is public, and "which hosts can I see" is not something an
  // unauthenticated caller gets to ask. Use `npm run relay:check` for that.
  if (req.method === "GET" && (url === "/health" || url === "/")) {
    return send(res, 200, {
      ok: true,
      service: "sql-relay",
      since: started.toISOString(),
      served,
      refused,
      writes: ALLOW_WRITES,
      // A COUNT, never the names. The caller needs to know that a narrow door
      // exists so it can attempt a permitted procedure instead of reporting the
      // capability as absent; it does not need to know which procedures, and
      // this endpoint is unauthenticated.
      allowedProcs: ALLOW_PROCS.size,
    });
  }

  if (req.method !== "POST" || !url.startsWith("/query")) {
    return send(res, 404, { ok: false, error: "Not found." });
  }

  let raw: string;
  try {
    raw = await readBody(req);
  } catch {
    refused++;
    return send(res, 413, { ok: false, error: "Body too large." });
  }

  const ts = String(req.headers[RELAY_TS_HEADER] ?? "");
  const sig = String(req.headers[RELAY_SIG_HEADER] ?? "");
  if (!verify(SECRET, ts, raw, sig)) {
    refused++;
    // No detail. A caller that cannot sign does not learn whether it failed on
    // the signature or on the clock.
    return send(res, 401, { ok: false, error: "Unauthorised." });
  }

  let reqBody: RelayRequest;
  try {
    reqBody = JSON.parse(raw) as RelayRequest;
  } catch {
    return send(res, 400, { ok: false, error: "Malformed request." });
  }

  const org = getOrg(reqBody.orgSlug);
  if (!org) return send(res, 400, { ok: false, error: `Unknown organisation "${reqBody.orgSlug}".` });
  if (!isOrgConfigured(org)) {
    return send(res, 503, {
      ok: false,
      error: `The relay host has no connection string for ${org.name}. Set ${org.connEnv} in the relay's .env.`,
    });
  }

  if (
    (reqBody.kind === "exec" || reqBody.kind === "proc") &&
    !ALLOW_WRITES &&
    !allowedWhileReadOnly(reqBody.kind, reqBody.sql)
  ) {
    refused++;
    return send(res, 403, {
      ok: false,
      // Naming the allowlist matters: without it, an operator who has already
      // listed a procedure and mistyped the name reads this as "writes are off"
      // and goes looking in the wrong place.
      error:
        `This relay is read-only. A "${reqBody.kind}" request was refused. ` +
        `Arm writes with SQL_RELAY_ALLOW_WRITES=true, or permit this one ` +
        `procedure by name with SQL_RELAY_ALLOW_PROCS — on the relay host.`,
    });
  }

  const params: QueryParam[] = (reqBody.params ?? []).map((p) => ({
    name: p.name,
    type: decodeType(p.type),
    value: decodeValue(p.value),
  }));

  const t0 = Date.now();
  try {
    if (reqBody.kind === "read") {
      const r = await runReadOnlyQueryDirect(org, reqBody.sql, params, {
        timeoutMs: reqBody.timeoutMs,
        maxRows: reqBody.maxRows,
      });
      served++;
      log(reqBody, r.rows.length, Date.now() - t0);
      return send(res, 200, { ok: true, columns: r.columns, rows: encodeRows(r.rows), rowCount: r.rowCount, elapsedMs: r.elapsedMs });
    }

    if (reqBody.kind === "proc") {
      const rows = await callStoredProcDirect(org, reqBody.sql, params, { timeoutMs: reqBody.timeoutMs });
      served++;
      log(reqBody, rows.length, Date.now() - t0);
      return send(res, 200, {
        ok: true,
        columns: rows.length ? Object.keys(rows[0]) : [],
        rows: encodeRows(rows),
        rowCount: rows.length,
        elapsedMs: Date.now() - t0,
      });
    }

    // exec: rowsAffected travels in rowCount, matching execNonQuery's contract.
    const affected = await execNonQueryDirect(org, reqBody.sql, params, { timeoutMs: reqBody.timeoutMs });
    served++;
    log(reqBody, affected, Date.now() - t0);
    return send(res, 200, { ok: true, columns: [], rows: [], rowCount: affected, elapsedMs: Date.now() - t0 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error.";
    console.error(`  ✗ ${reqBody.orgSlug} ${reqBody.kind} failed in ${Date.now() - t0}ms — ${message}`);
    // The SQL Server message is returned deliberately: the caller is trusted (it
    // signed), and "Invalid column name 'LoanBalance'" is the difference between
    // a five-minute fix and an afternoon.
    return send(res, 200, { ok: false, error: message });
  }
});

function log(r: RelayRequest, rows: number, ms: number) {
  // Slug, kind, shape, duration. Never the SQL — it can carry a phone number or
  // a national ID in a WHERE clause, and this log is not a place for those.
  console.log(`  → ${r.orgSlug} ${r.kind} · ${rows} rows · ${ms}ms`);
}

/**
 * Open the connection pool before anyone asks.
 *
 * ── WHY THIS IS NOT A MICRO-OPTIMISATION ─────────────────────────────────────
 * node-mssql connects lazily, so without this the FIRST request after the relay
 * starts pays the full TDS handshake to Micromart's server. Measured from the
 * tailnet, a cold connect to 100.72.35.56,4230 takes eight to twenty seconds and
 * has been seen to time out outright at twenty.
 *
 * The first request after a restart is, reliably, the first screen somebody
 * opens — the suite launcher. So the cost lands exactly where it does the most
 * damage: on the page that is meant to prove all six systems are live, in front
 * of whoever is being shown it. Warming here moves that wait to boot, where
 * nobody is watching.
 *
 * A failure is logged and swallowed: the relay must still come up, because a
 * database that is down now may be up in a minute and refusing to listen would
 * turn a recoverable outage into a manual restart.
 */
async function warmPools() {
  for (const slug of ["micromart", "axe"]) {
    const org = getOrg(slug);
    if (!org || !isOrgConfigured(org)) continue;
    const started = Date.now();
    try {
      await runReadOnlyQueryDirect(org, "SELECT 1 AS ok", [], { timeoutMs: 30_000 });
      console.log(`  \x1b[32m✓\x1b[0m ${org.name} pool open \x1b[2m(${Date.now() - started}ms)\x1b[0m`);
    } catch (e) {
      console.log(
        `  \x1b[33m~\x1b[0m ${org.name} did not answer in ${Date.now() - started}ms — ` +
          `\x1b[2m${(e as Error).message.split("\n")[0]}\x1b[0m`,
      );
    }
  }
}

server.listen(PORT, HOST, async () => {
  console.log(`\n\x1b[1mSQL relay\x1b[0m listening on http://${HOST}:${PORT}`);
  console.log(`  writes:   ${ALLOW_WRITES ? "\x1b[33mARMED\x1b[0m" : "\x1b[32mrefused (read-only)\x1b[0m"}`);
  // Printed in full at startup, on the operator's own console. This is the one
  // place the names belong: whoever restarts the relay must be able to see
  // exactly which doors they just opened, without reading the .env back.
  if (ALLOW_PROCS.size > 0) {
    console.log(`  allowed:  \x1b[33m${ALLOW_PROCS.size} procedure(s)\x1b[0m even while read-only`);
    for (const p of ALLOW_PROCS) console.log(`              \x1b[2m${p}\x1b[0m`);
  }
  console.log(`\n  \x1b[2mwarming connection pools…\x1b[0m`);
  await warmPools();
  console.log(`\n  Publish it:   \x1b[1mtailscale funnel ${PORT}\x1b[0m`);
  console.log(`  Then set on Vercel:`);
  console.log(`    SERVICESUITE_RELAY_URL     = the https://… URL funnel prints`);
  console.log(`    SERVICESUITE_RELAY_SECRET  = the same secret as this host\n`);
});
