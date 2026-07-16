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

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Gauge, Bot, LifeBuoy, Send, Loader2, X, ArrowRight, AlertCircle, Database, Mic, Sheet, FileText, Download, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useVoice } from "@/lib/hooks/useVoice";
import { RiriAvatar } from "./RiriAvatar";
import { RiriAccount } from "./RiriAccount";
import { RIRI_MODELS, RIRI_MODEL_IDS, normaliseModelId, type RiriModelId } from "@/lib/riri/models";

const ICON = { Gauge, Bot, LifeBuoy } as const;
const INSET = 16;
const SIZE = 60;
const GAP = 12;

type Chip = { label: string; value: string; sub?: string; tone?: "good" | "warn" | "bad" };
type Series = { unit: "KES" | "count"; points: { x: string; y: number }[] };
type Table = { head: string[]; rows: string[][] };
/** Something Riri offers to do. She proposes; the human taps. */
type Action = { kind: "navigate"; label: string; href: string };
type Turn = {
  id: string; question: string; model: RiriModelId; loading: boolean;
  answer?: string; chips?: Chip[] | null; series?: Series | null; table?: Table | null;
  mode?: "live" | "simulation"; error?: string;
  sql?: string | null; rows?: number | null; ms?: number | null; route?: string;
  actions?: Action[]; suggestions?: string[];
};

const placeholderFor: Record<RiriModelId, string> = {
  support: "Ask me how to do anything…",
  assistant: "Ask me about your day, or this customer…",
  analytics: "Ask your loan book a question…",
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

/**
 * Take this away as a file.
 *
 * Offered only when there is a query behind the answer — a number Riri reasoned her way
 * to is not a dataset, and offering to export it would imply it is one.
 *
 * The server RE-RUNS the query and builds a real workbook; nothing here posts the rows
 * it is showing. It is not a screenshot of the table either: the people this is for
 * pivot these numbers, and a picture of a table is a rumour about data.
 */
function ExportBar({ question, sql }: { question: string; sql: string }) {
  const [busy, setBusy] = useState<"xlsx" | "pdf" | null>(null);
  const [done, setDone] = useState<{ filename: string; url?: string | null; stored: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (format: "xlsx" | "pdf") => {
    setBusy(format); setError(null); setDone(null);
    try {
      const res = await fetch("/api/console/riri/export", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, sql, format }),
      });
      const d = await res.json();
      if (!d.success) { setError(d.message || "Could not build that report."); return; }
      setDone({ filename: d.filename, url: d.url, stored: d.stored });
      // Saved either way; opening it is the convenience, not the delivery.
      if (d.url) window.open(d.url, "_blank", "noopener");
    } catch {
      setError("Could not reach the server.");
    } finally { setBusy(null); }
  };

  const btn = "inline-flex items-center gap-1 rounded-md border border-zinc-900/10 bg-white/70 px-2 py-1 text-[10px] font-semibold text-zinc-600 hover:text-zinc-900 disabled:opacity-40";

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] text-zinc-400">Download?</span>
      <button onClick={() => run("xlsx")} disabled={!!busy} className={btn}>
        {busy === "xlsx" ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Sheet className="h-2.5 w-2.5" />} Excel
      </button>
      <button onClick={() => run("pdf")} disabled={!!busy} className={btn}>
        {busy === "pdf" ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <FileText className="h-2.5 w-2.5" />} PDF
      </button>
      {done && (
        <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600">
          <Download className="h-2.5 w-2.5" />
          {done.stored ? `Saved as ${done.filename}` : `${done.filename} (storage is in simulation — not kept)`}
        </span>
      )}
      {error && <span className="text-[10px] text-rose-600">{error}</span>}
    </div>
  );
}

/**
 * The SQL behind the number.
 *
 * The blueprint's rule for this tier is "SQL always shown", and it is a trust
 * feature, not a debugging one: a lender who cannot check a figure cannot act on it.
 * Collapsed by default because an officer chasing arrears does not want a query in
 * their face — but one click away, always, and never a different query from the one
 * that ran.
 */
function SqlDisclosure({ sql, rows, ms }: { sql: string; rows?: number | null; ms?: number | null }) {
  return (
    <details className="mt-2.5 group">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[10px] font-medium text-zinc-400 hover:text-zinc-700">
        <Database className="h-2.5 w-2.5" />
        <span className="group-open:hidden">Show the SQL</span>
        <span className="hidden group-open:inline">Hide the SQL</span>
        {rows != null && <span className="tabular-nums">· {rows} row{rows === 1 ? "" : "s"}</span>}
        {ms != null && <span className="tabular-nums">· {ms}ms</span>}
      </summary>
      <pre className="mt-1.5 max-h-40 overflow-auto rounded-lg border border-zinc-900/10 bg-zinc-950/[0.03] px-2.5 py-2 text-[10px] leading-relaxed text-zinc-600">
        <code>{sql}</code>
      </pre>
      <p className="mt-1 text-[9px] leading-snug text-zinc-400">
        Read-only, and scoped to your organisation by the database itself.
      </p>
    </details>
  );
}

