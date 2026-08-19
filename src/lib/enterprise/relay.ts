// ─────────────────────────────────────────────────────────────────────────────
// THE SQL RELAY — how a serverless deployment reads a database that has no
// public address.
//
// ── THE PROBLEM, STATED PRECISELY ────────────────────────────────────────────
// Micromart's SQL Server lives at 100.72.35.56,4230. That is a Tailscale address
// in the CGNAT range 100.64.0.0/10. It is not firewalled off the internet — it
// has no internet route AT ALL. Nothing outside the tailnet can open a socket to
// it, ever, under any configuration.
//
// Locally that is invisible: this workstation is on the tailnet, so `npm run
// dev` reads the live floor in 300ms and every screen is green. Deployed to
// Vercel the identical code cannot route to the host, every probe fails
// together, and the launcher renders
//
//     "Micromart's server is not reachable right now"
//
// which reads like an outage on their side. It is not. It is topology, and no
// environment variable can change it — SERVICESUITE_CONN_MICROMART can be set
// perfectly on Vercel and still connect to nothing.
//
// ── THE FIX ──────────────────────────────────────────────────────────────────
// Move the SOCKET, not the application. One small process — scripts/sql-relay.ts
// — runs on a machine that IS on the tailnet, holds the real connection pool,
// and accepts signed query requests over public HTTPS. Vercel stops dialling SQL
// and starts POSTing here instead:
//
//     Vercel fn ──HTTPS(signed)──► relay (on tailnet) ──TDS──► 100.72.35.56
//
// The relay is not an open SQL proxy. It executes only requests carrying a valid
// HMAC over the exact body, inside a two-minute window, and it refuses every
// write unless separately armed. See the server for the rest of that argument.
//
// ── WHY THIS FILE IS THE ONLY PLACE THE APP CHANGES ──────────────────────────
// Every live read in the suite — all six systems, forty call sites — goes
// through runReadOnlyQuery() in ./mssql. That function now asks relayEnabled()
// and either dials or posts. No page, no component and no query changes. With
// SERVICESUITE_RELAY_URL unset the relay does not exist and the direct path runs
// exactly as before, which is what keeps local development a straight TDS
// connection with no extra hop.
//
// ── THE CODEC, AND WHY IT IS NOT JSON.stringify ──────────────────────────────
// Two things in a query round-trip do not survive plain JSON:
//
//   PARAMETER TYPES are node-mssql objects. `mssql.Int` is a FUNCTION carrying
//   a `declaration` of "int"; `mssql.VarChar(255)` is an OBJECT of shape
//   { type, length } whose `type` is that function. JSON.stringify yields
//   undefined for the first and {} for the second, so every parameter would
//   arrive untyped and tedious would reject the request. encodeType() reads the
//   declaration and the modifiers; decodeType() rebuilds the real object on the
//   far side.
//
//   DATES come back from SQL Server as JS Date objects and go out as them too.
//   Through JSON they become strings, and a string that looks like a date is the
//   worst possible outcome — ago(lastEventAt) still renders, just wrongly, and
//   the header pill on /desk would tick with a plausible lie. Values are tagged
//   so a Date leaves as a Date and arrives as a Date.
//
// Money is deliberately NOT re-typed here: SQL Server hands `numeric` back as a
// number or a string depending on precision, both survive JSON intact, and
// num() in lib/collectbox/client already absorbs that difference at every call
// site. Fixing it twice would be the bug.
// ─────────────────────────────────────────────────────────────────────────────

import { createHmac, timingSafeEqual } from "node:crypto";
import mssql from "mssql";
import type { OrgDef } from "./connections";

/** How long a signed request stays valid. Room for clock skew, useless if captured. */
export const RELAY_SKEW_MS = 120_000;

export const RELAY_TS_HEADER = "x-relay-ts";
export const RELAY_SIG_HEADER = "x-relay-sig";

