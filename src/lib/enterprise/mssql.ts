// ─────────────────────────────────────────────────────────────────────────────
// Pooled, read-only SQL Server access to the lenders' ServiceSuite databases.
//
// Connection pools are cached per org slug across hot-reloads (dev) so we don't
// exhaust SQL Server connections. All callers go through runReadOnlyQuery, which
// is parameter-friendly and bounded by a statement timeout.
//
// This module performs NO sql-string validation itself — callers MUST validate
// untrusted/LLM-generated SQL with src/lib/enterprise/guards.ts first. Metric SQL
// (src/lib/enterprise/metrics.ts) and the verify-staff lookup are trusted/
// parameterized and may be passed directly.
// ─────────────────────────────────────────────────────────────────────────────

import mssql, { type ConnectionPool, type config as MssqlConfig } from "mssql";
import { getMssqlConfig, type OrgDef } from "./connections";
import { relayEnabled, relayQuery, isRoadFailure } from "./relay";

// ─────────────────────────────────────────────────────────────────────────────
// TWO WAYS TO REACH THE SAME SERVER, CHOSEN ONCE, HERE.
//
// Micromart's SQL Server has a tailnet address and no public route. On a machine
// that is on the tailnet the direct TDS path below is correct and fastest. On
// Vercel it cannot work at all — see lib/enterprise/relay.ts for why that is
// topology rather than configuration.
//
// So each public function is a two-line dispatcher over an unchanged *Direct
// implementation. Callers — all forty of them, across all six systems — are
// untouched and cannot tell which path ran. With SERVICESUITE_RELAY_URL unset
// there is no relay and nothing about this module's behaviour changes.
// ─────────────────────────────────────────────────────────────────────────────

type PoolCache = Map<string, Promise<ConnectionPool>>;
const globalForPool = globalThis as unknown as { __ssPoolCache?: PoolCache };
const poolCache: PoolCache = globalForPool.__ssPoolCache ?? new Map();
if (!globalForPool.__ssPoolCache) globalForPool.__ssPoolCache = poolCache;

async function getPool(org: OrgDef): Promise<ConnectionPool> {
  const cfg: MssqlConfig = getMssqlConfig(org);
  const key = `${org.slug}:${cfg.server}:${cfg.port}:${cfg.database}:${cfg.user}`;

  const existing = poolCache.get(key);
  if (existing) {
    try {
      const pool = await existing;
      if (pool.connected || pool.connecting) return pool;
    } catch {
      /* fall through and rebuild */
    }
  }

  const p = new mssql.ConnectionPool(cfg)
    .connect()
    .catch((err: unknown) => {
      poolCache.delete(key); // don't cache a failed connect
      throw err;
    });
  poolCache.set(key, p);
  return p;
}

export type QueryParam = { name: string; type: mssql.ISqlType | (() => mssql.ISqlType); value: unknown };

export type QueryResult = {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  elapsedMs: number;
};

/**
 * Run a read-only query against an org's ServiceSuite DB.
 * @param timeoutMs  per-request statement timeout (default 15s)
 * @param maxRows    hard cap applied after fetch (default 500)
 */
// ─────────────────────────────────────────────────────────────────────────────
// WHERE DIRECT TDS SITS IN THE ORDER — SERVICESUITE_SQL_DIRECT
//
//   off    (default) Relays only. The correct setting on Vercel, where a direct
//                    socket to 100.72.35.56 CANNOT work at any price — the
//                    address is Tailscale CGNAT and has no internet route. This
//                    is not caution, it is arithmetic: connectionTimeout is
//                    20 SECONDS, so a blind direct attempt would add twenty
//                    seconds to every query that is going to the relay anyway.
//   first            Direct TDS, then the relays. For a runtime that IS on the
//                    tailnet — this workstation, or a tailnet-hosted deploy.
//                    Fastest path to the book, and the relays remain underneath
//                    it as the safety net.
//   last             Relays, then direct. For a host that might have the route
//                    and should use it only when every relay is down.
//
// It is one variable with three values rather than a pair of booleans because
// the question is genuinely "where in the order", and two booleans can express
// states that make no sense.
// ─────────────────────────────────────────────────────────────────────────────
type DirectMode = "off" | "first" | "last";

