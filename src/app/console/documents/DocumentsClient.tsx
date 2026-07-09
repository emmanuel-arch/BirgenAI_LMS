"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowLeft, Loader2, AlertTriangle, CheckCircle2, FileText, Upload, Eye, ScanLine, FlaskConical,
} from "lucide-react";

// The Document Parser. Upload a PDF, get fields.
//
// The screen is honest about what it did: PARSED means we found what an officer
// needs, NEEDS REVIEW names what is missing, and UNPARSED says plainly that a photo
// cannot be read until OCR is connected. A parser that quietly guesses is worse than
// one that admits it cannot see.

type LineItem = { label: string; amountKes: number };
type Fields = Record<string, string | number | boolean | LineItem[] | undefined>;
type Doc = {
  id: string; kind: string; filename: string; contentType: string; bytes: number; pages: number | null;
  status: "PARSED" | "NEEDS_REVIEW" | "UNPARSED" | "FAILED";
  confidence: number; fields: Fields | null; note: string | null; parserMode: string;
  borrowerId: string | null; createdAt: string;
};

const KINDS = [
  { key: "FEE_STRUCTURE", label: "School fee structure" },
  { key: "INVOICE", label: "Invoice" },
  { key: "PERMIT", label: "Business permit" },
  { key: "BANK_STATEMENT", label: "Bank statement" },
  { key: "NATIONAL_ID", label: "National ID" },
  { key: "OTHER", label: "Something else" },
];

const STATUS: Record<Doc["status"], { cls: string; label: string }> = {
  PARSED: { cls: "bg-emerald-100 text-emerald-700", label: "Parsed" },
  NEEDS_REVIEW: { cls: "bg-amber-100 text-amber-700", label: "Needs review" },
  UNPARSED: { cls: "bg-zinc-900/5 text-zinc-500", label: "Not readable" },
  FAILED: { cls: "bg-rose-100 text-rose-700", label: "Failed" },
};

const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Could not read that file."));
    r.readAsDataURL(file);
  });

