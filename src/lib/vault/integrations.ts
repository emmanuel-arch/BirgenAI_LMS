// ─────────────────────────────────────────────────────────────────────────────
// Org integrations vault — typed accessors over OrgIntegration.
//
// "Input the environment variables when creating the entity" is realized here:
// each org stores its own third-party credentials (Daraja, SMS, SMTP, CRB,
// KYC, ServiceSuite bridge) encrypted at rest; the platform never needs a
// redeploy to onboard a lender. Reads decrypt on the server at point of use.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";
import { encryptJson, decryptJson } from "./crypto";
import type { IntegrationKind, IntegrationStatus } from "@prisma/client";

// ── Typed config shapes (what the admin UI collects per integration) ─────────
export type MpesaStkConfig = {
  consumerKey: string;
  consumerSecret: string;
  shortCode: string;
  passkey: string;
  callbackUrl?: string; // defaults to the platform callback for the org
  environment?: "production" | "sandbox";
};

export type MpesaB2cConfig = {
  consumerKey: string;
  consumerSecret: string;
  shortCode: string; // B2C org shortcode
  initiatorName: string;
  securityCredential: string; // encrypted initiator password (cert-encrypted)
  environment?: "production" | "sandbox";
};

export type SmsConfig = {
  provider: "africastalking" | "celcom" | "custom";
  apiKey: string;
  username?: string;
  senderId?: string;
  endpoint?: string; // custom providers
};

export type SmtpConfig = {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
};

export type ServiceSuiteConfig = {
  /** .NET-style connection string (same format ServiceSuite uses). */
  connectionString: string;
  entityId: number;
  postingEnabled?: boolean;
  createdByUserId?: number; // UserMaster.ID service account
  channel?: number; // ChannelUsed tag
};

export type KycConfig = {
  provider: "smile-id" | "custom";
  partnerId?: string;
  apiKey: string;
  environment?: "production" | "sandbox";
};

export type CrbConfig = {
  bureau: "transunion" | "metropol" | "creditinfo";
  username: string;
  password: string;
  endpoint?: string;
};

type ConfigFor = {
  MPESA_STK: MpesaStkConfig;
  MPESA_B2C: MpesaB2cConfig;
  MPESA_C2B: MpesaStkConfig;
  SMS: SmsConfig;
  SMTP: SmtpConfig;
  CRB: CrbConfig;
  KYC: KycConfig;
  SERVICESUITE: ServiceSuiteConfig;
  WEBHOOK: Record<string, unknown>;
};

/** Save (encrypt) an org's integration config. Upserts; resets status to CONFIGURED. */
export async function setIntegration<K extends IntegrationKind>(
  orgId: string,
  kind: K,
  config: K extends keyof ConfigFor ? ConfigFor[K] : Record<string, unknown>,
  updatedBy?: string,
) {
  const configEnc = encryptJson(config);
  return prisma.orgIntegration.upsert({
    where: { orgId_kind: { orgId, kind } },
    update: { configEnc, status: "CONFIGURED", lastError: null, updatedBy: updatedBy ?? null },
    create: { orgId, kind, configEnc, status: "CONFIGURED", updatedBy: updatedBy ?? null },
  });
}

/** Read (decrypt) an org's integration config, or null when unconfigured/disabled. */
export async function getIntegration<K extends keyof ConfigFor>(
  orgId: string,
  kind: K,
): Promise<ConfigFor[K] | null> {
  const row = await prisma.orgIntegration.findUnique({ where: { orgId_kind: { orgId, kind } } });
  if (!row || row.status === "DISABLED" || !row.configEnc) return null;
  try {
    return decryptJson<ConfigFor[K]>(row.configEnc);
  } catch {
    return null; // key rotation mishap — treat as unconfigured, never crash a flow
  }
}

export async function setIntegrationStatus(orgId: string, kind: IntegrationKind, status: IntegrationStatus, lastError?: string) {
  return prisma.orgIntegration.update({
    where: { orgId_kind: { orgId, kind } },
    data: { status, lastError: lastError ?? null, lastTestAt: status === "TESTED" || status === "LIVE" ? new Date() : undefined },
  });
}

/** Masked listing for the admin UI — kinds + statuses only, never secrets. */
export async function listIntegrations(orgId: string) {
  const rows = await prisma.orgIntegration.findMany({
    where: { orgId },
    select: { kind: true, status: true, lastTestAt: true, lastError: true, updatedAt: true },
    orderBy: { kind: "asc" },
  });
  return rows;
}
