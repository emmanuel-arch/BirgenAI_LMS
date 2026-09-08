"use client";

// ─────────────────────────────────────────────────────────────────────────────
// ADDITIONAL DETAILS — the fields we did not think of, that this lender needs.
//
// A sacco number. A matatu route. The chief's location. The crop and the acreage.
// Every lending system eventually meets a lender who must capture something its
// author never imagined, and there are only two answers: a column — which means a
// migration, a deploy, and a schema that grows a scar per tenant — or making the
// FIELD a first-class object.
//
// The screen is two levels because the data is: a GROUP is a titled section that
// appears on a record, and an ITEM is one typed question inside it. That is the
// shape ServiceSuite chose too, and it was right to. What it does not give an item
// is any meaning — a "Numeric" field there accepts -9e99, dropdown options are a
// comma-joined string in one column, nothing says WHERE a group appears so every
// group is asked everywhere, and deleting an item orphans every value ever captured.
//
// Here an item carries its own validation, its own channels, and a stable `code`
// that the captured VALUE is filed under — so renaming "Business name" to "Trading
// name" never orphans a year of capture, which is the single most common way a
// system like this quietly loses data.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ListPlus, Loader2, AlertTriangle, CheckCircle2, ArrowLeft, Plus, Trash2,
  Save, RotateCcw, History, X, ChevronRight, GripVertical,
} from "lucide-react";
import { useLoad } from "@/lib/hooks/useLoad";
import {
  Toggle, TextField, SelectField, NumberField, Divider, INPUT,
} from "@/components/settings/controls";
import {
  DETAIL_SCOPES, DETAIL_TYPES, DETAIL_CHANNELS, OPTION_TYPES, RANGED_TYPES,
  mergeDetailsConfig, validateDetailsConfig,
  type DetailsConfig, type DetailGroup, type DetailItem,
  type DetailScope, type DetailType, type DetailChannel,
} from "@/lib/config/details";
import type { ConfigIssue } from "@/lib/config/borrower";

type Revision = { version: number; changed: string[]; createdAt: string };

const blankGroup = (): DetailGroup => ({
  code: "", title: "", shortCode: "", description: "", scope: "borrower", active: true, items: [],
});

const blankItem = (): DetailItem => ({
  code: "", title: "", description: "", type: "text", options: [],
  required: false, min: null, max: null, pattern: "", placeholder: "",
  channels: ["console", "portal"], active: true,
});

const slug = (s: string) =>
  s.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);

