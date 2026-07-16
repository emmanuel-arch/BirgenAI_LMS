"use client";

import { useState } from "react";
import { useLoad } from "@/lib/hooks/useLoad";
import { ShieldCheck, Loader2, AlertTriangle, CheckCircle2, ChevronDown } from "lucide-react";

// Settings & Vault — each integration slot has its own encrypted, per-org
// config form. Secrets are WRITE-ONLY: the API never returns stored values,
// so fields always start blank and saving replaces the whole config.

type FieldSpec = { key: string; label: string; type?: "text" | "password" | "select" | "number"; options?: string[]; placeholder?: string };

const FORMS: { kind: string; title: string; desc: string; fields: FieldSpec[] }[] = [
  {
    kind: "MPESA_STK", title: "M-Pesa STK (collections)", desc: "Daraja app for STK push on your paybill/till.",
    fields: [
      { key: "consumerKey", label: "Consumer key", type: "password" },
      { key: "consumerSecret", label: "Consumer secret", type: "password" },
      { key: "shortCode", label: "Business shortcode" },
      { key: "passkey", label: "Passkey", type: "password" },
      { key: "environment", label: "Environment", type: "select", options: ["production", "sandbox"] },
    ],
  },
  {
    kind: "MPESA_B2C", title: "M-Pesa B2C (disbursement)", desc: "Pays approved loans straight to the borrower's M-Pesa.",
    fields: [
      { key: "consumerKey", label: "Consumer key", type: "password" },
      { key: "consumerSecret", label: "Consumer secret", type: "password" },
      { key: "shortCode", label: "B2C shortcode" },
      { key: "initiatorName", label: "Initiator name" },
      { key: "securityCredential", label: "Security credential", type: "password", placeholder: "Cert-encrypted initiator password" },
      { key: "environment", label: "Environment", type: "select", options: ["production", "sandbox"] },
    ],
  },
  {
    kind: "SMS", title: "SMS provider", desc: "Transactional SMS: approvals, disbursement, receipts, reminders.",
    fields: [
      { key: "provider", label: "Provider", type: "select", options: ["africastalking", "celcom", "custom"] },
      { key: "username", label: "Username / account" },
      { key: "apiKey", label: "API key", type: "password" },
      { key: "senderId", label: "Sender ID", placeholder: "e.g. your brand name" },
    ],
  },
  {
    kind: "SMTP", title: "Email (SMTP)", desc: "Per-org from-address for statements and staff mail.",
    fields: [
      { key: "host", label: "Host", placeholder: "smtp.zoho.com" },
      { key: "port", label: "Port", type: "number", placeholder: "587" },
      { key: "user", label: "User" },
      { key: "pass", label: "Password", type: "password" },
      { key: "from", label: "From", placeholder: "Lender <no-reply@lender.co.ke>" },
    ],
  },
  {
    // Identity is no longer one vendor's black box. Three providers do three jobs
    // (Google Vision reads the card, IPRS confirms the human, AWS Rekognition
    // confirms it is the same human) and they are PLATFORM credentials, held in the
    // environment, not per-lender vault entries — every lender on BirgenAI verifies
    // against the same national registry with the same engine. This card stays only
    // for a lender who brings their OWN identity provider.
    kind: "KYC", title: "Identity provider (optional)",
    desc: "Identity is verified by the platform: the document is read by Google Vision, the person is confirmed against the national registry (IPRS), and the face is matched to the ID. Only fill this in if you bring your own provider.",
    fields: [
      { key: "provider", label: "Provider", type: "select", options: ["platform", "custom"] },
      { key: "apiKey", label: "API key", type: "password" },
      { key: "environment", label: "Environment", type: "select", options: ["production", "sandbox"] },
    ],
  },
  {
    kind: "CRB", title: "CRB bureau", desc: "Your bureau subscription for consented credit checks.",
    fields: [
      { key: "bureau", label: "Bureau", type: "select", options: ["transunion", "metropol", "creditinfo"] },
      { key: "username", label: "Username" },
      { key: "password", label: "Password", type: "password" },
      { key: "endpoint", label: "Endpoint (optional)" },
    ],
  },
  {
    kind: "SERVICESUITE", title: "ServiceSuite bridge", desc: "Bridged lenders: read + posting connection to your ServiceSuite.",
    fields: [
      { key: "connectionString", label: "Connection string", type: "password", placeholder: "Data Source=…;Initial Catalog=Serviceconnect;…" },
      { key: "entityId", label: "EntityId", type: "number" },
      { key: "createdByUserId", label: "Service account UserMaster.ID", type: "number" },
      { key: "channel", label: "Channel tag", type: "number", placeholder: "7" },
    ],
  },
];

type Row = { kind: string; status: string; lastTestAt: string | null; lastError: string | null };

