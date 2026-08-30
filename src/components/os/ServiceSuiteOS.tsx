"use client";

// ─────────────────────────────────────────────────────────────────────────────
// SERVICESUITE OS — the assistant, operated as a handset.
//
// This replaces RiriDock. Three things changed and each one is a correction, not
// a coat of paint.
//
// 1. THE THREE MODELS ARE GONE FROM THE SURFACE.
//    The home screen used to be Support / Assistant / Analytics — our architecture,
//    drawn as app icons, asking every lender to classify their own question into
//    our taxonomy before they could type it. Now there is ONE conversation, and a
//    pure deterministic router (lib/riri/router.ts) picks the engine from the
//    finished question. The safety property the tiles existed to protect — a
//    request for a hard number must not reach an engine that reasons one up — is
//    stronger for being tested instead of trusted to a finger, and every answer is
//    stamped with which engine ran and what it stood on.
//
// 2. IT IS A DEVICE, WITH A REAL NAVIGATION STACK.
//    Back used to mean "go home", because there was no stack — every screen was
//    one level deep. Now Back pops exactly one level, the shell derives its own
//    chrome from the depth so a screen cannot forget to render one, and the home
//    button is a physical control rather than a gesture nobody discovers with a
//    mouse.
//
// 3. IT DOES THE THINGS A PHONE DOES.
//    Conversations that survive Monday, a tray of counted facts off the live book,
//    and a dialler that tells you who a number belongs to and what they owe before
//    it rings.
//
// WHAT DID NOT CHANGE, deliberately: Autopilot is still opt-in, still navigation
// only, and still stops at the door. It can take you to the disbursement screen;
// it cannot press the button when it gets there. Speech recognition mishears, and
// in a lending system the gap between "show me" and "send it" is one syllable.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import { X, Navigation, PenLine, UserRound } from "lucide-react";
import { useVoice } from "@/lib/hooks/useVoice";
import { RiriAvatar } from "@/components/riri/RiriAvatar";
import { ASSISTANT_NAME } from "@/lib/riri/brand";
import { normaliseModelId } from "@/lib/riri/models";
import { PhoneShell } from "./PhoneShell";
import { LockScreen } from "./LockScreen";
import { useOsNav, ROUTE_TITLES, type Route } from "./nav";
import { appFor } from "./apps";
import { HomeScreen } from "./screens/Home";
import { AskScreen, AskComposer, type Turn, type Action } from "./screens/Ask";
import { ChatsScreen } from "./screens/Chats";
import { AlertsScreen } from "./screens/Alerts";
import { CallsScreen } from "./screens/Calls";
import { FindScreen } from "./screens/Find";
import { SettingsScreen } from "./screens/Settings";
import { TodayScreen, type TodayKind } from "./screens/Today";
import type { TodayPayload } from "@/app/api/console/riri/today/route";
import type { Signal } from "@/lib/riri/signals";
import type { ThreadSummary, StoredMessage } from "@/lib/riri/threads";
import type { LookupMatch } from "@/app/api/console/riri/lookup/route";
import type { Engine } from "@/lib/riri/router";

const INSET = 16;
const SIZE = 60;
const GAP = 12;

// ── Two external things React needs to read: the browser, and its size ────────
// Both via useSyncExternalStore rather than setState-in-an-effect: the effect
// version costs an extra render on every mount, and an effect should SUBSCRIBE to
// an external system, not copy it into state on arrival.
const subscribeNothing = () => () => {};

function pref(key: string): string | null {
  if (typeof window === "undefined") return null;
  try { return localStorage.getItem(key); } catch { return null; }
}
const setPref = (key: string, v: string) => { try { localStorage.setItem(key, v); } catch { /* private mode */ } };

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

