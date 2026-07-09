// ─────────────────────────────────────────────────────────────────────────────
// RiriDock — the floating AI companion, mounted once in the console layout so it
// persists across every page (conversation and position survive navigation).
//
// DESIGN DECISION (founder asked draggable vs. fixed): draggable, but it snaps to
// the nearer BOTTOM corner on release and remembers the side (localStorage),
// defaulting bottom-right. Free-floating assistants end up covering content or in
// awkward spots; a snapped corner stays thumb-reachable, predictable, and out of
// the way — while still letting the user move it to whichever side they like.
//
// All three models are surfaced at once via a segmented switcher. Answers render
// rich: metric chips, a mini sparkline and small tables for Analyst; structured
// prose for Copilot/Max. Every answer is tagged Live data or Simulated.
// ─────────────────────────────────────────────────────────────────────────────
"use client";

import { useEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Gauge, Bot, Crown, Send, Loader2, X, ArrowRight, AlertCircle } from "lucide-react";
import { RiriAvatar } from "./RiriAvatar";
import { RIRI_MODELS, RIRI_MODEL_IDS, isRiriModel, type RiriModelId } from "@/lib/riri/models";

const ICON = { Gauge, Bot, Crown } as const;
const INSET = 16;
const SIZE = 60;
const GAP = 12;

type Chip = { label: string; value: string; sub?: string; tone?: "good" | "warn" | "bad" };
type Series = { unit: "KES" | "count"; points: { x: string; y: number }[] };
type Table = { head: string[]; rows: string[][] };
type Turn = {
  id: string; question: string; model: RiriModelId; loading: boolean;
  answer?: string; chips?: Chip[] | null; series?: Series | null; table?: Table | null;
  mode?: "live" | "simulation"; error?: string;
};

const placeholderFor: Record<RiriModelId, string> = {
  analyst: "Ask about your loan book…",
  copilot: "Ask how to run something…",
  max: "Ask for a strategy…",
};

// ── Tiny rich-text renderer (bold + bullets + numbered), no dependency ────────
function renderInline(text: string, k: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith("**") && p.endsWith("**")
      ? <strong key={k + i} className="font-semibold text-zinc-900">{p.slice(2, -2)}</strong>
      : <span key={k + i}>{p}</span>,
  );
}
function RichText({ text }: { text: string }) {
  const out: ReactNode[] = [];
  text.split("\n").forEach((raw, i) => {
    const l = raw.trimEnd();
    if (!l.trim()) { out.push(<div key={i} className="h-1.5" />); return; }
    const bullet = /^-\s+(.*)/.exec(l);
    const num = /^(\d+)\.\s+(.*)/.exec(l);
    if (bullet) out.push(<div key={i} className="flex gap-2"><span className="mt-px shrink-0" style={{ color: "var(--brand)" }}>•</span><span className="flex-1">{renderInline(bullet[1], i + "b")}</span></div>);
    else if (num) out.push(<div key={i} className="flex gap-2"><span className="shrink-0 font-semibold" style={{ color: "var(--brand)" }}>{num[1]}.</span><span className="flex-1">{renderInline(num[2], i + "n")}</span></div>);
    else out.push(<p key={i}>{renderInline(l, i + "p")}</p>);
  });
  return <div className="space-y-1 text-[13px] leading-relaxed text-zinc-700">{out}</div>;
}

const toneClass = (t?: Chip["tone"]) =>
  t === "good" ? "text-emerald-600" : t === "warn" ? "text-amber-600" : t === "bad" ? "text-rose-600" : "text-[color:var(--brand)]";

function Chips({ chips }: { chips: Chip[] }) {
  return (
    <div className="mt-2.5 grid grid-cols-3 gap-1.5">
      {chips.map((c, i) => (
        <div key={i} className="rounded-lg border border-zinc-900/10 bg-white/70 px-2 py-1.5">
          <p className="text-[9px] uppercase tracking-wide text-zinc-500 leading-tight truncate">{c.label}</p>
          <p className={`text-sm font-bold leading-tight ${toneClass(c.tone)}`}>{c.value}</p>
          {c.sub && <p className="text-[9px] text-zinc-400 leading-tight truncate">{c.sub}</p>}
        </div>
      ))}
    </div>
  );
}

