// ─────────────────────────────────────────────────────────────────────────────
// The exposure broker — node side.
//
// Screen locally, fan out in parallel, aggregate, and never lie about what came
// back. Port of the Registry's `lib/exposure/broker.ts`, with one addition it
// needs to be honest on real data: a member who has never published a book is
// counted as a NON-RESPONDER, not as a member holding nothing.
//
// ── WHY THE SCREENING HAPPENS HERE ───────────────────────────────────────────
// Filters are downloaded and tested inside this process. If the Registry
// screened instead, it would see every token every member ever evaluated —
// rebuilding, centrally, exactly the linkage the OPRF exists to destroy. Local
// screening also means most members never learn a query about their borrower
// happened at all, which protects their origination pipeline from competitors.
//
// ── DEGRADE, NEVER LIE ───────────────────────────────────────────────────────
// A member that times out, errors, or has not published is reported and the
// result is marked `partial`. Returning "no exposure found" when a node was
// unreachable is the single most dangerous thing this service could do: it is
// indistinguishable, to the lender reading it, from a clean borrower.
// ─────────────────────────────────────────────────────────────────────────────
import { mightContain } from "./bloom";
import { signRequest } from "./signing";
import { registryUrl, type MemberIdentity, type PublishedFilter } from "./registry";

/**
 * Per-member budget. The whole query targets p95 under 400ms (blueprint Table 7).
 *
 * ── 250ms ASSUMES A NODE READS ITS OWN BOOK LOCALLY ──────────────────────────
 * In the deployed architecture a member's node answers from a database inside
 * its own perimeter, so the read is a millisecond and 250ms is almost entirely
 * network between nodes.
 *
 * That is NOT true in the current topology. Every node is served by one app
 * whose Postgres is Supabase in eu-central-1, and a bare `SELECT 1` to it
 * measures 223ms median from here. The per-node budget is therefore spent
 * reaching Frankfurt before any work happens, and every member times out — which
 * the broker correctly reports as `partial` rather than as "no exposure", but
 * which makes the 400ms acceptance a measurement of distance rather than of
 * design.
 *
 * So the value is overridable. Raise it to measure the fan-out in a topology
 * with a remote database; leave it at 250 to hold the real target. Moving the
 * Registry's database next to the app, or deploying real member nodes, is the
 * fix — not a bigger number.
 */
