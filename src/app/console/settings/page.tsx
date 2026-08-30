"use client";

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS & VAULT — the module launcher, not an accordion.
//
// The old page stacked seven collapsible credential forms in one column: to find
// SMS you scrolled past M-Pesa, and the non-credential settings (branding, roles,
// products, structure) lived somewhere else entirely, so "configure my platform"
// was never one place.
//
// Now every configurable surface is a tile, banded by what it actually does, and
// the whole catalogue comes from src/lib/settings/registry.ts. Credential tiles
// open a drawer OVER the launcher — you never lose your place — and saving
// re-reads the status live. Nothing here needs a sign-out to take effect.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  ShieldCheck, Loader2, AlertTriangle, CheckCircle2, X, ArrowUpRight, Lock, Search,
} from "lucide-react";
import { useLoad } from "@/lib/hooks/useLoad";
import {
  SETTINGS_TILES, SETTINGS_GROUPS, GROUP_BLURB,
  type SettingsTile, type FieldSpec,
} from "@/lib/settings/registry";

type Row = { kind: string; status: string; lastTestAt: string | null; lastError: string | null };

const STATUS_TONE: Record<string, string> = {
  LIVE: "bg-emerald-500/12 text-emerald-700 ring-emerald-600/20",
  TESTED: "bg-emerald-500/12 text-emerald-700 ring-emerald-600/20",
  CONFIGURED: "bg-amber-500/12 text-amber-700 ring-amber-600/20",
  UNCONFIGURED: "bg-[color:var(--ink)]/[0.05] text-[color:var(--ink-faint)] ring-[color:var(--ink)]/10",
  DISABLED: "bg-red-500/12 text-red-700 ring-red-600/20",
};

const STATUS_WORD: Record<string, string> = {
  LIVE: "Live",
  TESTED: "Tested",
  CONFIGURED: "Configured",
  UNCONFIGURED: "Not set up",
  DISABLED: "Disabled",
};

