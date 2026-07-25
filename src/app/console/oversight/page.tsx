"use client";

// ─────────────────────────────────────────────────────────────────────────────
// OVERSIGHT — the audit trail as a living activity stream, not a grid of rows.
//
// Who did what, from where, and when — read down a timeline the way you'd read a
// feed: a coloured spine, an actor's face, the action as a sentence, and the
// device/IP/place it came from as quiet metadata underneath. Events cluster by
// day (Today, Yesterday, a date), search and category chips filter as you type,
// and nothing here can be edited — an audit trail you can change is not one.
//
// Deliberately its OWN shape: a compliance officer scanning for the one odd
// login at 2am reads a stream far faster than a spreadsheet they have to sort.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useMemo, useState } from "react";
import { useLoad } from "@/lib/hooks/useLoad";
import { motion } from "framer-motion";
import {
  Loader2, AlertTriangle, ScrollText, Search, LogIn, Banknote, Landmark,
  UserRound, Settings2, ShieldAlert, MapPin, Activity, Monitor, Globe, X,
} from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";

type Event = {
  id: string; actorName: string; actorTitle: string | null; actorType: string; avatarSeed: string;
  action: string; entity: string | null; entityId: string | null;
  device: string | null; location: string | null; ip: string | null; createdAt: string;
};
type Summary = { shown: number; today: number; actors: number; topAction: string | null };

type Cat = "auth" | "money" | "lending" | "customer" | "config" | "security" | "field" | "other";
const CATS: { key: Cat; label: string; color: string; soft: string; icon: typeof LogIn }[] = [
  { key: "auth", label: "Access", color: "#0284c7", soft: "rgba(2,132,199,0.12)", icon: LogIn },
  { key: "lending", label: "Lending", color: "#7c3aed", soft: "rgba(124,58,237,0.12)", icon: Landmark },
  { key: "money", label: "Money", color: "#059669", soft: "rgba(5,150,105,0.12)", icon: Banknote },
  { key: "customer", label: "Customers", color: "#d97706", soft: "rgba(217,119,6,0.12)", icon: UserRound },
  { key: "config", label: "Config", color: "#475569", soft: "rgba(71,85,105,0.12)", icon: Settings2 },
  { key: "field", label: "Field", color: "#0891b2", soft: "rgba(8,145,178,0.12)", icon: MapPin },
  { key: "security", label: "Security", color: "#e11d48", soft: "rgba(225,29,72,0.12)", icon: ShieldAlert },
  { key: "other", label: "Other", color: "#64748b", soft: "rgba(100,116,139,0.12)", icon: Activity },
];
const CAT_BY_KEY = new Map(CATS.map((c) => [c.key, c]));

function categorize(action: string): Cat {
  const a = action.toLowerCase();
  if (/login|logout|auth|session|sign/.test(a)) return "auth";
  if (/override|eras|export|delete|suspend|lock|vault|revoke|breach/.test(a)) return "security";
  if (/disburse|repay|payment|float|receipt|recon|charge|refund/.test(a)) return "money";
  if (/loan|approve|decline|apply|application|offer|guarant/.test(a)) return "lending";
  if (/borrower|kyc|lead|customer|consent/.test(a)) return "customer";
  if (/field|check-in|dispatch|visit|route/.test(a)) return "field";
  if (/product|role|setting|workflow|branch|brand|team|invite/.test(a)) return "config";
  return "other";
}