export const NODE_TIMEOUT_MS = (() => {
  const raw = Number(process.env.INTERCHANGE_NODE_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 250;
})();

export type NodeAnswer = {
  memberCode: string;
  hasExposure: boolean;
  activeLoans?: number;
  outstandingBand?: string;
  worstBucket?: string;
  newestDisbursement?: string | null;
  asOf?: string | null;
};

export type ExposureResult = {
  subjectToken: string;
  asOf: string;
  activeLoans: number;
  lenders: number;
  outstandingBand: string;
  worstBucket: string;
  newestDisbursement: string | null;
  velocity14d: number;
  partial: boolean;
  screened: number;
  queried: number;
  responded: number;
  /** Members asked that could not answer, and why — the honesty of `partial`. */
  silent: { memberCode: string; reason: "timeout" | "unpublished" | "error" }[];
  lendersNamed: string[] | null;
  timings: { screenMs: number; fanoutMs: number; totalMs: number };
};

const BUCKET_ORDER = ["prepayment", "due", "watch_1", "watch_2", "watch_3", "npl"];

function worstOf(buckets: string[]): string {
  let worst = "due";
  let rank = -1;
  for (const b of buckets) {
    const i = BUCKET_ORDER.indexOf(b);
    if (i > rank) {
      rank = i;
      worst = b;
    }
  }
  return worst;
}

/** Bands are not additive, so the ecosystem total sums midpoints and re-bands. */
const BAND_MIDPOINT: Record<string, number> = {
  none: 0,
  "<10k": 5_000,
  "10k–25k": 17_500,
  "25k–50k": 37_500,
  "50k–100k": 75_000,
  "100k–250k": 175_000,
  "250k+": 350_000,
};

function bandTotal(bands: string[]): string {
  const total = bands.reduce((a, b) => a + (BAND_MIDPOINT[b] ?? 0), 0);
  if (total <= 0) return "none";
  if (total < 10_000) return "<10k";
  if (total < 25_000) return "10k–25k";
  if (total < 50_000) return "25k–50k";
  if (total < 100_000) return "50k–100k";
  if (total < 250_000) return "100k–250k";
  return "250k+";
}

/**
 * Which members might hold this borrower?
 *
 * A member with NO published filter is always queried. Absence of a filter is not
 * evidence of absence of exposure, and quietly skipping them would produce
 * exactly the false negative this design refuses to allow.
 */
export function screen(
  subjectToken: string,
  allMemberCodes: string[],
  filters: PublishedFilter[],
): string[] {
  const byCode = new Map(filters.map((f) => [f.member_code, f]));
  const candidates: string[] = [];

  for (const code of allMemberCodes) {
    const f = byCode.get(code);
    if (!f) {
      candidates.push(code);
      continue;
    }
    const bits = Buffer.from(f.bits, "base64");
    if (mightContain(bits, { m: f.m, k: f.k }, subjectToken)) candidates.push(code);
  }
  return candidates;
}

type AskResult =
  | { ok: true; answer: NodeAnswer }
  | { ok: false; reason: "timeout" | "unpublished" | "error" };

async function askNode(
  who: MemberIdentity,
  memberCode: string,
  subjectToken: string,
): Promise<AskResult> {
  const path = "/api/node/exposure";
  const body = JSON.stringify({ subject_token: subjectToken, member_code: memberCode });
  const headers = signRequest({
    method: "POST",
    path,
    body,
    memberCode: who.code,
    secretKeyHex: who.secretKey,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NODE_TIMEOUT_MS);
  try {
    const res = await fetch(`${registryUrl()}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
      signal: controller.signal,
    });

    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      // A member with no published book is a KNOWN unknown. It is reported as
      // such rather than folded into "error", because the two call for different
      // action: one is an outage, the other is an ingest that has not been run.
      if (j.error === "BOOK_NOT_PUBLISHED") return { ok: false, reason: "unpublished" };
      return { ok: false, reason: "error" };
    }

    const j = (await res.json()) as Record<string, unknown>;
    return {
      ok: true,
      answer: {
        memberCode: String(j.member_code),
        hasExposure: Boolean(j.has_exposure),
        activeLoans: j.active_loans as number | undefined,
        outstandingBand: j.outstanding_band as string | undefined,
        worstBucket: j.worst_bucket as string | undefined,
        newestDisbursement: (j.newest_disbursement as string | null) ?? null,
        asOf: (j.as_of as string | null) ?? null,
      },
    };
  } catch (e) {
    return { ok: false, reason: (e as Error).name === "AbortError" ? "timeout" : "error" };
  } finally {
    clearTimeout(timer);
  }
}

export async function queryExposure(opts: {
  who: MemberIdentity;
  /** Every member that could be asked. The caller is excluded automatically. */
  memberCodes: string[];
  filters: PublishedFilter[];
  subjectToken: string;
  discloseLenders: boolean;
}): Promise<ExposureResult> {
  const t0 = Date.now();

  // The caller already knows its own book, and including it would double-count
  // its own exposure in the ecosystem total the borrower is shown.
  const askable = opts.memberCodes.filter((c) => c !== opts.who.code);
  const candidates = screen(opts.subjectToken, askable, opts.filters);
  const screenMs = Date.now() - t0;

  const t1 = Date.now();
  const results = await Promise.all(
    candidates.map(async (code) => ({ code, r: await askNode(opts.who, code, opts.subjectToken) })),
  );
  const fanoutMs = Date.now() - t1;

  const responded = results.filter((x) => x.r.ok).map((x) => (x.r as { ok: true; answer: NodeAnswer }).answer);
  const silent = results
    .filter((x) => !x.r.ok)
    .map((x) => ({ memberCode: x.code, reason: (x.r as { reason: "timeout" | "unpublished" | "error" }).reason }));

  const withExposure = responded.filter((a) => a.hasExposure);

  const newest =
    withExposure
      .map((a) => a.newestDisbursement)
      .filter((d): d is string => !!d)
      .sort()
      .pop() ?? null;

  const fourteenDaysAgo = Date.now() - 14 * 86_400_000;
  const velocity14d = withExposure.filter(
    (a) => a.newestDisbursement && Date.parse(a.newestDisbursement) >= fourteenDaysAgo,
  ).length;

  return {
    subjectToken: opts.subjectToken,
    asOf: new Date().toISOString(),
    activeLoans: withExposure.reduce((a, x) => a + (x.activeLoans ?? 0), 0),
    lenders: withExposure.length,
    outstandingBand: bandTotal(withExposure.map((a) => a.outstandingBand ?? "none")),
    worstBucket: worstOf(withExposure.map((a) => a.worstBucket ?? "due")),
    newestDisbursement: newest,
    velocity14d,
    partial: silent.length > 0,
    screened: askable.length,
    queried: candidates.length,
    responded: responded.length,
    silent,
    lendersNamed: opts.discloseLenders ? withExposure.map((a) => a.memberCode) : null,
    timings: { screenMs, fanoutMs, totalMs: Date.now() - t0 },
  };
}
