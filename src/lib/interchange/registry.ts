// ─────────────────────────────────────────────────────────────────────────────
// The Registry client — how this deployment talks to the Interchange.
//
// Every call here is Ed25519-signed as a specific MEMBER. That matters more than
// it looks: this one deployment hosts several member nodes (blueprint v2 §1 —
// "nodes are hosted by you on your hardware; members get an endpoint, not a
// server"), so "which member is asking" is never ambient. It is passed in, and
// the signature proves it.
//
// ── WHERE THE KEYS LIVE ──────────────────────────────────────────────────────
// INTERCHANGE_NODE_KEYS is a JSON object mapping member code → Ed25519 secret
// key hex. One env var rather than one per member because the set grows: Axe
// alone is two entities, and every entity is its own member with its own key.
//
// ⚠ These are the private halves. They are what lets this process speak AS
// Micromart or AS Axe, and a leak is impersonation of a lender inside a credit
// network. They belong in the platform's secret store, never in a repo, and the
// production ones should be generated on this host and never travel.
// ─────────────────────────────────────────────────────────────────────────────
import { signRequest } from "./signing";
import { blind, finalize, type IdentifierKind } from "./oprf";

export type MemberIdentity = { code: string; secretKey: string };

export class InterchangeUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InterchangeUnavailable";
  }
}

/** Is this deployment wired to the Interchange at all? */
export function interchangeConfigured(): boolean {
  return !!process.env.INTERCHANGE_URL?.trim() && !!process.env.INTERCHANGE_NODE_KEYS?.trim();
}

export function registryUrl(): string {
  const u = process.env.INTERCHANGE_URL?.trim();
  if (!u) throw new InterchangeUnavailable("INTERCHANGE_URL is not set.");
  return u.replace(/\/+$/, "");
}

let keyCache: Record<string, string> | null = null;

function nodeKeys(): Record<string, string> {
  if (keyCache) return keyCache;
  const raw = process.env.INTERCHANGE_NODE_KEYS?.trim();
  if (!raw) throw new InterchangeUnavailable("INTERCHANGE_NODE_KEYS is not set.");
  try {
    keyCache = JSON.parse(raw) as Record<string, string>;
  } catch {
    throw new InterchangeUnavailable("INTERCHANGE_NODE_KEYS is not valid JSON.");
  }
  return keyCache;
}

/** The signing identity for one member code, or a clear refusal. */
export function memberIdentity(code: string): MemberIdentity {
  const secretKey = nodeKeys()[code];
  if (!secretKey) {
    throw new InterchangeUnavailable(
      `No Interchange node key for ${code}. This deployment cannot sign as that member.`,
    );
  }
  return { code, secretKey };
}

export function hasMemberIdentity(code: string): boolean {
  try {
    return !!nodeKeys()[code];
  } catch {
    return false;
  }
}

type Json = Record<string, unknown>;

