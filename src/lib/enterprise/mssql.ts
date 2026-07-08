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
export async function runReadOnlyQuery(
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
