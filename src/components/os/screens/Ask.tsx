"use client";

// ─────────────────────────────────────────────────────────────────────────────
// ASK — the one conversation.
//
// THE STAMP IS THE POINT. Under the old dock the lender chose the engine, so the
// tier was on the screen before they typed. Now the router chooses, which means
// the ANSWER has to say what stood behind it — and it does, on every single turn:
//
//   Platform     read from the console's own screens and rules
//   Judgement    reasoned from records; verify figures before acting
//   Live book    queried, and the SQL is right there
//
// That is a better contract than the tiles ever were. A tile told you which engine
// you had SELECTED; the stamp tells you which engine ANSWERED, and attaches its
// evidence. A number now arrives with its query whether or not anybody thought to
// go looking for it.
//
// AND WHEN IT IS UNSURE IT SAYS SO, in one tap. "I read that as a question about
// the platform — I meant it about my book" re-asks the same words down the other
// path. That is the recovery the switcher never had: under a switcher, a
// misrouted question was a wrong answer you had to notice, retype and resend.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send, Loader2, AlertCircle, Mic, ArrowRight, Pin, Repeat2,
  LifeBuoy, Bot, Gauge, Zap,
} from "lucide-react";
import { RichText, Chips, Sparkline, MiniTable, ExportBar, SqlDisclosure, Screen, type Chip, type Series, type Table } from "../kit";
import { RiriAvatar } from "@/components/riri/RiriAvatar";
import { ASSISTANT_NAME } from "@/lib/riri/brand";
import type { Engine } from "@/lib/riri/router";

export type Action = { kind: "navigate"; label: string; href: string };

export type Turn = {
  id: string;
  question: string;
  loading: boolean;
  answer?: string;
  error?: string;
  engine?: Engine;
  engineLabel?: string;
  engineWhy?: string | null;
  evidence?: string;
  confidence?: "certain" | "likely" | "unsure";
  alternative?: { engine: Engine; label: string } | null;
  routed?: boolean;
  chips?: Chip[] | null;
  series?: Series | null;
  table?: Table | null;
  mode?: "live" | "simulation";
  sql?: string | null;
  rows?: number | null;
  ms?: number | null;
  route?: string;
  actions?: Action[];
  suggestions?: string[];
};

const ENGINE_ICON: Record<Engine, typeof Bot> = { support: LifeBuoy, assistant: Bot, analytics: Gauge };
const ENGINE_TINT: Record<Engine, string> = {
  support: "bg-sky-50 text-sky-700 ring-sky-200",
  assistant: "bg-violet-50 text-violet-700 ring-violet-200",
  analytics: "bg-emerald-50 text-emerald-700 ring-emerald-200",
};

/**
 * The opening deck.
 *
 * Grouped by WHAT YOU WANT, not by which engine serves it — and the grouping is a
 * quiet demonstration that you no longer have to know. Three columns of question,
 * one box to type them in.
 */
const DECK: { label: string; prompts: string[] }[] = [
  {
    label: "Find your way around",
    prompts: [
      "Take me to where we write our credit policy",
      "Why can't I disburse this loan?",
      "Who can see whose customers?",
      "What do I do next?",
    ],
  },
  {
    label: "Ask the book a number",
    prompts: [
      "What's my outstanding loan book?",
      "What's my PAR 30 by product?",
      "How much did we collect last month?",
      "Top 5 borrowers by balance",
    ],
  },
  {
    label: "Ask for a read",
    prompts: [
      "Who should I chase first today?",
      "Can I give this customer a top-up?",
      "Draft the call for a customer 12 days late",
      "Is my book drifting?",
    ],
  },
];

