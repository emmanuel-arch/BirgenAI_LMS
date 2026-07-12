"use client";

// The Metric Catalogue — Riri's semantic layer with the lid off.
//
// Two tabs, and they answer the two questions a Credit Manager actually has about an
// AI that quotes numbers at them:
//
//   Measures — "what does she MEAN by PAR 30?" Every metric, its definition in plain
//              English, the exact SQL it compiles to, and the words she answers to.
//              Editable where it should be (their words, their target), fixed where
//              it must be (the arithmetic).
//   Questions — "what has she been telling my staff?" Every question asked, the SQL
//              that answered it, and — the useful half — the ones she refused or
//              could not place.
import { useState } from "react";
import { Ruler, Bot, Check, Loader2, AlertCircle, Database, Eye, EyeOff, Target } from "lucide-react";
import { useLoad } from "@/lib/hooks/useLoad";

type Metric = {
  id: string;
  label: string;
  catalogLabel: string;
  unit: "KES" | "count" | "percent" | "score";
  description: string;
  synonyms: string[];
  ownSynonyms: string[];
  enabled: boolean;
  target: number | null;
  targetDirection: "below" | "above" | null;
  customised: boolean;
  dimensions: { id: string; label: string }[];
  period: boolean;
  sql: string;
};

type LogRow = {
  id: string;
  question: string;
  model: string;
  route: string;
  metricId: string | null;
  sql: string | null;
  rows: number | null;
  ms: number | null;
  ok: boolean;
  error: string | null;
  createdAt: string;
};

const UNIT_LABEL: Record<Metric["unit"], string> = {
  KES: "Shillings",
  count: "A count",
  percent: "A percentage",
  score: "A score",
};

const ROUTE_STYLE: Record<string, { label: string; cls: string }> = {
  catalog: { label: "Metric", cls: "bg-emerald-100 text-emerald-700" },
  llm: { label: "Written by Riri", cls: "bg-violet-100 text-violet-700" },
  engine: { label: "Risk model", cls: "bg-sky-100 text-sky-700" },
  narrative: { label: "No data read", cls: "bg-zinc-900/5 text-zinc-500" },
  refused: { label: "Refused", cls: "bg-rose-100 text-rose-700" },
};

function Sql({ sql }: { sql: string }) {
  return (
    <pre className="mt-2 overflow-x-auto rounded-lg border border-zinc-900/10 bg-zinc-950/[0.03] px-3 py-2 text-[11px] leading-relaxed text-zinc-600">
      <code>{sql}</code>
    </pre>
  );
}

