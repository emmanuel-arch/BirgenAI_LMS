// ─────────────────────────────────────────────────────────────────────────────
// The guard — the only door analytics SQL goes through.
//
// It sits in front of BOTH sources of SQL, deliberately:
//   • the metric compiler (catalog.ts), which we wrote, and
//   • a language model (planner.ts), which we did not.
//
// That symmetry is the whole design. A guard that only inspects LLM output is
// betting that our own compiler has no bugs; a guard that inspects everything is
// betting nothing. When the day comes that RIRI_LLM_KEY is set and Riri starts
// writing her own SQL, not one line of this file has to change — which is the
// point at which you find out whether the boundary was real.
//
// FOUR LAYERS, each of which alone would be insufficient:
//
//   1. THIS FILE — a syntactic allowlist. Read-shaped statements only, over a
//      published read surface (prisma/riri-views.sql), using known functions.
//   2. NO DOUBLE QUOTES — every Prisma base table needs one ("Loan", "orgId");
//      every view and column in the read surface is lowercase_snake and needs
//      none. Rejecting the character makes the base tables — and therefore
//      password hashes, vault ciphertext and national IDs — unreachable by
//      construction rather than by pattern-matching. Bare `Loan` folds to `loan`,
//      which is not a relation.
//   3. A READ-ONLY TRANSACTION (readpath.ts) — Postgres itself refuses a write,
//      so even a statement that talks its way past this file cannot mutate a book.
//   4. ROW-LEVEL SECURITY — the statement runs as `lms_app` (NOBYPASSRLS) with the
//      caller's `app.org_id` stamped, so even a permitted SELECT over a permitted
//      view can only ever return the caller's own rows.
//
// Layer 1 is the one that can be argued with. Layers 2–4 are why being wrong here
// is not a breach.
// ─────────────────────────────────────────────────────────────────────────────

/** Riri's read surface — the views in prisma/riri-views.sql. Nothing else exists. */
export const READ_SURFACE = [
  "riri_loans",
  "riri_installments",
  "riri_borrowers",
  "riri_products",
  "riri_applications",
  "riri_disbursements",
  "riri_payments",
  "riri_scores",
  "riri_staff",
  "riri_branches",
  "riri_field_visits",
  "riri_promises",
  "riri_calls",
  "riri_tickets",
] as const;

export type ReadView = (typeof READ_SURFACE)[number];
const SURFACE = new Set<string>(READ_SURFACE);

/**
 * Functions Riri may call. An ALLOWLIST, not a denylist: analytics needs a small,
 * predictable vocabulary, and the cost of a wrong "no" here is a logged refusal we
 * can read and fix — while the cost of a wrong "yes" on a denylist is pg_read_file.
 *
 * A refusal names the function and lands in RiriQueryLog, so the list grows from
 * evidence about what lenders actually ask rather than from our imagination.
 */
const ALLOWED_FUNCTIONS = new Set([
  // aggregate
  "sum", "count", "avg", "min", "max", "stddev", "stddev_pop", "stddev_samp", "variance",
  // window
  "row_number", "rank", "dense_rank", "lag", "lead", "over",
  // numeric
  "round", "abs", "ceil", "ceiling", "floor", "trunc", "greatest", "least", "mod", "power", "sqrt",
  // null / conditional
  "coalesce", "nullif",
  // date & time.
  // NOTE `extract` is deliberately absent, and so are `trim`/`substring`: their
  // Postgres spellings put a FROM *inside* the parentheses (`extract(month from
  // due_date)`), which the table scan below would read as a table reference. Rather
  // than teach the scanner to parse SQL properly, we decline the two functions that
  // create the ambiguity — `date_part` does the same job with a comma.
  "date_trunc", "date_part", "age", "now", "current_date", "current_timestamp", "to_char", "make_interval",
  // text
  "lower", "upper", "length", "left", "right", "concat", "split_part",
  // casting
  "cast",
]);

/**
 * Words that may legally precede an opening parenthesis without being a function
 * call. Without this list, `where status in ('ACTIVE')` reads as a call to `in`.
 */
const KEYWORDS_BEFORE_PAREN = new Set([
  "in", "not", "and", "or", "on", "exists", "values", "select", "from", "where", "having",
  "by", "when", "then", "else", "all", "any", "some", "union", "intersect", "except",
  "filter", "as", "using", "case", "distinct", "returning", "join", "order", "group", "limit", "offset",
]);

/**
 * Statement-level bans. Everything here is either a write, a transaction verb, a
 * session mutation, or a way of reaching outside the read surface. `into` earns its
 * place: `SELECT … INTO new_table` is a CREATE TABLE wearing a SELECT's clothes.
 */
const BANNED_KEYWORDS = [
  "insert", "update", "delete", "merge", "upsert", "truncate", "drop", "alter", "create",
  "grant", "revoke", "copy", "vacuum", "reindex", "cluster", "refresh", "call", "do",
  "execute", "prepare", "deallocate", "listen", "notify", "unlisten", "lock", "into",
  "set", "reset", "begin", "start", "commit", "rollback", "savepoint", "declare", "fetch",
  "close", "comment", "analyze", "explain", "security", "definer", "owner", "password",
];

