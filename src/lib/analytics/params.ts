// ─────────────────────────────────────────────────────────────────────────────
// THE URL IS THE STATE.
//
// Every filter in the studio lives in the query string, and that is a product
// decision rather than a technical one. An analytics finding is worthless if the
// person who found it cannot send it to somebody: "PAR by branch, last quarter,
// Kitale region only" has to be a LINK, or the next thing that happens is a
// screenshot in WhatsApp with no provenance and no way to check it.
//
// Consequences that fall out of it for free, and are the reason to do it this
// way rather than with client state:
//   · every view is shareable, bookmarkable and reproducible
//   · the browser's back button works the way people expect
//   · pages stay SERVER components — the filters arrive as searchParams, the
//     query runs on the server, and no aggregate is ever shipped to the browser
//     to be recomputed
//
// Parsing is deliberately forgiving. A hand-edited or truncated link resolves to
// the nearest sane view rather than an error page: an unknown range falls back
// to 30 days, an unparseable date is dropped, ids are length-capped. Nothing
// here trusts its input — the ids flow into SQL as bound parameters downstream,
// but a cap here keeps a hostile URL from turning into a 10,000-element IN list.
// ─────────────────────────────────────────────────────────────────────────────
import { resolveRange, rangeDef, type RangeKey, type Bucket } from "./ranges";
import type { StudioFilters } from "./engine";

/** Next 15 hands page components a promise of this. */
export type SearchParams = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));

/** A comma list → a capped, de-duplicated id array. */
function ids(v: string | string[] | undefined, cap = 50): string[] {
  const raw = one(v);
  if (!raw) return [];
  return [...new Set(raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0 && s.length <= 64))].slice(0, cap);
}

function date(v: string | string[] | undefined): Date | null {
  const raw = one(v);
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

const BUCKETS: Bucket[] = ["hour", "day", "week", "month", "quarter", "year"];

/** A comma list of ServiceSuite EntityIds. Integers only, capped — nothing else survives. */
function entityIds(v: string | string[] | undefined): number[] {
  const raw = one(v);
  if (!raw) return [];
  const out = raw.split(",").map((s) => Number(s.trim())).filter((x) => Number.isInteger(x) && x > 0);
  return [...new Set(out)].slice(0, 8);
}

export type ParsedParams = {
  filters: StudioFilters;
  /** Present only when the reader forced a grain. Null means "follow the range". */
  bucket: Bucket | null;
  /** Free-form, per-screen: which dimension to slice by. */
  dimension: string | null;
  /** Free-form, per-screen: which ranking definition to use. */
  rank: string | null;
  /** The chart builder's ticked field keys. */
  fields: string[];
  /** The chart builder's chosen form. */
  form: string | null;
  /** How many rows a leaderboard shows. */
  top: number;
  /**
   * Which of the lender's books to read, as ServiceSuite EntityIds.
   *
   * Empty means "the book you were already in" — the studio opens on the console
   * realm rather than making a manager re-pick something they picked already.
   * Validated downstream against the lender's OWN declared entities, so a
   * hand-typed id can only ever select a book that lender actually has.
   */
  entityIds: number[];
  /** Break every measure out per book rather than summing them. */
  split: boolean;
};

export function parseParams(sp: SearchParams, opts: { inceptionFrom?: Date | null } = {}): ParsedParams {
  const rawRange = one(sp.range) || "30d";
  const key: RangeKey = rawRange === "custom" || rangeDef(rawRange) ? (rawRange as RangeKey) : "30d";

  const bucketRaw = one(sp.grain);
  const bucket = BUCKETS.includes(bucketRaw as Bucket) ? (bucketRaw as Bucket) : null;

  const range = resolveRange(key, {
    inceptionFrom: opts.inceptionFrom ?? null,
    customFrom: date(sp.from),
    customTo: date(sp.to),
    bucket,
  });

  const topRaw = Number(one(sp.top));
  const top = Number.isFinite(topRaw) ? Math.min(100, Math.max(3, Math.round(topRaw))) : 10;

  return {
    filters: {
      range,
      branchIds: ids(sp.branch),
      officerIds: ids(sp.officer),
      productIds: ids(sp.product),
      riskBands: ids(sp.risk, 8),
    },
    bucket,
    dimension: one(sp.by) || null,
    rank: one(sp.rank) || null,
    fields: ids(sp.f, 12),
    form: one(sp.form) || null,
    top,
    entityIds: entityIds(sp.ent),
    split: one(sp.split) === "1",
  };
}

/**
 * Rebuild a query string with some keys changed.
 *
 * Empty values are REMOVED rather than written as `key=`, so a link a person
 * copies carries only the filters they actually set. A URL full of empty
 * parameters looks broken and, worse, invites somebody to "fix" one.
 */
export function buildQuery(current: URLSearchParams, patch: Record<string, string | string[] | number | null | undefined>): string {
  const next = new URLSearchParams(current.toString());
  for (const [k, v] of Object.entries(patch)) {
    const value = Array.isArray(v) ? v.join(",") : v == null ? "" : String(v);
    if (!value) next.delete(k);
    else next.set(k, value);
  }
  const s = next.toString();
  return s ? `?${s}` : "";
}

/** How many filters are narrowing the view — the badge on the filter button. */
export function activeFilterCount(f: StudioFilters): number {
  return (
    (f.branchIds.length ? 1 : 0) +
    (f.officerIds.length ? 1 : 0) +
    (f.productIds.length ? 1 : 0) +
    (f.riskBands.length ? 1 : 0)
  );
}
