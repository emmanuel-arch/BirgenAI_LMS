// ─────────────────────────────────────────────────────────────────────────────
// Branded HTML email shell — the Movies transactional layout
// (movie-recommender/web/lib/mail/birgenTransactionalLayout.ts), rebuilt
// white-label for the LMS.
//
// Same architecture the founder designed there: table-based for inbox-client
// support, a top strip with the logo and two pill CTAs, a main content card of
// injected rows, a thank-you strip, and a legal footer. Two deliberate changes:
//
//   • PER-ORG BRAND. Movies is one product with one red; every LMS email is a
//     LENDER's email — their logo, their accent on the pills/borders, their
//     portal in the CTAs, "Powered by BirgenAI" only in the footer.
//   • LIGHT SURFACES. Movies is Netflix-dark; the LMS is the light-glass
//     console, and a lender's brand accent reads best on white.
//
// Every builder is pure: brand in, {subject, text, html} out — so the offline
// suite can assert content without a mail server.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";

export type EmailBrand = {
  orgId: string;
  name: string;
  slug: string;
  /** http(s) logo only — inbox clients strip data: URLs, so sim logos fall back to the wordmark. */
  logoUrl: string | null;
  accent: string;
  accent2: string;
  tagline: string | null;
};

const SUPPORT_MAIL = "support@birgenai.com";
const PALETTE = {
  pageBg: "#f4f4f5",
  cardBg: "#ffffff",
  stripBg: "#ffffff",
  innerBg: "#fafafa",
  border: "#e4e4e7",
  text: "#18181b",
  muted: "#52525b",
  legal: "#a1a1aa",
} as const;

export function escapeHtml(s: string): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function publicBaseUrl(): string {
  const raw = process.env.PUBLIC_BASE_URL?.trim() || "https://lms.birgenai.com";
  return raw.replace(/\/$/, "");
}

const darken = (hex: string): string => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!m) return "#111827";
  const n = parseInt(m[1], 16);
  const f = (v: number) => Math.max(0, Math.round(v * 0.75)).toString(16).padStart(2, "0");
  return `#${f((n >> 16) & 255)}${f((n >> 8) & 255)}${f(n & 255)}`;
};

/** Resolve the sending org's brand once per email. */
export async function emailBrandFor(orgId: string): Promise<EmailBrand> {
  const org = await prisma.org.findUnique({
    where: { id: orgId },
    select: { name: true, slug: true, logoUrl: true, accent: true, accent2: true, tagline: true },
  }).catch(() => null);
  const logo = org?.logoUrl && /^https?:\/\//i.test(org.logoUrl) ? org.logoUrl : null;
  return {
    orgId,
    name: org?.name ?? "LMS",
    slug: org?.slug ?? "lms",
    logoUrl: logo,
    accent: org?.accent ?? "#F97316",
    accent2: org?.accent2 ?? darken(org?.accent ?? "#F97316"),
    tagline: org?.tagline ?? null,
  };
}

export type EmailShellOptions = {
  brand: EmailBrand;
  pageTitle: string;
  /** One or more `<tr>…</tr>` rows inside the main content card. */
  mainCardRowsHtml: string;
  legalFooterInnerHtml: string;
  primaryCta?: { href: string; label: string };
};

const FONT = "'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "'Consolas','Segoe UI Mono','Menlo',Monaco,monospace";

