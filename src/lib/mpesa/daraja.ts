// ─────────────────────────────────────────────────────────────────────────────
// Daraja (Safaricom M-Pesa) client — per-org credentials from the vault.
//
// Mirrors the proven ServiceSuite pattern (per-entity StkParams → STK push) and
// adds what ServiceSuite never had: B2C disbursement. Tokens are cached per
// org+product with early expiry. Callbacks carry a DERIVED per-org key (HMAC of
// the org slug) so Safaricom's unauthenticated webhooks can't be spoofed.
// ─────────────────────────────────────────────────────────────────────────────
import { createHmac } from "crypto";
import { getIntegration, type MpesaStkConfig, type MpesaB2cConfig } from "@/lib/vault/integrations";

const BASE = {
  production: "https://api.safaricom.co.ke",
  sandbox: "https://sandbox.safaricom.co.ke",
};

const baseFor = (env?: string) => (env === "sandbox" ? BASE.sandbox : BASE.production);

// ── Callback authenticity ─────────────────────────────────────────────────────
/** Derived per-org webhook key — appended as ?key= to every callback URL we register. */
export function callbackKeyFor(orgSlug: string): string {
  const secret = process.env.NEXTAUTH_SECRET ?? "";
  return createHmac("sha256", secret).update(`mpesa:${orgSlug}`).digest("hex").slice(0, 32);
}

export function verifyCallbackKey(orgSlug: string, key: string | null): boolean {
  return !!key && key === callbackKeyFor(orgSlug);
}

/** Public base URL for callbacks (env override → NEXTAUTH_URL). */
function publicBase(): string {
  return (process.env.PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || "").replace(/\/$/, "");
}

export function stkCallbackUrl(orgSlug: string): string {
  return `${publicBase()}/api/mpesa/stk-callback/${orgSlug}?key=${callbackKeyFor(orgSlug)}`;
}
export function b2cResultUrl(orgSlug: string): string {
  return `${publicBase()}/api/mpesa/b2c-result/${orgSlug}?key=${callbackKeyFor(orgSlug)}`;
}
export function b2cTimeoutUrl(orgSlug: string): string {
  return `${publicBase()}/api/mpesa/b2c-timeout/${orgSlug}?key=${callbackKeyFor(orgSlug)}`;
}

// ── OAuth token (cached) ──────────────────────────────────────────────────────
type TokenCache = Map<string, { token: string; expiresAt: number }>;
const g = globalThis as unknown as { __darajaTokens?: TokenCache };
const tokens: TokenCache = g.__darajaTokens ?? new Map();
if (!g.__darajaTokens) g.__darajaTokens = tokens;

