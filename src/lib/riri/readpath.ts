// ─────────────────────────────────────────────────────────────────────────────
// The read path — where a validated statement actually runs.
//
// The blueprint's phrase is "guarded text-to-SQL on a READ path", and the word
// doing the work is *path*, not *guard*. guard.ts inspects a string; this file
// makes the execution environment itself incapable of the thing we're afraid of.
// Four properties hold here regardless of what the statement says:
//
//   READ-ONLY   `SET TRANSACTION READ ONLY` — Postgres refuses an INSERT/UPDATE/
//               DELETE inside it, with the guard's opinion nowhere in the loop. If
//               the guard ever has a bug, this is the layer that means the bug is
//               a wrong answer rather than a mutated loan book.
//   TENANT-BOUND The `app.org_id` stamp + RLS: the statement is physically unable
//               to see another lender's rows, even if it names no org at all.
//   BOUNDED     A statement timeout — an analytics question cannot become an
//               outage. And a row cap, applied by wrapping the statement, so a
//               `select * from riri_borrowers` cannot stream the whole book into
//               a chat panel.
//   OBSERVED    Every run returns its own timing and row count, which the caller
//               writes to RiriQueryLog next to the SQL.
//
// READ REPLICA (blueprint §12: "read replica for all analytics/Riri, never the
// transactional primary") — the seam is `RIRI_READ_DATABASE_URL`. Set it and every
// Riri query moves off the primary with no other change; leave it unset and we run
// on the primary inside a read-only transaction, which is correct but shares the
// primary's CPU. Item 22 provisions the replica; this is the socket it plugs into.
// ⚠ The replica URL MUST be the `lms_app` role (NOBYPASSRLS) — a replica reached as
// `postgres` would serve every tenant's book to every tenant.
// ─────────────────────────────────────────────────────────────────────────────
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { rawPrisma } from "@/lib/prisma";

/** Never return more rows than a person could read in a chat panel. */
export const MAX_ROWS = 200;
/** A question about a book is not allowed to become an incident. */
export const STATEMENT_TIMEOUT_MS = 8_000;

const globalForRead = globalThis as unknown as { ririReadClient?: PrismaClient };

/** The replica when we have one, the primary when we don't. */
function readClient(): PrismaClient {
  const url = process.env.RIRI_READ_DATABASE_URL;
  if (!url) return rawPrisma;
  return (globalForRead.ririReadClient ??= new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }),
    transactionOptions: { maxWait: 15_000, timeout: 30_000 },
  }));
}

export function usingReadReplica(): boolean {
  return Boolean(process.env.RIRI_READ_DATABASE_URL);
}

export type ReadResult =
  | { ok: true; rows: Row[]; ms: number; truncated: boolean }
  | { ok: false; error: string; ms: number };

export type Row = Record<string, unknown>;

/**
 * `count(*)` comes back from Postgres as a bigint, which Prisma faithfully hands
 * over as a JS BigInt — and `JSON.stringify` throws on those. A number that cannot
 * be serialised is a 500 on the way to the person who asked a question, so it is
 * normalised here rather than at each of the call sites that would have to remember.
 */
function normalize(value: unknown): unknown {
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object" && "toNumber" in (value as object)) {
    // Prisma Decimal — the views cast to float8, but a raw statement may not.
    const n = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(n) ? n : null;
  }
  return value;
}

function normalizeRows(rows: Row[]): Row[] {
  return rows.map((r) => {
    const out: Row = {};
    for (const [k, v] of Object.entries(r)) out[k] = normalize(v);
    return out;
  });
}

/**
 * Run a statement that has ALREADY been through `validateReadSql`.
 *
 * Deliberately takes the org explicitly rather than resolving it from the session:
 * the tenant a query runs as is the single most consequential input here, and it
 * should be visible at the call site rather than inherited from ambient state.
 */
export async function runReadQuery(
  orgId: string,
  sql: string,
  params: unknown[] = [],
  opts?: { maxRows?: number; timeoutMs?: number },
): Promise<ReadResult> {
  if (!orgId) throw new Error("[riri] runReadQuery requires an orgId — a query with no tenant runs as nobody.");

  const maxRows = opts?.maxRows ?? MAX_ROWS;
  const timeoutMs = opts?.timeoutMs ?? STATEMENT_TIMEOUT_MS;

  // Ask for one row more than the cap, so we can tell "exactly 200 rows" from
  // "more than we're showing you" and say so rather than quietly truncating.
  const wrapped = `SELECT * FROM (${sql}) AS riri_result LIMIT ${maxRows + 1}`;

  const started = Date.now();
  try {
    const rows = await readClient().$transaction(async (tx) => {
      // FIRST statement in the transaction — Postgres will not accept it later.
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${timeoutMs}`);
      await tx.$executeRaw`SELECT set_config('app.org_id', ${orgId}, TRUE)`;
      return (await tx.$queryRawUnsafe(wrapped, ...params)) as Row[];
    });

    const ms = Date.now() - started;
    const truncated = rows.length > maxRows;
    return { ok: true, rows: normalizeRows(truncated ? rows.slice(0, maxRows) : rows), ms, truncated };
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    return { ok: false, error: friendlyDbError(raw), ms: Date.now() - started };
  }
}

/**
 * The database's own words, translated for the Credit Manager reading the query
 * log — but never softened into a lie. A timeout says it timed out.
 */
function friendlyDbError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("read-only transaction")) {
    return "That query tried to change your book. Riri's connection can only read it.";
  }
  if (m.includes("statement timeout") || m.includes("canceling statement")) {
    return `That query took longer than ${Math.round(STATEMENT_TIMEOUT_MS / 1000)}s and was stopped. Try narrowing it to a shorter period.`;
  }
  if (m.includes("does not exist")) {
    // Most often a column Riri guessed at that the read surface doesn't publish.
    const col = /column\s+"?([a-z0-9_.]+)"?\s+does not exist/i.exec(message)?.[1];
    return col
      ? `Riri's read surface doesn't have a \`${col}\`, so that question can't be answered from it yet.`
      : "Riri's read surface doesn't have one of the fields that question needs.";
  }
  if (m.includes("permission denied")) {
    return "Riri isn't permitted to read that.";
  }
  // Keep the first line only: a Postgres error's tail is a query dump.
  return `The database couldn't run that query: ${message.split("\n")[0].slice(0, 200)}`;
}

/**
 * The statement as the LENDER is shown it — parameters inlined, so what appears in
 * the console and in the query log is the query that ran, not a template with `$1`
 * in it. FOR DISPLAY ONLY: the executed statement is always the parameterised one,
 * so this function is never a SQL-injection surface no matter what it renders.
 */
export function displaySql(sql: string, params: unknown[] = []): string {
  const literal = (p: unknown): string =>
    p === null || p === undefined ? "NULL"
      : typeof p === "number" ? String(p)
      : typeof p === "boolean" ? (p ? "TRUE" : "FALSE")
      : p instanceof Date ? `'${p.toISOString()}'`
      : `'${String(p).replace(/'/g, "''")}'`;

  // One pass, matching the whole placeholder. A naive `replaceAll("$1", …)` would
  // eat the "$1" inside "$10" and leave a stray "0" behind.
  return sql
    .replace(/\$(\d+)/g, (whole, n: string) => {
      const p = params[Number(n) - 1];
      return p === undefined && Number(n) > params.length ? whole : literal(p);
    })
    .replace(/\s+/g, " ")
    .trim();
}