/** A signed POST to the Registry. Returns status and parsed body, never throws on 4xx. */
export async function signedPost(
  who: MemberIdentity,
  path: string,
  body: unknown,
  opts: { timeoutMs?: number } = {},
): Promise<{ status: number; json: Json; headers: Headers }> {
  const payload = JSON.stringify(body);
  const headers = signRequest({
    method: "POST",
    path,
    body: payload,
    memberCode: who.code,
    secretKeyHex: who.secretKey,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
  try {
    const res = await fetch(`${registryUrl()}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: payload,
      signal: controller.signal,
    });
    return {
      status: res.status,
      json: (await res.json().catch(() => ({}))) as Json,
      headers: res.headers,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** An unsigned POST — only /api/consent, which a member calls from onboarding. */
export async function plainPost(path: string, body: unknown, opts: { timeoutMs?: number } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  try {
    const res = await fetch(`${registryUrl()}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Json };
  } finally {
    clearTimeout(timer);
  }
}

// ── Tokenisation ─────────────────────────────────────────────────────────────

/** Chunk size for batch evaluation. The Registry refuses more than 2,000. */
const EVALUATE_CHUNK = 1_000;

/**
 * Derive subject tokens for a list of identifiers, in order.
 *
 * The blinding and the finalizing both happen HERE; the Registry only ever sees
 * uniformly random points. `purpose: "ingest"` spends the node's own book
 * allowance rather than the serving one — see the Registry's lib/oprf/registry.ts
 * for why those are two different budgets.
 */
export async function deriveTokens(
  who: MemberIdentity,
  kind: IdentifierKind,
  identifiers: string[],
  purpose: "serving" | "ingest" = "serving",
  onProgress?: (done: number, total: number) => void,
): Promise<string[]> {
  const tokens: string[] = [];

  for (let i = 0; i < identifiers.length; i += EVALUATE_CHUNK) {
    const slice = identifiers.slice(i, i + EVALUATE_CHUNK);
    const blinds = slice.map((id) => blind(kind, id));

    const res = await signedPost(
      who,
      "/api/oprf/evaluate",
      { blinded: blinds.map((b) => b.blindedHex), purpose },
      { timeoutMs: 120_000 },
    );

    if (res.status !== 200) {
      throw new InterchangeUnavailable(
        `OPRF evaluate failed (${res.status}): ${String(res.json.message ?? res.json.error ?? "unknown")}`,
      );
    }
    const evaluated = res.json.evaluated;
    if (!Array.isArray(evaluated) || evaluated.length !== slice.length) {
      throw new InterchangeUnavailable("OPRF evaluate returned the wrong number of elements.");
    }

    for (let j = 0; j < slice.length; j++) {
      tokens.push(finalize(blinds[j].input, blinds[j].blind, String(evaluated[j])));
    }
    onProgress?.(Math.min(i + EVALUATE_CHUNK, identifiers.length), identifiers.length);
  }

  return tokens;
}

/** One identifier — the live path, used when a borrower is actually in front of us. */
export async function deriveToken(
  who: MemberIdentity,
  kind: IdentifierKind,
  identifier: string,
): Promise<string> {
  const [t] = await deriveTokens(who, kind, [identifier], "serving");
  return t;
}

// ── Consent ──────────────────────────────────────────────────────────────────

export const MANDATORY_SCOPES = [
  "mpesa.crunch",
  "kyc.verify",
  "bureau.pull",
  "ecosystem.exposure",
  "outcome.label",
  "model.train",
  "collections.contact",
] as const;

export async function issueConsent(opts: {
  subjectToken: string;
  memberCode: string;
  scopes?: readonly string[];
  capturedVia?: "PWA" | "LMS_CONSOLE" | "MEMBER_API" | "FIELD_OFFICER";
  wordingVersion?: string;
  ttlDays?: number;
  evidence?: unknown;
}): Promise<{ ok: true; ref: string } | { ok: false; status: number; message: string }> {
  const res = await plainPost("/api/consent", {
    subject_token: opts.subjectToken,
    member_code: opts.memberCode,
    scopes: opts.scopes ?? MANDATORY_SCOPES,
    captured_via: opts.capturedVia ?? "PWA",
    wording_version: opts.wordingVersion,
    ttl_days: opts.ttlDays,
    evidence: opts.evidence,
  });
  if (res.status === 201 && typeof res.json.consent_ref === "string") {
    return { ok: true, ref: res.json.consent_ref };
  }
  return {
    ok: false,
    status: res.status,
    message: String(res.json.message ?? res.json.error ?? "Consent could not be issued."),
  };
}

// ── Authorisation ────────────────────────────────────────────────────────────

export type Authorisation =
  | { ok: true; auditId: string; latencyMs: number }
  | { ok: false; outcome: string; reason: string; status: number };

/**
 * Ask the Registry whether this member may run this query about this subject.
 *
 * This is the hard gate — reciprocity, quota, consent, scope — and it is a
 * SEPARATE call from the fan-out on purpose. The broker never decides whether it
 * is allowed to run; it is told, by the one component that writes the audit row.
 */
export async function authorise(
  who: MemberIdentity,
  opts: { serviceCode: string; subjectToken: string; consentRef: string },
): Promise<Authorisation> {
  const res = await signedPost(who, "/api/exchange", {
    service_code: opts.serviceCode,
    subject_token: opts.subjectToken,
    consent_ref: opts.consentRef,
  });

  if (res.status === 200 && res.json.authorised === true) {
    return {
      ok: true,
      auditId: String(res.json.audit_id ?? ""),
      latencyMs: Number(res.json.latency_ms ?? 0),
    };
  }
  return {
    ok: false,
    status: res.status,
    outcome: String(res.json.outcome ?? res.json.error ?? "REFUSED"),
    reason: String(res.json.reason ?? res.json.message ?? "The Registry refused this query."),
  };
}

// ── Filters ──────────────────────────────────────────────────────────────────

export type PublishedFilter = {
  member_code: string;
  generation: number;
  m: number;
  k: number;
  item_count: number;
  bits: string;
};

export async function fetchFilters(opts: { timeoutMs?: number } = {}): Promise<PublishedFilter[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  try {
    const res = await fetch(`${registryUrl()}/api/filters`, { signal: controller.signal });
    if (!res.ok) throw new InterchangeUnavailable(`Could not fetch filters: ${res.status}`);
    const j = (await res.json()) as { filters: PublishedFilter[] };
    return j.filters ?? [];
  } finally {
    clearTimeout(timer);
  }
}

// ── Publication ──────────────────────────────────────────────────────────────

export type HoldingWire = {
  subject_token: string;
  active_loans: number;
  outstanding_kes: number;
  worst_bucket: string;
  newest_disbursed_at: string | null;
};

/**
 * Publish one chunk of this member's book.
 *
 * `generation` is chosen by the node and every chunk of one publication carries
 * the same value; `commit` on the last chunk is what makes the whole generation
 * visible at once. Nothing is ever deleted first — see the MemberHolding comment
 * in the Registry schema for why a delete-then-insert would be dangerous.
 */
export async function publishHoldings(
  who: MemberIdentity,
  opts: {
    generation: number;
    holdings: HoldingWire[];
    commit: boolean;
    summary?: { borrowers: number; loans: number; lastLoanAt: string | null };
  },
): Promise<{ status: number; json: Json }> {
  return signedPost(
    who,
    "/api/node/holdings",
    {
      member_code: who.code,
      generation: opts.generation,
      holdings: opts.holdings,
      commit: opts.commit,
      summary: opts.summary,
    },
    { timeoutMs: 180_000 },
  );
}