/** Full HTML document: brand strip, gradient rule, content card, thank-you strip, legal footer. */
export function buildEmailDocumentHtml({ brand, pageTitle, mainCardRowsHtml, legalFooterInnerHtml, primaryCta }: EmailShellOptions): string {
  const base = publicBaseUrl();
  // Default the header CTA to the lender's OWN branded door (/<slug>), where staff
  // meet their logo and colours from the first click — never the generic /login.
  // "lms" is emailBrandFor's no-org fallback, which correctly keeps /login.
  const brandedDoor = brand.slug && brand.slug !== "lms" ? `${base}/${brand.slug}` : `${base}/login`;
  const ctaHref = primaryCta?.href ?? brandedDoor;
  const ctaLabel = primaryCta?.label ?? "Open the console";
  // Logo only — no wordmark beside it. The mark carries the brand; a wide logo
  // (a wordmark like "Mular Credit Ltd") gets room via height-driven sizing with
  // a generous max-width, so it reads as clearly as the console header logo.
  const logoCell = brand.logoUrl
    ? `<img src="${brand.logoUrl}" height="46" alt="${escapeHtml(brand.name)}" style="display:block;border:0;outline:none;height:46px;width:auto;max-height:52px;max-width:220px;border-radius:6px;-ms-interpolation-mode:bicubic;" />`
    : `<span style="display:inline-block;width:46px;height:46px;line-height:46px;text-align:center;background:${brand.accent};border-radius:10px;font-family:${FONT};font-size:22px;font-weight:800;color:#ffffff;">${escapeHtml(brand.name.slice(0, 1).toUpperCase())}</span>`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${escapeHtml(pageTitle)}</title>
</head>
<body style="margin:0;padding:0;background:${PALETTE.pageBg};-webkit-font-smoothing:antialiased;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${PALETTE.pageBg};">
    <tr>
      <td align="center" style="padding:24px 12px 32px;">

        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;background:${PALETTE.stripBg};border-radius:12px 12px 0 0;border:1px solid ${PALETTE.border};border-bottom:none;">
          <tr>
            <td style="padding:18px 24px 14px;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td valign="middle" align="left" style="width:50%;">
                    ${logoCell}
                  </td>
                  <td valign="middle" align="right" style="width:50%;white-space:nowrap;">
                    <a href="${ctaHref}" style="display:inline-block;margin:4px 0;padding:9px 16px;background:transparent;border:1px solid ${brand.accent};border-radius:999px;font-family:${FONT};font-size:12px;font-weight:600;color:${brand.accent};text-decoration:none;">${escapeHtml(ctaLabel)}</a>
                    <a href="mailto:${SUPPORT_MAIL}" style="display:inline-block;margin:4px 0 4px 8px;padding:9px 16px;background:${brand.accent};border-radius:999px;font-family:${FONT};font-size:12px;font-weight:600;color:#ffffff;text-decoration:none;">Help</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr><td style="height:4px;background:linear-gradient(90deg,${brand.accent},${brand.accent2});font-size:0;line-height:0;">&nbsp;</td></tr>
        </table>

        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;background:${PALETTE.cardBg};border:1px solid ${PALETTE.border};border-top:none;">
          ${mainCardRowsHtml}
        </table>

        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;background:${PALETTE.innerBg};border:1px solid ${PALETTE.border};border-top:none;border-radius:0 0 12px 12px;">
          <tr>
            <td align="center" style="padding:20px 24px;">
              <p style="margin:0;font-family:${FONT};font-size:14px;color:${PALETTE.text};">
                ${brand.tagline ? `${escapeHtml(brand.tagline)}<br />` : ""}
                <strong style="color:${brand.accent};">The ${escapeHtml(brand.name)} team</strong>
              </p>
              <p style="margin:12px 0 0;font-family:${FONT};font-size:12px;font-weight:600;color:${PALETTE.muted};">
                <a href="mailto:${SUPPORT_MAIL}" style="color:${PALETTE.muted};text-decoration:none;">${SUPPORT_MAIL}</a>
                <span style="color:${PALETTE.border};"> &nbsp;|&nbsp; </span>
                <a href="https://${escapeHtml(brand.slug)}.birgenai.com" style="color:${PALETTE.muted};text-decoration:none;">${escapeHtml(brand.slug)}.birgenai.com</a>
              </p>
            </td>
          </tr>
        </table>

        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:600px;">
          <tr>
            <td style="padding:18px 16px 8px;text-align:center;">
              <p style="margin:0;font-family:${FONT};font-size:11px;line-height:1.5;color:${PALETTE.legal};">
                ${legalFooterInnerHtml}<br />
                ${escapeHtml(brand.name)} runs on <a href="https://birgenai.com" style="color:${PALETTE.legal};text-decoration:underline;">LMS</a>.
              </p>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── Reusable content fragments ────────────────────────────────────────────────

/** Heading + intro paragraph row. */
export function headingRow(brand: EmailBrand, title: string, introHtml: string): string {
  return `
          <tr>
            <td style="padding:26px 28px 6px;">
              <h1 style="margin:0;font-family:${FONT};font-size:21px;font-weight:700;letter-spacing:-0.02em;color:${PALETTE.text};">${escapeHtml(title)}</h1>
              <p style="margin:12px 0 0;font-family:${FONT};font-size:15px;line-height:1.55;color:${PALETTE.muted};">${introHtml}</p>
            </td>
          </tr>`;
}

/** The big mono value bar (codes, passwords) with an accent left border. */
export function valueBarRow(brand: EmailBrand, label: string, value: string, wide = false): string {
  return `
          <tr>
            <td style="padding:14px 28px 4px;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${PALETTE.innerBg};border-radius:10px;border-left:4px solid ${brand.accent};border-top:1px solid ${PALETTE.border};border-right:1px solid ${PALETTE.border};border-bottom:1px solid ${PALETTE.border};">
                <tr>
                  <td align="center" style="padding:18px 16px;">
                    <p style="margin:0 0 6px;font-family:${FONT};font-size:11px;font-weight:600;letter-spacing:0.18em;text-transform:uppercase;color:${PALETTE.muted};">${escapeHtml(label)}</p>
                    <p style="margin:0;font-family:${MONO};font-size:${wide ? 20 : 32}px;font-weight:700;letter-spacing:${wide ? "0.04em" : "0.4em"};color:${PALETTE.text};word-break:break-all;">${escapeHtml(value)}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`;
}

/** A full-width accent button row. */
export function buttonRow(brand: EmailBrand, href: string, label: string): string {
  return `
          <tr>
            <td align="center" style="padding:18px 28px 8px;">
              <a href="${href}" style="display:inline-block;padding:13px 34px;background:linear-gradient(90deg,${brand.accent},${brand.accent2});border-radius:10px;font-family:${FONT};font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;">${escapeHtml(label)}</a>
            </td>
          </tr>`;
}

/** Small-print paragraph row inside the card. */
export function noteRow(innerHtml: string): string {
  return `
          <tr>
            <td style="padding:12px 28px 24px;">
              <p style="margin:0;font-family:${FONT};font-size:13px;line-height:1.55;color:${PALETTE.muted};">${innerHtml}</p>
            </td>
          </tr>`;
}

export const EMAIL_FONT = FONT;
export const EMAIL_PALETTE = PALETTE;
export const EMAIL_SUPPORT = SUPPORT_MAIL;