function directMode(): DirectMode {
  const v = (process.env.SERVICESUITE_SQL_DIRECT ?? "").trim().toLowerCase();
  if (v === "first" || v === "last" || v === "off") return v;
  // No relays configured at all means direct is the only road there is — which
  // is what keeps local development a straight TDS connection with no config.
  return relayEnabled() ? "off" : "first";
}

/** Can we even attempt a direct socket for this org? No connection string, no road. */
function directConfigured(org: OrgDef): boolean {
  return !!process.env[org.connEnv]?.trim();
}

/**
 * The ordered roads for one call.
 *
 * "relay" is a single entry because relayQuery does its own ordering and
 * failover across the endpoint list — this layer only decides where DIRECT sits
 * relative to that whole set.
 */
function roads(org: OrgDef): ("direct" | "relay")[] {
  const mode = directMode();
  const direct = directConfigured(org) && mode !== "off" ? (["direct"] as const) : [];
  const relay = relayEnabled() ? (["relay"] as const) : [];
  if (mode === "first") return [...direct, ...relay];
  return [...relay, ...direct];
}

/**
 * Try the roads in order.
 *
 * `canFailOver` is false for anything that writes. A stored procedure that timed
 * out may still have run: the request reached the server, the row was written,
 * and the response was lost on the way back. Trying the next road then posts a
 * second loan against a real customer. A read costs nothing to repeat; a write
 * costs somebody money, so the default is the one that cannot.
 */
async function overRoads<T>(
  org: OrgDef,
  canFailOver: boolean,
  run: (road: "direct" | "relay") => Promise<T>,
): Promise<T> {
  const list = roads(org);
  if (list.length === 0) {
    // Neither road exists. Say which switch turns one on rather than surfacing
    // a connection error that reads like the lender being down.
    throw new Error(
      `${org.name} has no route to its ServiceSuite: ${org.connEnv} is unset and SERVICESUITE_RELAY_URL is empty.`,
    );
  }

  let last: unknown;
  for (let i = 0; i < list.length; i++) {
    try {
      return await run(list[i]);
    } catch (e) {
      last = e;
      if (!canFailOver || i === list.length - 1) throw e;

      // ── AN ANSWER IS NOT A BROKEN ROAD ──────────────────────────────────
      // "Invalid column name 'EntityId'" means SQL Server received the query
      // and replied. Every other road runs the same SQL against the same
      // tables and replies identically — so failing over cannot help, and it
      // does active harm: the caller ends up holding the LAST road's error,
      // which is usually about a relay being unreachable, and the real bug is
      // invisible. That is not hypothetical. It hid a wrong column name here
      // through two runs, reporting a relay 502 both times.
      if (!isRoadFailure(e)) throw e;
    }
  }
  throw last;
}

export async function runReadOnlyQuery(
  org: OrgDef,
  query: string,
  params: QueryParam[] = [],
  opts: { timeoutMs?: number; maxRows?: number } = {},
): Promise<QueryResult> {
  return overRoads(org, true, (road) =>
    road === "relay" ? relayQuery("read", org, query, params, opts) : runReadOnlyQueryDirect(org, query, params, opts),
  );
}

