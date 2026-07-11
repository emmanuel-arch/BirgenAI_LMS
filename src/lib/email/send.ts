// ─────────────────────────────────────────────────────────────────────────────
// Email — per-org SMTP from the vault (Enterprise) → platform SMTP fallback.
// Best-effort: a mail failure never breaks a lending flow.
//
// Every send now leaves an EmailMessage row (ServiceSuite parity), so "did the
// system email them?" has an answer. Prefer `sendTemplatedEmail` with a builder
// from ./templates — it ships the branded HTML and tags the log row; the plain
// `sendEmail` remains for one-off text.
// ─────────────────────────────────────────────────────────────────────────────
import nodemailer from "nodemailer";
import { prisma } from "@/lib/prisma";
import { getIntegration, type SmtpConfig } from "@/lib/vault/integrations";
import type { EmailParts } from "./templates";

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

/** The log row is the point — never let logging failure change the outcome. */
async function log(orgId: string | null, to: string, subject: string, template: string | null, state: "SENT" | "FAILED", error?: string | null) {
  if (!orgId) return;
  await prisma.emailMessage.create({
    data: { orgId, to, subject, template, state, error: error?.slice(0, 300) ?? null },
  }).catch(() => {});
}

/** Send an email. Returns true when the transport accepted it. */
export async function sendEmail(
  orgId: string | null,
  to: string,
  subject: string,
  text: string,
  html?: string,
  template: string | null = null,
): Promise<boolean> {
  try {
    const cfg = await smtpFor(orgId);
    if (!cfg) {
      await log(orgId, to, subject, template, "FAILED", "SMTP not configured (vault or platform)");
      return false;
    }
    const transport = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465,
      auth: { user: cfg.user, pass: cfg.pass },
    });
    await transport.sendMail({ from: cfg.from, to, subject, text, html: html ?? undefined });
    await log(orgId, to, subject, template, "SENT");
    return true;
  } catch (e) {
    await log(orgId, to, subject, template, "FAILED", e instanceof Error ? e.message : "send failed");
    return false;
  }
}

/** Send branded parts from ./templates, tagging the log row with the template key. */
export async function sendTemplatedEmail(
  orgId: string,
  to: string,
  parts: EmailParts,
  template: string,
): Promise<boolean> {
  return sendEmail(orgId, to, parts.subject, parts.text, parts.html, template);
}
