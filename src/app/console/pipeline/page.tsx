"use client";

// ─────────────────────────────────────────────────────────────────────────────
// PIPELINE — the funnel, as a board you watch fill, not a list you scroll.
//
// The same applications as the Queue, but arranged the way a sales manager
// actually thinks about them: columns from first touch to money out, each with a
// running headcount AND a running value, so "how much is stuck in Officer
// Review" is one glance, not a filter-and-sum. A card is a lead with a face, an
// amount, a score and an age; drop onto it to open the full dossier.
//
// Reuses the Applications feed (no second source of truth) — this is a lens on
// it, its OWN shape: horizontal, value-weighted, funnel-first.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useLoad } from "@/lib/hooks/useLoad";
import { motion } from "framer-motion";
import { Loader2, AlertTriangle, Waypoints, TrendingUp, ChevronRight, Gauge } from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";

type App = {
  id: string; createdAt: string; status: string; stageTitle: string | null;
  borrowerName: string | null; phone: string | null; amountRequested: number;
  productName: string | null; score: number | null; approvedLimit: number | string | null;
  loan: { id: string; status: string } | null;
};

const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
const kesShort = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(Math.round(n));

const STAGES: { key: string; label: string; color: string; soft: string }[] = [
  { key: "SUBMITTED", label: "New leads", color: "#64748b", soft: "rgba(100,116,139,0.10)" },
  { key: "AI_PRESCREEN", label: "AI prescreen", color: "#7c3aed", soft: "rgba(124,58,237,0.10)" },
  { key: "OFFICER_REVIEW", label: "Officer review", color: "#d97706", soft: "rgba(217,119,6,0.10)" },
  { key: "REFERRED", label: "Referred up", color: "#0891b2", soft: "rgba(8,145,178,0.10)" },
  { key: "APPROVED", label: "Approved", color: "#059669", soft: "rgba(5,150,105,0.10)" },
  { key: "DISBURSED", label: "Disbursed", color: "#2563eb", soft: "rgba(37,99,235,0.10)" },
];
const OPEN_STAGES = new Set(["SUBMITTED", "AI_PRESCREEN", "OFFICER_REVIEW", "REFERRED"]);

function relAge(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
function scoreTone(score: number | null): string {
  if (score == null) return "#94a3b8";
  return score >= 720 ? "#059669" : score >= 620 ? "#0284c7" : score >= 540 ? "#d97706" : "#e11d48";
}

export default function PipelinePage() {
  const [apps, setApps] = useState<App[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/console/applications?scope=all");
      const d = await res.json();
      if (!d.success) { setError(d.message || "Could not load the pipeline."); return; }
      setApps(d.applications);
    } catch { setError("Could not load the pipeline."); }
  }, []);
  useLoad(load);

  const columns = useMemo(() => {
    const byStage = new Map<string, App[]>();
    for (const s of STAGES) byStage.set(s.key, []);
    for (const a of apps ?? []) if (byStage.has(a.status)) byStage.get(a.status)!.push(a);
    return STAGES.map((s) => {
      const items = byStage.get(s.key) ?? [];
      return { ...s, items, value: items.reduce((sum, a) => sum + a.amountRequested, 0) };
    });
  }, [apps]);

  const totals = useMemo(() => {
    const open = (apps ?? []).filter((a) => OPEN_STAGES.has(a.status));
    const approved = (apps ?? []).filter((a) => a.status === "APPROVED" || a.status === "DISBURSED");
    return {
      openCount: open.length,
      openValue: open.reduce((s, a) => s + a.amountRequested, 0),
      approvedValue: approved.reduce((s, a) => s + a.amountRequested, 0),
      maxColValue: Math.max(1, ...columns.map((c) => c.value)),
    };
  }, [apps, columns]);

  return (
    <main className="mx-auto max-w-6xl px-4 sm:px-6 py-8">
      <PageHeader
        icon={Waypoints}
        title="Pipeline"
        subtitle="Every lead from first touch to money out, weighted by value — watch the funnel fill and see exactly what's stuck where."
      >
        <Link href="/console/applications/new"
          className="inline-flex items-center gap-1.5 rounded-lg bg-invert px-4 py-2 text-xs font-semibold text-invert-fg hover:bg-invert-2">
          <TrendingUp className="h-3.5 w-3.5" /> Add a lead
        </Link>
      </PageHeader>

      {error && <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}</div>}

      {apps && (
        <div className="mt-4 grid grid-cols-3 gap-2">
          <SummaryTile label="open leads" value={String(totals.openCount)} />
          <SummaryTile label="value in play" value={kes(totals.openValue)} small />
          <SummaryTile label="approved value" value={kes(totals.approvedValue)} small accent />
        </div>
      )}

      {!apps && !error && <div className="mt-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-ash-400" /></div>}

      {apps && (
        <div className="mt-5 flex snap-x gap-3 overflow-x-auto pb-3">
          {columns.map((col, ci) => (
            <div key={col.key} className="w-[80vw] max-w-[280px] shrink-0 snap-start sm:w-[280px]">
              {/* Column head */}
              <div className="rounded-t-2xl px-3 py-2.5" style={{ backgroundColor: col.soft }}>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-[13px] font-bold text-ash-700">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: col.color }} /> {col.label}
                  </span>
                  <span className="rounded-full bg-paper/70 px-2 py-0.5 text-[11px] font-bold tabular-nums" style={{ color: col.color }}>{col.items.length}</span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-paper/50">
                    <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${(col.value / totals.maxColValue) * 100}%`, backgroundColor: col.color }} />
                  </div>
                  <span className="text-[10px] font-semibold tabular-nums text-ash-500">{kesShort(col.value)}</span>
                </div>
              </div>
              {/* Cards */}
              <div className="min-h-[120px] space-y-2 rounded-b-2xl bg-ash-900/[0.02] p-2">
                {col.items.length === 0 && <p className="py-6 text-center text-[11px] text-ash-300">—</p>}
                {col.items.map((a, i) => (
                  <motion.div key={a.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: (ci * 0.04) + (i * 0.02) }}>
                    <Link href={`/console/applications/${a.id}`}
                      className="block rounded-xl border border-ash-900/10 bg-paper/90 p-2.5 transition-shadow hover:shadow-md">
                      <div className="flex items-center gap-2">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: col.color }}>
                          {initials(a.borrowerName ?? "?")}
                        </span>
                        <p className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ash-800">{a.borrowerName ?? "Lead"}</p>
                        {a.score != null && (
                          <span className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-bold text-white" style={{ backgroundColor: scoreTone(a.score) }}>
                            <Gauge className="h-2.5 w-2.5" /> {a.score}
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 flex items-center justify-between gap-2">
                        <span className="text-sm font-black tabular-nums text-ash-800">{kes(a.amountRequested)}</span>
                        <span className="text-[10px] text-ash-400">{relAge(a.createdAt)}</span>
                      </div>
                      <p className="mt-0.5 flex items-center gap-1 truncate text-[10px] text-ash-400">
                        {a.productName ?? "—"}<ChevronRight className="ml-auto h-3 w-3 shrink-0" />
                      </p>
                    </Link>
                  </motion.div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

function SummaryTile({ label, value, small, accent }: { label: string; value: string; small?: boolean; accent?: boolean }) {
  return (
    <div className="glass px-3 py-2.5">
      <p className={`font-black tabular-nums ${small ? "text-base truncate" : "text-2xl"}`} style={accent ? { color: "var(--brand)" } : undefined}>{value}</p>
      <p className="text-[11px] text-ash-500">{label}</p>
    </div>
  );
}