export function DocumentsClient() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [mode, setMode] = useState<string>("simulation");
  const [kind, setKind] = useState("FEE_STRUCTURE");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsPassword, setNeedsPassword] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/console/documents");
      const d = await res.json();
      if (d.success) { setDocs(d.documents); setMode(d.mode); }
    } catch { /* leave list */ }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const upload = async (file: File, pwd?: string) => {
    setBusy(true); setError(null);
    try {
      const dataUrl = await readAsDataUrl(file);
      const res = await fetch("/api/console/documents", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, filename: file.name, file: dataUrl, password: pwd }),
      });
      const d = await res.json();
      if (!d.success) {
        if (d.needsPassword) { setNeedsPassword(file); setError(d.message); return; }
        setError(d.message || "Could not read that document.");
        return;
      }
      setNeedsPassword(null); setPassword("");
      await load();
      setOpen(d.document.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that document.");
    } finally { setBusy(false); if (fileInput.current) fileInput.current.value = ""; }
  };

  const view = async (id: string) => {
    const res = await fetch(`/api/console/documents/${id}`);
    const d = await res.json();
    if (d.url) window.open(d.url, "_blank", "noopener");
    else alert("The file itself is not stored — object storage is running in simulation.");
  };

  return (
    <div className="min-h-screen relative text-zinc-900">
      <div aria-hidden className="fixed inset-0 z-0 bg-[url('/images/white-background.png')] bg-cover bg-center" />
      <main className="relative z-10 mx-auto max-w-4xl px-4 sm:px-6 py-10">
        <Link href="/console" className="mb-6 inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800">
          <ArrowLeft className="h-4 w-4" /> Console
        </Link>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold">
              <ScanLine className="h-5 w-5" style={{ color: "var(--brand)" }} /> Document Parser
            </h1>
            <p className="mt-1 text-sm text-zinc-500">Fee structures, invoices, permits, bank statements — read into figures you can use.</p>
          </div>
          {mode === "simulation" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-[10px] font-semibold text-amber-700">
              <FlaskConical className="h-3 w-3" /> PDFs ONLY — OCR NOT CONNECTED
            </span>
          )}
        </div>

        {/* Upload */}
        <div className="mt-5 glass p-5 sm:p-6">
          <label className="text-xs font-medium text-zinc-500">What are you uploading?</label>
          <div className="mt-2 flex flex-wrap gap-2">
            {KINDS.map((k) => (
              <button key={k.key} onClick={() => setKind(k.key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${kind === k.key ? "text-white" : "border border-zinc-900/15 bg-white/70 text-zinc-600 hover:bg-white"}`}
                style={kind === k.key ? { backgroundColor: "var(--brand)" } : undefined}>
                {k.label}
              </button>
            ))}
          </div>

          <input ref={fileInput} type="file" accept="application/pdf,image/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />

          <button onClick={() => fileInput.current?.click()} disabled={busy}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-zinc-900/15 bg-white/50 py-8 text-sm text-zinc-500 hover:border-zinc-900/25 hover:bg-white/70 disabled:opacity-60">
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
            {busy ? "Reading…" : "Choose a PDF (up to 3 MB)"}
          </button>

          {needsPassword && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs text-amber-800">This PDF is locked. Enter its password to read it.</p>
              <div className="mt-2 flex gap-2">
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password" className="flex-1 rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs outline-none" />
                <button onClick={() => void upload(needsPassword, password)} disabled={busy || !password}
                  className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">Unlock</button>
              </div>
            </div>
          )}

          {error && !needsPassword && (
            <p className="mt-3 flex items-start gap-1.5 text-xs text-red-600"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}</p>
          )}
        </div>

        {/* Results */}
        <h2 className="mt-8 text-sm font-semibold">Read so far</h2>
        {docs.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">Nothing yet.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {docs.map((d) => {
              const tone = STATUS[d.status];
              const expanded = open === d.id;
              return (
                <motion.div key={d.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="glass p-4">
                  <div className="flex items-start justify-between gap-3">
                    <button className="flex min-w-0 flex-1 items-start gap-3 text-left" onClick={() => setOpen(expanded ? null : d.id)}>
                      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{d.filename}</p>
                        <p className="text-[11px] text-zinc-400">
                          {KINDS.find((k) => k.key === d.kind)?.label ?? d.kind} · {kb(d.bytes)}
                          {d.pages ? ` · ${d.pages} page${d.pages > 1 ? "s" : ""}` : ""}
                        </p>
                      </div>
                    </button>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${tone.cls}`}>{tone.label}</span>
                      <button onClick={() => void view(d.id)} title="Open the file" className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-900/5 hover:text-zinc-700">
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {d.note && <p className="mt-2 text-[11px] text-zinc-500">{d.note}</p>}

                  {expanded && d.fields && Object.keys(d.fields).length > 0 && (
                    <div className="mt-3 border-t border-zinc-900/10 pt-3">
                      <FieldList fields={d.fields} />
                      {d.status === "PARSED" && (
                        <p className="mt-2 flex items-center gap-1 text-[11px] text-emerald-700">
                          <CheckCircle2 className="h-3 w-3" /> Every field this document needs was found.
                        </p>
                      )}
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

function FieldList({ fields }: { fields: Fields }) {
  const items = (fields.items as LineItem[] | undefined) ?? null;
  const scalars = Object.entries(fields).filter(([k]) => k !== "items");

  return (
    <>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
        {scalars.map(([k, v]) => (
          <div key={k}>
            <dt className="text-zinc-400">{humanize(k)}</dt>
            <dd className="font-medium text-zinc-800">{render(k, v)}</dd>
          </div>
        ))}
      </dl>
      {items && items.length > 0 && (
        <table className="mt-3 w-full text-xs">
          <tbody>
            {items.map((it, i) => (
              <tr key={i} className="border-t border-zinc-900/5">
                <td className="py-1.5 text-zinc-600">{it.label}</td>
                <td className="py-1.5 text-right tabular-nums font-medium">{kes(it.amountKes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

const humanize = (k: string) =>
  k.replace(/Kes$/, " (KES)").replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();

function render(key: string, v: unknown): string {
  if (typeof v === "boolean") return v ? "Yes" : "No — the parts do not add up to the total";
  if (typeof v === "number") return /kes$/i.test(key) ? kes(v) : String(v);
  return String(v);
}