/** The original TDS path: used on the tailnet, and by the relay process itself. */
export async function runReadOnlyQueryDirect(
  org: OrgDef,
  query: string,
  params: QueryParam[] = [],
  opts: { timeoutMs?: number; maxRows?: number } = {},
): Promise<QueryResult> {
  const { timeoutMs = 15000, maxRows = 500 } = opts;
  const pool = await getPool(org);
  const request = pool.request();
  // node-mssql honours a per-request timeout at runtime; not in the v12 types.
  (request as unknown as { timeout?: number }).timeout = timeoutMs;
  for (const prm of params) request.input(prm.name, prm.type as mssql.ISqlType, prm.value);

  const started = Date.now();
  const result = await request.query(query);
  const elapsedMs = Date.now() - started;

  const recordset = (result.recordset ?? []) as Record<string, unknown>[];
  const columns = recordset.length > 0 ? Object.keys(recordset[0]) : (result.recordset?.columns ? Object.keys(result.recordset.columns) : []);
  const rows = recordset.slice(0, maxRows);

  return { columns, rows, rowCount: recordset.length, elapsedMs };
}

/**
 * Execute a stored procedure (WRITE path — used by lms loan posting). Returns the
 * first recordset. Callers must gate this behind their own enablement flag.
 */
export async function callStoredProc(
  org: OrgDef,
  procName: string,
  params: QueryParam[] = [],
  opts: { timeoutMs?: number } = {},
): Promise<Record<string, unknown>[]> {
  // canFailOver: FALSE. This is the loan-posting path. A procedure that did not
  // answer may still have run, and the second attempt would book the loan twice.
  return overRoads(org, false, async (road) => {
    if (road === "relay") {
      const { rows } = await relayQuery("proc", org, procName, params, {
        timeoutMs: opts.timeoutMs ?? 30000,
        maxRows: 2000,
      });
      return rows;
    }
    return callStoredProcDirect(org, procName, params, opts);
  });
}

export async function callStoredProcDirect(
  org: OrgDef,
  procName: string,
  params: QueryParam[] = [],
  opts: { timeoutMs?: number } = {},
): Promise<Record<string, unknown>[]> {
  const { timeoutMs = 30000 } = opts;
  const pool = await getPool(org);
  const request = pool.request();
  (request as unknown as { timeout?: number }).timeout = timeoutMs;
  for (const prm of params) request.input(prm.name, prm.type as mssql.ISqlType, prm.value);
  const result = await request.execute(procName);
  return (result.recordset ?? []) as Record<string, unknown>[];
}

/** Execute a write statement (UPDATE/INSERT) and return rows affected. Gate callers themselves. */
export async function execNonQuery(
  org: OrgDef,
  query: string,
  params: QueryParam[] = [],
  opts: { timeoutMs?: number } = {},
): Promise<number> {
  // canFailOver: FALSE — this writes. See callStoredProc above.
  return overRoads(org, false, async (road) => {
    if (road === "relay") {
      // On the "exec" kind the relay carries rowsAffected in rowCount — there is
      // no recordset to return. A relay that has not been armed for writes
      // refuses this by name rather than reporting zero rows affected, which
      // would be indistinguishable from a statement that matched nothing.
      const { rowCount } = await relayQuery("exec", org, query, params, {
        timeoutMs: opts.timeoutMs ?? 20000,
        maxRows: 0,
      });
      return rowCount;
    }
    return execNonQueryDirect(org, query, params, opts);
  });
}

export async function execNonQueryDirect(
  org: OrgDef,
  query: string,
  params: QueryParam[] = [],
  opts: { timeoutMs?: number } = {},
): Promise<number> {
  const { timeoutMs = 20000 } = opts;
  const pool = await getPool(org);
  const request = pool.request();
  (request as unknown as { timeout?: number }).timeout = timeoutMs;
  for (const prm of params) request.input(prm.name, prm.type as mssql.ISqlType, prm.value);
  const result = await request.query(query);
  return result.rowsAffected?.[0] ?? 0;
}

/** Convenience: run a single-scalar metric query returning the `value` column. */
export async function runScalar(org: OrgDef, query: string, timeoutMs = 15000): Promise<number> {
  const { rows } = await runReadOnlyQuery(org, query, [], { timeoutMs, maxRows: 1 });
  const v = rows[0]?.value;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export { mssql };