// ── Two external things React needs to read: the browser, and its size ────────
//
// Both are asked for with useSyncExternalStore rather than setState-in-an-effect.
// The effect version cost an extra render on every mount and is banned by the current
// react-hooks rules for exactly that reason: an effect should SUBSCRIBE to an external
// system, not copy it into state on arrival.

const subscribeNothing = () => () => {};

/** One stored preference. Returns null on the server, or if storage is unavailable. */
function pref(key: string): string | null {
  if (typeof window === "undefined") return null;
  try { return localStorage.getItem(key); } catch { return null; }
}

/** The viewport, cached — getSnapshot must return a stable reference or it loops forever. */
let vpCache = { w: 1200, h: 800 };
const VP_SERVER = { w: 1200, h: 800 };

function subscribeViewport(onChange: () => void) {
  const onResize = () => {
    if (vpCache.w !== window.innerWidth || vpCache.h !== window.innerHeight) {
      vpCache = { w: window.innerWidth, h: window.innerHeight };
      onChange();
    }
  };
  window.addEventListener("resize", onResize);
  return () => window.removeEventListener("resize", onResize);
}

function viewportSnapshot() {
  if (vpCache.w !== window.innerWidth || vpCache.h !== window.innerHeight) {
    vpCache = { w: window.innerWidth, h: window.innerHeight };
  }
  return vpCache;
}