export default function DetailsCatalogue() {
  const [cfg, setCfg] = useState<DetailsConfig | null>(null);
  const [saved, setSaved] = useState<DetailsConfig | null>(null);
  const [version, setVersion] = useState(0);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [issues, setIssues] = useState<ConfigIssue[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [open, setOpen] = useState(0);
  const [editing, setEditing] = useState<{ g: number; i: number } | null>(null);

  const load = async () => {
    try {
      const res = await fetch("/api/config/details");
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not load additional details."); return; }
      const merged = mergeDetailsConfig(data.value);
      setCfg(merged); setSaved(merged); setVersion(data.version);
      setRevisions(data.history ?? []); setError(null);
    } catch { setError("Could not load additional details."); }
  };
  useLoad(load);

  const dirty = useMemo(
    () => Boolean(cfg && saved && JSON.stringify(cfg) !== JSON.stringify(saved)),
    [cfg, saved],
  );
  const liveIssues = useMemo(() => (cfg ? validateDetailsConfig(cfg) : []), [cfg]);

  const save = async () => {
    if (!cfg) return;
    setBusy(true); setError(null); setNotice(null); setIssues([]);
    try {
      const res = await fetch("/api/config/details", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: cfg }),
      });
      const data = await res.json();
      if (res.status === 422) { setIssues(data.issues ?? []); setError(data.message); return; }
      if (!data.success) { setError(data.message || "Could not save."); return; }
      const merged = mergeDetailsConfig(data.value);
      setCfg(merged); setSaved(merged); setVersion(data.version);
      setNotice(`Published as version ${data.version} — live in the console and the customer app.`);
      const fresh = await fetch("/api/config/details").then((r) => r.json()).catch(() => null);
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

  const patchGroup = (gi: number, patch: Partial<DetailGroup>) =>
    setCfg({ ...cfg, groups: cfg.groups.map((g, i) => (i === gi ? { ...g, ...patch } : g)) });

  const patchItem = (gi: number, ii: number, patch: Partial<DetailItem>) =>
    patchGroup(gi, { items: cfg.groups[gi].items.map((it, i) => (i === ii ? { ...it, ...patch } : it)) });

  const moveItem = (gi: number, ii: number, dir: -1 | 1) => {
    const items = [...cfg.groups[gi].items];
    const j = ii + dir;
    if (j < 0 || j >= items.length) return;
    [items[ii], items[j]] = [items[j], items[ii]];
    patchGroup(gi, { items });
  };

  return (
    <main className="mx-auto max-w-5xl px-4 pb-24 pt-6 sm:px-6 sm:pt-8">
      <Link href="/console/settings" className="t-meta inline-flex items-center gap-1.5 text-[12px] hover:text-[color:var(--ink)]">
        <ArrowLeft className="h-3.5 w-3.5" /> Settings &amp; Vault
      </Link>

      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="t-display flex items-center gap-2 text-[1.6rem]">
            <ListPlus className="h-6 w-6" style={{ color: "var(--brand)" }} /> Additional details
          </h1>
          <p className="t-meta mt-1 max-w-2xl">
            Anything you need to capture that we did not ship a field for. Define a group,
            hang typed questions off it, and it appears on the record you scoped it to —
            in the console and in the customer app, without a deploy.
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
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error ?? "These fields would not hold together."}
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
            <p className="t-meta mt-2 text-[12px]">Nothing published yet.</p>
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

      <div className="mt-5 flex justify-end">
        <button type="button"
          onClick={() => { setCfg({ ...cfg, groups: [...cfg.groups, blankGroup()] }); setOpen(cfg.groups.length); }}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-bold text-white"
          style={{ backgroundColor: "var(--brand)" }}>
          <Plus className="h-3.5 w-3.5" /> Add group
        </button>
      </div>

      {cfg.groups.length === 0 && (
        <div className="glass mt-3 px-4 py-10 text-center">
          <ListPlus className="mx-auto h-6 w-6 text-[color:var(--ink-faint)]" />
          <p className="mt-2 text-[14px] font-semibold text-[color:var(--ink)]">No extra fields</p>
          <p className="t-meta mx-auto mt-1 max-w-md text-[12.5px]">
            You are collecting exactly what the platform ships. Add a group when you need
            something else — a sacco number, a route, a farm size.
          </p>
        </div>
      )}

      <div className="mt-3 space-y-3">
        {cfg.groups.map((g, gi) => {
          const expanded = open === gi;
          return (
            <div key={gi} className="glass overflow-hidden" style={g.active ? undefined : { opacity: 0.6 }}>
              <button type="button" onClick={() => setOpen(expanded ? -1 : gi)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-[color:var(--ink)]">
                    {g.title || <span className="italic text-[color:var(--ink-faint)]">Untitled group</span>}
                    <span className="t-meta ml-2 text-[11px] font-normal">{g.shortCode}</span>
                  </p>
                  <p className="t-meta text-[11px]">
                    {DETAIL_SCOPES.find((s) => s.key === g.scope)?.label} ·{" "}
                    {g.items.length} field{g.items.length === 1 ? "" : "s"}
                    {g.description ? ` · ${g.description}` : ""}
                  </p>
                </div>
                <ChevronRight className={`h-4 w-4 shrink-0 text-[color:var(--ink-faint)] transition-transform ${expanded ? "rotate-90" : ""}`} />
              </button>

              {expanded && (
                <div className="border-t border-[color:var(--ink)]/[0.07] px-4 py-4">
                  <div className="grid gap-4 sm:grid-cols-4">
                    <div className="sm:col-span-2">
                      <TextField label="Group title" value={g.title}
                        onChange={(v) => patchGroup(gi, { title: v, code: g.code || slug(v), shortCode: g.shortCode || slug(v).slice(0, 3) })}
                        placeholder="Business details" />
                    </div>
                    <TextField label="Short tag" value={g.shortCode}
                      onChange={(v) => patchGroup(gi, { shortCode: v.toUpperCase().slice(0, 8) })} placeholder="BD" />
                    <SelectField label="Appears on" value={g.scope}
                      onChange={(v) => patchGroup(gi, { scope: v as DetailScope })}
                      options={DETAIL_SCOPES.map((s) => ({ value: s.key, label: s.label }))}
                      help={DETAIL_SCOPES.find((s) => s.key === g.scope)?.blurb} />
                  </div>

                  <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
                    <TextField label="Description" value={g.description}
                      onChange={(v) => patchGroup(gi, { description: v })}
                      placeholder="What the customer does, and where they do it." />
                    <TextField label="Key" value={g.code}
                      onChange={(v) => patchGroup(gi, { code: slug(v) })}
                      help="Never change this once fields under it have been filled in." />
                  </div>

                  <div className="mt-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-2">
                        <Toggle label="Active" checked={g.active} onChange={(v) => patchGroup(gi, { active: v })} />
                        <span className="t-label">Active</span>
                      </label>
                      <button type="button"
                        onClick={() => setCfg({ ...cfg, groups: cfg.groups.filter((_, i) => i !== gi) })}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-[color:var(--ink-faint)] hover:text-red-500">
                        <Trash2 className="h-3.5 w-3.5" /> Delete group
                      </button>
                    </div>
                    <button type="button"
                      onClick={() => { patchGroup(gi, { items: [...g.items, blankItem()] }); setEditing({ g: gi, i: g.items.length }); }}
                      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-bold text-white"
                      style={{ backgroundColor: "var(--brand)" }}>
                      <Plus className="h-3.5 w-3.5" /> Add field
                    </button>
                  </div>

                  <Divider label="Fields" />
                  {g.items.length === 0 ? (
                    <p className="t-meta mt-2 text-[12px]">Nothing in this group yet.</p>
                  ) : (
                    <ul className="mt-2 space-y-1.5">
                      {g.items.map((it, ii) => (
                        <li key={ii}
                          className="flex items-center gap-2 rounded-xl px-3 py-2.5 ring-1 ring-[color:var(--ink)]/[0.07]"
                          style={it.active ? undefined : { opacity: 0.55 }}>
                          <div className="flex shrink-0 flex-col">
                            <button type="button" onClick={() => moveItem(gi, ii, -1)} disabled={ii === 0}
                              className="text-[10px] font-bold text-[color:var(--ink-faint)] disabled:opacity-20">↑</button>
                            <button type="button" onClick={() => moveItem(gi, ii, 1)} disabled={ii === g.items.length - 1}
                              className="text-[10px] font-bold text-[color:var(--ink-faint)] disabled:opacity-20">↓</button>
                          </div>
                          <GripVertical className="h-3.5 w-3.5 shrink-0 text-[color:var(--ink-faint)]" />
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] font-semibold text-[color:var(--ink)]">
                              {it.title || <span className="italic text-[color:var(--ink-faint)]">Untitled field</span>}
                              {it.required && <span className="ml-1.5 text-red-500">*</span>}
                            </p>
                            <p className="t-meta text-[11px]">
                              {DETAIL_TYPES.find((t) => t.key === it.type)?.label}
                              {it.options.length ? ` · ${it.options.length} options` : ""}
                              {" · "}{it.channels.join(", ")}
                            </p>
                          </div>
                          <button type="button" onClick={() => setEditing({ g: gi, i: ii })}
                            className="shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold text-[color:var(--ink-muted)] ring-1 ring-[color:var(--ink)]/10 hover:text-[color:var(--ink)]">
                            Edit
                          </button>
                          <button type="button"
                            onClick={() => patchGroup(gi, { items: g.items.filter((_, i) => i !== ii) })}
                            className="shrink-0 text-[color:var(--ink-faint)] hover:text-red-500">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {editing && cfg.groups[editing.g]?.items[editing.i] && (
        <FieldDrawer
          item={cfg.groups[editing.g].items[editing.i]}
          groupTitle={cfg.groups[editing.g].title}
          onChange={(patch) => patchItem(editing.g, editing.i, patch)}
          onClose={() => setEditing(null)}
        />
      )}
    </main>
  );
}

// ── The field editor ──────────────────────────────────────────────────────────

function FieldDrawer({
  item, groupTitle, onChange, onClose,
}: {
  item: DetailItem;
  groupTitle: string;
  onChange: (patch: Partial<DetailItem>) => void;
  onClose: () => void;
}) {
  const hasOptions = OPTION_TYPES.includes(item.type);
  const ranged = RANGED_TYPES.includes(item.type);
  const numeric = item.type === "numeric" || item.type === "currency";

  const toggleChannel = (c: DetailChannel) =>
    onChange({ channels: item.channels.includes(c) ? item.channels.filter((x) => x !== c) : [...item.channels, c] });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6">
      <div className="glass max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl p-5 sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="t-display text-[1.15rem]">Field</h2>
            <p className="t-meta mt-0.5 text-[12px]">In {groupTitle || "this group"}.</p>
          </div>
          <button type="button" onClick={onClose}
            className="rounded-lg p-1.5 text-[color:var(--ink-faint)] hover:text-[color:var(--ink)]">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-5">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_11rem]">
            <TextField label="Title" value={item.title}
              onChange={(v) => onChange({ title: v, code: item.code || slug(v) })}
              placeholder="Business name" />
            <TextField label="Key" value={item.code}
              onChange={(v) => onChange({ code: slug(v) })}
              help="Values are filed under this. Never change it once used." />
          </div>

          <TextField label="Help text" value={item.description} onChange={(v) => onChange({ description: v })}
            placeholder="The trading name, as the customer gives it." />

          <SelectField
            label="Type" value={item.type}
            onChange={(v) => onChange({
              type: v as DetailType,
              // Options and bounds are meaningless off the type that used them, and
              // carrying them forward is how a field that was once a dropdown keeps a
              // stale list nobody can see to remove.
              options: OPTION_TYPES.includes(v as DetailType) ? item.options : [],
              min: RANGED_TYPES.includes(v as DetailType) ? item.min : null,
              max: RANGED_TYPES.includes(v as DetailType) ? item.max : null,
            })}
            options={DETAIL_TYPES.map((t) => ({ value: t.key, label: t.label }))}
            help={DETAIL_TYPES.find((t) => t.key === item.type)?.blurb}
          />

          {hasOptions && (
            <div>
              <p className="t-label mb-1">Options</p>
              <textarea
                value={item.options.join("\n")}
                rows={Math.min(10, Math.max(3, item.options.length + 1))}
                onChange={(e) => onChange({ options: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })}
                placeholder={"Sole trader\nPartnership\nLimited company"}
                className={INPUT}
              />
              <p className="t-meta mt-1 text-[11px]">One per line. A choice field needs at least two.</p>
            </div>
          )}

          {ranged && (
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField
                label={numeric ? "Minimum value" : "Minimum length"}
                value={item.min ?? 0} min={0}
                onChange={(v) => onChange({ min: v > 0 ? v : null })}
                help="0 = no minimum."
              />
              <NumberField
                label={numeric ? "Maximum value" : "Maximum length"}
                value={item.max ?? 0} min={0}
                onChange={(v) => onChange({ max: v > 0 ? v : null })}
                help="0 = no maximum."
              />
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Placeholder" value={item.placeholder} onChange={(v) => onChange({ placeholder: v })}
              placeholder="Wanjiku Grocers" />
            <TextField label="Pattern" value={item.pattern} onChange={(v) => onChange({ pattern: v })}
              placeholder="^[A-Z]{3}[0-9]{3}$"
              help="A regular expression the answer must match. Leave empty for none." />
          </div>

          <Divider label="Where it is asked" />
          <div className="grid gap-2 sm:grid-cols-3">
            {DETAIL_CHANNELS.map((c) => {
              const on = item.channels.includes(c.key);
              return (
                <button key={c.key} type="button" onClick={() => toggleChannel(c.key)}
                  className="flex items-start justify-between gap-2 rounded-xl px-3 py-2.5 text-left ring-1 transition-colors"
                  style={on
                    ? { backgroundColor: "var(--brand-soft)", ["--tw-ring-color" as never]: "var(--brand)" }
                    : { ["--tw-ring-color" as never]: "rgba(15,15,25,0.08)" }}>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold text-[color:var(--ink)]">{c.label}</span>
                    <span className="t-meta block text-[11px] leading-snug">{c.blurb}</span>
                  </span>
                  <Toggle label={c.label} checked={on} onChange={() => toggleChannel(c.key)} />
                </button>
              );
            })}
          </div>
          <p className="t-meta text-[11px]">
            A field asked only in the console is one your staff fill in on the customer&apos;s
            behalf. A required field asked nowhere would make the form impossible to submit,
            and will not publish.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-start justify-between gap-2 rounded-xl px-3 py-2.5 ring-1 ring-[color:var(--ink)]/[0.07]">
              <span className="min-w-0">
                <span className="text-[13px] font-semibold text-[color:var(--ink)]">Required</span>
                <span className="t-meta block text-[11px] leading-snug">The record cannot be saved without it.</span>
              </span>
              <Toggle label="Required" checked={item.required} onChange={(v) => onChange({ required: v })} />
            </label>
            <label className="flex items-start justify-between gap-2 rounded-xl px-3 py-2.5 ring-1 ring-[color:var(--ink)]/[0.07]">
              <span className="min-w-0">
                <span className="text-[13px] font-semibold text-[color:var(--ink)]">Active</span>
                <span className="t-meta block text-[11px] leading-snug">
                  Off stops it being asked. Values already captured stay on file.
                </span>
              </span>
              <Toggle label="Active" checked={item.active} onChange={(v) => onChange({ active: v })} />
            </label>
          </div>
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