function humanize(action: string): string {
  const s = action.replace(/[._-]+/g, " ").trim().toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
const AVA = ["#f97316", "#3b82f6", "#10b981", "#8b5cf6", "#e11d48", "#0ea5e9", "#d946ef", "#14b8a6"];
const avaColor = (seed: string) => AVA[[...(seed || "?")].reduce((a, c) => a + c.charCodeAt(0), 0) % AVA.length];

function relTime(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  return d < 30 ? `${d}d ago` : new Date(iso).toLocaleDateString("en-KE", { day: "numeric", month: "short" });
}
function dayKey(iso: string): string {
  const d = new Date(iso); const now = new Date();
  const midnight = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((midnight(now) - midnight(d)) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-KE", { weekday: "long", day: "numeric", month: "long" });
}
const fmtClock = (iso: string) => new Date(iso).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit", hour12: false });

export default function OversightPage() {
  const [events, setEvents] = useState<Event[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<Cat | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/console/oversight");
      const d = await res.json();
      if (!d.success) { setError(d.message || "Could not load the audit trail."); return; }
      setEvents(d.events); setSummary(d.summary);
    } catch { setError("Could not load the audit trail."); }
  }, []);
  useLoad(load);

  const filtered = useMemo(() => {
    if (!events) return null;
    const needle = q.trim().toLowerCase();
    return events.filter((e) => {
      if (cat && categorize(e.action) !== cat) return false;
      if (!needle) return true;
      return [e.actorName, e.action, e.entity, e.entityId, e.device, e.location, e.ip]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(needle));
    });
  }, [events, q, cat]);

  // Group the filtered stream by day, preserving the newest-first order.
  const groups = useMemo(() => {
    if (!filtered) return [];
    const out: { day: string; items: Event[] }[] = [];
    for (const e of filtered) {
      const day = dayKey(e.createdAt);
      const last = out[out.length - 1];
      if (last && last.day === day) last.items.push(e);
      else out.push({ day, items: [e] });
    }
    return out;
  }, [filtered]);

  const catCounts = useMemo(() => {
    const m = new Map<Cat, number>();
    for (const e of events ?? []) { const c = categorize(e.action); m.set(c, (m.get(c) ?? 0) + 1); }
    return m;
  }, [events]);

  return (
    <main className="mx-auto max-w-4xl px-4 sm:px-6 py-8">
      <PageHeader
        icon={ScrollText}
        title="Oversight"
        subtitle="Every action in the lender, on one immutable timeline — who did it, from what device, where, and when. Read it like a feed; nothing here can be changed."
      />

      {error && <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}</div>}

      {/* Summary */}
      {summary && (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <SummaryTile label="events in view" value={summary.shown} />
          <SummaryTile label="today" value={summary.today} accent />
          <SummaryTile label="people active" value={summary.actors} />
          <SummaryTile label="busiest action" value={summary.topAction ? humanize(summary.topAction) : "—"} small />
        </div>
      )}

      {/* Filters */}
      <div className="glass mt-4 p-3">
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 shrink-0 text-zinc-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search person, action, device, IP, place…"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-400" />
          {(q || cat) && <button onClick={() => { setQ(""); setCat(null); }} className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"><X className="h-4 w-4" /></button>}
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {CATS.filter((c) => (catCounts.get(c.key) ?? 0) > 0).map((c) => {
            const on = cat === c.key;
            return (
              <button key={c.key} onClick={() => setCat(on ? null : c.key)}
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all"
                style={on ? { backgroundColor: c.color, color: "#fff" } : { backgroundColor: c.soft, color: c.color }}>
                <c.icon className="h-3 w-3" /> {c.label}
                <span className={`tabular-nums ${on ? "text-white/80" : "opacity-60"}`}>{catCounts.get(c.key)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Stream */}
      {!events && !error && <div className="mt-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-zinc-400" /></div>}
      {filtered && filtered.length === 0 && (
        <p className="mt-10 text-center text-sm text-zinc-500">Nothing matches — {q || cat ? "clear the filters" : "no activity recorded yet"}.</p>
      )}

      <div className="mt-4 space-y-6">
        {groups.map((g) => (
          <div key={g.day}>
            <div className="sticky top-0 z-10 -mx-1 mb-1 bg-gradient-to-b from-[var(--surface,#faf9fb)] to-transparent px-1 py-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">{g.day}</span>
              <span className="ml-2 text-[11px] text-zinc-300">{g.items.length}</span>
            </div>
            <div className="relative ml-3 border-l border-zinc-900/10 pl-5">
              {g.items.map((e, i) => <StreamRow key={e.id} e={e} delay={i * 0.015} />)}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}

function StreamRow({ e, delay }: { e: Event; delay: number }) {
  const c = CAT_BY_KEY.get(categorize(e.action))!;
  return (
    <motion.div
      initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay, duration: 0.2 }}
      className="relative pb-4"
    >
      {/* Spine node */}
      <span className="absolute -left-[27px] top-1 flex h-5 w-5 items-center justify-center rounded-full ring-4 ring-[var(--surface,#faf9fb)]" style={{ backgroundColor: c.soft }}>
        <c.icon className="h-3 w-3" style={{ color: c.color }} />
      </span>
      <div className="glass p-3">
        <div className="flex items-start gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: avaColor(e.avatarSeed) }}>
            {initials(e.actorName)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm leading-snug">
              <span className="font-semibold text-zinc-800">{e.actorName}</span>
              <span className="text-zinc-500"> · {humanize(e.action)}</span>
              {e.entity && (
                <span className="ml-1.5 rounded-md bg-zinc-900/5 px-1.5 py-0.5 text-[11px] font-medium text-zinc-500">
                  {e.entity}{e.entityId ? ` #${String(e.entityId).slice(0, 8)}` : ""}
                </span>
              )}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-zinc-400">
              <span>{e.actorTitle}</span>
              {e.device && <span className="inline-flex items-center gap-1"><Monitor className="h-3 w-3" /> {e.device}</span>}
              {e.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> {e.location}</span>}
              {e.ip && <span className="inline-flex items-center gap-1"><Globe className="h-3 w-3" /> {e.ip}</span>}
            </div>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[11px] font-semibold text-zinc-500 tabular-nums">{fmtClock(e.createdAt)}</p>
            <p className="text-[10px] text-zinc-400">{relTime(e.createdAt)}</p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function SummaryTile({ label, value, accent, small }: { label: string; value: number | string; accent?: boolean; small?: boolean }) {
  return (
    <div className="glass px-3 py-2.5">
      <p className={`font-black tabular-nums ${small ? "text-sm truncate" : "text-2xl"}`} style={accent ? { color: "var(--brand)" } : undefined}>{value}</p>
      <p className="text-[11px] text-zinc-500">{label}</p>
    </div>
  );
}
