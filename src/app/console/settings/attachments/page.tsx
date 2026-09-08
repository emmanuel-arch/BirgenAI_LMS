"use client";

// ─────────────────────────────────────────────────────────────────────────────
// ATTACHMENT TYPES — the lender's own catalogue of what a customer may be asked
// to bring.
//
// Until now this was fourteen hard-coded rows in the borrower-settings screen that
// every lender on the platform shared and none could change. A lender financing
// boda-bodas who needed "Logbook + insurance certificate" had to ask us for a
// deploy. That is the exact failure the Tenant Definition Layer exists to end.
//
// A row here carries three things the system we are replacing cannot express:
//
//   SCOPES — where the document may be asked for at all. Their `AttachmentFiles`
//   is one flat pool offered identically to a borrower profile, a loan application
//   and a workflow stage, so a payslip is offered as a transaction attachment.
//
//   PARSER — which reader runs over it. This is what makes an M-Pesa statement
//   worth more than a filename, and it is what the check catalogue binds against.
//
//   BUILT-IN — platform rows a lender may rename, re-scope and switch off, but not
//   delete, because engines reference them by code. Deleting is not offered rather
//   than offered-and-refused.
//
// One document, one Publish, versioned like every other namespace.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Paperclip, Loader2, AlertTriangle, CheckCircle2, ArrowLeft, Plus, Trash2,
  Save, RotateCcw, History, Lock, X, Search,
} from "lucide-react";
import { useLoad } from "@/lib/hooks/useLoad";
import {
  Toggle, Choice, TextField, SelectField, NumberField, Divider,
} from "@/components/settings/controls";
import {
  ATTACHMENT_SCOPES, ATTACHMENT_PARSERS, FILE_TYPES,
  mergeAttachmentConfig, validateAttachmentConfig,
  type AttachmentConfig, type AttachmentItem, type AttachmentScope, type AttachmentParser,
} from "@/lib/config/attachments";
import type { ConfigIssue } from "@/lib/config/borrower";

type Revision = { version: number; changed: string[]; createdAt: string };

const blank = (): AttachmentItem => ({
  code: "", name: "", shortCode: "", description: "",
  fileTypes: [".pdf", ".png", ".jpg"], allowMultiple: false, active: true,
  scopes: ["loan"], parser: "none", maxSizeMb: 10, builtIn: false,
});