/** Anything that reaches outside the published surface, whatever the syntax around it. */
const BANNED_PATTERNS: { re: RegExp; why: string }[] = [
  { re: /\bpg_[a-z_]*/i, why: "the database's own catalogue and internals are not part of your book" },
  { re: /\binformation_schema\b/i, why: "the schema catalogue is not part of your book" },
  { re: /\bcurrent_setting\b|\bset_config\b/i, why: "session settings carry the tenant fence and are not readable" },
  { re: /\bdblink|\bpostgres_fdw|\blo_import|\blo_export/i, why: "reaching another server or the filesystem is never an analytics question" },
  { re: /::\s*regclass|::\s*regproc|::\s*regtype/i, why: "casting to a catalogue reference reaches outside the read surface" },
  { re: /\bcurrent_user\b|\bsession_user\b|\buser\b\s*\(|\bversion\s*\(/i, why: "database identity is not part of your book" },
];

export type GuardResult = { ok: true; sql: string } | { ok: false; reason: string };

const deny = (reason: string): GuardResult => ({ ok: false, reason });

/**
 * Validate a statement for the read path.
 *
 * Refusals are phrased for the person who will read them in the query log — the
 * lender's Credit Manager, not us. "Riri may only read from your book, never
 * change it" is a sentence that explains itself; "SQL validation failed" is not.
 */
export function validateReadSql(input: string): GuardResult {
  const sql = (input ?? "").trim();

  if (!sql) return deny("There was no query to run.");
  if (sql.length > 2000) return deny("That query is too long to be a question about your book.");

  // One statement. A semicolon is how two statements become one attack.
  if (sql.includes(";")) return deny("Only a single statement may run — remove the semicolon.");

  // The load-bearing rule. See the header, and prisma/riri-views.sql.
  if (sql.includes('"')) {
    return deny(
      "Riri reads your book through her published views, which never need quoted names. " +
        "A quoted identifier means reaching for a raw table, and that is not allowed.",
    );
  }

  // Comments are how a banned word is smuggled past a scanner that reads text.
  if (sql.includes("--") || sql.includes("/*") || sql.includes("*/")) {
    return deny("Comments aren't allowed in an analytics query.");
  }

  const lower = sql.toLowerCase();

  if (!/^\s*(with|select)\b/.test(lower)) {
    return deny("Riri may only read from your book, never change it — a query has to begin with SELECT.");
  }

  for (const word of BANNED_KEYWORDS) {
    if (new RegExp(`\\b${word}\\b`).test(lower)) {
      return deny(`\`${word.toUpperCase()}\` isn't permitted — Riri has read-only access to your book.`);
    }
  }

  for (const { re, why } of BANNED_PATTERNS) {
    if (re.test(lower)) return deny(`That query was refused: ${why}.`);
  }

  // Old-style comma joins hide a second table where the FROM/JOIN scan below is not
  // looking. Requiring an explicit JOIN costs a real question nothing.
  if (/\bfrom\s+[a-z_][a-z0-9_]*(\s+(as\s+)?[a-z_][a-z0-9_]*)?\s*,/.test(lower)) {
    return deny("Join tables explicitly with JOIN … ON … rather than with a comma.");
  }

  // CTE names are legal FROM targets — collect them before checking the targets.
  const cteNames = new Set<string>();
  for (const m of lower.matchAll(/(?:\bwith\b|,)\s*([a-z_][a-z0-9_]*)\s+as\s*\(/g)) cteNames.add(m[1]);

  // Functions FIRST, tables second. The order matters: a function whose Postgres
  // spelling hides a FROM inside its parentheses would otherwise be refused by the
  // table scan with a baffling message about a table named `due_date`.
  for (const m of lower.matchAll(/\b([a-z_][a-z0-9_]*)\s*\(/g)) {
    const fn = m[1];
    if (KEYWORDS_BEFORE_PAREN.has(fn) || cteNames.has(fn)) continue;
    if (!ALLOWED_FUNCTIONS.has(fn)) {
      return deny(`Riri isn't allowed to use \`${fn}()\` in an analytics query.`);
    }
  }

  // Every table referenced must be a published view (or a CTE over published views).
  const targets = [...lower.matchAll(/\b(?:from|join)\s+([a-z_][a-z0-9_]*)/g)].map((m) => m[1]);
  for (const t of targets) {
    if (SURFACE.has(t) || cteNames.has(t)) continue;
    return deny(
      `Riri doesn't have a table called \`${t}\`. She reads your book through: ${READ_SURFACE.join(", ")}.`,
    );
  }

  // A SELECT with no table at all (`select 1`, or a lone scalar) reads nothing from
  // the book, so it answers no question — and it is the shape a probe takes.
  if (targets.length === 0) return deny("That query doesn't read anything from your book.");

  return { ok: true, sql };
}
