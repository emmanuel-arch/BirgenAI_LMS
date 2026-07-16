"use client";

// ─────────────────────────────────────────────────────────────────────────────
// RIRI — THE ACCOUNT PANEL.
//
// One flip of the dock, four sections, in the order a person (or a procurement
// reviewer in a demo) actually asks:
//
//   YOU        who Riri is briefed that you are — name, role, branch. If this is
//              wrong, every answer is wrong, so it is shown rather than assumed.
//   USAGE      what you have asked this month, by tier, and what you exported.
//              This is the number the billing meter runs on; showing it here is
//              how "metered" stays a fact instead of a surprise on an invoice.
//   MEMORY     every note Riri holds about you, readable and deletable — one by
//              one, or everything. An assistant that remembers you but will not
//              show you what it remembers, or let you erase it, fails the first
//              question any buyer's DPO asks.
//   SETTINGS   voice, language, auto-navigate. Consent controls, defaulting off.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import {
  Loader2, UserRound, Gauge, Brain, Settings2, Trash2, Volume2, VolumeX,
  ArrowRight, ShieldCheck, RefreshCw,
} from "lucide-react";
import { useLoad } from "@/lib/hooks/useLoad";

type Account = {
  actor: { name: string | null; role: string | null; branch: string | null; isPlatformAdmin: boolean };
  usage: { monthLabel: string; byModel: { support: number; assistant: number; analytics: number }; total: number; exports: number } | null;
  memories: { id: string; kind: string; body: string; createdAt: string; expiresAt: string | null }[];
  llm: "live" | "simulation";
};

const KIND_LABEL: Record<string, string> = {
  recommendation: "Advice she gave you",
  pattern: "Something she noticed",
  preference: "How you like to work",
  summary: "A running summary",
};

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-400">
        {icon} {title}
      </p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

