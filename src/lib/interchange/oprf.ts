// ─────────────────────────────────────────────────────────────────────────────
// The OPRF — member-node side. THE IDENTITY BOUNDARY.
//
// This is the last place in the whole pipeline where a real Kenyan national ID
// or MSISDN exists. Everything past `finalize()` is a token, and nothing
// downstream — the Registry, the message log, another member's node, a report in
// storage — ever sees the identifier itself.
//
// Three steps, one network hop:
//
//   blind(identifier)         local    → { blind, blinded }
//   POST /api/oprf/evaluate   Registry → the evaluated element
//   finalize(...)             local    → subject_token
//
// The Registry sees only `blinded`, a uniformly random ristretto255 point. Two
// calls about the SAME person produce DIFFERENT blinded elements, so the
// Registry cannot even tell it was asked twice about one borrower — while the
// finalized token is identical every time, which is exactly what makes exposure
// computable across members who never share a name.
//
// ⚠ WIRE FORMAT — port of the Registry's `lib/oprf/node.ts`. `canonicalIdentifier`
// especially: it decides whether 0758…, +254758… and 254758… land on ONE token.
// If Micromart normalises differently from Axe, the same borrower tokenises two
// ways and the exchange silently stops matching — which looks exactly like "this
// person has no exposure anywhere", the most dangerous wrong answer this system
// can give. Change it in one repo and you must change it in both.
// ─────────────────────────────────────────────────────────────────────────────
import { ristretto255_oprf } from "@noble/curves/ed25519.js";

const { oprf } = ristretto255_oprf;

export type IdentifierKind = "national_id" | "msisdn";

/** OPRF output is 64 bytes → 128 hex characters. */
export const SUBJECT_TOKEN_HEX_LENGTH = 128;

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.trim().toLowerCase().match(/.{2}/g)!.map((b) => parseInt(b, 16)));
}

/**
 * Normalise before blinding.
 *
 * ServiceSuite stores whatever the loan officer typed: leading zeros on an ID,
 * a phone with or without +254, spaces. Tokenising the raw string would give one
 * borrower several tokens and defeat the entire exchange.
 */
export function canonicalIdentifier(kind: IdentifierKind, raw: string): string {
  const trimmed = raw.trim();
  if (kind === "msisdn") {
    const digits = trimmed.replace(/\D/g, "");
    const local = digits.replace(/^(?:254|0)/, "");
    return `msisdn:254${local}`;
  }
  return `national_id:${trimmed.replace(/^0+/, "").toUpperCase()}`;
}

/**
 * A Kenyan national ID, reduced to the digits that identify the person.
 *
 * ── WHY THIS EXISTS, AND WHY IT IS NOT OPTIONAL ──────────────────────────────
 * `Borrowers.NationalID` is free text and holds what the loan officer typed:
 * "12345678", "1234-5678", "12 345 678", "1234567/8". `canonicalIdentifier`
 * above does not touch punctuation — it cannot, because it is a wire format
 * shared with the Registry and changing it unilaterally would fork the tokens.
 *
 * So the same borrower tokenised one way during an ingest and another way while
 * a query was being served, and the two never matched. The failure is SILENT and
 * it is the worst-shaped bug this system can have: the exposure query returns
 * "no other lender is reporting a loan to you" about somebody who is three
 * lenders deep, and nothing anywhere logs an error.
 *
 * It was caught by the acceptance test's no-false-negatives check, which is
 * precisely what that check is for.
 *
 * Returns null for anything that is not a usable ID — blanks, "N/A", a stray
 * phone number. Those borrowers cannot be tokenised at all, and the ingest
 * counts them rather than inventing a token that would match nothing.
 */
export function normaliseNationalId(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const digits = s.replace(/\D/g, "");
  if (digits.length < 6 || digits.length > 9) return null;
  if (/^0+$/.test(digits)) return null;
  return digits;
}

/** Thrown rather than returned, because a caller that ignores it derives a token for nobody. */
export class UnusableIdentifier extends Error {
  constructor(kind: IdentifierKind) {
    super(`Not a usable ${kind} — it cannot be tokenised.`);
    this.name = "UnusableIdentifier";
  }
}

/**
 * Pre-normalise, then canonicalise.
 *
 * Every path that derives a token goes through here, so ingest and serving
 * cannot drift apart again. It is idempotent: normalising an
 * already-normalised value is the same value.
 *
 * ⚠ A node written in another language must reproduce THIS, not just
 * `canonicalIdentifier`, or its tokens will not match ours.
 */
export function identifierInput(kind: IdentifierKind, raw: string): string {
  if (kind === "national_id") {
    const clean = normaliseNationalId(raw);
    if (!clean) throw new UnusableIdentifier(kind);
    return canonicalIdentifier(kind, clean);
  }
  return canonicalIdentifier(kind, raw);
}

/** Step 1 — blind locally. `blind` is a secret; it never leaves this process. */
export function blind(kind: IdentifierKind, raw: string) {
  const input = new TextEncoder().encode(identifierInput(kind, raw));
  const { blind: blindScalar, blinded } = oprf.blind(input);
  return { input, blind: blindScalar, blindedHex: bytesToHex(blinded) };
}

/** Step 3 — unblind and finalize into the ecosystem-stable subject token. */
export function finalize(input: Uint8Array, blindScalar: Uint8Array, evaluatedHex: string): string {
  return bytesToHex(oprf.finalize(input, blindScalar, hexToBytes(evaluatedHex)));
}

/**
 * The whole exchange for one identifier.
 *
 * `evaluate` is injected so this file has no opinion about transport, and so the
 * same function works against a local Registry, a remote one, or a test double.
 */
export async function deriveSubjectToken(
  kind: IdentifierKind,
  raw: string,
  evaluate: (blindedHex: string) => Promise<string>,
): Promise<string> {
  const { input, blind: blindScalar, blindedHex } = blind(kind, raw);
  return finalize(input, blindScalar, await evaluate(blindedHex));
}

export function isSubjectToken(value: string): boolean {
  return new RegExp(`^[0-9a-f]{${SUBJECT_TOKEN_HEX_LENGTH}}$`, "i").test(value);
}

/**
 * Short display form.
 *
 * Never render a full token in a console, a log line or an error message. A full
 * token is a stable pseudonym: anyone who collects two of them from two
 * different screens can link the borrower across members, which is precisely the
 * linkage the OPRF exists to prevent.
 */
export function tokenPreview(token: string): string {
  return `${token.slice(0, 8)}…${token.slice(-4)}`;
}