export default function AttachmentCatalogue() {
  const [cfg, setCfg] = useState<AttachmentConfig | null>(null);
  const [saved, setSaved] = useState<AttachmentConfig | null>(null);
  const [version, setVersion] = useState(0);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [issues, setIssues] = useState<ConfigIssue[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [editing, setEditing] = useState<{ index: number; item: AttachmentItem } | null>(null);
  const [q, setQ] = useState("");

  const load = async () => {
    try {
      const res = await fetch("/api/config/attachments");
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not load the catalogue."); return; }
      const merged = mergeAttachmentConfig(data.value);
      setCfg(merged); setSaved(merged); setVersion(data.version);
      setRevisions(data.history ?? []); setError(null);
    } catch { setError("Could not load the catalogue."); }
  };
  useLoad(load);

  const dirty = useMemo(
    () => Boolean(cfg && saved && JSON.stringify(cfg) !== JSON.stringify(saved)),
    [cfg, saved],
  );
  const liveIssues = useMemo(() => (cfg ? validateAttachmentConfig(cfg) : []), [cfg]);

  const save = async () => {
    if (!cfg) return;
    setBusy(true); setError(null); setNotice(null); setIssues([]);
    try {
      const res = await fetch("/api/config/attachments", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: cfg }),
      });
      const data = await res.json();
      if (res.status === 422) { setIssues(data.issues ?? []); setError(data.message); return; }
      if (!data.success) { setError(data.message || "Could not save."); return; }
      const merged = mergeAttachmentConfig(data.value);
      setCfg(merged); setSaved(merged); setVersion(data.version);
      setNotice(`Published as version ${data.version} — live everywhere a document is asked for.`);
      const fresh = await fetch("/api/config/attachments").then((r) => r.json()).catch(() => null);
      if (fresh?.success) setRevisions(fresh.history ?? []);
    } catch { setError("Could not save."); } finally { setBusy(false); }
  };

  if (error && !cfg) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <p className="flex items-start gap-2 rounded-xl bg-red-500/10 px-3 py-2.5 text-sm text-red-800 ring-1 ring-red-600/20">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      </main>
    );
  }
  if (!cfg) {
    return <main className="flex justify-center py-20"><Loader2 className="h-5 w-5 animate-spin text-[color:var(--ink-faint)]" /></main>;
  }

  const patchItem = (index: number, patch: Partial<AttachmentItem>) =>
    setCfg({ ...cfg, items: cfg.items.map((it, i) => (i === index ? { ...it, ...patch } : it)) });

  const needle = q.trim().toLowerCase();
  const rows = cfg.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) =>
      !needle || item.name.toLowerCase().includes(needle) || item.code.toLowerCase().includes(needle));

  return (
    <main className="mx-auto max-w-5xl px-4 pb-24 pt-6 sm:px-6 sm:pt-8">
      <Link href="/console/settings" className="t-meta inline-flex items-center gap-1.5 text-[12px] hover:text-[color:var(--ink)]">
        <ArrowLeft className="h-3.5 w-3.5" /> Settings &amp; Vault
      </Link>

      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="t-display flex items-center gap-2 text-[1.6rem]">
            <Paperclip className="h-6 w-6" style={{ color: "var(--brand)" }} /> Attachment types
          </h1>
          <p className="t-meta mt-1 max-w-2xl">
            Everything you may ask a customer to bring, and where each one is asked for.
            Borrower settings and every product choose from this list — add a row here and
            it appears in both.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setShowHistory((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-[color:var(--ink-muted)] ring-1 ring-[color:var(--ink)]/10 hover:text-[color:var(--ink)]">
            <History className="h-3.5 w-3.5" /> {version > 0 ? `v${version}` : "Defaults"}
          </button>
          {dirty && (
            <button type="button" onClick={() => { setCfg(saved); setIssues([]); }}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-[color:var(--ink-muted)] hover:text-[color:var(--ink)]">
              <RotateCcw className="h-3.5 w-3.5" /> Discard
            </button>
          )}
          <button type="button" onClick={save} disabled={busy || !dirty || liveIssues.length > 0}
            className="inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-[11px] font-bold text-white disabled:opacity-50"
            style={{ backgroundColor: "var(--brand)" }}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {dirty ? "Publish changes" : "Saved"}
          </button>
        </div>
      </div>

      {notice && (
        <div className="mt-4 flex items-start gap-2 rounded-xl bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-800 ring-1 ring-emerald-600/20">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {notice}
        </div>
      )}
      {(error || liveIssues.length > 0) && (
        <div className="mt-4 rounded-xl bg-amber-500/10 px-3 py-2.5 text-sm text-amber-900 ring-1 ring-amber-600/20">
          <p className="flex items-start gap-2 font-semibold">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error ?? "This catalogue would not hold together."}
          </p>
          <ul className="mt-1.5 space-y-0.5 pl-6 text-[12px]">
            {[...new Map([...issues, ...liveIssues].map((i) => [i.path + i.message, i])).values()].map((i) => (
              <li key={i.path + i.message} className="list-disc">{i.message}</li>
            ))}
          </ul>
        </div>
      )}

      {showHistory && (
        <div className="glass mt-4 p-4">
          <p className="t-label">Published versions</p>
          {revisions.length === 0 ? (
            <p className="t-meta mt-2 text-[12px]">Nothing published — you are looking at the platform catalogue.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {revisions.map((r) => (
                <li key={r.version} className="flex items-center justify-between gap-3 text-[12px]">
                  <span className="font-semibold text-[color:var(--ink)]">v{r.version}</span>
                  <span className="t-meta shrink-0 text-[11px]">
                    {new Date(r.createdAt).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-5 flex items-center justify-between gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[color:var(--ink-faint)]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an attachment…"
            className="w-44 rounded-lg border border-[color:var(--ink)]/10 bg-paper/70 py-1.5 pl-8 pr-2.5 text-[12px] outline-none placeholder:text-[color:var(--ink-faint)] focus:border-transparent focus:ring-2 focus:ring-[color:var(--brand)] sm:w-64" />
        </div>
        <button type="button"
          onClick={() => { setCfg({ ...cfg, items: [...cfg.items, blank()] }); setEditing({ index: cfg.items.length, item: blank() }); }}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-bold text-white"
          style={{ backgroundColor: "var(--brand)" }}>
          <Plus className="h-3.5 w-3.5" /> Add attachment
        </button>
      </div>

      <div className="glass mt-3 overflow-hidden">
        <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_6rem_5rem_5rem] gap-3 border-b border-[color:var(--ink)]/[0.07] px-4 py-2.5 sm:grid">
          <span className="t-label">Attachment</span>
          <span className="t-label">File types</span>
          <span className="t-label text-center">Multiple</span>
          <span className="t-label text-center">Active</span>
          <span className="t-label text-right">Edit</span>
        </div>

        <ul className="divide-y divide-[color:var(--ink)]/[0.05]">
          {rows.map(({ item, index }) => (
            <li key={`${item.code}-${index}`}
              className="grid grid-cols-[minmax(0,1fr)_5rem] items-center gap-3 px-4 py-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_6rem_5rem_5rem]"
              style={item.active ? undefined : { opacity: 0.55 }}>
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold text-[color:var(--ink)]">
                  {item.name || <span className="italic text-[color:var(--ink-faint)]">Unnamed</span>}
                  {item.builtIn && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--ink)]/[0.06] px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-[color:var(--ink-muted)]">
                      <Lock className="h-2.5 w-2.5" /> Platform
                    </span>
                  )}
                </p>
                <p className="t-meta text-[11px]">
                  {item.shortCode}
                  {item.description ? ` · ${item.description}` : ""}
                  {" · "}
                  {item.scopes.map((s) => ATTACHMENT_SCOPES.find((x) => x.key === s)?.label).join(", ")}
                </p>
              </div>
              <p className="hidden font-mono text-[11px] text-[color:var(--ink-muted)] sm:block">{item.fileTypes.join(" ")}</p>
              <div className="hidden justify-center sm:flex">
                <Toggle label="Multiple" checked={item.allowMultiple} onChange={(v) => patchItem(index, { allowMultiple: v })} />
              </div>
              <div className="hidden justify-center sm:flex">
                <Toggle label="Active" checked={item.active} onChange={(v) => patchItem(index, { active: v })} />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setEditing({ index, item })}
                  className="rounded-md px-2 py-1 text-[11px] font-semibold text-[color:var(--ink-muted)] ring-1 ring-[color:var(--ink)]/10 hover:text-[color:var(--ink)]">
                  Edit
                </button>
                {!item.builtIn && (
                  <button type="button"
                    onClick={() => setCfg({ ...cfg, items: cfg.items.filter((_, i) => i !== index) })}
                    className="text-[color:var(--ink-faint)] hover:text-red-500" aria-label={`Delete ${item.name}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <p className="t-meta mt-3 text-[11px]">
        Platform attachments can be renamed, re-scoped and switched off, but not deleted —
        the document parser and the check catalogue reference them by code. Switching one
        off stops it being asked for everywhere, immediately.
      </p>

      {editing && (
        <ItemDrawer
          item={cfg.items[editing.index] ?? editing.item}
          onChange={(patch) => patchItem(editing.index, patch)}
          onClose={() => setEditing(null)}
        />
      )}
    </main>
  );
}

// ── The editor ────────────────────────────────────────────────────────────────

function ItemDrawer({
  item, onChange, onClose,
}: {
  item: AttachmentItem;
  onChange: (patch: Partial<AttachmentItem>) => void;
  onClose: () => void;
}) {
  const toggleScope = (s: AttachmentScope) =>
    onChange({ scopes: item.scopes.includes(s) ? item.scopes.filter((x) => x !== s) : [...item.scopes, s] });

  const toggleType = (t: string) =>
    onChange({ fileTypes: item.fileTypes.includes(t) ? item.fileTypes.filter((x) => x !== t) : [...item.fileTypes, t] });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6">
      <div className="glass max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl p-5 sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="t-display text-[1.15rem]">{item.builtIn ? item.name : "Attachment"}</h2>
            <p className="t-meta mt-0.5 text-[12px]">
              {item.builtIn
                ? "A platform attachment. Rename it, re-scope it, switch it off — but its code stays, because engines read it."
                : "Your own. Give it a code that will not change, because captured files are filed under it."}
            </p>
          </div>
          <button type="button" onClick={onClose}
            className="rounded-lg p-1.5 text-[color:var(--ink-faint)] hover:text-[color:var(--ink)]">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <TextField label="Name" value={item.name} onChange={(v) => onChange({ name: v })} placeholder="Business licence" />
            </div>
            <TextField label="Short tag" value={item.shortCode}
              onChange={(v) => onChange({ shortCode: v.toUpperCase().slice(0, 8) })} placeholder="BL"
              help="Shown under the name in lists." />
          </div>

          <TextField
            label="Code" value={item.code}
            onChange={(v) => onChange({ code: v.toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 32) })}
            placeholder="BUSINESS_LICENCE"
            help={item.builtIn
              ? "Platform code. Changing it would orphan every file already captured under it."
              : "Uppercase, no spaces. Files are filed under this, so it should never change once used."}
          />

          <TextField label="Description" value={item.description} onChange={(v) => onChange({ description: v })}
            placeholder="Single business permit for the current year." />

          <Divider label="Where it may be asked for" />
          <div className="grid gap-2 sm:grid-cols-2">
            {ATTACHMENT_SCOPES.map((s) => {
              const on = item.scopes.includes(s.key);
              return (
                <button key={s.key} type="button" onClick={() => toggleScope(s.key)}
                  className="flex items-start justify-between gap-3 rounded-xl px-3 py-2.5 text-left ring-1 transition-colors"
                  style={on
                    ? { backgroundColor: "var(--brand-soft)", ["--tw-ring-color" as never]: "var(--brand)" }
                    : { ["--tw-ring-color" as never]: "rgba(15,15,25,0.08)" }}>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold text-[color:var(--ink)]">{s.label}</span>
                    <span className="t-meta block text-[11px] leading-snug">{s.blurb}</span>
                  </span>
                  <Toggle label={s.label} checked={on} onChange={() => toggleScope(s.key)} />
                </button>
              );
            })}
          </div>

          <Divider label="The file itself" />
          <div>
            <p className="t-label mb-2">Accepted file types</p>
            <div className="flex flex-wrap gap-1.5">
              {FILE_TYPES.map((t) => {
                const on = item.fileTypes.includes(t);
                return (
                  <button key={t} type="button" aria-pressed={on} onClick={() => toggleType(t)}
                    className="rounded-full px-3 py-1.5 font-mono text-[12px] font-semibold ring-1 transition-colors"
                    style={on
                      ? { backgroundColor: "var(--brand-soft)", color: "var(--ink)", ["--tw-ring-color" as never]: "var(--brand)" }
                      : { color: "var(--ink-muted)", ["--tw-ring-color" as never]: "rgba(15,15,25,0.10)" }}>
                    {t}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField label="Largest file" suffix="MB" min={1} max={50} value={item.maxSizeMb}
              onChange={(v) => onChange({ maxSizeMb: v })}
              help="A photograph from a modern phone is 3–8 MB." />
            <label className="flex items-start justify-between gap-2 rounded-xl px-3 py-2.5 ring-1 ring-[color:var(--ink)]/[0.07]">
              <span className="min-w-0">
                <span className="text-[13px] font-semibold text-[color:var(--ink)]">Several files allowed</span>
                <span className="t-meta block text-[11px] leading-snug">
                  Six months of statements, or four photographs of a shop.
                </span>
              </span>
              <Toggle label="Several allowed" checked={item.allowMultiple} onChange={(v) => onChange({ allowMultiple: v })} />
            </label>
          </div>

          <SelectField
            label="What reads it"
            value={item.parser}
            onChange={(v) => onChange({ parser: v as AttachmentParser })}
            options={ATTACHMENT_PARSERS.map((p) => ({ value: p.key, label: p.label }))}
            help={ATTACHMENT_PARSERS.find((p) => p.key === item.parser)?.blurb}
          />

          <Choice
            label="Status"
            value={item.active ? "active" : "off"}
            onChange={(v) => onChange({ active: v === "active" })}
            cols={2}
            options={[
              { value: "active", label: "Active", hint: "Offered wherever it is switched on." },
              { value: "off", label: "Switched off", hint: "The row survives and references keep resolving; nobody is asked for it." },
            ]}
          />
        </div>

        <div className="mt-5 flex justify-end">
          <button type="button" onClick={onClose}
            className="rounded-lg px-5 py-2 text-[12px] font-bold text-white"
            style={{ backgroundColor: "var(--brand)" }}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

