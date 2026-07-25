"use client";

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMER TIMELINE — every touch and every decision about this customer, in one
// chronological stream. The incumbents scatter this across four tabs (interactions,
// approval history, limit adjustments, scored-amount history); we merge them into a
// single filterable spine, and let an agent LOG a disposition right on it — the
// call-centre memory, the part they got right, done better.
//
// Interactions are recorded as activity rows (the same spine Oversight reads), so a
// disposition logged here is a first-class, audited event with no schema to migrate.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { History, Phone, Banknote, Gauge, FileCheck2, Plus, Loader2, MessageSquarePlus, X } from "lucide-react";

export type TimelineKind = "interaction" | "limit" | "score" | "approval";
export type TimelineEvent = {
  id: string;
  kind: TimelineKind;
  at: string; // ISO
  title: string;
  detail?: string | null;
  actor?: string | null;
  tone?: "up" | "down" | "neutral";
};

const KIND: Record<TimelineKind, { label: string; icon: typeof Phone; color: string }> = {
  interaction: { label: "Interactions", icon: Phone, color: "#2a78d6" },
  limit: { label: "Limit", icon: Banknote, color: "#1baf7a" },
  score: { label: "Score", icon: Gauge, color: "#eb6834" },
  approval: { label: "Approvals", icon: FileCheck2, color: "#4a3aa7" },
};
const DISPOSITIONS = ["Reached", "No answer", "Promise to pay", "Inquiry", "Complaint", "Follow-up needed", "Not interested", "Wrong number"];
const CHANNELS = ["CALL", "SMS", "WHATSAPP", "VISIT", "WALK-IN"];

const rel = (iso: string) => {
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000), h = Math.floor(m / 60), days = Math.floor(h / 24);
  if (days > 30) return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" });
  if (days > 0) return `${days}d ago`;
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return "just now";
};

export function CustomerTimeline({ borrowerId, events }: { borrowerId: string; events: TimelineEvent[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<TimelineKind | "all">("all");
  const [logging, setLogging] = useState(false);
  const [disposition, setDisposition] = useState("");
  const [channel, setChannel] = useState("CALL");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shown = filter === "all" ? events : events.filter((e) => e.kind === filter);
  const counts = events.reduce<Record<string, number>>((a, e) => ((a[e.kind] = (a[e.kind] ?? 0) + 1), a), {});

  const save = async () => {
    if (!disposition) { setError("Choose a disposition."); return; }
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/console/borrowers/${borrowerId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "interaction", disposition, channel, note: note.trim() || undefined }),
      });
      const d = await res.json();
      if (!d.success) { setError(d.message || "Couldn't log that."); return; }
      setLogging(false); setDisposition(""); setNote(""); setChannel("CALL");
      router.refresh(); // the page is server-rendered — pull the new event in
    } catch { setError("Couldn't log that."); } finally { setBusy(false); }
  };

  return (
    <div className="glass p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <History className="h-4 w-4" style={{ color: "var(--brand)" }} /> Customer timeline
          <span className="font-normal text-zinc-400">· every touch &amp; decision</span>
        </h2>
        <button onClick={() => setLogging((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-white"
          style={{ backgroundColor: "var(--brand)" }}>
          {logging ? <X className="h-3.5 w-3.5" /> : <MessageSquarePlus className="h-3.5 w-3.5" />} {logging ? "Close" : "Log interaction"}
        </button>
      </div>

      {/* Log a disposition — the call-centre capture */}
      <AnimatePresence>
        {logging && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden">
            <div className="mt-3 rounded-xl border border-zinc-900/10 bg-white/60 p-3">
              <p className="text-[11px] font-semibold text-zinc-600">Disposition</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {DISPOSITIONS.map((d) => (
                  <button key={d} onClick={() => setDisposition(d)}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 transition-colors ${disposition === d ? "text-white" : "text-zinc-600 ring-zinc-900/10 hover:bg-zinc-900/5"}`}
                    style={disposition === d ? { backgroundColor: "var(--brand)", borderColor: "var(--brand)" } : undefined}>
                    {d}
                  </button>
                ))}
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <select value={channel} onChange={(e) => setChannel(e.target.value)}
                  className="rounded-lg border border-zinc-900/15 bg-white px-2.5 py-1.5 text-xs outline-none">
                  {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)"
                  className="min-w-0 flex-1 rounded-lg border border-zinc-900/15 bg-white px-2.5 py-1.5 text-xs outline-none" />
                <button onClick={save} disabled={busy || !disposition}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Save
                </button>
              </div>
              {error && <p className="mt-1.5 text-[11px] text-red-600">{error}</p>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Filter chips */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Chip active={filter === "all"} onClick={() => setFilter("all")} label={`All ${events.length}`} color="#52514e" />
        {(Object.keys(KIND) as TimelineKind[]).filter((k) => counts[k]).map((k) => (
          <Chip key={k} active={filter === k} onClick={() => setFilter(k)} label={`${KIND[k].label} ${counts[k]}`} color={KIND[k].color} />
        ))}
      </div>

      {/* The spine */}
      <div className="mt-3">
        {shown.length === 0 ? (
          <p className="text-sm text-zinc-500">No activity yet. Log the first interaction above.</p>
        ) : (
          <ol className="relative space-y-3 before:absolute before:left-[11px] before:top-1 before:bottom-1 before:w-px before:bg-zinc-900/10">
            {shown.map((e) => {
              const k = KIND[e.kind];
              const Icon = k.icon;
              return (
                <li key={e.id} className="relative flex gap-3 pl-0">
                  <span className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-4 ring-white" style={{ backgroundColor: `${k.color}18` }}>
                    <Icon className="h-3.5 w-3.5" style={{ color: k.color }} />
                  </span>
                  <div className="min-w-0 flex-1 -mt-0.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-sm font-medium text-zinc-800">{e.title}</p>
                      <span className="shrink-0 text-[10px] text-zinc-400">{rel(e.at)}</span>
                    </div>
                    {e.detail && <p className="text-[12px] leading-snug text-zinc-500">{e.detail}</p>}
                    {e.actor && <p className="text-[10px] text-zinc-400">by {e.actor}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

function Chip({ active, onClick, label, color }: { active: boolean; onClick: () => void; label: string; color: string }) {
  return (
    <button onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 transition-colors ${active ? "bg-zinc-900 text-white ring-zinc-900" : "text-zinc-600 ring-zinc-900/10 hover:bg-zinc-900/5"}`}>
      {!active && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />}
      {label}
    </button>
  );
}