export function AskScreen({
  turns, pinned, flight, onAsk, onReask, onUnpin, onNavigate,
}: {
  turns: Turn[];
  pinned: { id: string; name: string } | null;
  flight: string | null;
  onAsk: (q: string) => void;
  onReask: (q: string, engine: Engine) => void;
  onUnpin: () => void;
  onNavigate: (href: string) => void;
}) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [turns]);

  return (
    <Screen from="right" pad={false} className="min-h-0">
      {/* Pinned customer — the whole conversation is about them until it isn't. */}
      <AnimatePresence>
        {pinned && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="shrink-0 overflow-hidden px-3"
          >
            <div className="mb-1.5 flex items-center gap-1.5 rounded-lg px-2 py-1.5" style={{ backgroundColor: "var(--brand-soft)" }}>
              <Pin className="h-3 w-3 shrink-0" style={{ color: "var(--brand)" }} />
              <p className="min-w-0 flex-1 truncate text-[11px] font-semibold text-zinc-700">
                Every question is about {pinned.name}
              </p>
              <button onClick={onUnpin} className="shrink-0 rounded px-1 text-[10px] font-semibold text-zinc-500 hover:text-zinc-800">
                Unpin
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3">
        {turns.length === 0 ? (
          <div className="space-y-3.5">
            <div>
              <p className="text-[12.5px] font-semibold leading-tight text-zinc-800">What do you need?</p>
              <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">
                One place for all three — how the platform works, what your numbers say, and what you should do about it.
                I&apos;ll work out which is which.
              </p>
            </div>
            {DECK.map((g, gi) => (
              <motion.div
                key={g.label}
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: gi * 0.06, duration: 0.3 }}
              >
                <p className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-zinc-400">{g.label}</p>
                <div className="mt-1.5 space-y-1">
                  {g.prompts.map((p) => (
                    <button
                      key={p}
                      onClick={() => onAsk(p)}
                      className="group flex w-full items-center gap-2 rounded-xl border border-zinc-900/[0.07] bg-white/75 px-2.5 py-2 text-left text-[11.5px] leading-snug text-zinc-700 transition-colors hover:border-[color:var(--brand)] hover:bg-white hover:text-zinc-900"
                    >
                      <span className="min-w-0 flex-1">{p}</span>
                      <ArrowRight className="h-3 w-3 shrink-0 text-zinc-300 transition-colors group-hover:text-[color:var(--brand)]" />
                    </button>
                  ))}
                </div>
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {turns.map((t) => {
              const Glyph = t.engine ? ENGINE_ICON[t.engine] : Bot;
              return (
                <div key={t.id} className="space-y-2.5">
                  {t.question && (
                    <div className="flex justify-end">
                      <div className="max-w-[85%] rounded-2xl rounded-br-sm px-3 py-2 text-[13px] text-white shadow-sm" style={{ backgroundColor: "var(--brand)" }}>
                        {t.question}
                      </div>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <div className="mt-0.5 h-6 w-6 shrink-0 overflow-hidden rounded-full ring-1 ring-white">
                      <RiriAvatar size={24} state={t.loading ? "thinking" : "idle"} animated={t.loading} />
                    </div>
                    <div className="min-w-0 flex-1 rounded-2xl rounded-bl-sm border border-zinc-900/10 bg-white/75 px-3.5 py-3">
                      {t.loading ? (
                        <span className="flex items-center gap-2 text-[13px] text-zinc-400">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Working out where to look…
                        </span>
                      ) : t.error ? (
                        <span className="flex items-center gap-2 text-[13px] text-rose-600">
                          <AlertCircle className="h-3.5 w-3.5" /> {t.error}
                        </span>
                      ) : (
                        <>
                          <RichText text={t.answer ?? ""} />
                          {t.chips && t.chips.length > 0 && <Chips chips={t.chips} />}
                          {t.series && <Sparkline series={t.series} />}
                          {t.table && <MiniTable table={t.table} />}
                          {t.sql && <ExportBar question={t.question} sql={t.sql} />}
                          {t.sql && <SqlDisclosure sql={t.sql} rows={t.rows} ms={t.ms} />}

                          {/* What it offers to DO. It proposes; you tap — unless
                              Autopilot already took the first one. Navigation only,
                              always: it can take you to the disbursement screen, it
                              cannot press the button when it gets there. */}
                          {t.actions && t.actions.length > 0 && (
                            <div className="mt-2.5 flex flex-wrap gap-1.5">
                              {t.actions.map((a, i) => (
                                <button
                                  key={i}
                                  onClick={() => onNavigate(a.href)}
                                  className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold text-white transition-transform active:scale-95"
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
                                  onClick={() => onAsk(sg)}
                                  className="rounded-full border border-zinc-900/[0.12] bg-white/70 px-2 py-0.5 text-[10px] text-zinc-500 hover:border-[color:var(--brand)] hover:text-zinc-900"
                                >
                                  {sg}
                                </button>
                              ))}
                            </div>
                          )}

                          {/* THE STAMP. Which engine answered, and what it stood on. */}
                          {t.engine && (
                            <div className="mt-2.5 space-y-1.5">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ring-1 ring-inset ${ENGINE_TINT[t.engine]}`}>
                                  <Glyph className="h-2.5 w-2.5" /> {t.engineLabel}
                                </span>
                                <span className="text-[9px] text-zinc-400">{t.evidence}</span>
                              </div>
                              {t.engineWhy && t.routed && (
                                <p className="text-[9.5px] leading-snug text-zinc-400">{t.engineWhy}</p>
                              )}
                              {/* THE RECOVERY. One tap re-asks the same words of the
                                  other engine — offered only when the router said it
                                  was unsure, so it is a correction, not a nag. */}
                              {t.alternative && t.confidence === "unsure" && (
                                <button
                                  onClick={() => onReask(t.question, t.alternative!.engine)}
                                  className="inline-flex items-center gap-1 rounded-full border border-zinc-900/[0.12] bg-white px-2 py-0.5 text-[10px] font-semibold text-zinc-600 hover:border-[color:var(--brand)] hover:text-zinc-900"
                                >
                                  <Repeat2 className="h-2.5 w-2.5" /> {t.alternative.label}
                                </button>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={endRef} />
          </div>
        )}
      </div>

      {/* Autopilot flight card — a moving screen is never a mystery. */}
      <AnimatePresence>
        {flight && (
          <motion.div
            initial={{ opacity: 0, y: 14, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 400, damping: 28 }}
            className="pointer-events-none absolute inset-x-3 bottom-3 z-20 flex items-center gap-2 rounded-2xl px-3 py-2.5 text-white shadow-xl"
            style={{ backgroundColor: "var(--brand)" }}
          >
            <Zap className="h-4 w-4 shrink-0" />
            <p className="min-w-0 flex-1 text-[12px] font-semibold leading-snug">Autopilot — taking you to {flight}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </Screen>
  );
}

/** The composer. Lives in the shell's footer slot so it never scrolls with the thread. */
export function AskComposer({
  input, busy, autoGo, placeholder, voice, onInput, onAsk,
}: {
  input: string;
  busy: boolean;
  autoGo: boolean;
  placeholder: string;
  voice: { supported: boolean; listening: boolean; speaking: boolean; listen: () => void };
  onInput: (v: string) => void;
  onAsk: (q: string) => void;
}) {
  return (
    <div className="shrink-0 border-t border-zinc-900/10 bg-white/70 p-2.5">
      <div className="flex items-center gap-1.5 rounded-2xl border border-zinc-900/15 bg-white px-2 focus-within:border-[color:var(--brand)]">
        {voice.supported && (
          <button
            onClick={voice.listen}
            title={voice.listening ? "Stop listening" : `Talk to ${ASSISTANT_NAME}`}
            aria-label={voice.listening ? "Stop listening" : `Talk to ${ASSISTANT_NAME}`}
            className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
              voice.listening ? "text-white" : "text-zinc-400 hover:bg-zinc-900/5 hover:text-zinc-700"
            }`}
            style={voice.listening ? { backgroundColor: "var(--brand)" } : undefined}
          >
            <Mic className="h-4 w-4" />
            {voice.listening && <span className="riri-halo absolute inset-0 rounded-lg" style={{ background: "var(--brand)", opacity: 0.35 }} />}
          </button>
        )}
        <input
          value={input}
          onChange={(e) => onInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onAsk(input); }
          }}
          placeholder={voice.listening ? "Listening…" : placeholder}
          className="flex-1 bg-transparent py-2.5 text-[13px] outline-none placeholder:text-zinc-400"
        />
        <button
          onClick={() => onAsk(input)}
          disabled={busy || !input.trim()}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white transition-transform active:scale-90 disabled:opacity-40"
          style={{ backgroundColor: "var(--brand)" }}
          aria-label="Send"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        </button>
      </div>
      <p className="mt-1 text-center text-[9px] text-zinc-400">
        {voice.speaking ? "Speaking… · " : ""}
        {autoGo ? "Autopilot on — I'll move the screen · " : ""}
        Powered by BirgenAI
      </p>
    </div>
  );
}
