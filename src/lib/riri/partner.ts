// ─────────────────────────────────────────────────────────────────────────────
// PARTNERS — who may call Riri from outside the estate, and with which key.
//
// Riri Ecosystem AI plan §02, "What the seam looks like on the wire": a partner does
// not import TypeScript. They get ONE signed HTTP contract (POST /api/riri/v1/ask)
// and a web component (public/riri-embed.js). The signature is the relay's own —
// HMAC-SHA256 over `${ts}.${body}` inside a two-minute window, lib/enterprise/
// relay.ts — so a partner integration and a lender's book are protected by the same
// reviewed code, and there is one place to fix it rather than two.
//
// ── THE REGISTRY IS AN ENVIRONMENT VARIABLE, DELIBERATELY, FOR NOW ───────────
//   RIRI_PARTNER_KEYS='{"KE/LENDER/P051234567X":{"secret":"…","org":"micromart"}}'
//
// Keyed on the member code the Interchange uses (KRA PIN), never an EntityId. A
// secret in the environment is rotated by redeploying, which is the right weight
// for a handful of partners; when there are dozens it moves to the vault
// (OrgIntegration), and nothing that calls `partnerFor()` changes.
// ─────────────────────────────────────────────────────────────────────────────

export type Partner = { code: string; secret: string; orgSlug: string };

const CODE_RE = /^KE\/LENDER\/[A-Z0-9]{9,15}$/;

export function partnerFor(code: string | null | undefined): Partner | null {
  const c = (code ?? "").trim();
  if (!CODE_RE.test(c)) return null;
  let raw: Record<string, { secret?: unknown; org?: unknown }>;
  try {
    raw = JSON.parse(process.env.RIRI_PARTNER_KEYS ?? "{}");
  } catch {
    return null;
  }
  const entry = raw[c];
  if (!entry || typeof entry.secret !== "string" || entry.secret.length < 24 || typeof entry.org !== "string") return null;
  return { code: c, secret: entry.secret, orgSlug: entry.org };
}

export const PARTNER_ORG_HEADER = "x-riri-org";
export const PARTNER_TS_HEADER = "x-riri-ts";
export const PARTNER_SIG_HEADER = "x-riri-sig";
