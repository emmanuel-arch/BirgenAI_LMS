// ─────────────────────────────────────────────────────────────────────────────
// SERVICESUITE'S CONFIGURATION SURFACE — read, decrypted, and mapped onto ours.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
// Two reasons, and the second is the urgent one.
//
//   1. PARITY. Nothing may be configured in the live Micromart system that this
//      platform has no equivalent for. Their configuration is not in a file —
//      almost all of it lives in DATABASE TABLES, keyed by EntityId, which is
//      why reading appsettings.json tells you almost nothing about how the live
//      system is actually set up. This module enumerates the real surface.
//
//   2. RECOVERY. The environment file holding this platform's copy of those
//      credentials was lost with a laptop. Every value in it is recoverable
//      from the live system, because the live system is still running on them —
//      and this reads them back.
//
// ── HOW THE CREDENTIALS ARE PROTECTED, AND WHAT THAT MEANS ───────────────────
// ServiceSuite encrypts its M-Pesa credentials with `Models/Decipher.cs`:
// TripleDES in ECB mode with PKCS7 padding, the key being the MD5 digest of a
// passphrase that is COMMITTED IN THE SOURCE. That is the mechanism this module
// reverses, and it is worth being plain about what it implies:
//
//   · The encryption is obfuscation, not protection. Anyone with the repository
//     and read access to the database has every lender's Daraja credentials.
//   · ECB mode additionally leaks structure — identical plaintext blocks encrypt
//     to identical ciphertext blocks — so equal credentials across entities are
//     visible without decrypting anything at all.
//   · MD5 as a KDF has been unacceptable for this purpose for over a decade.
//
// It is flagged here rather than only in a report because whoever next reads
// this file should know that "encrypted at rest" is not true of that column, and
// should not repeat the pattern. THIS PLATFORM does not: OrgIntegration.configEnc
// is AES-256-GCM under a key that lives only in the environment (src/lib/vault).
//
// ── SAFETY ───────────────────────────────────────────────────────────────────
// Every read here is SELECT-only, goes through the same bounded, pooled,
// read-only path as every other bridged query, and touches only configuration
// tables — never a borrower, a loan or a payment. Nothing writes.
// ─────────────────────────────────────────────────────────────────────────────
import { createDecipheriv, createHash } from "crypto";
import { runReadOnlyQuery, mssql } from "./mssql";
import type { OrgDef } from "./connections";

/**
 * The passphrase ServiceSuite's `Decipher` class uses, reproduced exactly.
 *
 * NOT a secret — it is a string literal in Models/Decipher.cs in the
 * ServiceSuite repository, which is the entire point being made above. It is
 * here so this platform can READ what that system wrote; it is used for nothing
 * else and must never be used to protect anything new.
 */
const SERVICESUITE_LEGACY_PASSPHRASE = "koKRmH,HdaP5993fwfk33232!23#+*()__*&^^^&*STK";

/**
 * Reverse ServiceSuite's Decipher: 3DES-ECB/PKCS7 under MD5(passphrase).
 *
 * MD5 gives 16 bytes; 3DES wants a 24-byte key, and .NET's
 * TripleDESCryptoServiceProvider silently accepts a 16-byte key as two-key EDE
 * (K1, K2, K1). Node will not — so K1 is appended explicitly to build the
 * 24-byte form. Get this wrong and the decryption does not fail loudly, it
 * returns plausible-looking garbage, which is exactly the sort of bug that ends
 * up in a callback URL.
 */
export function decipherLegacy(cipherTextB64: string | null | undefined): string | null {
  const raw = (cipherTextB64 ?? "").trim();
  if (!raw) return null;
  try {
    const k16 = createHash("md5").update(SERVICESUITE_LEGACY_PASSPHRASE, "utf8").digest();
    const key24 = Buffer.concat([k16, k16.subarray(0, 8)]); // K1 K2 K1
    const decipher = createDecipheriv("des-ede3", key24, null);
    decipher.setAutoPadding(true); // PKCS7
    const out = Buffer.concat([decipher.update(Buffer.from(raw, "base64")), decipher.final()]);
    const text = out.toString("utf8");
    // A wrong key produces bytes, not text. Anything with control characters in
    // it did not decrypt — return null rather than a string that looks like a
    // credential and is not.
    return /[\x00-\x08\x0e-\x1f]/.test(text) ? null : text;
  } catch {
    return null;
  }
}

