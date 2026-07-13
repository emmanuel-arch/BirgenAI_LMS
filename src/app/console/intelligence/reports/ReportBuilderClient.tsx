"use client";

// The Report Builder's two faces: the COMPOSER (checkboxes over the metric
// catalogue) and the DOCUMENT (a white paper sheet that prints to PDF via the
// same @media print machinery as the loan statement). Every measure is one
// Riri query and the composer says so — no surprise lines on an invoice.
import { useState } from "react";
import { FileBarChart, Loader2, Printer, ArrowLeft, AlertTriangle, ChevronDown } from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";

type MetricLite = { id: string; label: string; description: string };
type Chip = { label: string; value: string; tone?: string };
type MiniTable = { columns: string[]; rows: (string | number)[][] } | null;
type Item = {
  metricId: string; label: string; description: string; question: string;
  ok: boolean; answer: string; chips: Chip[] | null; table: MiniTable; sql: string | null;
};
type Result = { title: string; generatedAt: string; generatedBy: string; items: Item[] };

const PERIODS = [
  { key: "all", label: "All time" },
  { key: "this-month", label: "This month" },
  { key: "last-month", label: "Last month" },
  { key: "90d", label: "Last 90 days" },
];
const SLICES = [
  { key: "none", label: "Totals" },
  { key: "product", label: "By product" },
  { key: "branch", label: "By branch" },
];