function Sparkline({ series }: { series: Series }) {
  const max = Math.max(...series.points.map((p) => p.y), 1);
  const fmt = (y: number) => series.unit === "KES" ? (y >= 1000 ? `${Math.round(y / 1000)}k` : String(Math.round(y))) : String(y);
  return (
    <div className="mt-2.5 rounded-lg border border-zinc-900/10 bg-white/70 p-2.5">
      <div className="flex items-end gap-1.5 h-16">
        {series.points.map((p, i) => (
          <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1 h-full">
            <span className="text-[8px] text-zinc-400">{p.y > 0 ? fmt(p.y) : ""}</span>
            <div className="w-full rounded-t transition-all" style={{ height: `${Math.max(4, (p.y / max) * 100)}%`, backgroundColor: "var(--brand)", opacity: 0.35 + 0.65 * (p.y / max) }} />
            <span className="text-[8px] text-zinc-500">{p.x}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniTable({ table }: { table: Table }) {
  if (!table.rows.length) return null;
  return (
    <div className="mt-2.5 overflow-x-auto rounded-lg border border-zinc-900/10 bg-white/70">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-zinc-900/10 text-zinc-500">
            {table.head.map((h, i) => <th key={i} className={`px-2.5 py-1.5 font-medium ${i === 0 ? "text-left" : "text-right"}`}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r, ri) => (
            <tr key={ri} className="border-b border-zinc-900/5 last:border-0">
              {r.map((c, ci) => <td key={ci} className={`px-2.5 py-1.5 ${ci === 0 ? "text-left font-medium text-zinc-800" : "text-right tabular-nums text-zinc-600"}`}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function RiriDock({ orgName, userName }: { orgName: string; userName?: string | null }) {
  const [mounted, setMounted] = useState(false);
  const [vp, setVp] = useState({ w: 1200, h: 800 });
  const [open, setOpen] = useState(false);
  const [corner, setCorner] = useState<"br" | "bl">("br");
  const [model, setModel] = useState<RiriModelId>("analyst");
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [greet, setGreet] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const down = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Mount: read persisted prefs + viewport.
  useEffect(() => {
    setMounted(true);
    setVp({ w: window.innerWidth, h: window.innerHeight });
    try {
      const c = localStorage.getItem("riri:corner"); if (c === "br" || c === "bl") setCorner(c);
      const m = localStorage.getItem("riri:model"); if (isRiriModel(m)) setModel(m);
      if (localStorage.getItem("riri:open") === "1") setOpen(true);
      if (localStorage.getItem("riri:greeted") !== "1") setGreet(true);
    } catch { /* ignore */ }
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Persist prefs.
  useEffect(() => { try { localStorage.setItem("riri:corner", corner); } catch {} }, [corner]);
  useEffect(() => { try { localStorage.setItem("riri:model", model); } catch {} }, [model]);
  useEffect(() => { try { localStorage.setItem("riri:open", open ? "1" : "0"); } catch {} }, [open]);

  useEffect(() => { if (open) endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [turns, open]);

  // Open Riri from anywhere: any element with [data-riri-open] (optionally
  // [data-riri-open="analyst|copilot|max"]) or a window "riri:open" event.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.("[data-riri-open]");
      if (!el) return;
      e.preventDefault();
      const m = el.getAttribute("data-riri-open");
      if (isRiriModel(m)) setModel(m);
      setOpen(true); dismissGreet();
    };
    const onEvent = (e: Event) => {
      const m = (e as CustomEvent).detail?.model;
      if (isRiriModel(m)) setModel(m);
      setOpen(true); dismissGreet();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("click", onClick);
    window.addEventListener("riri:open", onEvent as EventListener);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("click", onClick); window.removeEventListener("riri:open", onEvent as EventListener); window.removeEventListener("keydown", onKey); };
  }, []);

  const dismissGreet = () => { setGreet(false); try { localStorage.setItem("riri:greeted", "1"); } catch {} };

  // Launcher coordinates (left/top so the snap can animate smoothly).
  const anchorLeft = corner === "br" ? vp.w - INSET - SIZE : INSET;
  const anchorTop = vp.h - INSET - SIZE;
  const pos = drag ? { left: drag.x, top: drag.y } : { left: anchorLeft, top: anchorTop };

  const onDown = (e: ReactPointerEvent) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    down.current = { x: e.clientX, y: e.clientY, moved: false };
  };
  const onMove = (e: ReactPointerEvent) => {
    if (!down.current) return;
    if (!down.current.moved && Math.hypot(e.clientX - down.current.x, e.clientY - down.current.y) < 6) return;
    down.current.moved = true;
    setDrag({ x: Math.min(vp.w - SIZE, Math.max(0, e.clientX - SIZE / 2)), y: Math.min(vp.h - SIZE, Math.max(0, e.clientY - SIZE / 2)) });
  };
  const onUp = (e: ReactPointerEvent) => {
    const d = down.current; down.current = null;
    if (!d) return;
    if (!d.moved) { setOpen((o) => !o); dismissGreet(); return; }
    setCorner(e.clientX < vp.w / 2 ? "bl" : "br");
    setDrag(null);
  };

  const ask = async (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    const id = crypto.randomUUID();
    const m = model;
    setTurns((t) => [...t, { id, question, model: m, loading: true }]);
    setInput(""); setBusy(true);
    try {
      const res = await fetch("/api/console/riri", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, model: m }) });
      const data = await res.json();
      setTurns((t) => t.map((x) => x.id === id
        ? (data.success
          ? { ...x, loading: false, answer: data.answer, chips: data.chips, series: data.series, table: data.table, mode: data.mode }
          : { ...x, loading: false, error: data.message || "Riri couldn't answer that." })
        : x));
    } catch {
      setTurns((t) => t.map((x) => x.id === id ? { ...x, loading: false, error: "Network error. Try again." } : x));
    } finally { setBusy(false); }
  };

  if (!mounted) return null;
  const active = RIRI_MODELS[model];
  const sideStyle = corner === "br" ? { right: INSET } : { left: INSET };
  const panelBottom = INSET + SIZE + GAP;

  return (
    <>
      {/* Greeting nudge (first run only) */}
      <AnimatePresence>
        {greet && !open && (
          <motion.button
            initial={{ opacity: 0, y: 10, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
            transition={{ type: "spring", stiffness: 400, damping: 28 }}
            onClick={() => { setOpen(true); dismissGreet(); }}
            style={{ ...sideStyle, bottom: panelBottom }}
            className="fixed z-[9998] max-w-[240px] glass rounded-2xl bg-white/85 px-3.5 py-2.5 text-left shadow-xl"
          >
            <p className="text-[13px] font-semibold text-zinc-900">Hi{userName ? `, ${userName.split(" ")[0]}` : ""} 👋 I&apos;m Riri</p>
            <p className="mt-0.5 text-[11px] text-zinc-500 leading-snug">Ask me anything about {orgName}&apos;s book — or how to run it.</p>
            <span onClick={(e) => { e.stopPropagation(); dismissGreet(); }} className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-900 text-white" aria-label="Dismiss"><X className="h-3 w-3" /></span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="riri-panel"
            initial={{ opacity: 0, scale: 0.9, y: 14 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.94, y: 10 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            role="dialog" aria-label="Riri assistant"
            style={{ ...sideStyle, bottom: panelBottom, transformOrigin: corner === "br" ? "bottom right" : "bottom left", width: "min(384px, calc(100vw - 24px))", maxHeight: "min(600px, calc(100vh - 120px))" }}
            className="fixed z-[9998] flex flex-col overflow-hidden rounded-3xl border border-white/60 bg-white/85 shadow-2xl backdrop-blur-2xl"
          >
            {/* Header */}
            <div className="relative shrink-0 px-4 pt-3.5 pb-3" style={{ background: "linear-gradient(135deg, var(--brand-soft), transparent)" }}>
              <div className="flex items-center gap-2.5">
                <div className="relative h-10 w-10 shrink-0 rounded-full shadow-md ring-2 ring-white overflow-hidden">
                  <RiriAvatar size={40} state={busy ? "thinking" : "listening"} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold leading-tight">Riri</p>
                  <p className="text-[11px] text-zinc-500 leading-tight flex items-center gap-1">
                    {busy ? <>Thinking<span className="riri-think-dot">.</span><span className="riri-think-dot" style={{ animationDelay: ".2s" }}>.</span><span className="riri-think-dot" style={{ animationDelay: ".4s" }}>.</span></>
                      : <><span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" /> {active.name} · Online</>}
                  </p>
                </div>
                <button onClick={() => setOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-900/5 hover:text-zinc-900" aria-label="Close Riri"><X className="h-4 w-4" /></button>
              </div>

              {/* Model switcher — all three, always visible */}
              <div className="mt-3 flex gap-1 rounded-xl bg-white/60 p-1">
                {RIRI_MODEL_IDS.map((id) => {
                  const m = RIRI_MODELS[id]; const Icon = ICON[m.icon]; const on = id === model;
                  return (
                    <button key={id} onClick={() => setModel(id)}
                      className={`relative flex flex-1 items-center justify-center gap-1 rounded-lg px-1.5 py-1.5 text-[11px] font-semibold transition-colors ${on ? "text-white shadow-sm" : "text-zinc-600 hover:text-zinc-900"} ${m.pro && on ? "riri-sheen" : ""}`}
                      style={on ? { backgroundColor: "var(--brand)" } : undefined}>
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span>{m.name.replace("Riri ", "")}</span>
                      {m.pro && <span className={`rounded px-1 text-[7px] font-bold leading-none ${on ? "bg-white/25 text-white" : "bg-amber-100 text-amber-700"}`}>PRO</span>}
                    </button>
                  );
                })}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className={`rounded-full px-1.5 py-0.5 text-[8px] font-bold tracking-wide ${active.badge === "LIVE DATA" ? "bg-emerald-100 text-emerald-700" : active.badge === "PRO" ? "bg-amber-100 text-amber-700" : "bg-zinc-900/5 text-zinc-500"}`}>{active.badge}</span>
                <p className="text-[11px] text-zinc-500 leading-tight truncate">{active.blurb}</p>
              </div>
            </div>

            {/* Conversation */}
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-4">
              {turns.length === 0 && (
                <div>
                  <div className="rounded-2xl rounded-bl-sm border border-zinc-900/10 bg-white/70 px-3.5 py-3">
                    <RichText text={active.id === "analyst"
                      ? `Hey${userName ? ` ${userName.split(" ")[0]}` : ""} — I read **${orgName}**'s live book. Ask me a number and I'll pull it straight from your data.`
                      : active.id === "copilot"
                        ? `I'm your operations co-pilot. Tell me what you're trying to do and I'll give you concrete steps for this console.`
                        : `I'm the strategy tier. Give me a decision and I'll reason it end-to-end — trade-offs, evidence, and what to watch.`} />
                  </div>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {active.suggestions.map((s) => (
                      <button key={s} onClick={() => ask(s)} className="rounded-full border border-zinc-900/12 bg-white/70 px-2.5 py-1 text-[11px] text-zinc-600 hover:border-[color:var(--brand)] hover:text-zinc-900 transition-colors">{s}</button>
                    ))}
                  </div>
                </div>
              )}

              {turns.map((t) => {
                const Icon = ICON[RIRI_MODELS[t.model].icon];
                return (
                  <div key={t.id} className="space-y-2.5">
                    <div className="flex justify-end">
                      <div className="max-w-[85%] rounded-2xl rounded-br-sm px-3 py-2 text-[13px] text-white shadow-sm" style={{ backgroundColor: "var(--brand)" }}>{t.question}</div>
                    </div>
                    <div className="flex gap-2">
                      <div className="mt-0.5 h-6 w-6 shrink-0 rounded-full ring-1 ring-white overflow-hidden"><RiriAvatar size={24} state={t.loading ? "thinking" : "idle"} animated={t.loading} /></div>
                      <div className="min-w-0 flex-1 rounded-2xl rounded-bl-sm border border-zinc-900/10 bg-white/70 px-3.5 py-3">
                        {t.loading ? (
                          <span className="flex items-center gap-2 text-[13px] text-zinc-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading your book…</span>
                        ) : t.error ? (
                          <span className="flex items-center gap-2 text-[13px] text-rose-600"><AlertCircle className="h-3.5 w-3.5" /> {t.error}</span>
                        ) : (
                          <>
                            <RichText text={t.answer ?? ""} />
                            {t.chips && t.chips.length > 0 && <Chips chips={t.chips} />}
                            {t.series && <Sparkline series={t.series} />}
                            {t.table && <MiniTable table={t.table} />}
                            <div className="mt-2.5 flex items-center gap-1.5">
                              <span className="inline-flex items-center gap-1 rounded-full bg-zinc-900/5 px-1.5 py-0.5 text-[9px] font-medium text-zinc-500"><Icon className="h-2.5 w-2.5" /> {RIRI_MODELS[t.model].name}</span>
                              <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${t.mode === "live" ? "text-emerald-600" : "text-zinc-400"}`}>{t.mode === "live" ? "Live data" : "Simulated"}</span>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={endRef} />
            </div>

            {/* Composer */}
            <div className="shrink-0 border-t border-zinc-900/10 bg-white/60 p-2.5">
              <div className="flex items-center gap-2 rounded-xl border border-zinc-900/15 bg-white/80 px-2.5 focus-within:border-[color:var(--brand)]">
                <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), ask(input))}
                  placeholder={placeholderFor[model]} className="flex-1 bg-transparent py-2.5 text-[13px] outline-none placeholder:text-zinc-400" />
                <button onClick={() => ask(input)} disabled={busy || !input.trim()}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-white disabled:opacity-40" style={{ backgroundColor: "var(--brand)" }} aria-label="Send">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                </button>
              </div>
              <p className="mt-1.5 text-center text-[9px] text-zinc-400">Riri can be wrong — verify figures before acting · Powered by BirgenAI</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Launcher */}
      <div
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
        style={{ ...pos, width: SIZE, height: SIZE, touchAction: "none", transition: drag ? "none" : "left .38s cubic-bezier(.22,1,.36,1), top .38s cubic-bezier(.22,1,.36,1)" }}
        className="fixed z-[9999] cursor-grab active:cursor-grabbing select-none"
        title={open ? "Close Riri" : "Ask Riri"}
      >
        {!open && <span className="pointer-events-none absolute inset-0 rounded-full riri-halo" style={{ background: "var(--brand)", opacity: 0.25 }} />}
        <div className={`relative h-full w-full rounded-full shadow-2xl ring-2 ring-white ${open ? "" : "riri-float"}`} style={{ boxShadow: "0 12px 32px rgba(0,0,0,.22)" }}>
          <div className="h-full w-full overflow-hidden rounded-full">
            <RiriAvatar size={SIZE} state={busy ? "thinking" : "idle"} />
          </div>
          {open ? (
            <span className="absolute -top-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-zinc-900 text-white ring-2 ring-white"><X className="h-3.5 w-3.5" /></span>
          ) : (
            <span className="absolute bottom-0.5 right-0.5 h-3.5 w-3.5 rounded-full bg-emerald-500 ring-2 ring-white" />
          )}
          {busy && !open && <span className="pointer-events-none absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full riri-orbit-dot" style={{ backgroundColor: "var(--brand)" }} />}
        </div>
      </div>
    </>
  );
}
