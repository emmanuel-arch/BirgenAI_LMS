// Stateless per-lender API keys for the public engine endpoints (e.g. the crunch
// / Internal Report API). A key is an HMAC of the org slug under a server secret,
// so it identifies the caller AND proves authenticity with nothing to store —
// no key table, no migration. Rotation = rotate REPORT_API_SECRET.
//
// Format:  brgn_<orgSlug>.<sig>   e.g.  brgn_mular.9fA2…
// The slug is readable (routing), the sig is the credential (timing-safe check).
import { createHmac, timingSafeEqual } from "crypto";

const secret = () => process.env.REPORT_API_SECRET?.trim() || "dev-report-secret-change-me";

function sign(slug: string): string {
  return createHmac("sha256", secret()).update(`report:${slug}`).digest("base64url").slice(0, 32);
}

export function issueReportKey(slug: string): string {
  return `brgn_${slug}.${sign(slug)}`;
}

/** Verify a presented key. Returns the org slug it authorises, or null. */
export function verifyReportKey(key: string | null | undefined): { orgSlug: string } | null {
  if (!key || !key.startsWith("brgn_")) return null;
  const body = key.slice(5);
  const dot = body.lastIndexOf(".");
  if (dot < 1) return null;
  const slug = body.slice(0, dot);
  const provided = body.slice(dot + 1);
  const expected = sign(slug);
  if (provided.length !== expected.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) return null;
  } catch { return null; }
  return { orgSlug: slug };
}