/** A configuration value found on the live system, and where it belongs here. */
export type ConfigFinding = {
  /** The ServiceSuite table it came from. */
  source: string;
  /** The column. */
  field: string;
  /** Which entity it is scoped to. Null = server-wide. */
  entityId: number | null;
  /** Present, absent, or present-but-undecryptable. */
  state: "found" | "empty" | "encrypted-unreadable";
  /** The plaintext, when we have it. NEVER logged by default — see the script. */
  value: string | null;
  /** The BirgenAI environment variable or vault field this maps onto. */
  mapsTo: string;
  /** Why it matters, for the parity report. */
  note?: string;
};

const str = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s.length ? s : null;
};

/**
 * M-Pesa / Daraja STK credentials, per entity.
 *
 * Lives in a DIFFERENT DATABASE from the main catalogue — Transactions.dbo —
 * which is why a naive "show me the settings tables" sweep of Serviceconnect
 * misses it entirely, and why the stored procedure that reads it is three-part
 * qualified.
 */
export async function readStkParams(org: OrgDef, entityId?: number): Promise<ConfigFinding[]> {
  const { rows } = await runReadOnlyQuery(
    org,
    `SELECT EntityId, ConsumerKey, ConsumerSecrete, CallBackUrl, passkey, shortCode
     FROM Transactions.dbo.StkParams
     ${entityId != null ? "WHERE EntityId = @entityId" : ""}
     ORDER BY EntityId`,
    entityId != null ? [{ name: "entityId", type: mssql.Int, value: entityId }] : [],
    { timeoutMs: 20000, maxRows: 100 },
  );

  const MAP: Record<string, { env: string; note: string }> = {
    ConsumerKey: { env: "MPESA_STK.consumerKey", note: "Daraja app consumer key." },
    ConsumerSecrete: { env: "MPESA_STK.consumerSecret", note: "Daraja app consumer secret. Note the spelling — the column is 'ConsumerSecrete'." },
    CallBackUrl: { env: "MPESA_STK.callbackUrl / PUBLIC_BASE_URL", note: "Where Safaricom posts the STK result. Ours must differ from theirs, or their callbacks land here." },
    passkey: { env: "MPESA_STK.passkey", note: "The Lipa Na M-Pesa passkey used to build the request password." },
    shortCode: { env: "MPESA_STK.shortcode", note: "Paybill/till the STK is raised against." },
  };

  const out: ConfigFinding[] = [];
  for (const r of rows) {
    const eid = Number(r.EntityId);
    for (const [field, meta] of Object.entries(MAP)) {
      const cipher = str(r[field]);
      const plain = cipher ? decipherLegacy(cipher) : null;
      out.push({
        source: "Transactions.dbo.StkParams",
        field,
        entityId: eid,
        state: !cipher ? "empty" : plain ? "found" : "encrypted-unreadable",
        value: plain,
        mapsTo: meta.env,
        note: meta.note,
      });
    }
  }
  return out;
}

/**
 * Africa's Talking SMS credentials.
 *
 * Stored in PLAINTEXT — no Decipher call anywhere near this table. Worth knowing
 * before anyone assumes the STK obfuscation is applied uniformly.
 */
export async function readSmsCredentials(org: OrgDef): Promise<ConfigFinding[]> {
  const { rows } = await runReadOnlyQuery(
    org,
    `SELECT id, companyid, username, apiKey, Senderid, isRegistered
     FROM africaisTalkingcredentials ORDER BY companyid`,
    [],
    { timeoutMs: 20000, maxRows: 100 },
  );

  const out: ConfigFinding[] = [];
  for (const r of rows) {
    const eid = r.companyid != null ? Number(r.companyid) : null;
    const fields: Array<[string, string, string]> = [
      ["username", "AFRICASTALKING_USERNAME", "Africa's Talking account username."],
      ["apiKey", "AFRICASTALKING_API_KEY", "Africa's Talking API key — stored in PLAINTEXT on their side."],
      ["Senderid", "AFRICASTALKING_SENDER_ID", "The registered alphanumeric sender ID."],
    ];
    for (const [field, env, note] of fields) {
      const v = str(r[field]);
      out.push({
        source: "africaisTalkingcredentials",
        field,
        entityId: eid,
        state: v ? "found" : "empty",
        value: v,
        mapsTo: env,
        note: `${note}${r.isRegistered === 0 ? " Sender ID is marked NOT registered on this row." : ""}`,
      });
    }
  }
  return out;
}

/**
 * IntegrationSettings — the AI, storage and branding surface, per entity.
 *
 * Read defensively. This table has grown columns over time and a deployment that
 * is behind will not have all of them; asking for a column that does not exist
 * fails the whole SELECT, so the columns are discovered first and only the ones
 * that exist are read.
 */