export function MetricsClient() {
  const [tab, setTab] = useState<"measures" | "questions">("measures");
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [log, setLog] = useState<LogRow[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [readSurface, setReadSurface] = useState<string[]>([]);
  const [replica, setReplica] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const res = await fetch("/api/console/metrics");
    const data = await res.json();
    if (!data.success) throw new Error(data.message ?? "Could not load the catalogue.");
    setMetrics(data.metrics);
    setLog(data.log);
    setCanManage(data.canManage);
    setReadSurface(data.readSurface);
    setReplica(data.readReplica);
  };

  useLoad(async () => {
    try {
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the catalogue.");
    } finally {
      setLoading(false);
    }
  });

  const save = async (metricId: string, patch: Record<string, unknown>) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/console/metrics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metricId, ...patch }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message ?? "Could not save.");
      // Re-read rather than patch the row in place: `ownSynonyms` and the display
      // label are DERIVED from the catalogue plus the overlay, and a client that
      // recomputes them itself is a second implementation waiting to disagree.
      await load();
      setEditing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const refused = log.filter((l) => !l.ok || l.route === "refused").length;

  if (loading) {
    return (
      <main className="mx-auto max-w-5xl px-4 sm:px-6 py-10">
        <p className="flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading the catalogue…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-4 sm:px-6 py-8">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-zinc-900">
          <Ruler className="h-6 w-6" style={{ color: "var(--brand)" }} /> Metric Catalogue
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-zinc-500">
          Every measure Riri knows, what it means, and the exact query behind it. She reads your book through{" "}
          {readSurface.length} published views on a read-only connection{replica ? " against a read replica" : ""} — she can
          look at your loans, never change them.
        </p>
      </header>

      <div className="mt-6 flex gap-1 rounded-xl bg-zinc-900/5 p-1 w-fit">
        {([["measures", `Measures · ${metrics.length}`], ["questions", `Questions · ${log.length}`]] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`rounded-lg px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${tab === id ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-900"}`}
          >
            {label}
            {id === "questions" && refused > 0 && (
              <span className="ml-1.5 rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">{refused}</span>
            )}
          </button>
        ))}
      </div>

      {error && (
        <p className="mt-4 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      {tab === "measures" && (
        <div className="mt-5 space-y-3">
          {metrics.map((m) => (
            <MetricCard
              key={m.id}
              m={m}
              canManage={canManage}
              editing={editing === m.id}
              saving={saving}
              onEdit={() => setEditing(editing === m.id ? null : m.id)}
              onSave={(patch) => save(m.id, patch)}
            />
          ))}
        </div>
      )}

      {tab === "questions" && (
        <div className="mt-5">
          <p className="mb-3 text-[13px] leading-relaxed text-zinc-500">
            Every question your staff have put to Riri, with the query that answered it. The ones she{" "}
            <span className="font-semibold text-rose-600">refused</span> or could not place are the useful ones — they say
            which measure is missing from the catalogue.
          </p>
          {log.length === 0 ? (
            <p className="rounded-xl border border-zinc-900/10 bg-white/60 px-4 py-8 text-center text-sm text-zinc-500">
              Nobody has asked Riri anything yet.
            </p>
          ) : (
            <div className="space-y-2">
              {log.map((l) => {
                const style = ROUTE_STYLE[l.route] ?? ROUTE_STYLE.narrative;
                return (
                  <div key={l.id} className="rounded-xl border border-zinc-900/10 bg-white/60 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Bot className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                      <p className="flex-1 min-w-0 text-[13px] font-medium text-zinc-800">{l.question}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${style.cls}`}>{style.label}</span>
                      {l.ms != null && <span className="text-[10px] tabular-nums text-zinc-400">{l.ms}ms</span>}
                      {l.rows != null && <span className="text-[10px] tabular-nums text-zinc-400">{l.rows} row{l.rows === 1 ? "" : "s"}</span>}
                    </div>
                    {l.error && <p className="mt-1.5 text-[12px] text-rose-600">{l.error}</p>}
                    {l.sql && <Sql sql={l.sql} />}
                    <p className="mt-1.5 text-[10px] text-zinc-400">
                      {new Date(l.createdAt).toLocaleString()} · {l.model}
                      {l.metricId ? ` · ${l.metricId}` : ""}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </main>
  );
}

function MetricCard({
  m, canManage, editing, saving, onEdit, onSave,
}: {
  m: Metric;
  canManage: boolean;
  editing: boolean;
  saving: boolean;
  onEdit: () => void;
  onSave: (patch: Record<string, unknown>) => void;
}) {
  const [label, setLabel] = useState(m.label);
  const [synonyms, setSynonyms] = useState(m.ownSynonyms.join(", "));
  const [target, setTarget] = useState(m.target == null ? "" : String(m.target));
  const [direction, setDirection] = useState<"below" | "above">(m.targetDirection ?? (m.unit === "percent" ? "below" : "above"));

  return (
    <div className={`rounded-xl border bg-white/60 px-4 py-3.5 ${m.enabled ? "border-zinc-900/10" : "border-zinc-900/10 opacity-60"}`}>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[15px] font-semibold text-zinc-900">{m.label}</h2>
            {m.label !== m.catalogLabel && <span className="text-[11px] text-zinc-400">(our name: {m.catalogLabel})</span>}
            <span className="rounded-full bg-zinc-900/5 px-2 py-0.5 text-[10px] font-medium text-zinc-500">{UNIT_LABEL[m.unit]}</span>
            {!m.enabled && <span className="rounded-full bg-zinc-900/5 px-2 py-0.5 text-[10px] font-medium text-zinc-500">Hidden from Riri</span>}
            {m.target != null && (
              <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                <Target className="h-2.5 w-2.5" /> {m.targetDirection === "below" ? "≤" : "≥"} {m.target}
              </span>
            )}
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-zinc-600">{m.description}</p>
        </div>
        {canManage && (
          <button
            onClick={onEdit}
            className="shrink-0 rounded-lg border border-zinc-900/12 bg-white px-2.5 py-1 text-[12px] font-medium text-zinc-600 hover:border-[color:var(--brand)] hover:text-zinc-900"
          >
            {editing ? "Cancel" : "Edit"}
          </button>
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {m.period && <Pill>Any period</Pill>}
        {m.dimensions.map((d) => <Pill key={d.id}>By {d.label.toLowerCase()}</Pill>)}
      </div>

      <details className="mt-2.5 group">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[12px] font-medium text-zinc-500 hover:text-zinc-900">
          <Database className="h-3 w-3" /> How it&apos;s calculated
        </summary>
        <Sql sql={m.sql} />
        <p className="mt-1.5 text-[11px] text-zinc-400">
          Riri answers to: {m.synonyms.slice(0, 10).join(" · ")}
        </p>
      </details>

      {editing && (
        <div className="mt-3 space-y-3 rounded-lg border border-zinc-900/10 bg-zinc-900/[0.02] p-3">
          <Field label="What you call it" help="Riri will use your name for this measure everywhere.">
            <input value={label} onChange={(e) => setLabel(e.target.value)} className="w-full rounded-lg border border-zinc-900/15 bg-white px-2.5 py-1.5 text-[13px] outline-none focus:border-[color:var(--brand)]" />
          </Field>
          <Field label="Words your staff use for it" help="Comma-separated. Riri will recognise these in a question — teach her your team's vocabulary.">
            <input value={synonyms} onChange={(e) => setSynonyms(e.target.value)} placeholder="delinquency, bad book" className="w-full rounded-lg border border-zinc-900/15 bg-white px-2.5 py-1.5 text-[13px] outline-none focus:border-[color:var(--brand)]" />
          </Field>
          <Field label="Your target" help="Riri will say whether you're inside it every time she quotes this number. Leave empty for none.">
            <div className="flex gap-2">
              <select value={direction} onChange={(e) => setDirection(e.target.value as "below" | "above")} className="rounded-lg border border-zinc-900/15 bg-white px-2 py-1.5 text-[13px] outline-none focus:border-[color:var(--brand)]">
                <option value="below">At or below</option>
                <option value="above">At or above</option>
              </select>
              <input value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal" placeholder="5" className="w-32 rounded-lg border border-zinc-900/15 bg-white px-2.5 py-1.5 text-[13px] outline-none focus:border-[color:var(--brand)]" />
            </div>
          </Field>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              disabled={saving}
              onClick={() => onSave({
                label,
                synonyms: synonyms.split(",").map((s) => s.trim()).filter(Boolean),
                target: target.trim() === "" ? null : Number(target),
                targetDirection: target.trim() === "" ? null : direction,
              })}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: "var(--brand)" }}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save
            </button>
            <button
              disabled={saving}
              onClick={() => onSave({ enabled: !m.enabled })}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-900/12 bg-white px-3 py-1.5 text-[13px] font-medium text-zinc-600 hover:text-zinc-900 disabled:opacity-50"
            >
              {m.enabled ? <><EyeOff className="h-3.5 w-3.5" /> Hide from Riri</> : <><Eye className="h-3.5 w-3.5" /> Show to Riri</>}
            </button>
            <p className="text-[11px] text-zinc-400">The calculation itself can&apos;t be changed — it&apos;s the number you report.</p>
          </div>
        </div>
      )}
    </div>
  );
}

const Pill = ({ children }: { children: React.ReactNode }) => (
  <span className="rounded-full border border-zinc-900/10 bg-white/70 px-2 py-0.5 text-[10px] font-medium text-zinc-500">{children}</span>
);

function Field({ label, help, children }: { label: string; help: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[12px] font-semibold text-zinc-700">{label}</label>
      <p className="mb-1 text-[11px] leading-snug text-zinc-400">{help}</p>
      {children}
    </div>
  );
}
