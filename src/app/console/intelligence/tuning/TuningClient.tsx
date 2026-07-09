"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, AlertTriangle, RotateCcw, Save, Gauge, Eye, Info } from "lucide-react";

// The lender's own risk policy.
//
// Every slider is explained, bounded, and — crucially — previewed against the real
// book before it is saved. Nobody should have to guess what moving "31 to 60 days
// late" from 42 to 30 does to their watchlist; they should see the borrowers who
// move, by name, and then decide.

type Weights = Record<string, number>;
type Thresholds = Record<string, number>;
type Config = { weights: Weights; thresholds: Thresholds };
type Labels = Record<string, { label: string; group: string; help: string }>;
type Summary = { watchlist: number; high: number; elevated: number; atRiskValue: number; projectedLoss: number; fieldVisits: number };
type Moved = { name: string; from: string; to: string; riskScore: number; dpd: number };

type Loaded = {
  config: Config; defaults: Config; labels: Labels; isDefault: boolean;
  version: number; note: string | null; current: Summary; canEdit: boolean;
};

const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
const GROUPS = ["Arrears", "Origination", "Structural"];

const THRESHOLD_META: Record<string, { label: string; help: string; min: number; max: number; step: number; suffix?: string }> = {
  highBand: { label: "“High” risk starts at", help: "Risk score at or above which a borrower is treated as high risk.", min: 40, max: 95, step: 1 },
  elevatedBand: { label: "“Elevated” risk starts at", help: "Must sit below High.", min: 10, max: 80, step: 1 },
  surfaceAt: { label: "Watchlist cut-off", help: "Below this score, and with nothing overdue, a borrower is not shown. Anyone in arrears always appears.", min: 0, max: 60, step: 1 },
  pdHighAt: { label: "High model PD at", help: "The scorer's probability of default that counts as high.", min: 0.05, max: 0.9, step: 0.01 },
  pdElevatedAt: { label: "Elevated model PD at", help: "Must sit below high PD.", min: 0.02, max: 0.8, step: 0.01 },
  largeExposureMultiple: { label: "Large exposure at", help: "A balance this many times your average counts as unusually large.", min: 1.1, max: 5, step: 0.1, suffix: "×" },
  fieldVisitAtDpd: { label: "Send an officer at", help: "Days past due at which the recommended action becomes a field visit.", min: 1, max: 180, step: 1, suffix: " days" },
};