/** Is this deployment configured to reach SQL through a relay rather than directly? */
export function relayEnabled(): boolean {
  return !!(process.env.SERVICESUITE_RELAY_URL?.trim() && process.env.SERVICESUITE_RELAY_SECRET?.trim());
}

export function relayUrl(): string {
  return (process.env.SERVICESUITE_RELAY_URL ?? "").trim().replace(/\/$/, "");
}

function relaySecret(): string {
  return (process.env.SERVICESUITE_RELAY_SECRET ?? "").trim();
}

// ── The wire format ──────────────────────────────────────────────────────────

/** The seven SQL Server types this codebase binds. Anything else is a named error, not a silent cast. */
export type WireDecl = "int" | "bigint" | "varchar" | "nvarchar" | "decimal" | "datetime" | "date";

export type WireType = {
  decl: WireDecl;
  /** varchar/nvarchar. 65535 is node-mssql's MAX sentinel and passes through as-is. */
  length?: number;
  /** decimal */
  precision?: number;
  scale?: number;
};

export type WireParam = { name: string; type: WireType; value: unknown };

export type RelayRequest = {
  /** "read" is the only kind a relay serves unless it has been armed for writes. */
  kind: "read" | "exec" | "proc";
  orgSlug: string;
  /** For kind "proc" this is the procedure name, not SQL. */
  sql: string;
  params: WireParam[];
  timeoutMs: number;
  maxRows: number;
};

export type RelayResponse =
  | { ok: true; columns: string[]; rows: Record<string, unknown>[]; rowCount: number; elapsedMs: number }
  | { ok: false; error: string };

/**
 * node-mssql type object to wire.
 *
 * Bare types are functions carrying a `declaration`. Parameterised types are
 * objects whose `type` is that function, plus the modifiers. Both shapes are
 * handled; anything else throws by name rather than binding an untyped
 * parameter, because "Validation failed for parameter 'entityId'" is a message
 * this codebase has already paid for once.
 */
export function encodeType(t: unknown): WireType {
  const asObj = (typeof t === "object" && t !== null ? t : {}) as {
    type?: { declaration?: string };
    length?: number;
    precision?: number;
    scale?: number;
  };
  const fn = (typeof t === "function" ? t : asObj.type) as { declaration?: string } | undefined;
  const decl = fn?.declaration;

  if (!decl || !isWireDecl(decl)) {
    throw new Error(
      `SQL relay cannot encode parameter type "${decl ?? typeof t}". Add it to WireDecl in lib/enterprise/relay.ts.`,
    );
  }

  const out: WireType = { decl };
  if (typeof asObj.length === "number") out.length = asObj.length;
  if (typeof asObj.precision === "number") out.precision = asObj.precision;
  if (typeof asObj.scale === "number") out.scale = asObj.scale;
  return out;
}

function isWireDecl(d: string): d is WireDecl {
  return (
    d === "int" || d === "bigint" || d === "varchar" || d === "nvarchar" || d === "decimal" || d === "datetime" || d === "date"
  );
}

/** wire back to a node-mssql type object, rebuilt inside the relay process. */
export function decodeType(w: WireType): mssql.ISqlType | (() => mssql.ISqlType) {
  switch (w.decl) {
    case "int": return mssql.Int;
    case "bigint": return mssql.BigInt;
    case "datetime": return mssql.DateTime;
    case "date": return mssql.Date;
    case "varchar": return mssql.VarChar(w.length ?? 255);
    case "nvarchar": return mssql.NVarChar(w.length ?? 255);
    case "decimal": return mssql.Decimal(w.precision ?? 18, w.scale ?? 2);
  }
}

// ── Value tagging ────────────────────────────────────────────────────────────
// Only Date and Buffer need it. Everything else is a JSON primitive already, and
// wrapping those too would double the payload of a 2,000-row read for nothing.

