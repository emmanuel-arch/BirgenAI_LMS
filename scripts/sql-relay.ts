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
//
// ── WHY THE LIST IS IN THIS FILE AND NOT ONLY IN .env ───────────────────────
// It used to be env alone. Env alone has three holes, and all three matter on a
// shared lender database:
//
//   1. NO CEILING. Whoever can edit `.env` on the relay host can name any
//      procedure in the catalogue — `sp_ApproveLoan`, `sp_WriteOff`, anything —
//      and the relay would run it. A list in the file is a bound that an
//      operator, a bad paste or a leaked RDP session cannot raise.
//   2. NO ORG SCOPE. `SQL_RELAY_ALLOW_PROCS` admitted a procedure NAME on every
//      org the relay can route to. The same relay reaches Micromart AND Axe, so
//      a door opened for one lender's outbox was open on the other lender's
//      server too.
//   3. NO PARAMETER SHAPE. A procedure is only as narrow as its arguments, and
//      nothing checked which arguments a caller could pass.
//
// So the posture is now TWO KEYS THAT MUST BOTH TURN:
//
//   · WRITE_ALLOWLIST below is the CEILING — the complete set of writes this
//     proxy is ever capable of, pinned in source, reviewed in git.
//   · SQL_RELAY_ALLOW_PROCS is the SWITCH — per host, which of those grants are
//     actually live here. Unset means NONE. Adding a name that is not pinned
//     below does nothing at all; it cannot widen the ceiling.
//
// Deploying this file therefore changes no host's posture on its own, which is
// the property that lets it be rolled out without a maintenance window.
// ─────────────────────────────────────────────────────────────────────────────

/** One permitted write. Everything not described by one of these is refused. */
type WriteGrant = {
  /** Org slugs this grant covers. A grant is never global across lenders. */
  readonly orgs: readonly string[];
  /** Full procedure name, exactly as the caller must send it. */
  readonly proc: string;
  /** The ONLY parameter names accepted. An unrecognised one refuses the call. */
  readonly params: readonly string[];
  /** Why this door exists. Read at every review; do not add a grant without one. */
  readonly why: string;
};

const WRITE_ALLOWLIST: readonly WriteGrant[] = [
  {
    // Both Micromart books live on the same ServiceSuite instance and both send
    // under their own registered sender id, so the grant covers the pair. Axe is
    // deliberately absent: nothing in this product writes to Axe's outbox.
    orgs: ["micromart", "micromart-fintech"],
    proc: "Notifications.dbo.sp_InsertsmsAndEmails",
    // From src/lib/sms/servicesuite.ts — their own RepaymentTrigger calls the
    // procedure positionally as (@receiver, @body, @entityId); these are the
    // names the relay client binds. Anything else is a caller that has drifted.
    params: ["receiver", "bodyMessage", "companyid"],
    why:
      "The borrower verification code. Puts one row in Micromart's own outbox so " +
      "the SMS arrives under THEIR sender id rather than ours — a code from an " +
      "unknown sender is indistinguishable from phishing.",
  },
  // Add the next grant here, with its `why`, and only after the same question
  // has been answered out loud: what is the worst a caller holding the relay
  // secret could do with this procedure and arbitrary parameters?
];

