"use client";

// ─────────────────────────────────────────────────────────────────────────────
// WORKFLOWS — every approval chain in the business, not just the loan ones.
//
// The list used to show loan workflows because loan workflows were all there were.
// Now a chain declares WHAT IT APPROVES, so a restructure, a waiver, a write-off, a
// float movement and an expense each get a chain built for them — and the loan
// settings screen can point at the right one by name instead of everyone sharing a
// single undifferentiated "approval workflow".
//
// The counts matter: a workflow that eleven products route through is not one you
// delete on a Tuesday afternoon, and the list is where that becomes obvious.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useLoad } from "@/lib/hooks/useLoad";
import {
  GitBranch, Loader2, AlertTriangle, CheckCircle2, Plus, Pencil, Trash2,
  ShieldCheck, ChevronRight,
} from "lucide-react";
import { WORKFLOW_KINDS } from "@/components/workflows/WorkflowBuilder";

type Workflow = {
  id: string; title: string; description: string | null;
  kind: string; multiApproval: boolean; isActive: boolean;
  stages: { id: string; title: string; order: number; canFinalize: boolean; checkLabels: string[] }[];
  newLoanProducts: number;
  repeatLoanProducts: number;
};

export default function WorkflowsPage() {
  const [rows, setRows] = useState<Workflow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/console/workflows");
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not load workflows."); return; }
      setRows(data.workflows);
      setError(null);
    } catch { setError("Could not load workflows."); }
  }, []);
  useLoad(load);

  const remove = async (w: Workflow) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const res = await fetch(`/api/console/workflows?id=${w.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not delete."); return; }
      setNotice(`"${w.title}" removed.`);
      await load();
    } catch { setError("Could not delete."); } finally { setBusy(false); }
  };

  // Grouped by what they approve, because that is how a lender looks for one.
  const grouped = useMemo(() => {
    if (!rows) return [];
    return WORKFLOW_KINDS
      .map((k) => ({ kind: k, items: rows.filter((w) => w.kind === k.key) }))
      .filter((g) => g.items.length > 0);
  }, [rows]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="t-display flex items-center gap-2 text-[1.6rem]">
            <GitBranch className="h-6 w-6" style={{ color: "var(--brand)" }} /> Approval workflows
          </h1>
          <p className="t-meta mt-1 max-w-2xl">
            The chains a case moves along — loans, restructures, waivers, write-offs, payouts.
            Each stage decides who may act, what must be checked, and what must be on file.
          </p>
        </div>
        <Link href="/console/workflows/new"
          className="inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-[11px] font-bold text-white"
          style={{ backgroundColor: "var(--brand)" }}>
          <Plus className="h-3.5 w-3.5" /> New workflow
        </Link>
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

      {rows?.length === 0 && (
        <div className="glass mt-8 px-4 py-10 text-center">
          <GitBranch className="mx-auto h-6 w-6 text-[color:var(--ink-faint)]" />
          <p className="mt-2 text-[14px] font-semibold text-[color:var(--ink)]">No workflows yet</p>
          <p className="t-meta mx-auto mt-1 max-w-md text-[12.5px]">
            Without one, products fall back to a default two-tier chain. Build your own to
            put a bureau check at risk review, a Ratiba mandate before finance signs, or a
            finalize cap on a branch manager.
          </p>
          <Link href="/console/workflows/new"
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[12px] font-bold text-white"
            style={{ backgroundColor: "var(--brand)" }}>
            <Plus className="h-3.5 w-3.5" /> Build your first workflow
          </Link>
        </div>
      )}

      <div className="mt-5 space-y-6">
        {grouped.map(({ kind, items }) => (
          <div key={kind.key}>
            <div className="flex items-center gap-3 pb-2">
              <span className="t-label shrink-0">{kind.label}</span>
              <span className="h-px flex-1 bg-[color:var(--ink)]/[0.08]" />
            </div>

            <div className="space-y-2.5">
              {items.map((w) => {
                const inUse = w.newLoanProducts + w.repeatLoanProducts;
                return (
                  <div key={w.id} className="glass flex flex-wrap items-center justify-between gap-3 p-4"
                    style={w.isActive ? undefined : { opacity: 0.6 }}>
                    <Link href={`/console/workflows/${w.id}`} className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-1.5 text-[14px] font-semibold text-[color:var(--ink)]">
                        {w.title}
                        {w.multiApproval && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/12 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-amber-700">
                            <ShieldCheck className="h-2.5 w-2.5" /> One signer may sign twice
                          </span>
                        )}
                        {!w.isActive && (
                          <span className="rounded-full bg-[color:var(--ink)]/[0.07] px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-[color:var(--ink-muted)]">
                            Off
                          </span>
                        )}
                      </p>
                      <p className="t-meta mt-0.5 text-[11.5px]">
                        {w.stages.length} stage{w.stages.length === 1 ? "" : "s"}
                        {" · "}
                        {w.stages.map((s) => s.title).join(" → ")}
                      </p>
                      {w.stages.some((s) => s.checkLabels.length > 0) && (
                        <p className="t-meta mt-0.5 text-[11px]">
                          Runs: {[...new Set(w.stages.flatMap((s) => s.checkLabels))].join(", ")}
                        </p>
                      )}
                    </Link>

                    <div className="flex shrink-0 items-center gap-2">
                      {kind.key === "LOAN" && (
                        <span className="rounded-lg bg-[color:var(--ink)]/[0.05] px-2 py-1 text-[10.5px] font-semibold text-[color:var(--ink-muted)]">
                          {w.newLoanProducts} new · {w.repeatLoanProducts} repeat
                        </span>
                      )}
                      <Link href={`/console/workflows/${w.id}`} aria-label={`Edit ${w.title}`}
                        className="rounded-md p-1.5 text-[color:var(--ink-faint)] ring-1 ring-[color:var(--ink)]/10 hover:text-[color:var(--ink)]">
                        <Pencil className="h-3.5 w-3.5" />
                      </Link>
                      <button type="button" onClick={() => remove(w)} disabled={busy || inUse > 0}
                        title={inUse > 0 ? `${inUse} product route${inUse === 1 ? "s" : ""} through this — point them elsewhere first.` : undefined}
                        aria-label={`Delete ${w.title}`}
                        className="rounded-md p-1.5 text-[color:var(--ink-faint)] hover:text-red-500 disabled:opacity-30">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                      <ChevronRight className="h-4 w-4 text-[color:var(--ink-faint)]" />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