export default function SettingsLauncher() {
  const reduce = useReducedMotion();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<SettingsTile | null>(null);
  const [q, setQ] = useState("");

  const load = async () => {
    try {
      const res = await fetch("/api/orgs/integrations");
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not load integrations."); return; }
      setRows(data.integrations);
      setError(null);
    } catch { setError("Could not load integrations."); }
  };
  useLoad(load);

  const statusOf = (tile: SettingsTile) =>
    tile.kind === "vault" ? rows?.find((r) => r.kind === tile.vaultKind)?.status ?? "UNCONFIGURED" : null;

  // Search spans title AND description, because people look for "paybill", not
  // "M-Pesa collections".
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return SETTINGS_TILES;
    return SETTINGS_TILES.filter(
      (t) => t.title.toLowerCase().includes(needle) || t.desc.toLowerCase().includes(needle),
    );
  }, [q]);

  const configured = rows?.filter((r) => r.status !== "UNCONFIGURED").length ?? 0;
  const vaultCount = SETTINGS_TILES.filter((t) => t.kind === "vault").length;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="t-display flex items-center gap-2 text-[1.6rem]">
            <ShieldCheck className="h-6 w-6" style={{ color: "var(--brand)" }} /> Settings &amp; Vault
          </h1>
          <p className="t-meta mt-1">
            Everything that makes this platform yours. Credentials are encrypted at rest and never
            shown back — saving replaces the previous config.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {rows && (
            <span className="rounded-lg bg-[color:var(--ink)]/[0.05] px-2.5 py-1.5 text-[11px] font-semibold text-[color:var(--ink-muted)]">
              {configured}/{vaultCount} rails connected
            </span>
          )}
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[color:var(--ink-faint)]" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find a setting…"
              className="w-44 rounded-lg border border-[color:var(--ink)]/10 bg-paper/70 py-1.5 pl-8 pr-2.5 text-[12px] outline-none placeholder:text-[color:var(--ink-faint)] focus:border-transparent focus:ring-2 focus:ring-[color:var(--brand)] sm:w-56"
            />
          </div>
        </div>
      </div>

      {notice && (
        <div className="mt-4 flex items-start gap-2 rounded-xl bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-800 ring-1 ring-emerald-600/20">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {notice}
        </div>
      )}
      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-xl bg-red-500/10 px-3 py-2.5 text-sm text-red-800 ring-1 ring-red-600/20">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}
      {!rows && !error && (
        <div className="mt-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-[color:var(--ink-faint)]" /></div>
      )}

      {rows && (
        <div className="mt-6 space-y-7">
          {SETTINGS_GROUPS.map((group) => {
            const tiles = matches.filter((t) => t.group === group);
            if (tiles.length === 0) return null;
            return (
              <section key={group}>
                <div className="mb-3">
                  <h2 className="t-section">{group}</h2>
                  <p className="t-meta text-[12px]">{GROUP_BLURB[group]}</p>
                </div>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                  {tiles.map((tile) => (
                    <Tile
                      key={tile.id}
                      tile={tile}
                      status={statusOf(tile)}
                      onOpen={() => setOpen(tile)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
          {matches.length === 0 && (
            <p className="t-meta py-10 text-center">Nothing matches “{q}”.</p>
          )}
        </div>
      )}

      <AnimatePresence>
        {open && open.kind === "vault" && (
          <VaultDrawer
            tile={open}
            status={statusOf(open)}
            reduce={!!reduce}
            onClose={() => setOpen(null)}
            onSaved={async (msg) => {
              setNotice(msg);
              setOpen(null);
              // Live-apply: the launcher re-reads status immediately, so the tile
              // flips to Configured in place. No reload, no sign-out.
              await load();
            }}
          />
        )}
      </AnimatePresence>
    </main>
  );
}

// ── One tile ──────────────────────────────────────────────────────────────────
function Tile({ tile, status, onOpen }: { tile: SettingsTile; status: string | null; onOpen: () => void }) {
  const Icon = tile.icon;
  const body = (
    <div className="glass group h-full p-3.5 transition-colors hover:bg-paper/80 sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <Icon className="h-5 w-5 sm:h-6 sm:w-6" style={{ color: "var(--brand)" }} aria-hidden />
        {status ? (
          <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold ring-1 ${STATUS_TONE[status] ?? STATUS_TONE.UNCONFIGURED}`}>
            {STATUS_WORD[status] ?? status}
          </span>
        ) : (
          <ArrowUpRight className="h-4 w-4 text-[color:var(--ink-faint)] opacity-0 transition-opacity group-hover:opacity-100" />
        )}
      </div>
      <h3 className="mt-2.5 text-[13px] font-semibold leading-snug text-[color:var(--ink)] sm:mt-3 sm:text-sm">
        {tile.title}
      </h3>
      <p className="t-meta mt-1 text-[11px] leading-snug sm:text-[13px]">{tile.desc}</p>
    </div>
  );

  if (tile.kind === "link") {
    return <Link href={tile.href} className="block h-full">{body}</Link>;
  }
  return <button type="button" onClick={onOpen} className="block h-full w-full text-left">{body}</button>;
}

// ── The credential drawer ─────────────────────────────────────────────────────
// Opens over the launcher rather than navigating: you configure a rail and land
// straight back on the grid with the tile already updated.
function VaultDrawer({
  tile, status, reduce, onClose, onSaved,
}: {
  tile: Extract<SettingsTile, { kind: "vault" }>;
  status: string | null;
  reduce: boolean;
  onClose: () => void;
  onSaved: (msg: string) => void | Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const Icon = tile.icon;

  const save = async () => {
    setSaving(true); setErr(null);
    const config: Record<string, unknown> = {};
    for (const f of tile.fields) {
      const raw = (values[f.key] ?? "").trim();
      if (!raw) continue;
      config[f.key] = f.type === "number" ? Number(raw) : raw;
    }
    if (Object.keys(config).length === 0) {
      setErr("Fill in the credentials first."); setSaving(false); return;
    }
    try {
      const res = await fetch("/api/orgs/integrations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: tile.vaultKind, config }),
      });
      const data = await res.json();
      if (!data.success) { setErr(data.message || "Could not save."); return; }
      await onSaved(`${tile.title} saved — encrypted and live.`);
    } catch { setErr("Could not save."); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <motion.div
        aria-hidden
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={reduce ? undefined : { opacity: 0 }}
        className="absolute inset-0 bg-ash-950/30 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.aside
        role="dialog"
        aria-label={tile.title}
        initial={reduce ? false : { x: "100%" }}
        animate={{ x: 0 }}
        exit={reduce ? undefined : { x: "100%" }}
        transition={{ type: "spring", stiffness: 320, damping: 34 }}
        className="relative flex h-full w-full max-w-md flex-col bg-paper shadow-2xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-[color:var(--ink)]/[0.08] px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color:var(--brand-soft)]">
              <Icon className="h-5 w-5" style={{ color: "var(--brand)" }} />
            </span>
            <div>
              <p className="text-sm font-bold text-[color:var(--ink)]">{tile.title}</p>
              {status && (
                <span className={`mt-1 inline-block rounded-md px-1.5 py-0.5 text-[10px] font-bold ring-1 ${STATUS_TONE[status] ?? STATUS_TONE.UNCONFIGURED}`}>
                  {STATUS_WORD[status] ?? status}
                </span>
              )}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-[color:var(--ink-faint)] hover:bg-[color:var(--ink)]/5">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <p className="t-meta text-[12px] leading-relaxed">{tile.blurb}</p>

          <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-[color:var(--ink)]/[0.03] px-2.5 py-2 text-[11px] text-[color:var(--ink-muted)]">
            <Lock className="mt-0.5 h-3 w-3 shrink-0" />
            Secrets are write-only — we never read them back to this screen, so the fields start
            blank even when a value is already saved.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {tile.fields.map((f) => (
              <Field
                key={f.key}
                spec={f}
                value={values[f.key] ?? ""}
                onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))}
              />
            ))}
          </div>

          {tile.footnote && (
            <p className="mt-4 rounded-lg bg-[color:var(--ink)]/[0.03] px-2.5 py-2 text-[11px] leading-relaxed text-[color:var(--ink-faint)]">
              {tile.footnote}
            </p>
          )}

          {err && (
            <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-red-500/10 px-2.5 py-2 text-[12px] text-red-700 ring-1 ring-red-600/20">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {err}
            </p>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-[color:var(--ink)]/[0.08] px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-[12px] font-semibold text-[color:var(--ink-muted)] hover:text-[color:var(--ink)]">
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[12px] font-bold text-white disabled:opacity-60"
            style={{ backgroundColor: "var(--brand)" }}
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save encrypted
          </button>
        </footer>
      </motion.aside>
    </div>
  );
}

function Field({ spec, value, onChange }: { spec: FieldSpec; value: string; onChange: (v: string) => void }) {
  const cls =
    "mt-1 w-full rounded-lg border border-[color:var(--ink)]/12 bg-paper px-3 py-2.5 text-sm outline-none placeholder:text-[color:var(--ink-faint)] focus:border-transparent focus:ring-2 focus:ring-[color:var(--brand)]";
  return (
    <label className={spec.wide ? "sm:col-span-2" : undefined}>
      <span className="t-label">{spec.label}</span>
      {spec.type === "select" ? (
        <select value={value || spec.options![0]} onChange={(e) => onChange(e.target.value)} className={cls}>
          {spec.options!.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input
          type={spec.type === "password" ? "password" : "text"}
          inputMode={spec.type === "number" ? "numeric" : undefined}
          value={value}
          placeholder={spec.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={cls}
        />
      )}
      {spec.help && <span className="mt-1 block text-[11px] text-[color:var(--ink-faint)]">{spec.help}</span>}
    </label>
  );
}