export function ReportBuilderClient({ org, metrics }: {
  org: { name: string; logoUrl: string | null; accent: string };
  metrics: MetricLite[];
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set(["olb", "par30", "collected", "disbursed"]));
  const [period, setPeriod] = useState("this-month");
  const [slice, setSlice] = useState("none");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const toggle = (id: string) =>
    setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else if (n.size < 12) n.add(id); return n; });

  const run = async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/console/reports/custom", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metricIds: [...picked], period, slice, title }),
      });
      const d = await res.json();
      if (!d.success) { setError(d.message || "Could not build the report."); return; }
      setResult(d);
    } catch { setError("Could not build the report."); } finally { setBusy(false); }
  };

  // ── The document ────────────────────────────────────────────────────────────
  if (result) {
    return (
      <div className="min-h-screen rounded-2xl bg-white text-zinc-900 print-doc">
        <div className="no-print sticky top-0 z-10 rounded-t-2xl border-b border-zinc-900/10 bg-white/80 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4 sm:px-6">
            <button onClick={() => setResult(null)} className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800">
              <ArrowLeft className="h-4 w-4" /> Compose another
            </button>
            <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-800">
              <Printer className="h-3.5 w-3.5" /> Download report
            </button>
          </div>
        </div>

        <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 print-exact">
          <header className="flex items-start justify-between gap-4 border-b-2 pb-4" style={{ borderColor: org.accent }}>
            {org.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={org.logoUrl} alt={`${org.name} logo`} className="h-12 max-w-[220px] object-contain object-left" />
            ) : (
              <p className="text-base font-bold leading-tight">{org.name}</p>
            )}
            <div className="text-right">
              <h1 className="text-lg font-bold tracking-tight uppercase">{result.title}</h1>
              <p className="text-[11px] text-zinc-500">
                {PERIODS.find((p) => p.key === period)?.label}
                {slice !== "none" ? ` · ${SLICES.find((s) => s.key === slice)?.label.toLowerCase()}` : ""} ·
                generated {new Date(result.generatedAt).toLocaleString("en-GB")}
              </p>
            </div>
          </header>

          {result.items.map((item) => (
            <section key={item.metricId} className="mt-5 print-break">
              <h2 className="text-sm font-bold">{item.label}</h2>
              <p className="text-[11px] text-zinc-500">{item.description}</p>
              {!item.ok ? (
                <p className="mt-1.5 text-xs text-amber-700">Could not be computed for this period.</p>
              ) : (
                <>
                  {item.chips && item.chips.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {item.chips.map((c, i) => (
                        <div key={i} className="rounded-lg border border-zinc-900/10 px-2.5 py-1.5">
                          <p className="text-[9px] uppercase tracking-wide text-zinc-500">{c.label}</p>
                          <p className="text-sm font-bold" style={{ color: org.accent }}>{c.value}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-zinc-700">{stripMd(item.answer)}</p>
                  {item.table && (
                    <table className="mt-2 w-full text-[11px]">
                      <thead>
                        <tr className="border-b border-zinc-900/15 text-left text-zinc-500">
                          {item.table.columns.map((c) => <th key={c} className="py-1 pr-3 font-medium">{c}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {item.table.rows.map((r, i) => (
                          <tr key={i} className="border-b border-zinc-900/5">
                            {r.map((cell, j) => <td key={j} className={`py-1 pr-3 ${j > 0 ? "tabular-nums" : ""}`}>{String(cell)}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {item.sql && (
                    <details className="no-print mt-1.5">
                      <summary className="cursor-pointer text-[10px] text-zinc-400">The exact query that produced this</summary>
                      <pre className="mt-1 overflow-x-auto rounded bg-zinc-900/[0.04] p-2 text-[9px] leading-relaxed text-zinc-600">{item.sql}</pre>
                    </details>
                  )}
                </>
              )}
            </section>
          ))}

          <footer className="mt-8 border-t border-zinc-900/10 pt-3 text-[10px] leading-relaxed text-zinc-500">
            <p>Composed by {result.generatedBy} from the metric catalogue. Every figure ran the same audited, read-only query Riri shows in the dock.</p>
            <p className="mt-1">Powered by BirgenAI · lms.birgenai.com</p>
          </footer>
        </main>
      </div>
    );
  }

  // ── The composer ────────────────────────────────────────────────────────────
  return (
    <main className="mx-auto max-w-4xl px-4 sm:px-6 py-8">
      <PageHeader
        icon={FileBarChart}
        title="Report Builder"
        subtitle="Every measure Riri knows, with checkboxes. Compose it, run it, print it — each measure is one Riri query."
      />

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      <div className="glass mt-4 p-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <input
            className="w-full rounded-lg border border-zinc-900/15 bg-white/80 px-3 py-2.5 text-sm outline-none placeholder:text-zinc-400 sm:col-span-3"
            placeholder="Report title (e.g. Weekly portfolio review)"
            value={title} onChange={(e) => setTitle(e.target.value)}
          />
          <LabeledSelect label="Period" value={period} onChange={setPeriod} options={PERIODS} />
          <LabeledSelect label="Slice" value={slice} onChange={setSlice} options={SLICES} />
          <div className="flex items-end">
            <button onClick={run} disabled={busy || picked.size === 0}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: "var(--brand)" }}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileBarChart className="h-4 w-4" />}
              Run {picked.size} measure{picked.size === 1 ? "" : "s"}
            </button>
          </div>
        </div>

        <p className="mt-3 text-[11px] text-zinc-500">
          Pick up to 12. Each runs the same audited query Riri would — and is metered as one Riri query.
        </p>
        <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
          {metrics.map((m) => (
            <label key={m.id} className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 transition-colors ${picked.has(m.id) ? "bg-white/80" : "border-zinc-900/10 bg-white/50 hover:bg-white/70"}`}
              style={picked.has(m.id) ? { borderColor: "var(--brand)" } : undefined}>
              <input type="checkbox" checked={picked.has(m.id)} onChange={() => toggle(m.id)} className="mt-0.5 h-4 w-4" style={{ accentColor: "var(--brand)" }} />
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold text-zinc-800">{m.label}</span>
                <span className="block text-[11px] leading-snug text-zinc-500">{m.description}</span>
              </span>
            </label>
          ))}
        </div>
      </div>
    </main>
  );
}

function LabeledSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: { key: string; label: string }[];
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">{label}</span>
      <span className="relative mt-1 block">
        <select value={value} onChange={(e) => onChange(e.target.value)}
          className="w-full appearance-none rounded-lg border border-zinc-900/15 bg-white/80 px-3 py-2.5 pr-8 text-sm outline-none">
          {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
      </span>
    </label>
  );
}

/** The analyst writes markdown for the dock; a printed report wants prose. */
function stripMd(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`(.+?)`/g, "$1");
}