export function encodeValue(v: unknown): unknown {
  if (v instanceof Date) return { __d: v.toISOString() };
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(v)) return { __b: v.toString("base64") };
  return v;
}

export function decodeValue(v: unknown): unknown {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const d = (v as { __d?: unknown }).__d;
    if (typeof d === "string") return new Date(d);
    const b = (v as { __b?: unknown }).__b;
    if (typeof b === "string") return Buffer.from(b, "base64");
  }
  return v;
}

export function encodeRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((r) => {
    const out: Record<string, unknown> = {};
    for (const k in r) out[k] = encodeValue(r[k]);
    return out;
  });
}

export function decodeRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((r) => {
    const out: Record<string, unknown> = {};
    for (const k in r) out[k] = decodeValue(r[k]);
    return out;
  });
}

// ── Signing ──────────────────────────────────────────────────────────────────

/**
 * The signature covers the timestamp AND the exact body bytes.
 *
 * Signing the body rather than a path is what stops a captured request being
 * replayed with different SQL: change one character of the query and the
 * signature no longer verifies. The timestamp is inside the signed material for
 * the same reason — otherwise it could be moved forward to extend the window.
 */
export function sign(secret: string, ts: string, body: string): string {
  return createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
}

/** Constant-time verification, including the length check timingSafeEqual demands. */
export function verify(secret: string, ts: string, body: string, sig: string): boolean {
  const expected = sign(secret, ts, body);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(sig ?? "", "utf8");
  if (a.length !== b.length) return false;
  if (!timingSafeEqual(a, b)) return false;
  const age = Math.abs(Date.now() - Number(ts));
  return Number.isFinite(age) && age <= RELAY_SKEW_MS;
}

// ── The client half ──────────────────────────────────────────────────────────

export class RelayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RelayError";
  }
}

/**
 * Send one query through the relay.
 *
 * The HTTP timeout is deliberately the statement timeout plus a margin: a relay
 * that has gone away must fail in about the time a slow query would have taken,
 * not hang until the serverless function is killed. A hung function produces a
 * blank screen; a failed read produces the honest "unreachable" state the
 * launcher is already built to render.
 */
export async function relayQuery(
  kind: RelayRequest["kind"],
  org: OrgDef,
  sql: string,
  params: { name: string; type: unknown; value: unknown }[],
  opts: { timeoutMs?: number; maxRows?: number } = {},
): Promise<{ columns: string[]; rows: Record<string, unknown>[]; rowCount: number; elapsedMs: number }> {
  const timeoutMs = opts.timeoutMs ?? 15000;
  const maxRows = opts.maxRows ?? 500;

  const payload: RelayRequest = {
    kind,
    orgSlug: org.slug,
    sql,
    params: params.map((p) => ({ name: p.name, type: encodeType(p.type), value: encodeValue(p.value) })),
    timeoutMs,
    maxRows,
  };

  const body = JSON.stringify(payload);
  const ts = String(Date.now());
  const secret = relaySecret();

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs + 5000);

  let res: Response;
  try {
    res = await fetch(`${relayUrl()}/query`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [RELAY_TS_HEADER]: ts,
        [RELAY_SIG_HEADER]: sign(secret, ts, body),
      },
      body,
      signal: ctl.signal,
      cache: "no-store",
    });
  } catch (e) {
    const why =
      e instanceof Error && e.name === "AbortError"
        ? `no answer within ${timeoutMs + 5000}ms`
        : e instanceof Error
          ? e.message
          : "unknown";
    throw new RelayError(
      `SQL relay at ${relayUrl()} did not answer (${why}). The relay host is off, asleep, or off the tailnet.`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new RelayError(`SQL relay returned ${res.status}. ${text.slice(0, 300)}`);
  }

  const json = (await res.json()) as RelayResponse;
  if (!json.ok) throw new RelayError(json.error);

  return { columns: json.columns, rows: decodeRows(json.rows), rowCount: json.rowCount, elapsedMs: json.elapsedMs };
}
