// ─────────────────────────────────────────────────────────────────────────────
// COLLECTBOX — the collections and call-centre database, opened for reading.
//
// ── WHY THERE IS NO SECOND CONNECTION STRING ─────────────────────────────────
// CollectBox lives on the SAME SQL Server instance as Serviceconnect — host
// "services" at 100.72.35.56,4230. A second connection string pointed at the
// same box would double the pool, double the credential surface, and introduce
// the one failure mode that is genuinely hard to debug: two connections whose
// transaction isolation and clock drift differ by just enough that a call logged
// in one is invisible to the other for a few hundred milliseconds.
//
// So there is ONE pool — the org's ServiceSuite pool — and CollectBox is reached
// by THREE-PART QUALIFICATION: `CollectBox.dbo.CollectionTracker`. That is not a
// workaround; it is the reason cross-database joins in this file are a single
// query plan rather than two round trips stitched together in Node.
//
//   SELECT ... FROM CollectBox.dbo.CollectionTracker ct
//   JOIN Serviceconnect.dbo.Loans l ON l.id = ct.LoanId
//
// That join runs in the server. All 93,376 tracked loans resolve against Loans
// with zero orphans, which is what makes the collections floor and the lending
// ledger the same dataset rather than two systems that agree most of the time.
//
// ── WHAT THIS MODULE GUARANTEES ──────────────────────────────────────────────
//   · Reads are read-only and bounded (statement timeout + row cap).
//   · The org is resolved server-side from a slug; no caller supplies a server.
//   · A missing connection is a NAMED failure ("not connected yet"), never an
//     empty result set — a collections floor that silently renders zero rows is
//     indistinguishable from a quiet day, and that is a dangerous ambiguity in a
//     system whose whole job is to notice people who have stopped paying.
// ─────────────────────────────────────────────────────────────────────────────

import { getOrg, isOrgConfigured, type OrgDef } from "@/lib/enterprise/connections";
import { runReadOnlyQuery, mssql, type QueryParam } from "@/lib/enterprise/mssql";

/** The database CollectBox actually lives in, on the shared instance. */
export const CB = "CollectBox.dbo";
/** The lending ledger, for the cross-database joins that make the suite work. */
export const SC = "Serviceconnect.dbo";
/** Money movements — M-Pesa in and out. */
export const TX = "Transactions.dbo";

export class CollectBoxUnavailable extends Error {
  constructor(public readonly orgSlug: string, message: string) {
    super(message);
    this.name = "CollectBoxUnavailable";
  }
}

/**
 * Resolve an org slug to the pool that can see CollectBox.
 *
 * Micromart's collections floor is the one that exists today. Other lenders on
 * the shared ServiceSuite box have no CollectBox of their own, so asking for one
 * is a named error rather than an empty floor.
 */
export function collectBoxOrg(slug = "micromart"): OrgDef {
  const org = getOrg(slug);
  if (!org) throw new CollectBoxUnavailable(slug, `Unknown organisation "${slug}".`);
  if (!isOrgConfigured(org)) {
    throw new CollectBoxUnavailable(
      slug,
      `${org.name} is not connected to CollectBox yet. Set ${org.connEnv} to the ServiceSuite connection string — CollectBox is reached through the same server.`,
    );
  }
  return org;
}

/** Is the collections floor reachable at all? Used to render an honest empty state. */
export function isCollectBoxConfigured(slug = "micromart"): boolean {
  const org = getOrg(slug);
  return !!org && isOrgConfigured(org);
}

export type CbQueryOpts = {
  /** Per-statement timeout. Collections aggregates over 1.3M call logs need room. */
  timeoutMs?: number;
  maxRows?: number;
};

/**
 * Run a read against CollectBox (and, freely, across into Serviceconnect).
 *
 * Callers pass TRUSTED sql written in this codebase — never LLM output, never a
 * string assembled from request input. Values are always bound parameters.
 */
export async function cbQuery<T = Record<string, unknown>>(
  org: OrgDef,
  sql: string,
  params: QueryParam[] = [],
  opts: CbQueryOpts = {},
): Promise<T[]> {
  const { timeoutMs = 25000, maxRows = 2000 } = opts;
  const { rows } = await runReadOnlyQuery(org, sql, params, { timeoutMs, maxRows });
  return rows as T[];
}

/** A single row, or null. */
export async function cbOne<T = Record<string, unknown>>(
  org: OrgDef,
  sql: string,
  params: QueryParam[] = [],
  opts: CbQueryOpts = {},
): Promise<T | null> {
  const rows = await cbQuery<T>(org, sql, params, { ...opts, maxRows: 1 });
  return rows[0] ?? null;
}

// ── Parameter helpers ────────────────────────────────────────────────────────
// Thin, but they exist so that no call site has to import `mssql` just to say
// "this is an integer". Every value that reaches SQL passes through one of these.

export const P = {
  int: (name: string, value: number): QueryParam => ({ name, type: mssql.Int, value: Math.trunc(value) }),
  bigint: (name: string, value: number): QueryParam => ({ name, type: mssql.BigInt, value: Math.trunc(value) }),
  str: (name: string, value: string, len = 255): QueryParam => ({ name, type: mssql.VarChar(len), value }),
  date: (name: string, value: Date): QueryParam => ({ name, type: mssql.DateTime, value }),
  dec: (name: string, value: number): QueryParam => ({ name, type: mssql.Decimal(18, 2), value }),
};

// ── Coercion ─────────────────────────────────────────────────────────────────
// SQL Server's `numeric` comes back from node-mssql as a JS number most of the
// time and a string when precision demands it. Every money figure in this system
// goes through num() so a KES 211,326,076.80 NPL balance can never silently
// become the string "211326076.8" and then NaN two components later.

export function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

export function dt(v: unknown): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Kenyan MSISDN, normalised to 2547######## for cross-system matching. */
export function msisdn(v: unknown): string {
  const raw = str(v).replace(/\D/g, "");
  if (!raw) return "";
  if (raw.startsWith("254")) return raw;
  if (raw.startsWith("0")) return `254${raw.slice(1)}`;
  if (raw.length === 9) return `254${raw}`;
  return raw;
}
