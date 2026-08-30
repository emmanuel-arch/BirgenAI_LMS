"use client";

// ─────────────────────────────────────────────────────────────────────────────
// A PRODUCT'S HISTORY — and what actually changed between two versions.
//
// The question a credit manager asks before touching a rate is not "what does this
// product say now" but "who is still held to the old terms". The system we are
// replacing cannot answer it at all: `Loan` points at the product ROW, so editing a
// rate rewrites what past borrowers agreed to and leaves no trace that it happened.
//
// Here every version carries its loan count — the blast radius — and any two can be
// diffed field by field. Selecting two rows shows exactly what moved, in the same
// vocabulary the wizard uses.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import { Loader2, GitCompare, AlertTriangle, ArrowRight, Layers } from "lucide-react";
import { useLoad } from "@/lib/hooks/useLoad";
import { Modal } from "@/components/ui/Modal";
import { BLOCK_LABELS, type BlockKey } from "@/lib/products/definition";

type VersionRow = { version: number; changed: BlockKey[]; note: string | null; createdAt: string; loanCount: number };
type FieldChange = { block: BlockKey | "identity"; path: string; before: unknown; after: unknown };

export default function VersionPanel({
  productId, productName, onClose,
}: {
  productId: string; productName: string; onClose: () => void;
}) {
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [diff, setDiff] = useState<FieldChange[] | null>(null);
  const [diffing, setDiffing] = useState(false);

  const load = async () => {
    try {
      const res = await fetch(`/api/console/products/${productId}/versions`);
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not load history."); return; }
      setVersions(data.versions);
    } catch { setError("Could not load history."); }
  };
  useLoad(load);

  // Two picks is a comparison; a third replaces the older of the pair, so clicking
  // down a list keeps comparing "this one against the one before" without a reset.
  const toggle = (v: number) => {
    setDiff(null);
    setPicked((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v].slice(-2)));
  };

  const compare = async () => {
    if (picked.length !== 2) return;
    const [a, b] = [...picked].sort((x, y) => x - y);
    setDiffing(true); setError(null);
    try {
      const res = await fetch(`/api/console/products/${productId}/versions?diff=${a},${b}`);
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not compare."); return; }
      setDiff(data.diff);
    } catch { setError("Could not compare."); } finally { setDiffing(false); }
  };

  const [lo, hi] = [...picked].sort((x, y) => x - y);

  return (
    <Modal
      onClose={onClose}
      title={productName}
      sub="Every published version, and how many loans are held to it."
      width="lg"
      footer={
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-ash-500">
            {picked.length === 0 && "Pick two versions to compare."}
            {picked.length === 1 && `v${picked[0]} selected — pick one more.`}
            {picked.length === 2 && `Comparing v${lo} → v${hi}`}
          </p>
          <button
            type="button"
            onClick={compare}
            disabled={picked.length !== 2 || diffing}
            className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-bold text-white disabled:opacity-40"
            style={{ backgroundColor: "var(--brand)" }}
          >
            {diffing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitCompare className="h-3.5 w-3.5" />}
            Compare
          </button>
        </div>
      }
    >
      {error && (
        <p className="mb-3 flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-[12px] text-red-700 ring-1 ring-red-600/20">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}

      {!versions && !error && <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-ash-400" /></div>}

      {versions?.length === 0 && (
        <div className="rounded-xl bg-amber-500/10 px-3 py-3 text-[12px] text-amber-900 ring-1 ring-amber-600/20">
          <p className="font-semibold">This product predates versioning.</p>
          <p className="mt-1 leading-relaxed">
            Its terms live only in its current columns, so loans booked on it cannot say what they
            agreed to. Publish it once — edit and save — and v1 will capture exactly what it is
            today, with every version after that recorded.
          </p>
        </div>
      )}

      {versions && versions.length > 0 && (
        <ul className="space-y-1.5">
          {versions.map((v) => {
            const on = picked.includes(v.version);
            return (
              <li key={v.version}>
                <button
                  type="button"
                  onClick={() => toggle(v.version)}
                  className={`w-full rounded-xl px-3 py-2.5 text-left ring-1 transition-colors ${on ? "bg-[color:var(--brand-soft)]" : "ring-ash-900/[0.08] hover:bg-ash-900/[0.03]"}`}
                  style={on ? { ["--tw-ring-color" as never]: "var(--brand)" } : undefined}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <span className="text-[13px] font-bold text-ash-900">v{v.version}</span>
                      {v.loanCount > 0 && (
                        <span className="rounded-md bg-ash-900/[0.06] px-1.5 py-0.5 text-[10px] font-bold text-ash-600">
                          {v.loanCount} {v.loanCount === 1 ? "loan" : "loans"} on these terms
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-[11px] text-ash-400">
                      {new Date(v.createdAt).toLocaleDateString("en-KE", { dateStyle: "medium" })}
                    </span>
                  </div>
                  {v.changed.length > 0 && (
                    <p className="mt-1 flex flex-wrap items-center gap-1">
                      <Layers className="h-3 w-3 text-ash-400" />
                      {v.changed.map((b) => (
                        <span key={b} className="rounded bg-ash-900/[0.05] px-1.5 py-px text-[10px] font-medium text-ash-500">
                          {BLOCK_LABELS[b]?.label ?? b}
                        </span>
                      ))}
                    </p>
                  )}
                  {v.note && <p className="mt-1 text-[11px] italic text-ash-500">“{v.note}”</p>}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {diff && (
        <div className="mt-4 border-t border-ash-900/[0.08] pt-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.085em] text-ash-400">
            v{lo} → v{hi}
          </p>
          {diff.length === 0 ? (
            <p className="mt-2 text-[12px] text-ash-500">Nothing differs between these two versions.</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {diff.map((c) => (
                <li key={`${c.block}.${c.path}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg px-2 py-1.5 odd:bg-ash-900/[0.02]">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-ash-400">
                    {c.block === "identity" ? "Product" : BLOCK_LABELS[c.block]?.label ?? c.block}
                  </span>
                  <span className="text-[12px] font-medium text-ash-700">{humanPath(c.path)}</span>
                  <span className="flex items-center gap-1.5 text-[12px]">
                    <code className="rounded bg-red-500/10 px-1.5 py-px text-red-700">{show(c.before)}</code>
                    <ArrowRight className="h-3 w-3 text-ash-400" />
                    <code className="rounded bg-emerald-500/10 px-1.5 py-px text-emerald-700">{show(c.after)}</code>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}

/** "earlySettlement.rebatePct" → "early settlement · rebate pct" */
function humanPath(path: string): string {
  return path
    .split(".")
    .map((seg) => seg.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim())
    .join(" · ");
}

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "none";
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
}