/** The per-host switch. Narrows the ceiling; can never raise it. */
const ENABLED_PROCS = new Set(
  (process.env.SQL_RELAY_ALLOW_PROCS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);

/** Grants pinned in the file AND switched on for this host. */
const ACTIVE_GRANTS = WRITE_ALLOWLIST.filter((g) => ENABLED_PROCS.has(g.proc.toLowerCase()));

/** Names an operator enabled that no grant defines — always an error worth printing. */
const UNKNOWN_ENABLED = [...ENABLED_PROCS].filter(
  (name) => !WRITE_ALLOWLIST.some((g) => g.proc.toLowerCase() === name),
);

/**
 * Is this specific request permitted on a relay that is not armed for writes?
 *
 * Returns the reason for a refusal rather than a bare false, because the three
 * ways to fail here — wrong procedure, right procedure on the wrong lender,
 * unexpected parameter — look identical from the caller's side and have
 * completely different fixes.
 */
function checkGrant(req: RelayRequest): { ok: true } | { ok: false; reason: string } {
  // `exec` is arbitrary SQL. No allowlist can make that narrow, so it is never
  // reachable through this path at any setting — only SQL_RELAY_ALLOW_WRITES.
  if (req.kind !== "proc") {
    return { ok: false, reason: `"${req.kind}" is arbitrary SQL and is never covered by the allowlist.` };
  }

  const name = req.sql.trim().toLowerCase();
  const grant = ACTIVE_GRANTS.find((g) => g.proc.toLowerCase() === name);
  if (!grant) {
    const pinned = WRITE_ALLOWLIST.some((g) => g.proc.toLowerCase() === name);
    return {
      ok: false,
      reason: pinned
        ? `"${req.sql}" is in the allowlist but is not switched on for this host (SQL_RELAY_ALLOW_PROCS).`
        : `"${req.sql}" is not in this relay's write allowlist.`,
    };
  }

  if (!grant.orgs.includes(req.orgSlug)) {
    return {
      ok: false,
      reason: `"${grant.proc}" is permitted for ${grant.orgs.join(", ")} — not for "${req.orgSlug}".`,
    };
  }

  const permitted = new Set(grant.params.map((p) => p.toLowerCase()));
  const unexpected = (req.params ?? [])
    .map((p) => p.name)
    .filter((n) => !permitted.has(n.trim().toLowerCase()));
  if (unexpected.length > 0) {
    // Missing parameters are the procedure's business — it has defaults and its
    // own validation. An EXTRA one is ours: it means the caller is not the
    // caller this grant was written for.
    return {
      ok: false,
      reason: `"${grant.proc}" accepts only ${grant.params.join(", ")} — refused unexpected: ${unexpected.join(", ")}.`,
    };
  }

  return { ok: true };
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
      allowedProcs: ACTIVE_GRANTS.length,
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

  if ((reqBody.kind === "exec" || reqBody.kind === "proc") && !ALLOW_WRITES) {
    const grant = checkGrant(reqBody);
    if (!grant.ok) {
      refused++;
      // The specific reason, not a flat "read-only". An operator who has already
      // listed a procedure and mistyped the name, or pointed it at the wrong
      // lender, reads a flat refusal as "writes are off" and goes looking in the
      // wrong place. None of these strings name a credential or a connection.
      console.warn(`  ✗ ${reqBody.orgSlug} ${reqBody.kind} refused — ${grant.reason}`);
      return send(res, 403, {
        ok: false,
        error:
          `This relay is read-only and the request is not covered by its write ` +
          `allowlist. ${grant.reason} The allowlist is pinned in sql-relay.ts and ` +
          `switched on per host with SQL_RELAY_ALLOW_PROCS; env alone cannot widen it.`,
      });
    }
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
  if (ACTIVE_GRANTS.length > 0) {
    console.log(`  allowed:  \x1b[33m${ACTIVE_GRANTS.length} write grant(s)\x1b[0m even while read-only`);
    for (const g of ACTIVE_GRANTS) {
      console.log(`              \x1b[2m${g.proc}\x1b[0m`);
      console.log(`                \x1b[2morgs:   ${g.orgs.join(", ")}\x1b[0m`);
      console.log(`                \x1b[2mparams: ${g.params.join(", ")}\x1b[0m`);
    }
  } else {
    console.log(`  allowed:  \x1b[32mno write grants active\x1b[0m`);
  }
  // A name in SQL_RELAY_ALLOW_PROCS that matches no grant is silent otherwise —
  // the operator believes a door is open and every call 403s with a message
  // about an allowlist they think they edited. Say it once, loudly, at boot.
  if (UNKNOWN_ENABLED.length > 0) {
    console.log(
      `\n  \x1b[33m⚠ SQL_RELAY_ALLOW_PROCS names ${UNKNOWN_ENABLED.length} procedure(s) with no grant in\n` +
        `    sql-relay.ts, so they are NOT enabled and cannot be:\x1b[0m`,
    );
    for (const n of UNKNOWN_ENABLED) console.log(`      \x1b[2m${n}\x1b[0m`);
    console.log(
      `    \x1b[2mFix the spelling, or add a reviewed grant to WRITE_ALLOWLIST and redeploy.\x1b[0m`,
    );
  }
  if (ALLOW_WRITES) {
    console.log(
      `\n  \x1b[33m⚠ SQL_RELAY_ALLOW_WRITES=true — the allowlist is BYPASSED and this relay will\n` +
        `    run arbitrary SQL against a live lender database. Break-glass only.\x1b[0m`,
    );
  }
  console.log(`\n  \x1b[2mwarming connection pools…\x1b[0m`);
  await warmPools();
  console.log(`\n  Publish it:   \x1b[1mtailscale funnel ${PORT}\x1b[0m`);
  console.log(`  Then set on Vercel:`);
  console.log(`    SERVICESUITE_RELAY_URL     = the https://… URL funnel prints`);
  console.log(`    SERVICESUITE_RELAY_SECRET  = the same secret as this host\n`);
});
