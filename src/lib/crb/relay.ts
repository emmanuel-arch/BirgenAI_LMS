// ─────────────────────────────────────────────────────────────────────────────
// THE CRB RELAY (client half) — how a serverless deployment calls a bureau that
// answers only a fixed list of source addresses.
//
// ── THE PROBLEM, STATED PRECISELY ────────────────────────────────────────────
// Metropol drops any request from an unregistered source IP at their edge. Not
// a 403 — nothing. No HTTP response, no api_code, no log line. In the console
// that surfaces as a bare connection failure, which reads like "the bureau is
// down" and never like "you are calling from the wrong address".
//
// Two of our three callers cannot satisfy that whitelist:
//
//   · VERCEL has no stable outbound IP. Serverless functions egress from a
//     rotating cloud pool, so there is no address to register and no setting
//     that creates one short of Secure Compute (Enterprise). This is not
//     fixable with an environment variable.
//   · THE OFFICE LINK is a Safaricom DHCP pool inside 41.90.128.0/17. It moves.
//     It was 41.90.172.115, then 41.90.173.56. Whitelisting it buys days.
//
// Exactly one caller does satisfy it: the IIS production server at
// 102.214.69.233 (servicesuitecloud.com), which is static, always on, and
// MicroMart's own box. It is already whitelisted, and it is already where the
// native C# portal's bureau calls originate.
//
// ── THE FIX ──────────────────────────────────────────────────────────────────
// Move the SOCKET, not the application — the same move already proven for SQL
// in lib/enterprise/relay.ts. One small process (scripts/crb-relay.ts) runs on
// the whitelisted host and makes the bureau call on the caller's behalf:
//
//   Vercel fn ──HTTPS(signed)──► crb-relay (whitelisted IP) ──►  Metropol
//
// Every bureau call in this codebase already funnels through ONE function,
// metropolFetch() in ./metropol. That is the only place that changes: it asks
// crbRelayEnabled() and either dials Metropol directly or posts here. No report
// call, no route and no screen changes, and with CRB_RELAY_URL unset the relay
// does not exist and the direct path runs exactly as before — which is what
// keeps a whitelisted host (and the C# twin) on a straight connection with no
// extra hop.
//
// ── WHY THIS FILE DOES NOT IMPORT THE SQL RELAY'S HMAC ───────────────────────
// lib/enterprise/relay.ts has an identical sign()/verify() pair, and reusing it
// would be the obvious move. It is deliberately not reused: that module imports
// mssql at the top, and the CRB relay has to be deployable onto the IIS box — a
// machine with no business holding a database driver, a connection pool or a
// Serviceconnect credential. Six lines of HMAC is a cheaper dependency than
// dragging the whole SQL stack onto the bureau's egress host. The two must stay
// in step; the formula is the one line in crbSign and nothing else is shared.
// ─────────────────────────────────────────────────────────────────────────────
import { createHmac, timingSafeEqual } from "node:crypto";

/** How long a signed request stays valid. Room for clock skew, useless if captured. */
export const CRB_RELAY_SKEW_MS = 120_000;

export const CRB_RELAY_TS_HEADER = "x-crb-relay-ts";
export const CRB_RELAY_SIG_HEADER = "x-crb-relay-sig";

/**
 * The ONLY host this relay will ever call, enforced on the SERVER side.
 *
 * The caller supplies a full URL, so without this the relay is an open proxy
 * that anyone holding the secret can point at a cloud metadata service, at an
 * internal address, or at the tailnet. This allowlist is the difference between
 * "a bureau egress hop" and "SSRF with an HMAC on it".
 */
export const CRB_RELAY_ALLOWED_HOSTS = ["api.metropol.co.ke"];

// ── The wire format ──────────────────────────────────────────────────────────
// Deliberately dumb: the relay does not parse, validate or understand a bureau
// payload. It carries opaque bytes and hands back opaque bytes. Metropol's hash
// covers the exact body, so anything that re-serialized it in flight would
// invalidate the signature and surface as E027 — a transport bug wearing the
// costume of a key fault.