export default function ServiceSuiteOS({ orgName, userName }: { orgName: string; userName?: string | null }) {
  const mounted = useSyncExternalStore(subscribeNothing, () => true, () => false);
  const vp = useSyncExternalStore(subscribeViewport, viewportSnapshot, () => VP_SERVER);

  // Prefs restored in the INITIALISER, not an effect. Safe despite SSR because the
  // OS renders null until `mounted`, so the server's markup depends on none of them.
  const [open, setOpen] = useState(() => pref("riri:open") === "1");
  const [corner, setCorner] = useState<"br" | "bl">(() => (pref("riri:corner") === "bl" ? "bl" : "br"));
  const [greet, setGreet] = useState(() => pref("riri:greeted") !== "1");
  const [voiceOn, setVoiceOn] = useState(() => pref("riri:voice") === "1");
  const [autoGo, setAutoGo] = useState(() => pref("riri:autogo") === "1");
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);

  // THE PHONE OPENS LOCKED, AND RE-LOCKS WHEN IT IS PUT AWAY.
  //
  // Not security — the session is the security, and every figure on the lock screen
  // was authorised on the server before it was printed. It is that the briefing is
  // the product: the whole argument for a handset in a lending console is that it
  // tells you what today is before you ask it anything, and a lock screen you have
  // to go looking for is a briefing nobody reads. Opening costs one swipe.
  //
  // A caller that arrives WITH an intent — a sidebar link, a "talk about this
  // customer" button — unlocks on the way in. They already said where they were
  // going; making them swipe past a briefing to get there would be theatre.
  const [locked, setLocked] = useState(true);

  const nav = useOsNav();
  const router = useRouter();

  // ── Conversation ───────────────────────────────────────────────────────────
  const [turns, setTurns] = useState<Turn[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pinned, setPinned] = useState<{ id: string; name: string } | null>(null);
  const [flight, setFlight] = useState<string | null>(null);
  const subjectRef = useRef<{ kind: string; id: string; name?: string } | null>(null);

  // ── Chats ──────────────────────────────────────────────────────────────────
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [historyOn, setHistoryOn] = useState(true);

  // ── Alerts ─────────────────────────────────────────────────────────────────
  const [signals, setSignals] = useState<Signal[]>([]);
  const [badge, setBadge] = useState(0);
  const [signalsLoading, setSignalsLoading] = useState(false);
  const [signalsAt, setSignalsAt] = useState<string | null>(null);
  const [scope, setScope] = useState<string | null>(null);

  // ── Today (due / arrears / promises) ───────────────────────────────────────
  // One payload behind three apps AND the lock screen, because they are three
  // slices of one morning and four independent fetches of the same three counts
  // is four chances for the badge to disagree with the screen it opens.
  const [today, setToday] = useState<TodayPayload | null>(null);
  const [todayLoading, setTodayLoading] = useState(false);

  const askRef = useRef<(q: string, engine?: Engine) => void>(() => {});
  const openOnRef = useRef<(id: string, name: string) => void>(() => {});
  const voice = useVoice({ onTranscript: (text) => askRef.current(text) });

  const dismissGreet = () => { setGreet(false); setPref("riri:greeted", "1"); };

  /**
   * Put the phone away — and re-lock it on the way down.
   *
   * The re-lock happens HERE, in the one action that closes the device, rather than
   * in an effect watching `open`. An effect would be a setState synchronously
   * inside an effect body, which is a cascading render and is banned by this
   * project's hooks rules for exactly that reason. Closing is an event; treating it
   * as one keeps the state change where the intent is.
   */
  const closeDevice = useCallback(() => { setOpen(false); setLocked(true); }, []);

  useEffect(() => { setPref("riri:corner", corner); }, [corner]);
  useEffect(() => { setPref("riri:open", open ? "1" : "0"); }, [open]);
  useEffect(() => { setPref("riri:voice", voiceOn ? "1" : "0"); }, [voiceOn]);
  useEffect(() => { setPref("riri:autogo", autoGo ? "1" : "0"); }, [autoGo]);

  useEffect(() => {
    if (!flight) return;
    const t = window.setTimeout(() => setFlight(null), 2600);
    return () => window.clearTimeout(t);
  }, [flight]);

  // ── Loaders ────────────────────────────────────────────────────────────────

  const loadSignals = useCallback(async () => {
    setSignalsLoading(true);
    try {
      const r = await fetch("/api/console/riri/signals");
      const d = await r.json();
      if (d.success) { setSignals(d.signals ?? []); setBadge(d.badge ?? 0); setSignalsAt(d.at ?? null); setScope(d.scope ?? null); }
    } catch { /* the tray simply stays as it was */ }
    finally { setSignalsLoading(false); }
  }, []);

  const loadToday = useCallback(async () => {
    setTodayLoading(true);
    try {
      const r = await fetch("/api/console/riri/today");
      const d = await r.json();
      if (d.success) setToday(d as TodayPayload);
    } catch { /* the figures simply stay as they were */ }
    finally { setTodayLoading(false); }
  }, []);

  const loadThreads = useCallback(async () => {
    setThreadsLoading(true);
    try {
      const r = await fetch("/api/console/riri/threads");
      const d = await r.json();
      if (d.success) { setThreads(d.threads ?? []); setHistoryOn(d.available !== false); }
    } catch { /* an empty list is a fine list */ }
    finally { setThreadsLoading(false); }
  }, []);

  // THE TRAY IS READ ONCE, THEN ON OPEN — never on a timer.
  //
  // Once on mount because a badge that only appears after you open the panel is a
  // badge nobody sees, and the whole value of a tray is being told before you
  // thought to ask. Deferred past first paint so it never competes with the page
  // the officer actually navigated to. And never polled: a repeating query behind
  // a closed panel is work nobody asked for, on a database somebody is lending from.
  //
  // Every fetch is kicked off INSIDE a timer, never in the effect body — the same
  // rule the customer finder follows. A loader that flips a spinner flag
  // synchronously during an effect is a cascading render, and this one would fire
  // on every route change in the console.
  useEffect(() => {
    const t = window.setTimeout(() => void loadSignals(), 1200);
    return () => window.clearTimeout(t);
  }, [loadSignals]);

  // The morning figures are warmed a beat behind the tray, so the FIRST open of
  // the device already has them on the glass. A lock screen that appears and then
  // grows three numbers a half-second later is a lock screen that looks like it is
  // still thinking — and this one's whole job is to have finished thinking.
  useEffect(() => {
    const t = window.setTimeout(() => void loadToday(), 1900);
    return () => window.clearTimeout(t);
  }, [loadToday]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => { void loadSignals(); void loadToday(); }, 0);
    return () => window.clearTimeout(t);
  }, [open, loadSignals, loadToday]);

  const onChats = nav.route.name === "chats";
  useEffect(() => {
    if (!open || !onChats) return;
    const t = window.setTimeout(() => void loadThreads(), 0);
    return () => window.clearTimeout(t);
  }, [open, onChats, loadThreads]);

  // ── Asking ─────────────────────────────────────────────────────────────────

  const ask = useCallback(async (q: string, forceEngine?: Engine) => {
    const question = q.trim();
    if (!question || busy) return;

    // A question asked from anywhere lands in the conversation, and the conversation
    // is what comes to the front. The voice hook in particular can fire from the
    // home screen, and an answer arriving on a screen that cannot show it is a lost
    // answer.
    if (nav.route.name !== "ask") nav.push({ name: "ask", threadId });

    const id = crypto.randomUUID();
    setTurns((t) => [...t, { id, question, loading: true }]);
    setInput("");
    setBusy(true);

    const patch = (fn: (x: Turn) => Turn) => setTurns((t) => t.map((x) => (x.id === id ? fn(x) : x)));

    try {
      // The whole conversation rides along so "what about last month?" has an
      // antecedent. The server sanitises and caps it (sanitizeHistory).
      const history = turns.flatMap((t) => [
        ...(t.question ? [{ role: "user" as const, text: t.question }] : []),
        ...(t.answer ? [{ role: "model" as const, text: t.answer }] : []),
      ]);

      const res = await fetch("/api/console/riri", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          // "auto" is the whole point: the router decides. An explicit engine only
          // arrives from a one-tap correction or a legacy deep link.
          model: forceEngine ?? "auto",
          threadId,
          ...(voice.lang === "sw-KE" ? { lang: "sw" } : {}),
          ...(subjectRef.current ? { subject: subjectRef.current } : {}),
          ...(history.length ? { history } : {}),
        }),
      });
      const data = await res.json();

      patch((x) => (data.success
        ? {
            ...x, loading: false, answer: data.answer,
            engine: data.engine, engineLabel: data.engineLabel, engineWhy: data.engineWhy,
            evidence: data.evidence, confidence: data.confidence, alternative: data.alternative,
            routed: data.routed,
            chips: data.chips, series: data.series, table: data.table, mode: data.mode,
            sql: data.sql, rows: data.rows, ms: data.ms, route: data.route,
            actions: data.actions ?? [], suggestions: data.suggestions ?? [],
          }
        : { ...x, loading: false, error: data.message || `${ASSISTANT_NAME} couldn't answer that.` }));

      if (data.success) {
        if (data.threadId && data.threadId !== threadId) setThreadId(data.threadId);
        if (voiceOn) void voice.speak(data.answer as string);

        // AUTOPILOT. Opt-in, navigation only, and PLATFORM ANSWERS ONLY.
        //
        // It can take you to a screen; it cannot press the button when it gets
        // there. The engine check is not decoration: the only other answer that
        // carries an action is the paywall, and silently teleporting somebody to
        // the billing page because they asked what their PAR was would be the
        // rudest thing this product does.
        const first: Action | undefined = (data.actions ?? [])[0];
        if (autoGo && data.engine === "support" && first?.href) {
          setFlight(first.label);
          router.push(first.href);
        }
      }
    } catch {
      patch((x) => ({ ...x, loading: false, error: "Network error. Try again." }));
    } finally { setBusy(false); }
  }, [busy, nav, threadId, turns, voice, voiceOn, autoGo, router]);

  /** Start over: a fresh thread, nothing carried across. */
  const newConversation = useCallback(() => {
    setTurns([]); setThreadId(null); setInput(""); setPinned(null);
    subjectRef.current = null;
    nav.push({ name: "ask" });
  }, [nav]);

  /** Replay a saved conversation into the live thread and continue it. */
  const openThread = useCallback(async (t: ThreadSummary) => {
    nav.push({ name: "ask", threadId: t.id });
    setThreadId(t.id);
    setTurns([{ id: "loading", question: "", loading: true }]);
    setPinned(t.subjectId && t.subjectName ? { id: t.subjectId, name: t.subjectName } : null);
    subjectRef.current = t.subjectId ? { kind: "borrower", id: t.subjectId, name: t.subjectName ?? undefined } : null;
    try {
      const r = await fetch(`/api/console/riri/threads/${t.id}`);
      const d = await r.json();
      if (!d.success) { setTurns([{ id: "e", question: "", loading: false, error: "Could not open that conversation." }]); return; }

      // Rebuild turns by pairing each user message with the answer that followed.
      // The transcript is stored as a flat list because that is what it is; the UI
      // is a question-and-answer, so the pairing happens here rather than in the
      // table, where an assistant message with no question (a welcome, a briefing)
      // would have had nowhere to live.
      const msgs: StoredMessage[] = d.messages ?? [];
      const rebuilt: Turn[] = [];
      for (const m of msgs) {
        if (m.role === "user") {
          rebuilt.push({ id: m.id, question: m.body, loading: false });
        } else {
          const data = (m.data ?? {}) as Record<string, unknown>;
          const target = rebuilt.length && !rebuilt[rebuilt.length - 1].answer ? rebuilt[rebuilt.length - 1] : null;
          const turn: Turn = {
            id: m.id,
            question: target?.question ?? "",
            loading: false,
            answer: m.body,
            engine: (m.engine as Engine) ?? undefined,
            engineLabel: m.engine ? { support: "Platform", assistant: "Judgement", analytics: "Live book" }[m.engine as Engine] : undefined,
            evidence: undefined,
            sql: m.sql,
            route: m.route ?? undefined,
            chips: (data.chips as Turn["chips"]) ?? null,
            series: (data.series as Turn["series"]) ?? null,
            table: (data.table as Turn["table"]) ?? null,
            rows: (data.rows as number | null) ?? null,
            ms: (data.ms as number | null) ?? null,
            actions: (data.actions as Action[]) ?? [],
            suggestions: (data.suggestions as string[]) ?? [],
          };
          if (target) rebuilt[rebuilt.length - 1] = turn; else rebuilt.push(turn);
        }
      }
      setTurns(rebuilt);
    } catch {
      setTurns([{ id: "e", question: "", loading: false, error: "Could not reach the server." }]);
    }
  }, [nav]);

  /** Open on a customer: pin them, and read what we hold about them. */
  const openOnCustomer = useCallback(async (id: string, name: string) => {
    subjectRef.current = { kind: "borrower", id, name };
    setPinned({ id, name });
    nav.push({ name: "ask", threadId });
    const turnId = crypto.randomUUID();
    setTurns((t) => [...t, { id: turnId, question: "", loading: true }]);
    try {
      const res = await fetch("/api/console/riri/brief", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "borrower", id }),
      });
      const data = await res.json();
      setTurns((t) => t.map((x) => (x.id === turnId
        ? (data.success
            ? { ...x, loading: false, answer: data.answer, engine: "assistant" as Engine, engineLabel: "Record", evidence: "Read from their file — not reasoned", mode: "live" as const, route: "record" }
            : { ...x, loading: false, error: data.message || "Could not read that customer." })
        : x)));
    } catch {
      setTurns((t) => t.map((x) => (x.id === turnId ? { ...x, loading: false, error: "Network error. Try again." } : x)));
    }
  }, [nav, threadId]);

  useEffect(() => { askRef.current = ask; openOnRef.current = openOnCustomer; });

  // The mount-only listeners below reach for whichever nav exists NOW, so it is
  // held in a ref re-pointed after every render. A ref written during render is a
  // write to something React may not have committed yet, so it happens in an effect.
  const navRef = useRef(nav);
  useEffect(() => { navRef.current = nav; });
  const openAsk = useCallback(() => navRef.current.launch({ name: "ask" }), []);

  // ── Opening from anywhere in the console ───────────────────────────────────
  // Any element with [data-riri-open] (optionally naming a legacy model id), or a
  // window "riri:open" event. A caller that names a customer lands in a
  // conversation pinned to them, not on a home screen.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.("[data-riri-open]");
      if (!el) return;
      e.preventDefault();
      setOpen(true); setLocked(false); dismissGreet();
      // The attribute used to choose a MODEL. There is one conversation now, so a
      // named model is honoured as "open the conversation" and the router decides
      // the rest — the old attributes keep working without meaning what they said.
      openAsk();
    };
    const onEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail ?? {};
      setOpen(true); setLocked(false); dismissGreet();
      const s = detail.subject;
      const named = s && typeof s.id === "string" && typeof s.kind === "string";
      openAsk();
      if (named) void openOnRef.current(s.id, typeof s.label === "string" ? s.label : "this customer");
      if (typeof detail.prompt === "string" && detail.prompt.trim()) {
        window.setTimeout(() => askRef.current(detail.prompt.trim()), 340);
      }
      // Legacy callers still send a model id; it is accepted and ignored on purpose.
      void normaliseModelId(detail.model);
    };
    // Escape closes AND re-locks, same as the close button — the two ways out of
    // the device must not leave it in two different states.
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); setLocked(true); } };

    document.addEventListener("click", onClick);
    window.addEventListener("riri:open", onEvent as EventListener);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      window.removeEventListener("riri:open", onEvent as EventListener);
      window.removeEventListener("keydown", onKey);
    };
  }, [openAsk]);

  // ── The launcher ───────────────────────────────────────────────────────────
  const anchorLeft = corner === "br" ? vp.w - INSET - SIZE : INSET;
  const anchorTop = vp.h - INSET - SIZE;
  const pos = drag ? { left: drag.x, top: drag.y } : { left: anchorLeft, top: anchorTop };
  const down = useRef<{ x: number; y: number; moved: boolean } | null>(null);

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
    if (!d.moved) { if (open) closeDevice(); else setOpen(true); dismissGreet(); return; }
    setCorner(e.clientX < vp.w / 2 ? "bl" : "br");
    setDrag(null);
  };

  if (!mounted) return null;

  const sideStyle = corner === "br" ? { right: INSET } : { left: INSET };
  const panelBottom = INSET + SIZE + GAP;
  const app = nav.route.name === "home" ? null : appFor(nav.route.name);

  const title = nav.route.name === "home" ? ASSISTANT_NAME : (app?.name ?? ROUTE_TITLES[nav.route.name]);
  const subtitle =
    nav.route.name === "home" ? orgName
      : nav.route.name === "ask" ? (pinned ? `On ${pinned.name}` : turns.length ? "In conversation" : "Ready")
        : nav.route.name === "alerts" ? `${signals.length} thing${signals.length === 1 ? "" : "s"} on your book`
          : nav.route.name === "chats" ? `${threads.length} saved`
            // The morning three put the FIGURE in the status bar, not a description.
            // On these screens the subtitle is the answer, and repeating the blurb
            // under the title would be the one line of chrome that says nothing.
            : nav.route.name === "due" ? (today ? `${today.due.amount} across ${today.due.count}` : "Reading your book…")
              : nav.route.name === "arrears" ? (today ? `${today.arrears.amount} over ${today.arrears.count}` : "Reading your book…")
                : nav.route.name === "promises" ? (today ? `${today.promises.count} due today` : "Reading your book…")
                  : app?.blurb ?? "";

  return (
    <>
      {/* First-run nudge */}
      <AnimatePresence>
        {greet && !open && (
          <motion.button
            initial={{ opacity: 0, y: 10, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
            transition={{ type: "spring", stiffness: 400, damping: 28 }}
            onClick={() => { setOpen(true); dismissGreet(); }}
            style={{ ...sideStyle, bottom: panelBottom }}
            className="no-print glass fixed z-[9998] max-w-[248px] rounded-2xl bg-paper/85 px-3.5 py-2.5 text-left shadow-xl"
          >
            <p className="text-[13px] font-semibold text-ash-900">
              Hi{userName ? `, ${userName.split(" ")[0]}` : ""} 👋 I&apos;m {ASSISTANT_NAME}
            </p>
            <p className="mt-0.5 text-[11px] leading-snug text-ash-500">
              Ask me anything about {orgName} — how it works, what your numbers say, or what to do next.
              One place, and I&apos;ll work out which is which.
            </p>
            <span
              onClick={(e) => { e.stopPropagation(); dismissGreet(); }}
              className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-invert text-invert-fg"
              aria-label="Dismiss"
            >
              <X className="h-3 w-3" />
            </span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* THE DEVICE */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="os-device"
            initial={{ opacity: 0, scale: 0.9, y: 14 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.94, y: 10 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            role="dialog" aria-label={ASSISTANT_NAME}
            style={{
              ...sideStyle, bottom: panelBottom,
              transformOrigin: corner === "br" ? "bottom right" : "bottom left",
              width: "min(400px, calc(100vw - 24px))",
              height: "min(708px, calc(100vh - 116px))",
            }}
            className="no-print fixed z-[9998]"
          >
            <PhoneShell
              cover={
                locked ? (
                  <LockScreen
                    orgName={orgName}
                    userName={userName}
                    signals={signals}
                    today={today}
                    scope={scope}
                    loading={signalsLoading || todayLoading}
                    onUnlock={() => setLocked(false)}
                    onOpen={(r) => { setLocked(false); nav.launch(r); }}
                    onSignal={(s) => { setLocked(false); setFlight(s.actionLabel); router.push(s.href); }}
                  />
                ) : undefined
              }
              title={title}
              subtitle={subtitle}
              atHome={nav.atHome}
              onBack={nav.atHome ? null : nav.pop}
              backLabel={nav.backLabel}
              onHome={nav.home}
              onClose={closeDevice}
              busy={busy && nav.route.name === "ask"}
              accent={app?.tile ?? null}
              leading={
                <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full shadow ring-2 ring-white">
                  <RiriAvatar size={36} state={busy ? "thinking" : "listening"} />
                </div>
              }
              action={
                nav.route.name === "ask" ? (
                  <div className="flex shrink-0 items-center gap-1">
                    {/* Autopilot lives where answers end in a destination. */}
                    <button
                      onClick={() => setAutoGo((v) => !v)}
                      title={autoGo ? "Autopilot on — I move the screen when I answer" : "Autopilot off — I offer a button, you tap it"}
                      aria-pressed={autoGo}
                      className={`flex h-7 items-center gap-1 rounded-full px-2 text-[10px] font-bold transition-colors ${
                        autoGo ? "text-white shadow-sm" : "bg-ash-900/5 text-ash-500 hover:text-ash-800"
                      }`}
                      style={autoGo ? { backgroundColor: "var(--brand)" } : undefined}
                    >
                      <Navigation className={`h-3 w-3 ${autoGo ? "dock-pulse" : ""}`} /> AUTO
                    </button>
                    {turns.length > 0 && (
                      <button
                        onClick={newConversation}
                        title="Start a new conversation"
                        aria-label="Start a new conversation"
                        className="flex h-7 w-7 items-center justify-center rounded-full text-ash-400 hover:bg-ash-900/5 hover:text-ash-900"
                      >
                        <PenLine className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ) : nav.route.name === "home" ? (
                  <button
                    onClick={() => nav.push({ name: "settings" })}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ash-500 transition-colors hover:bg-ash-900/5 hover:text-ash-900"
                    aria-label="Account and settings"
                  >
                    <UserRound className="h-4 w-4" />
                  </button>
                ) : null
              }
              footer={
                nav.route.name === "ask" ? (
                  <AskComposer
                    input={input}
                    busy={busy}
                    autoGo={autoGo}
                    placeholder="Ask anything about your book or the platform…"
                    voice={{ supported: voice.supported, listening: voice.listening, speaking: voice.speaking, listen: () => voice.listen() }}
                    onInput={setInput}
                    onAsk={(q) => void ask(q)}
                  />
                ) : null
              }
            >
              <AnimatePresence mode="wait" initial={false}>
                {nav.route.name === "home" && (
                  <HomeScreen
                    key="home"
                    orgName={orgName}
                    userName={userName}
                    signals={signals}
                    badge={badge}
                    counts={today ? { due: today.due.count, arrears: today.arrears.count, promises: today.promises.count } : null}
                    lastRoute={null}
                    onOpen={(r: Route) => nav.launch(r)}
                    onSignal={(s) => { setFlight(s.actionLabel); router.push(s.href); }}
                  />
                )}

                {nav.route.name === "ask" && (
                  <AskScreen
                    key="ask"
                    turns={turns}
                    pinned={pinned}
                    flight={flight}
                    onAsk={(q) => void ask(q)}
                    onReask={(q, engine) => void ask(q, engine)}
                    onUnpin={() => { setPinned(null); subjectRef.current = null; }}
                    onNavigate={(href) => { setFlight(null); router.push(href); }}
                  />
                )}

                {nav.route.name === "chats" && (
                  <ChatsScreen
                    key="chats"
                    threads={threads}
                    loading={threadsLoading}
                    available={historyOn}
                    onOpen={(t) => void openThread(t)}
                    onNew={newConversation}
                    onPin={async (t) => {
                      setThreads((ts) => ts.map((x) => (x.id === t.id ? { ...x, pinned: !x.pinned } : x)));
                      await fetch(`/api/console/riri/threads/${t.id}`, {
                        method: "PATCH", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ pinned: !t.pinned }),
                      }).catch(() => void loadThreads());
                    }}
                    onDelete={async (t) => {
                      setThreads((ts) => ts.filter((x) => x.id !== t.id));
                      if (threadId === t.id) { setThreadId(null); setTurns([]); }
                      await fetch(`/api/console/riri/threads/${t.id}`, { method: "DELETE" }).catch(() => void loadThreads());
                    }}
                  />
                )}

                {nav.route.name === "alerts" && (
                  <AlertsScreen
                    key="alerts"
                    signals={signals}
                    loading={signalsLoading}
                    scope={scope}
                    at={signalsAt}
                    onRefresh={() => void loadSignals()}
                    onOpen={(s) => { setFlight(s.actionLabel); router.push(s.href); }}
                  />
                )}

                {(nav.route.name === "due" || nav.route.name === "arrears" || nav.route.name === "promises") && (
                  <TodayScreen
                    key={nav.route.name}
                    kind={nav.route.name as TodayKind}
                    data={today}
                    loading={todayLoading}
                    onRefresh={() => void loadToday()}
                    onOpenCustomer={(id, name) => void openOnCustomer(id, name)}
                    onNavigate={(href) => { setFlight(null); router.push(href); }}
                  />
                )}

                {nav.route.name === "calls" && (
                  <CallsScreen key="calls" onOpenCustomer={(id, name) => void openOnCustomer(id, name)} />
                )}

                {nav.route.name === "find" && (
                  <FindScreen key="find" onOpen={(m: LookupMatch) => void openOnCustomer(m.id, m.name)} />
                )}

                {nav.route.name === "settings" && (
                  <SettingsScreen
                    key="settings"
                    voiceOn={voiceOn}
                    onVoice={() => { if (voice.speaking) voice.stopSpeaking(); setVoiceOn((v) => !v); }}
                    autoGo={autoGo}
                    onAutoGo={() => setAutoGo((v) => !v)}
                    lang={voice.lang}
                    onLang={() => voice.setLang(voice.lang === "en-KE" ? "sw-KE" : "en-KE")}
                    speaking={voice.speaking}
                    corner={corner}
                    onCorner={() => setCorner((c) => (c === "br" ? "bl" : "br"))}
                    historyAvailable={historyOn}
                    threadCount={threads.length}
                    onClearHistory={async () => {
                      await fetch("/api/console/riri/threads?confirm=all", { method: "DELETE" });
                      setThreads([]); setThreadId(null);
                    }}
                  />
                )}
              </AnimatePresence>
            </PhoneShell>
          </motion.div>
        )}
      </AnimatePresence>

      {/* THE LAUNCHER */}
      <div
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
        style={{ ...pos, width: SIZE, height: SIZE, touchAction: "none", transition: drag ? "none" : "left .38s cubic-bezier(.22,1,.36,1), top .38s cubic-bezier(.22,1,.36,1)" }}
        className="no-print fixed z-[9999] cursor-grab select-none active:cursor-grabbing"
        title={open ? `Close ${ASSISTANT_NAME}` : `Open ${ASSISTANT_NAME}`}
      >
        {!open && <span className="riri-halo pointer-events-none absolute inset-0 rounded-full" style={{ background: "var(--brand)", opacity: 0.25 }} />}
        <div className={`relative h-full w-full rounded-full shadow-2xl ring-2 ring-white ${open ? "" : "riri-float"}`} style={{ boxShadow: "0 12px 32px rgba(0,0,0,.22)" }}>
          <div className="h-full w-full overflow-hidden rounded-full">
            <RiriAvatar size={SIZE} state={busy ? "thinking" : "idle"} />
          </div>
          {open ? (
            <span className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-invert text-invert-fg ring-2 ring-white">
              <X className="h-3.5 w-3.5" />
            </span>
          ) : badge > 0 ? (
            <span className="os-badge absolute -right-1 -top-1 flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-rose-500 px-1 text-[11px] font-bold text-white ring-2 ring-white">
              {badge > 99 ? "99+" : badge}
            </span>
          ) : (
            <span className="absolute bottom-0.5 right-0.5 h-3.5 w-3.5 rounded-full bg-emerald-500 ring-2 ring-white" />
          )}
          {busy && !open && (
            <span className="riri-orbit-dot pointer-events-none absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ backgroundColor: "var(--brand)" }} />
          )}
        </div>
      </div>
    </>
  );
}