export function TuningClient() {
  const [data, setData] = useState<Loaded | null>(null);
  const [draft, setDraft] = useState<Config | null>(null);
  const [preview, setPreview] = useState<{ before: Summary; after: Summary; changed: Moved[]; dropped: Moved[]; adjustments: string[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/console/intelligence/tuning");
      const d = await res.json();
      if (!d.success) { setError(d.message || "Could not load the policy."); return; }
      setData(d); setDraft(d.config); setNote(d.note ?? "");
    } catch { setError("Could not load the policy."); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const dirty = useMemo(
    () => !!data && !!draft && JSON.stringify(draft) !== JSON.stringify(data.config),
    [data, draft],
  );

  const post = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(action); setError(null); setNotice(null);
    try {
      const res = await fetch("/api/console/intelligence/tuning", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...draft, ...extra }),
      });
      const d = await res.json();
      if (!d.success) { setError(d.message || "That didn't work."); return null; }
      return d;
    } catch { setError("That didn't work."); return null; } finally { setBusy(null); }
  };

  const runPreview = async () => {
    const d = await post("preview");
    if (d) { setPreview(d); setDraft(d.config); }
  };

  const save = async () => {
    const d = await post("save", { note });
    if (d) { setPreview(null); setNotice(`Saved as version ${d.version}.`); await load(); }
  };

  const reset = async () => {
    if (!confirm("Put every weight back to the BirgenAI defaults?")) return;
    const d = await post("reset");
    if (d) { setPreview(null); setNotice("Back to the defaults."); await load(); }
  };

  if (error && !data) {
    return <p className="mt-6 flex items-center gap-2 text-sm text-red-600"><AlertTriangle className="h-4 w-4" /> {error}</p>;
  }
  if (!data || !draft) return <div className="flex justify-center py-20"><Loader2 className="h-5 w-5 animate-spin text-zinc-400" /></div>;

  const setWeight = (k: string, v: number) => setDraft({ ...draft, weights: { ...draft.weights, [k]: v } });
  const setThreshold = (k: string, v: number) => setDraft({ ...draft, thresholds: { ...draft.thresholds, [k]: v } });

  return (
    <div className="min-h-screen relative text-zinc-900">
      <div aria-hidden className="fixed inset-0 z-0 bg-[url('/images/white-background.png')] bg-cover bg-center" />
      <main className="relative z-10 mx-auto max-w-4xl px-4 sm:px-6 py-10">
        <Link href="/console/intelligence" className="mb-6 inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800">
          <ArrowLeft className="h-4 w-4" /> Credit Intelligence
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold">
              <Gauge className="h-5 w-5" style={{ color: "var(--brand)" }} /> Your risk policy
            </h1>
            <p className="mt-1 max-w-xl text-sm text-zinc-500">
              These weights decide who your officers are told to call first. They never change what a borrower owes,
              and they never reverse a decision already made.
            </p>
          </div>
          <div className="text-right text-xs text-zinc-400">
            {data.isDefault ? "BirgenAI defaults" : `Version ${data.version}`}
          </div>
        </div>

        {/* What the policy flags today */}
        <div className="mt-5 glass p-5">
          <p className="text-xs font-semibold text-zinc-500">On your book right now</p>
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="On the watchlist" value={String(data.current.watchlist)} />
            <Stat label="High risk" value={String(data.current.high)} />
            <Stat label="Value at risk" value={kes(data.current.atRiskValue)} />
            <Stat label="Officer visits advised" value={String(data.current.fieldVisits)} />
          </div>
        </div>

        {/* Weights */}
        {GROUPS.map((group) => (
          <section key={group} className="mt-6">
            <h2 className="text-sm font-semibold">{group}</h2>
            <div className="mt-2 glass divide-y divide-zinc-900/5 p-1">
              {Object.entries(data.labels)
                .filter(([, m]) => m.group === group)
                .map(([key, meta]) => (
                  <Slider
                    key={key}
                    label={meta.label}
                    help={meta.help}
                    value={draft.weights[key]}
                    def={data.defaults.weights[key]}
                    min={0}
                    max={70}
                    step={1}
                    disabled={!data.canEdit}
                    onChange={(v) => setWeight(key, v)}
                  />
                ))}
            </div>
          </section>
        ))}

        {/* Thresholds */}
        <section className="mt-6">
          <h2 className="text-sm font-semibold">Bands and cut-offs</h2>
          <div className="mt-2 glass divide-y divide-zinc-900/5 p-1">
            {Object.entries(THRESHOLD_META).map(([key, m]) => (
              <Slider
                key={key}
                label={m.label}
                help={m.help}
                value={draft.thresholds[key]}
                def={data.defaults.thresholds[key]}
                min={m.min}
                max={m.max}
                step={m.step}
                suffix={m.suffix}
                disabled={!data.canEdit}
                onChange={(v) => setThreshold(key, v)}
              />
            ))}
          </div>
        </section>

        {/* Preview */}
        {preview && (
          <section className="mt-6 glass p-5">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold"><Eye className="h-4 w-4 text-zinc-400" /> What this would change</h2>
            {preview.adjustments.length > 0 && (
              <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
                {preview.adjustments.map((a, i) => (
                  <p key={i} className="flex items-start gap-1.5 text-xs text-amber-800"><Info className="mt-0.5 h-3 w-3 shrink-0" /> {a}</p>
                ))}
              </div>
            )}
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Delta label="Watchlist" before={preview.before.watchlist} after={preview.after.watchlist} />
              <Delta label="High risk" before={preview.before.high} after={preview.after.high} />
              <Delta label="Value at risk" before={preview.before.atRiskValue} after={preview.after.atRiskValue} money />
              <Delta label="Visits advised" before={preview.before.fieldVisits} after={preview.after.fieldVisits} />
            </div>

            {(preview.changed.length > 0 || preview.dropped.length > 0) && (
              <table className="mt-4 w-full text-xs">
                <thead>
                  <tr className="text-left text-zinc-400">
                    <th className="py-1 font-medium">Borrower</th>
                    <th className="py-1 font-medium">Days late</th>
                    <th className="py-1 font-medium">Was</th>
                    <th className="py-1 font-medium">Becomes</th>
                  </tr>
                </thead>
                <tbody>
                  {[...preview.changed, ...preview.dropped].map((m, i) => (
                    <tr key={i} className="border-t border-zinc-900/5">
                      <td className="py-1.5 font-medium">{m.name}</td>
                      <td className="py-1.5 tabular-nums text-zinc-500">{m.dpd}</td>
                      <td className="py-1.5 text-zinc-500">{m.from}</td>
                      <td className="py-1.5 font-semibold">{m.to}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {preview.changed.length === 0 && preview.dropped.length === 0 && (
              <p className="mt-3 text-xs text-zinc-500">Nobody moves band. The change is cosmetic on today&apos;s book.</p>
            )}
          </section>
        )}

        {/* Actions */}
        {data.canEdit ? (
          <div className="mt-6 glass p-5">
            <label className="text-xs font-medium text-zinc-500">Why are you changing this?</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. our market-stall book breathes late; 10 days is normal here"
              className="mt-1.5 w-full rounded-lg border border-zinc-900/15 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400"
            />
            <p className="mt-1 text-[11px] text-zinc-400">Recorded against your name in the audit log, with the whole policy.</p>

            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={runPreview} disabled={!!busy || !dirty}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-900/15 bg-white/70 px-4 py-2.5 text-sm font-semibold text-zinc-700 hover:bg-white disabled:opacity-40">
                {busy === "preview" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />} Preview on my book
              </button>
              <button onClick={save} disabled={!!busy || !dirty}
                className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
                style={{ backgroundColor: "var(--brand)" }}>
                {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save policy
              </button>
              <button onClick={reset} disabled={!!busy || data.isDefault}
                className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm text-zinc-500 hover:text-zinc-800 disabled:opacity-40">
                {busy === "reset" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Back to defaults
              </button>
            </div>

            {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
            {notice && <p className="mt-3 text-xs text-emerald-700">{notice}</p>}
          </div>
        ) : (
          <p className="mt-6 text-xs text-zinc-500">You can see the policy, but only an admin can change it.</p>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-zinc-400">{label}</p>
      <p className="mt-0.5 text-lg font-bold tabular-nums">{value}</p>
    </div>
  );
}

function Delta({ label, before, after, money }: { label: string; before: number; after: number; money?: boolean }) {
  const diff = after - before;
  const fmt = (n: number) => (money ? kes(n) : String(n));
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-zinc-400">{label}</p>
      <p className="mt-0.5 text-lg font-bold tabular-nums">{fmt(after)}</p>
      <p className={`text-[11px] tabular-nums ${diff === 0 ? "text-zinc-400" : diff > 0 ? "text-amber-700" : "text-emerald-700"}`}>
        {diff === 0 ? "no change" : `${diff > 0 ? "+" : "−"}${fmt(Math.abs(diff))}`}
      </p>
    </div>
  );
}

function Slider({
  label, help, value, def, min, max, step, suffix, disabled, onChange,
}: {
  label: string; help: string; value: number; def: number;
  min: number; max: number; step: number; suffix?: string; disabled?: boolean;
  onChange: (v: number) => void;
}) {
  const moved = value !== def;
  const show = (n: number) => (step < 1 ? n.toFixed(2) : String(n));
  return (
    <div className="p-3">
      <div className="flex items-baseline justify-between gap-3">
        <label className="text-sm font-medium">{label}</label>
        <span className="shrink-0 text-sm tabular-nums font-semibold">
          {show(value)}{suffix ?? ""}
          {moved && <span className="ml-1.5 text-[11px] font-normal text-zinc-400">was {show(def)}{suffix ?? ""}</span>}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value} disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1.5 w-full accent-[var(--brand)] disabled:opacity-50"
      />
      {help && <p className="text-[11px] text-zinc-400">{help}</p>}
    </div>
  );
}