export async function readIntegrationSettings(org: OrgDef): Promise<ConfigFinding[]> {
  const WANTED: Record<string, { env: string; note: string }> = {
    OpenAiApiKey: { env: "(no equivalent — we do not use OpenAI)", note: "Their AI assistant's OpenAI key." },
    GeminiApiKey: { env: "(no equivalent)", note: "Google Gemini key." },
    AnthropicApiKey: { env: "ANTHROPIC_API_KEY", note: "Claude key — the assistant's model provider on both systems." },
    AnthropicRateInputToken: { env: "(billing config)", note: "Their per-token cost model for reselling AI usage." },
    AnthropicRateOutputToken: { env: "(billing config)", note: "As above, output side." },
    AnthropicMarkupPercent: { env: "(billing config)", note: "Markup applied on top of token cost." },
    AnthropicMinBalanceRequired: { env: "(billing config)", note: "Floor below which the assistant is cut off." },
    AnthropicRestrictedTables: { env: "(guard config)", note: "Tables the AI may never query. Ours is a code constant, not a row." },
    SupabaseUrl: { env: "NEXT_PUBLIC_SUPABASE_URL", note: "Their Supabase project — the RAG knowledge base." },
    SupabaseAnonKey: { env: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", note: "Publishable key." },
    SupabaseServiceKey: { env: "SUPABASE_SERVICE_ROLE_KEY", note: "SERVICE ROLE key — full bypass of row security. The highest-value secret in this table." },
    GoogleDriveApiUrl: { env: "(no equivalent — we use Supabase storage)", note: "Document storage endpoint." },
    GoogleClientId: { env: "(no equivalent)", note: "Drive OAuth client." },
    GoogleClientSecret: { env: "(no equivalent)", note: "Drive OAuth secret." },
    GoogleAccessToken: { env: "(no equivalent)", note: "Drive access token." },
    GoogleRefreshToken: { env: "(no equivalent)", note: "Drive refresh token — long-lived." },
    HangfireUsername: { env: "CRON_SECRET (nearest equivalent)", note: "Their background-job dashboard login. Ours is a bearer secret on /api/cron." },
    HangfirePassword: { env: "CRON_SECRET (nearest equivalent)", note: "As above." },
    ConnectBoxApiUrl: { env: "(no equivalent)", note: "Their device-management gateway." },
    DefaultLogo: { env: "Org.logoUrl", note: "Per-entity branding — ours is a column on Org." },
    DefaultIcon: { env: "Org.logoUrl", note: "As above." },
    DefaultPrimaryColor: { env: "Org.accent", note: "As above." },
    DefaultSecondaryColor: { env: "Org.accentSoft", note: "As above." },
  };

  const { rows: cols } = await runReadOnlyQuery(
    org,
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'IntegrationSettings'`,
    [],
    { timeoutMs: 15000, maxRows: 200 },
  );
  const present = new Set(cols.map((c) => String(c.COLUMN_NAME)));
  const readable = Object.keys(WANTED).filter((k) => present.has(k));
  if (readable.length === 0) return [];

  const { rows } = await runReadOnlyQuery(
    org,
    `SELECT EntityId, ${readable.map((c) => `[${c}]`).join(", ")} FROM IntegrationSettings ORDER BY EntityId`,
    [],
    { timeoutMs: 20000, maxRows: 100 },
  );

  const out: ConfigFinding[] = [];
  for (const r of rows) {
    for (const field of readable) {
      const v = str(r[field]);
      out.push({
        source: "IntegrationSettings",
        field,
        entityId: r.EntityId != null ? Number(r.EntityId) : null,
        state: v ? "found" : "empty",
        value: v,
        mapsTo: WANTED[field].env,
        note: WANTED[field].note,
      });
    }
  }
  return out;
}

/**
 * The remaining credential tables, swept generically.
 *
 * These are the tables ServiceSuite's own AI guard refuses to let its assistant
 * read (ServiceSuiteAIService.AlwaysBlockedTables) — which makes that list the
 * most reliable inventory of where secrets live in that system, because it was
 * written by someone who had to enumerate them exhaustively or leak them.
 *
 * Values are NOT returned for these. The sweep reports only whether each table
 * exists, how many rows it holds and which entities it covers, because the
 * purpose here is parity ("do we have an equivalent?"), not exfiltration.
 */
export const CREDENTIAL_TABLES = [
  { table: "StkParams", database: "Transactions", holds: "Daraja STK: consumer key/secret, passkey, shortcode, callback URL", ours: "OrgIntegration(MPESA_STK), AES-256-GCM" },
  { table: "africaisTalkingcredentials", database: "Serviceconnect", holds: "Africa's Talking SMS username, API key, sender ID (PLAINTEXT)", ours: "OrgIntegration(SMS) + AFRICASTALKING_* env" },
  { table: "TrustonicCredentials", database: "Serviceconnect", holds: "Device-locking API key and tenant", ours: "none — we do not lock devices" },
  { table: "ZohoCliqCred", database: "Serviceconnect", holds: "Zoho Cliq OAuth client id/secret and tokens", ours: "none" },
  { table: "MarantechParams", database: "Serviceconnect", holds: "Device-management vendor parameters", ours: "none" },
  { table: "ChiniseMdmParams", database: "Serviceconnect", holds: "Second MDM vendor parameters", ours: "none" },
  { table: "ApiClients", database: "Serviceconnect", holds: "Inbound API client ids and secrets", ours: "SERVICESUITE_HOOK_SECRET / PLATFORM_ADMIN_SECRET" },
  { table: "AuthenticatorKeys", database: "Serviceconnect", holds: "TOTP seeds for staff 2FA", ours: "StaffUser.otpSecret" },
  { table: "IntegrationSettings", database: "Serviceconnect", holds: "AI keys, Supabase keys, Drive OAuth, Hangfire login, branding", ours: "split across env + OrgIntegration + Org branding columns" },
] as const;

/** Which of the known credential tables actually exist on this server, and how full. */
export async function surveyCredentialTables(org: OrgDef): Promise<
  Array<{ table: string; database: string; exists: boolean; rows: number | null; holds: string; ours: string }>
> {
  const out: Array<{ table: string; database: string; exists: boolean; rows: number | null; holds: string; ours: string }> = [];
  for (const t of CREDENTIAL_TABLES) {
    try {
      // Table name is NOT caller-supplied — it comes from the constant above —
      // so interpolating it is safe and is the only way to name a table in SQL.
      const qualified = t.database === "Transactions" ? `Transactions.dbo.[${t.table}]` : `[${t.table}]`;
      const { rows } = await runReadOnlyQuery(org, `SELECT COUNT(*) AS n FROM ${qualified}`, [], { timeoutMs: 15000, maxRows: 1 });
      out.push({ ...t, exists: true, rows: Number(rows[0]?.n ?? 0) });
    } catch {
      out.push({ ...t, exists: false, rows: null });
    }
  }
  return out;
}

/**
 * Every stored procedure, function and view on the live server.
 *
 * The parity question this answers is not "do we have these procedures" — we do
 * not and should not, our logic is in TypeScript under test rather than in 622
 * uncovered T-SQL procedures. It is "does every BEHAVIOUR one of these encodes
 * exist somewhere in our platform". The inventory is what makes that checkable
 * instead of a matter of opinion.
 */
export async function inventoryProgrammability(org: OrgDef) {
  const { rows } = await runReadOnlyQuery(
    org,
    `SELECT o.name, o.type_desc AS kind, o.modify_date AS modified,
            LEN(CAST(m.definition AS NVARCHAR(MAX))) AS size
     FROM sys.objects o
     LEFT JOIN sys.sql_modules m ON m.object_id = o.object_id
     WHERE o.type IN ('P','FN','IF','TF','V','TR')
     ORDER BY o.type_desc, o.name`,
    [],
    { timeoutMs: 30000, maxRows: 2000 },
  );
  return rows.map((r) => ({
    name: String(r.name),
    kind: String(r.kind),
    modified: r.modified ? new Date(r.modified as string).toISOString() : null,
    size: Number(r.size ?? 0),
  }));
}

/** The per-entity settings tables — the behavioural configuration, not the secrets. */
export const SETTINGS_TABLES = [
  { table: "BorrowerSettings", holds: "Onboarding fields, required documents, KYC rules", ours: "config namespace 'borrower' (/console/settings/borrowers)" },
  { table: "ProvisionSettings", holds: "Loan-loss provisioning bands", ours: "none yet — GAP" },
  { table: "RedisbursementSettings", holds: "Approval workflow for re-disbursement", ours: "Workflow builder (/console/workflows)" },
  { table: "ManagedLoanSettings", holds: "Approval workflow for managed loans", ours: "Workflow builder" },
  { table: "LoanRestructureSettings", holds: "Restructure rules and approval chain", ours: "none yet — GAP" },
  { table: "LoanTopUpSettings", holds: "Top-up eligibility and approval chain", ours: "Credit policy ladder (/console/settings/credit)" },
  { table: "IntegrationSettings", holds: "AI, Supabase, Drive, Hangfire, branding", ours: "env + OrgIntegration vault + Org branding" },
  { table: "SmsTemplate", holds: "Per-entity SMS templates", ours: "Comms templates (/console/comms)" },
  { table: "SmsPlaceholders", holds: "Merge fields available in templates", ours: "Comms templates" },
  { table: "Preferences", holds: "Assorted per-user/per-entity toggles", ours: "config namespaces" },
  { table: "SystemOptions", holds: "Global switches", ours: "plan features + config namespaces" },
] as const;