export function RiriAccount({
  voiceOn, onVoice, autoGo, onAutoGo, lang, onLang, speaking,
}: {
  voiceOn: boolean; onVoice: () => void;
  autoGo: boolean; onAutoGo: () => void;
  lang: string; onLang: () => void;
  speaking: boolean;
}) {
  const [acc, setAcc] = useState<Account | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await fetch("/api/console/riri/account");
      const d = await res.json();
      if (!d.success) { setError(d.message || "Could not load your account."); return; }
      setAcc(d);
    } catch { setError("Could not reach the server."); }
  };
  useLoad(load);

  const forget = async (id?: string) => {
    setBusyId(id ?? "*");
    try {
      const res = await fetch(`/api/console/riri/account${id ? `?id=${id}` : ""}`, { method: "DELETE" });
      const d = await res.json();
      if (d.success) await load();
    } catch { /* the list simply stays */ } finally { setBusyId(null); }
  };

  if (error) return <p className="px-4 py-6 text-xs text-rose-600">{error}</p>;
  if (!acc) return <p className="flex items-center gap-2 px-4 py-6 text-xs text-zinc-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading your account…</p>;

  const toggle = "flex w-full items-center justify-between rounded-xl border border-zinc-900/10 bg-white/70 px-3 py-2.5 text-left";
  const u = acc.usage;

  return (
    <div className="flex-1 min-h-0 space-y-4 overflow-y-auto px-4 py-3">
      <Section icon={<UserRound className="h-3 w-3" />} title="Who I know you as">
        <div className="rounded-xl border border-zinc-900/10 bg-white/70 px-3 py-2.5">
          <p className="text-[13px] font-bold text-zinc-800">{acc.actor.name ?? "—"}</p>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            {[acc.actor.role, acc.actor.branch].filter(Boolean).join(" · ") || "No role on file"}
          </p>
          {acc.actor.isPlatformAdmin && (
            <p className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-violet-700">
              <ShieldCheck className="h-3 w-3" /> BirgenAI platform admin — acting as this lender
            </p>
          )}
        </div>
      </Section>

      <Section icon={<Gauge className="h-3 w-3" />} title={`Your usage — ${u?.monthLabel ?? "this month"}`}>
        <div className="grid grid-cols-4 gap-1.5">
          {([
            ["Support", u?.byModel.support],
            ["Assistant", u?.byModel.assistant],
            ["Analytics", u?.byModel.analytics],
            ["Exports", u?.exports],
          ] as const).map(([label, n]) => (
            <div key={label} className="rounded-xl border border-zinc-900/10 bg-white/70 px-2 py-2 text-center">
              <p className="text-base font-bold tabular-nums" style={{ color: "var(--brand)" }}>{n ?? 0}</p>
              <p className="text-[9px] uppercase tracking-wide text-zinc-500">{label}</p>
            </div>
          ))}
        </div>
        <p className="mt-1.5 text-[10px] text-zinc-400">
          Support is free. Assistant and Analytics meter to your organisation&apos;s Intelligence Suite.
        </p>
      </Section>

      <Section icon={<Brain className="h-3 w-3" />} title="What I remember about you">
        {acc.memories.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-900/15 px-3 py-3 text-[11px] text-zinc-500">
            Nothing yet. As we work together I keep short notes — advice I gave you, how you like to work — so next week I can pick up where we left off. You&apos;ll see every note here, and you can make me forget any of them.
          </p>
        ) : (
          <div className="space-y-1.5">
            {acc.memories.map((m) => (
              <div key={m.id} className="flex items-start justify-between gap-2 rounded-xl border border-zinc-900/10 bg-white/70 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-[9px] font-bold uppercase tracking-wide text-zinc-400">
                    {KIND_LABEL[m.kind] ?? m.kind} · {new Date(m.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-snug text-zinc-700">{m.body}</p>
                </div>
                <button
                  onClick={() => forget(m.id)}
                  disabled={!!busyId}
                  className="shrink-0 rounded-lg p-1 text-zinc-300 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
                  aria-label="Forget this note"
                >
                  {busyId === m.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                </button>
              </div>
            ))}
            <button
              onClick={() => forget()}
              disabled={!!busyId}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-rose-200 py-2 text-[11px] font-semibold text-rose-500 hover:bg-rose-50 disabled:opacity-40"
            >
              {busyId === "*" ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Forget everything — we start fresh
            </button>
          </div>
        )}
      </Section>

      <Section icon={<Settings2 className="h-3 w-3" />} title="Settings">
        <div className="space-y-1.5">
          <button onClick={onVoice} className={toggle}>
            <span className="flex items-center gap-2 text-[12px] font-medium text-zinc-700">
              {voiceOn ? <Volume2 className="h-3.5 w-3.5" style={{ color: "var(--brand)" }} /> : <VolumeX className="h-3.5 w-3.5 text-zinc-400" />}
              Speak answers out loud
            </span>
            <span className={`text-[10px] font-bold ${voiceOn ? "text-[color:var(--brand)]" : "text-zinc-400"}`}>
              {speaking ? "Speaking…" : voiceOn ? "ON" : "OFF"}
            </span>
          </button>
          <button onClick={onAutoGo} className={toggle} title="When on, Riri takes you straight to the screen she suggests">
            <span className="flex items-center gap-2 text-[12px] font-medium text-zinc-700">
              <ArrowRight className={`h-3.5 w-3.5 ${autoGo ? "" : "text-zinc-400"}`} style={autoGo ? { color: "var(--brand)" } : undefined} />
              Take me to screens she suggests
            </span>
            <span className={`text-[10px] font-bold ${autoGo ? "text-[color:var(--brand)]" : "text-zinc-400"}`}>{autoGo ? "ON" : "OFF"}</span>
          </button>
          <button onClick={onLang} className={toggle}>
            <span className="text-[12px] font-medium text-zinc-700">Voice language</span>
            <span className="text-[10px] font-bold" style={{ color: "var(--brand)" }}>{lang === "sw-KE" ? "Kiswahili" : "English"}</span>
          </button>
        </div>
        <p className="mt-2 text-[10px] leading-snug text-zinc-400">
          {acc.llm === "live"
            ? "Assistant and Analytics run on a live model."
            : "No model key on this install — Assistant answers honestly that her brain isn't connected."}
        </p>
      </Section>
    </div>
  );
}