const STATUS_TONE: Record<string, string> = {
  LIVE: "bg-emerald-100 text-emerald-700",
  TESTED: "bg-emerald-100 text-emerald-700",
  CONFIGURED: "bg-amber-100 text-amber-700",
  UNCONFIGURED: "bg-zinc-900/5 text-zinc-500",
  DISABLED: "bg-red-100 text-red-700",
};

export default function Settings() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, Record<string, string>>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await fetch("/api/orgs/integrations");
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not load integrations."); return; }
      setRows(data.integrations);
    } catch { setError("Could not load integrations."); }
  };
  useLoad(load);

  const statusOf = (kind: string) => rows?.find((r) => r.kind === kind)?.status ?? "UNCONFIGURED";

  const save = async (kind: string, fields: FieldSpec[]) => {
    setSaving(kind); setError(null); setNotice(null);
    const v = values[kind] ?? {};
    const config: Record<string, unknown> = {};
    for (const f of fields) {
      const raw = (v[f.key] ?? "").trim();
      if (!raw) continue;
      config[f.key] = f.type === "number" ? Number(raw) : raw;
    }
    if (Object.keys(config).length === 0) { setError("Fill in the credentials first."); setSaving(null); return; }
    try {
      const res = await fetch("/api/orgs/integrations", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, config }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not save."); return; }
      setNotice(`${kind.replace(/_/g, " ")} saved (encrypted).`);
      setOpen(null);
      setValues((s) => ({ ...s, [kind]: {} }));
      await load();
    } catch { setError("Could not save."); } finally { setSaving(null); }
  };

  return (
    <main className="mx-auto max-w-4xl px-4 sm:px-6 py-8">
        <h1 className="mt-3 text-xl font-bold flex items-center gap-2"><ShieldCheck className="h-5 w-5" style={{ color: "var(--brand)" }} /> Settings & Vault</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Your organization&apos;s own credentials, encrypted at rest and never shown back. Saving replaces the previous config.
        </p>

        {notice && <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50/90 px-3 py-2.5 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> {notice}</div>}
        {error && <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}</div>}
        {!rows && !error && <div className="mt-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-zinc-400" /></div>}

        {rows && (
          <div className="mt-6 space-y-3">
            {FORMS.map((slot) => {
              const st = statusOf(slot.kind);
              const expanded = open === slot.kind;
              const v = values[slot.kind] ?? {};
              return (
                <div key={slot.kind} className="glass p-4">
                  <button className="w-full flex items-center justify-between gap-3 text-left" onClick={() => setOpen(expanded ? null : slot.kind)}>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{slot.title}</p>
                      <p className="text-xs text-zinc-500">{slot.desc}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`rounded-md px-2 py-1 text-[11px] font-semibold ${STATUS_TONE[st] ?? STATUS_TONE.UNCONFIGURED}`}>{st}</span>
                      <ChevronDown className={`h-4 w-4 text-zinc-400 transition-transform ${expanded ? "rotate-180" : ""}`} />
                    </div>
                  </button>

                  {expanded && (
                    <div className="mt-3 border-t border-zinc-900/10 pt-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        {slot.fields.map((f) => (
                          <label key={f.key} className={f.key === "connectionString" || f.key === "from" ? "sm:col-span-2" : ""}>
                            <span className="text-[11px] uppercase tracking-wide text-zinc-500">{f.label}</span>
                            {f.type === "select" ? (
                              <select
                                value={v[f.key] ?? f.options![0]}
                                onChange={(e) => setValues((s) => ({ ...s, [slot.kind]: { ...v, [f.key]: e.target.value } }))}
                                className="mt-1 w-full rounded-lg border border-zinc-900/15 bg-white/80 px-3 py-2.5 text-sm outline-none">
                                {f.options!.map((o) => <option key={o} value={o}>{o}</option>)}
                              </select>
                            ) : (
                              <input
                                type={f.type === "password" ? "password" : "text"}
                                inputMode={f.type === "number" ? "numeric" : undefined}
                                value={v[f.key] ?? ""}
                                placeholder={f.placeholder}
                                onChange={(e) => setValues((s) => ({ ...s, [slot.kind]: { ...v, [f.key]: e.target.value } }))}
                                className="mt-1 w-full rounded-lg border border-zinc-900/15 bg-white/80 px-3 py-2.5 text-sm outline-none placeholder:text-zinc-400"
                              />
                            )}
                          </label>
                        ))}
                      </div>
                      <button onClick={() => save(slot.kind, slot.fields)} disabled={saving === slot.kind}
                        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60">
                        {saving === slot.kind ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save encrypted
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            <p className="text-xs text-zinc-400 pt-2">
              M-Pesa C2B paybill confirmations post to <span className="font-mono">/api/mpesa/c2b/&lt;your-subdomain&gt;</span> — BirgenAI registers this with Safaricom during activation.
            </p>
          </div>
        )}
      </main>
  );
}