export default function RiriDock({ orgName, userName }: { orgName: string; userName?: string | null }) {
  // Are we on the client yet? The server snapshot is false, the client's is true —
  // hydration-safe, and no render is wasted announcing it.
  const mounted = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const vp = useSyncExternalStore(subscribeViewport, viewportSnapshot, () => VP_SERVER);
  // Prefs are restored in the INITIALISER, not an effect. Safe despite SSR because the
  // dock renders null until `mounted`, so the server's markup does not depend on any of
  // them and there is nothing to mismatch on hydration.
  const [open, setOpen] = useState(() => pref("riri:open") === "1");
  const [corner, setCorner] = useState<"br" | "bl">(() => (pref("riri:corner") === "bl" ? "bl" : "br"));
  const [model, setModel] = useState<RiriModelId>(() => {
    const m = pref("riri:model");
    // normalise, not validate: an officer with "copilot" saved from last week must land
    // on Assistant, not be silently reset to Support.
    return normaliseModelId(m) ?? "support";
  });
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [greet, setGreet] = useState(() => pref("riri:greeted") !== "1");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  // Voice preferences. Both OFF by default — an assistant that starts talking, or
  // navigates on its own, before anyone asked it to is a hostile assistant.
  const [voiceOn, setVoiceOn] = useState(() => pref("riri:voice") === "1");
  const [autoGo, setAutoGo] = useState(() => pref("riri:autogo") === "1");
  // chat | account — the panel's two faces. Account is who Riri thinks you are, your
  // usage, her memory of you, and settings. Not persisted: the dock reopens on chat.
  const [view, setView] = useState<"chat" | "account">("chat");
  const down = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  // `ask` is declared below; the hook only ever calls this after a spoken utterance, so
  // it is held in a ref rather than referenced before its declaration.
  const askRef = useRef<(q: string) => void>(() => {});
  // Who Riri is currently looking at, if she was opened from a customer's page. A ref,
  // not state: it is read inside handlers, and re-rendering the whole dock because the
  // subject changed would buy nothing.
  const subjectRef = useRef<{ kind: string; id: string } | null>(null);
  const briefRef = useRef<(s: { kind: string; id: string }) => void>(() => {});
  const voice = useVoice({ onTranscript: (text) => askRef.current(text) });

  const dismissGreet = () => { setGreet(false); try { localStorage.setItem("riri:greeted", "1"); } catch {} };

  // Persist prefs.
  useEffect(() => { try { localStorage.setItem("riri:corner", corner); } catch {} }, [corner]);
  useEffect(() => { try { localStorage.setItem("riri:model", model); } catch {} }, [model]);
  useEffect(() => { try { localStorage.setItem("riri:open", open ? "1" : "0"); } catch {} }, [open]);
  useEffect(() => { try { localStorage.setItem("riri:voice", voiceOn ? "1" : "0"); } catch {} }, [voiceOn]);
  useEffect(() => { try { localStorage.setItem("riri:autogo", autoGo ? "1" : "0"); } catch {} }, [autoGo]);

  useEffect(() => { if (open) endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [turns, open]);

  // Open Riri from anywhere: any element with [data-riri-open] (optionally
  // [data-riri-open="analyst|copilot|max"]) or a window "riri:open" event.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.("[data-riri-open]");
      if (!el) return;
      e.preventDefault();
      const m = el.getAttribute("data-riri-open");
      const want = normaliseModelId(m);
      if (want) setModel(want);
      setOpen(true); dismissGreet();
    };
    const onEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail ?? {};
      const want = normaliseModelId(detail.model);
      if (want) setModel(want);
      // A caller may hand Riri an opening question — Field Ops does this with
      // the live route context — asked immediately so she answers on arrival.
      if (typeof detail.prompt === "string" && detail.prompt.trim()) {
        setTimeout(() => askRef.current(detail.prompt.trim()), 300);
      }
      // Or a caller may point her at someone. She opens by saying what she can see,
      // and every question after that stays about them.
      const s = detail.subject;
      if (s && typeof s.id === "string" && typeof s.kind === "string") {
        subjectRef.current = { kind: s.kind, id: s.id };
        briefRef.current({ kind: s.kind, id: s.id });
      }
      setOpen(true); dismissGreet();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("click", onClick);
    window.addEventListener("riri:open", onEvent as EventListener);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("click", onClick); window.removeEventListener("riri:open", onEvent as EventListener); window.removeEventListener("keydown", onKey); };
  }, []);

  // THE WELCOME. Fetched the first time the panel is ever opened on Support, and pushed
  // in as Riri's opening turn — so a new admin's first experience of the console is
  // being told, by name, what to do next, rather than being left to guess which of
  // eleven menus comes first.
  const welcomed = useRef(false);
  useEffect(() => {
    if (!open || model !== "support" || turns.length > 0 || welcomed.current) return;
    welcomed.current = true;
    (async () => {
      try {
        const res = await fetch("/api/console/riri/welcome");
        const data = await res.json();
        if (!data.success) return;
        setTurns([{
          id: crypto.randomUUID(),
          question: "",
          model: "support",
          loading: false,
          answer: data.answer,
          actions: data.actions ?? [],
          suggestions: data.suggestions ?? [],
          mode: "live",
          route: "knowledge",
        }]);
        if (voiceOn) void voice.speak(data.answer as string);
      } catch { /* the empty state is a perfectly good fallback */ }
    })();
  }, [open, model, turns.length, voiceOn, voice]);

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
      // The voice toggle is an explicit language choice — support answers follow it.
      // Typed questions with the toggle on English still flip via detectLang server-side.
      // If Riri was opened from a customer's page, every question stays about THEM
      // until she is opened from somewhere else — an officer who asked "why is their
      // limit so low?" should not have to say who "they" are. Only the id travels; the
      // server reads the facts (see lib/riri/context.ts).
      //
      // The Assistant also gets the conversation so far, so "what about last month?"
      // has an antecedent. Server-side sanitizeHistory caps it.
      const history = m === "assistant"
        ? turns.flatMap((t) => [
            ...(t.question ? [{ role: "user" as const, text: t.question }] : []),
            ...(t.answer ? [{ role: "model" as const, text: t.answer }] : []),
          ])
        : undefined;
      const res = await fetch("/api/console/riri", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question, model: m,
          ...(voice.lang === "sw-KE" ? { lang: "sw" } : {}),
          ...(subjectRef.current ? { subject: subjectRef.current } : {}),
          ...(history?.length ? { history } : {}),
        }),
      });
      const data = await res.json();
      setTurns((t) => t.map((x) => x.id === id
        ? (data.success
          ? { ...x, loading: false, answer: data.answer, chips: data.chips, series: data.series, table: data.table, mode: data.mode, sql: data.sql, rows: data.rows, ms: data.ms, route: data.route, actions: data.actions ?? [], suggestions: data.suggestions ?? [] }
          : { ...x, loading: false, error: data.message || "Riri couldn't answer that." })
        : x));

      if (data.success) {
        if (voiceOn) void voice.speak(data.answer as string);

        // AUTO-NAVIGATE IS OPT-IN, AND ONLY EVER NAVIGATION. Riri can take you to a
        // screen; she cannot press the button when she gets there. Speech recognition
        // mishears, and in a lending system the gap between "show me" and "send it" is
        // one misheard syllable — so the irreversible half always stays with a human.
        const first: Action | undefined = (data.actions ?? [])[0];
        if (autoGo && first?.href) router.push(first.href);
      }
    } catch {
      setTurns((t) => t.map((x) => x.id === id ? { ...x, loading: false, error: "Network error. Try again." } : x));
    } finally { setBusy(false); }
  };
  /**
   * Open on a customer by saying what we hold about them.
   *
   * Pushed as a turn with no question, exactly like the Support welcome — because it is
   * not an answer to anything. It is a READ of our own rows (api/console/riri/brief),
   * not a model output, so it is marked live: it is true whether or not an LLM key
   * exists, and mislabelling it as reasoning would be the lie.
   */
  const brief = async (s: { kind: string; id: string }) => {
    const id = crypto.randomUUID();
    setTurns((t) => [...t, { id, question: "", model, loading: true }]);
    try {
      const res = await fetch("/api/console/riri/brief", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(s),
      });
      const data = await res.json();
      setTurns((t) => t.map((x) => x.id === id
        ? (data.success
          ? { ...x, loading: false, answer: data.answer, mode: "live", route: "record" }
          : { ...x, loading: false, error: data.message || "Could not read that customer." })
        : x));
    } catch {
      setTurns((t) => t.map((x) => x.id === id ? { ...x, loading: false, error: "Network error. Try again." } : x));
    }
  };
  // The mount-only listeners and the voice hook call whichever version of these exists
  // NOW, so the refs are re-pointed after every render — in an effect, because a ref
  // written during render is a write to something React may not have committed yet.
  useEffect(() => {
    askRef.current = ask;
    briefRef.current = brief;
  });

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
            className="no-print fixed z-[9998] max-w-[240px] glass rounded-2xl bg-white/85 px-3.5 py-2.5 text-left shadow-xl"
          >
            <p className="text-[13px] font-semibold text-zinc-900">Hi{userName ? `, ${userName.split(" ")[0]}` : ""} 👋 I&apos;m Riri</p>
            <p className="mt-0.5 text-[11px] text-zinc-500 leading-snug">I&apos;ll show you around {orgName} — ask me how to do anything, or just talk to me.</p>
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
            className="no-print fixed z-[9998] flex flex-col overflow-hidden rounded-3xl border border-white/60 bg-white/85 shadow-2xl backdrop-blur-2xl"
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
                <button
                  onClick={() => setView((v) => (v === "chat" ? "account" : "chat"))}
                  className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${view === "account" ? "text-white" : "text-zinc-500 hover:bg-zinc-900/5 hover:text-zinc-900"}`}
                  style={view === "account" ? { backgroundColor: "var(--brand)" } : undefined}
                  aria-label={view === "account" ? "Back to the conversation" : "Your account, usage and what Riri remembers"}
                  title={view === "account" ? "Back to the conversation" : "Account & usage"}
                >
                  <UserRound className="h-4 w-4" />
                </button>
                <button onClick={() => setOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-900/5 hover:text-zinc-900" aria-label="Close Riri"><X className="h-4 w-4" /></button>
              </div>

              {/* Model switcher — chat only; the account view is tier-less */}
              {view === "chat" && (<>
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
              </>)}
            </div>

            {view === "account" ? (
              <RiriAccount
                voiceOn={voiceOn}
                onVoice={() => { if (voice.speaking) voice.stopSpeaking(); setVoiceOn((v) => !v); }}
                autoGo={autoGo}
                onAutoGo={() => setAutoGo((v) => !v)}
                lang={voice.lang}
                onLang={() => voice.setLang(voice.lang === "en-KE" ? "sw-KE" : "en-KE")}
                speaking={voice.speaking}
              />
            ) : (<>
            {/* Conversation */}
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-4">
              {turns.length === 0 && (
                <div>
                  <div className="rounded-2xl rounded-bl-sm border border-zinc-900/10 bg-white/70 px-3.5 py-3">
                    <RichText text={active.id === "support"
                      ? `Hey${userName ? ` ${userName.split(" ")[0]}` : ""} — I know this platform inside out. Ask me how to do anything, why something is blocked, or what to do next, and I'll take you straight there.

