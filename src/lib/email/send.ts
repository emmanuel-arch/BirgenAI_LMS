// ─────────────────────────────────────────────────────────────────────────────
// Email — per-org SMTP from the vault (Enterprise) → platform SMTP fallback.
// Best-effort: a mail failure never breaks a lending flow.
// ─────────────────────────────────────────────────────────────────────────────
import nodemailer from "nodemailer";
import { getIntegration, type SmtpConfig } from "@/lib/vault/integrations";

async function smtpFor(orgId: string | null): Promise<SmtpConfig | null> {
  if (orgId) {
    const vault = await getIntegration(orgId, "SMTP").catch(() => null);
    if (vault?.host && vault.user) return vault;
  }
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  if (host && user && pass) {
    return { host, port: Number(process.env.SMTP_PORT || 587), user, pass, from: process.env.SMTP_FROM || user };
  }
  return null;
}

/** Send an email. Returns true when the transport accepted it. */
export async function sendEmail(
  orgId: string | null,
  to: string,
  subject: string,
  text: string,
  html?: string,
): Promise<boolean> {
  try {
    const cfg = await smtpFor(orgId);
    if (!cfg) return false;
    const transport = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465,
      auth: { user: cfg.user, pass: cfg.pass },
    });
    await transport.sendMail({ from: cfg.from, to, subject, text, html: html ?? undefined });
    return true;
  } catch {
    return false;
  }
}