export type CrbRelayRequest = {
  /** Absolute https URL at the bureau. The relay re-validates the host itself. */
  url: string;
  method: "GET" | "POST";
  /** Includes the three X-METROPOL-* auth headers, already signed by the caller. */
  headers: Record<string, string>;
  /** Compact JSON, byte-identical to what the caller hashed. Absent on GET. */
  body?: string;
  timeoutMs: number;
};

export type CrbRelayResponse =
  | { ok: true; status: number; text: string; elapsedMs: number }
  | { ok: false; error: string };

// ── Signing ──────────────────────────────────────────────────────────────────

export function crbSign(secret: string, ts: string, body: string): string {
  return createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
}

/** Constant-time verification, including the length check timingSafeEqual demands. */
export function crbVerify(secret: string, ts: string, body: string, sig: string): boolean {
  const expected = crbSign(secret, ts, body);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(sig ?? "", "utf8");
  if (a.length !== b.length) return false;
  if (!timingSafeEqual(a, b)) return false;
  const age = Math.abs(Date.now() - Number(ts));
  return Number.isFinite(age) && age <= CRB_RELAY_SKEW_MS;
}

// ── Configuration ────────────────────────────────────────────────────────────

export function crbRelayUrl(): string {
  return (process.env.CRB_RELAY_URL ?? "").trim().replace(/\/$/, "");
}

function crbRelaySecret(): string {
  return (process.env.CRB_RELAY_SECRET ?? "").trim();
}

/** Is this deployment configured to reach Metropol through a relay rather than directly? */
export function crbRelayEnabled(): boolean {
  return !!(crbRelayUrl() && crbRelaySecret());
}

/** True when `url` is a bureau address this relay is permitted to call. */
export function isAllowedBureauUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return u.protocol === "https:" && CRB_RELAY_ALLOWED_HOSTS.includes(u.hostname);
}

// ── The client half ──────────────────────────────────────────────────────────

export class CrbRelayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrbRelayError";
  }
}

/**
 * Make one bureau call through the relay, returning a real Response.
 *
 * Returning a genuine Response rather than a bespoke shape is what keeps the
 * change inside metropolFetch to a single expression: everything downstream
 * (res.text(), res.status, the E017/E409 handling, the non-JSON 404 branch)
 * reads a relayed answer exactly as it reads a direct one.
 *
 * A transport failure BETWEEN us and the relay is raised as CrbRelayError, not
 * folded into a bureau error. "The relay is down" and "Metropol refused us" are
 * different call-outs to different people, and merging them is how an outage
 * gets misdiagnosed as a key problem.
 */
export async function crbRelayFetch(req: CrbRelayRequest, signal?: AbortSignal): Promise<Response> {
  const base = crbRelayUrl();
  const secret = crbRelaySecret();
  if (!base || !secret) throw new CrbRelayError("CRB relay is not configured (CRB_RELAY_URL / CRB_RELAY_SECRET).");

  const payload = JSON.stringify(req);
  const ts = String(Date.now());

  let res: Response;
  try {
    res = await fetch(`${base}/crb`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [CRB_RELAY_TS_HEADER]: ts,
        [CRB_RELAY_SIG_HEADER]: crbSign(secret, ts, payload),
      },
      body: payload,
      // The relay's own budget is the bureau timeout plus a margin: a relay that
      // is merely slow should surface as a bureau timeout, not as a dead relay.
      signal: signal ?? AbortSignal.timeout(req.timeoutMs + 10_000),
    });
  } catch (e) {
    throw new CrbRelayError(
      `Could not reach the CRB relay at ${base}. ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  let out: CrbRelayResponse;
  try {
    out = (await res.json()) as CrbRelayResponse;
  } catch {
    throw new CrbRelayError(`CRB relay returned a non-JSON response (HTTP ${res.status}).`);
  }

  if (!out.ok) throw new CrbRelayError(out.error || `CRB relay refused the request (HTTP ${res.status}).`);

  return new Response(out.text, { status: out.status, headers: { "Content-Type": "application/json" } });
}