You can talk to me out loud with the microphone.`
                      : active.id === "assistant"
                        ? `Niaje${userName ? ` ${userName.split(" ")[0]}` : ""} 👋 I know your role, your book and whoever you have open. Ask me who to chase, whether to lend, or what I told you last week — in English, Kiswahili or Sheng.`
                        : `Hey${userName ? ` ${userName.split(" ")[0]}` : ""} — I read **${orgName}**'s live book. Ask me a number and I'll pull it straight from your data, show you the SQL I ran, and hand you an Excel or PDF of it.`} />
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
                    {t.question && (
                      <div className="flex justify-end">
                        <div className="max-w-[85%] rounded-2xl rounded-br-sm px-3 py-2 text-[13px] text-white shadow-sm" style={{ backgroundColor: "var(--brand)" }}>{t.question}</div>
                      </div>
                    )}
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
                            {t.sql && <ExportBar question={t.question} sql={t.sql} />}
                            {t.sql && <SqlDisclosure sql={t.sql} rows={t.rows} ms={t.ms} />}

                            {/* WHAT SHE OFFERS TO DO. She proposes; you tap. Nothing here
                                moves money or changes a permission — the destination is
                                the action, and the button at the other end is still yours. */}
                            {t.actions && t.actions.length > 0 && (
                              <div className="mt-2.5 flex flex-wrap gap-1.5">
                                {t.actions.map((a, i) => (
                                  <button
                                    key={i}
                                    onClick={() => router.push(a.href)}
                                    className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold text-white"
                                    style={{ backgroundColor: "var(--brand)" }}
                                  >
                                    {a.label} <ArrowRight className="h-3 w-3" />
                                  </button>
                                ))}
                              </div>
                            )}

                            {t.suggestions && t.suggestions.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {t.suggestions.filter(Boolean).map((sg) => (
                                  <button
                                    key={sg}
                                    onClick={() => ask(sg)}
                                    className="rounded-full border border-zinc-900/12 bg-white/70 px-2 py-0.5 text-[10px] text-zinc-500 hover:border-[color:var(--brand)] hover:text-zinc-900"
                                  >
                                    {sg}
                                  </button>
                                ))}
                              </div>
                            )}
                            <div className="mt-2.5 flex items-center gap-1.5">
                              <span className="inline-flex items-center gap-1 rounded-full bg-zinc-900/5 px-1.5 py-0.5 text-[9px] font-medium text-zinc-500"><Icon className="h-2.5 w-2.5" /> {RIRI_MODELS[t.model].name}</span>
                              <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${t.mode === "live" ? "text-emerald-600" : "text-zinc-400"}`}>{t.mode === "live" ? "Live data" : "Simulated"}</span>
                              {t.route === "llm" && <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-bold text-violet-700">WRITTEN BY RIRI</span>}
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
              <div className="flex items-center gap-1.5 rounded-xl border border-zinc-900/15 bg-white/80 px-2 focus-within:border-[color:var(--brand)]">
                {voice.supported && (
                  <button
                    onClick={() => voice.listen()}
                    title={voice.listening ? "Stop listening" : "Talk to Riri"}
                    aria-label={voice.listening ? "Stop listening" : "Talk to Riri"}
                    className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
                      voice.listening ? "text-white" : "text-zinc-400 hover:bg-zinc-900/5 hover:text-zinc-700"
                    }`}
                    style={voice.listening ? { backgroundColor: "var(--brand)" } : undefined}
                  >
                    <Mic className="h-4 w-4" />
                    {voice.listening && <span className="absolute inset-0 rounded-lg riri-halo" style={{ background: "var(--brand)", opacity: 0.35 }} />}
                  </button>
                )}
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), ask(input))}
                  placeholder={voice.listening ? "Listening…" : placeholderFor[model]}
                  className="flex-1 bg-transparent py-2.5 text-[13px] outline-none placeholder:text-zinc-400"
                />
                <button onClick={() => ask(input)} disabled={busy || !input.trim()}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white disabled:opacity-40" style={{ backgroundColor: "var(--brand)" }} aria-label="Send">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                </button>
              </div>

              {/* Voice/consent settings moved to the Account panel (the person icon,
                  top-right) — one home for settings. Speaking still shows here so a
                  talking Riri is never mysterious. */}
              <p className="mt-1 text-center text-[9px] text-zinc-400">
                {voice.speaking ? "Speaking… · " : ""}Riri can be wrong — verify figures before acting · Powered by BirgenAI
              </p>
            </div>
            </>)}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Launcher */}
      <div
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
        style={{ ...pos, width: SIZE, height: SIZE, touchAction: "none", transition: drag ? "none" : "left .38s cubic-bezier(.22,1,.36,1), top .38s cubic-bezier(.22,1,.36,1)" }}
        className="no-print fixed z-[9999] cursor-grab active:cursor-grabbing select-none"
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
