"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ShieldCheck, Loader2, AlertTriangle } from "lucide-react";

// Settings & Vault (v1): shows each integration slot and its status. Editing
// forms per integration land with the money rails (Phase-2 continuation) —
// configs are already writable via PUT /api/orgs/integrations.
const SLOTS: { kind: string; title: string; desc: string }[] = [
  { kind: "MPESA_STK", title: "M-Pesa STK (collections)", desc: "Daraja consumer key/secret, shortcode, passkey" },
  { kind: "MPESA_C2B", title: "M-Pesa C2B (paybill)", desc: "Confirmation/validation callback registration" },
  { kind: "MPESA_B2C", title: "M-Pesa B2C (disbursement)", desc: "Initiator, security credential — native orgs only" },
  { kind: "SMS", title: "SMS provider", desc: "Africa's Talking / Celcom + sender ID" },
  { kind: "SMTP", title: "Email (SMTP)", desc: "Per-org from-address (Enterprise)" },
  { kind: "CRB", title: "CRB bureau", desc: "TransUnion / Metropol / Creditinfo credentials" },
  { kind: "KYC", title: "KYC / IPRS provider", desc: "Smile ID keys for identity + liveness" },
  { kind: "SERVICESUITE", title: "ServiceSuite bridge", desc: "Bridged orgs: read + posting connection" },
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

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/orgs/integrations");
        const data = await res.json();
        if (!data.success) { setError(data.message || "Could not load integrations."); return; }
        setRows(data.integrations);
      } catch { setError("Could not load integrations."); }
    })();
  }, []);

  const statusOf = (kind: string) => rows?.find((r) => r.kind === kind)?.status ?? "UNCONFIGURED";

  return (
    <div className="min-h-screen relative text-zinc-900">
      <div aria-hidden className="fixed inset-0 z-0 bg-[url('/images/white-background.png')] bg-cover bg-center" />
      <main className="relative z-10 mx-auto max-w-4xl px-4 sm:px-6 py-8">
        <Link href="/console" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800">
          <ArrowLeft className="h-4 w-4" /> Console
        </Link>
        <h1 className="mt-3 text-xl font-bold flex items-center gap-2"><ShieldCheck className="h-5 w-5" style={{ color: "var(--brand)" }} /> Settings & Vault</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Your organization&apos;s own credentials, encrypted at rest — the platform never shares them across tenants.
        </p>

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
          </div>
        )}
        {!rows && !error && <div className="mt-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-zinc-400" /></div>}

        {rows && (
          <div className="mt-6 space-y-3">
            {SLOTS.map((s) => {
              const st = statusOf(s.kind);
              return (
                <div key={s.kind} className="glass p-4 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{s.title}</p>
                    <p className="text-xs text-zinc-500">{s.desc}</p>
                  </div>
                  <span className={`rounded-md px-2 py-1 text-[11px] font-semibold shrink-0 ${STATUS_TONE[st] ?? STATUS_TONE.UNCONFIGURED}`}>{st}</span>
                </div>
              );
            })}
            <p className="text-xs text-zinc-400 pt-2">
              Per-integration setup forms ship with the money rails; admins can already store configs via the API.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