async function getToken(cacheKey: string, consumerKey: string, consumerSecret: string, env?: string): Promise<string> {
  const hit = tokens.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return hit.token;

  const res = await fetch(`${baseFor(env)}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${Buffer.from(`${consumerKey}:${consumerSecret}`).toString("base64")}` },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Daraja token failed (${res.status}).`);
  const data = (await res.json()) as { access_token: string; expires_in: string };
  const token = data.access_token;
  tokens.set(cacheKey, { token, expiresAt: Date.now() + (Number(data.expires_in) - 60) * 1000 });
  return token;
}

const timestamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

export const normalizeMsisdn = (phone: string) => {
  const digits = phone.replace(/\D/g, "");
  return `254${digits.slice(-9)}`;
};

// ── STK push (collections) ────────────────────────────────────────────────────
export type StkResult = { ok: boolean; checkoutRequestId?: string; merchantRequestId?: string; message: string; raw?: unknown };

export async function initiateStkPush(
  orgId: string,
  orgSlug: string,
  args: { phone: string; amount: number; accountReference: string; description?: string },
): Promise<StkResult> {
  const cfg = await getIntegration(orgId, "MPESA_STK");
  if (!cfg) return { ok: false, message: "M-Pesa STK is not configured for this organization (Settings → Vault)." };
  return stkWith(cfg, orgId, orgSlug, args);
}

async function stkWith(cfg: MpesaStkConfig, orgId: string, orgSlug: string, args: { phone: string; amount: number; accountReference: string; description?: string }): Promise<StkResult> {
  try {
    const token = await getToken(`stk:${orgId}`, cfg.consumerKey, cfg.consumerSecret, cfg.environment);
    const ts = timestamp();

    // BUY GOODS AND PAYBILL ARE NOT THE SAME SHAPE, and getting it wrong does not
    // error — it pushes the customer a prompt that credits the wrong number, or none.
    // The shortcode always signs the password and always fills BusinessShortCode; what
    // changes is PartyB, which is the till on a Buy Goods request and the paybill on a
    // PayBill one.
    const txType = cfg.transactionType ?? "CustomerPayBillOnline";
    const partyB = txType === "CustomerBuyGoodsOnline" ? (cfg.tillNumber || cfg.shortCode) : cfg.shortCode;

    const body = {
      BusinessShortCode: cfg.shortCode,
      Password: Buffer.from(`${cfg.shortCode}${cfg.passkey}${ts}`).toString("base64"),
      Timestamp: ts,
      TransactionType: txType,
      Amount: String(Math.max(1, Math.round(args.amount))),
      PartyA: normalizeMsisdn(args.phone),
      PartyB: partyB,
      PhoneNumber: normalizeMsisdn(args.phone),
      CallBackURL: cfg.callbackUrl || stkCallbackUrl(orgSlug),
      AccountReference: args.accountReference.slice(0, 12),
      TransactionDesc: (args.description || "Payment").slice(0, 13),
    };
    const res = await fetch(`${baseFor(cfg.environment)}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok && String(data.ResponseCode) === "0") {
      return {
        ok: true,
        checkoutRequestId: String(data.CheckoutRequestID ?? ""),
        merchantRequestId: String(data.MerchantRequestID ?? ""),
        message: String(data.CustomerMessage ?? "STK sent — ask the customer to enter their PIN."),
        raw: data,
      };
    }
    return { ok: false, message: String(data.errorMessage ?? data.ResponseDescription ?? `STK failed (${res.status}).`), raw: data };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "STK request failed." };
  }
}

// ── B2C (disbursement) ────────────────────────────────────────────────────────
export type B2cResult = { ok: boolean; conversationId?: string; originatorConversationId?: string; message: string; raw?: unknown };

export async function initiateB2C(
  orgId: string,
  orgSlug: string,
  args: { phone: string; amount: number; remarks?: string },
): Promise<B2cResult> {
  const cfg = await getIntegration(orgId, "MPESA_B2C");
  if (!cfg) return { ok: false, message: "M-Pesa B2C is not configured — record a manual disbursement instead, or add credentials in Settings → Vault." };
  return b2cWith(cfg, orgId, orgSlug, args);
}

async function b2cWith(cfg: MpesaB2cConfig, orgId: string, orgSlug: string, args: { phone: string; amount: number; remarks?: string }): Promise<B2cResult> {
  try {
    const token = await getToken(`b2c:${orgId}`, cfg.consumerKey, cfg.consumerSecret, cfg.environment);
    const body = {
      InitiatorName: cfg.initiatorName,
      SecurityCredential: cfg.securityCredential,
      CommandID: "BusinessPayment",
      Amount: String(Math.max(1, Math.round(args.amount))),
      PartyA: cfg.shortCode,
      PartyB: normalizeMsisdn(args.phone),
      Remarks: (args.remarks || "Loan disbursement").slice(0, 90),
      QueueTimeOutURL: b2cTimeoutUrl(orgSlug),
      ResultURL: b2cResultUrl(orgSlug),
      Occasion: "Loan",
    };
    const res = await fetch(`${baseFor(cfg.environment)}/mpesa/b2c/v1/paymentrequest`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok && String(data.ResponseCode) === "0") {
      return {
        ok: true,
        conversationId: String(data.ConversationID ?? ""),
        originatorConversationId: String(data.OriginatorConversationID ?? ""),
        message: String(data.ResponseDescription ?? "B2C accepted — awaiting result."),
        raw: data,
      };
    }
    return { ok: false, message: String(data.errorMessage ?? data.ResponseDescription ?? `B2C failed (${res.status}).`), raw: data };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "B2C request failed." };
  }
}
