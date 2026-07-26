"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE DOCK'S SCREENS — home, briefing, use-case deck, customer finder.
//
// ServiceSuite AI is operated like a handset: apps launch from a home grid, one
// app is open at a time, and Back always means "up one level", never "into a
// different brain". These are the non-chat screens of that OS. The chat itself
// stays in RiriDock, because it owns the conversation state.
//
// The design rule everywhere below: NOTHING GENERIC. No truncated blurb strip, no
// badge that says LIVE DATA and nothing else, no chip row of five prompts pretending
// to be a capability list. If a thing is worth saying, it gets the screen it needs
// and it says the whole sentence.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Gauge, Bot, LifeBuoy, ChevronRight, ArrowRight, Search, Loader2, UserRound,
  Route, ShieldAlert, ListChecks, Navigation, Languages, UserSearch, Brain, Scale,
  PhoneCall, Eye, Database, Code2, SlidersHorizontal, TrendingUp, FileDown,
  Play, Settings2, KeyRound, Sun, Landmark, Banknote, Users, ShieldCheck,
  AlertCircle, Building2, type LucideIcon,
} from "lucide-react";
import { RIRI_MODELS, RIRI_MODEL_IDS, type RiriModelId } from "@/lib/riri/models";
import { RIRI_APPS, personalise } from "@/lib/riri/apps";
import { ASSISTANT_NAME } from "@/lib/riri/brand";
import type { LookupMatch } from "@/app/api/console/riri/lookup/route";

const ICONS: Record<string, LucideIcon> = {
  Gauge, Bot, LifeBuoy, Route, ShieldAlert, ListChecks, Navigation, Languages,
  UserSearch, Brain, Scale, PhoneCall, Eye, Database, Code2, SlidersHorizontal,
  TrendingUp, FileDown, Play, Settings2, KeyRound, Sun, Landmark, Banknote, Users,
};
const Icon = ({ name, className }: { name: string; className?: string }) => {
  const C = ICONS[name] ?? ListChecks;
  return <C className={className} />;
};

const SPRING = { type: "spring" as const, stiffness: 420, damping: 34 };

// ── HOME ─────────────────────────────────────────────────────────────────────
//
// The app grid. Three tiles, sized like app icons, each carrying its own artwork
// gradient so an officer learns them by colour before they learn them by name —
// which is the entire reason phone home screens work.

export function HomeScreen({
  orgName, userName, onLaunch, onFind, onAccount, lastApp,
}: {
  orgName: string;
  userName?: string | null;
  onLaunch: (id: RiriModelId) => void;
  onFind: () => void;
  onAccount: () => void;
  lastApp: RiriModelId | null;
}) {
  const first = userName?.split(" ")[0];
  const hour = new Date().getHours();
  const salutation = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <motion.div
      key="home"
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.03 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      className="flex h-full flex-col overflow-y-auto px-4 pb-3 pt-3"
    >
      <div className="shrink-0">
        <p className="text-[11px] font-medium text-zinc-500">{salutation}{first ? `, ${first}` : ""}</p>
        <h2 className="mt-0.5 text-[19px] font-bold leading-tight tracking-tight text-zinc-900">{orgName}</h2>
        <p className="mt-1 text-[11.5px] leading-snug text-zinc-500">
          Three intelligences. Open one at a time — each keeps its own conversation.
        </p>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2.5">
        {RIRI_MODEL_IDS.map((id, i) => {
          const m = RIRI_MODELS[id];
          const app = RIRI_APPS[id];
          const Glyph = ICONS[m.icon] ?? Bot;
          return (
            <motion.button
              key={id}
              layoutId={`app-tile-${id}`}
              onClick={() => onLaunch(id)}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.04 * i, ...SPRING }}
              whileTap={{ scale: 0.93 }}
              className="group flex flex-col items-center gap-1.5 text-center"
            >
              <span
                className="relative flex aspect-square w-full items-center justify-center rounded-[22px] shadow-lg shadow-zinc-900/15 ring-1 ring-inset ring-white/25"
                style={{ background: `linear-gradient(145deg, ${app.tile.from}, ${app.tile.to})` }}
              >
                <Glyph className="h-7 w-7 text-white drop-shadow" />
                {m.pro && (
                  <span className="absolute -right-1 -top-1 rounded-full bg-amber-400 px-1.5 py-px text-[8px] font-bold text-amber-950 shadow ring-2 ring-white">PRO</span>
                )}
                {lastApp === id && (
                  <span className="absolute -bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-white/90" />
                )}
              </span>
              <span className="text-[11px] font-semibold leading-tight text-zinc-700">{m.short}</span>
            </motion.button>
          );
        })}
      </div>

      {/* Utilities — the things that aren't a conversation */}
      <div className="mt-4 space-y-1.5">
        <p className="px-0.5 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-zinc-400">On this book</p>
        <UtilityRow
          icon={<Search className="h-4 w-4" />}
          title="Find a customer"
          detail="By name, phone or national ID — within what you're allowed to see."
          onClick={onFind}
        />
        <UtilityRow
          icon={<UserRound className="h-4 w-4" />}
          title="Account & memory"
          detail="Your usage, your settings, and what I remember about you."
          onClick={onAccount}
        />
      </div>

      <div className="flex-1" />
      <p className="mt-4 shrink-0 text-center text-[9.5px] leading-snug text-zinc-400">
        {ASSISTANT_NAME} can be wrong — verify figures before acting
      </p>
    </motion.div>
  );
}

function UtilityRow({ icon, title, detail, onClick }: { icon: React.ReactNode; title: string; detail: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-2xl border border-zinc-900/[0.07] bg-white/70 px-3 py-2.5 text-left transition-colors hover:border-[color:var(--brand)] hover:bg-white"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-900/[0.05] text-zinc-600">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-semibold leading-tight text-zinc-800">{title}</span>
        <span className="block truncate text-[10.5px] leading-tight text-zinc-500">{detail}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-zinc-300" />
    </button>
  );
}

// ── BRIEFING ─────────────────────────────────────────────────────────────────
//
// The capability screen, full-bleed, shown when an app launches. This is the
// thing that replaced the truncated one-liner: what this model knows, what it
// hands back, and where its authority stops — before a single question is asked.

export function BriefScreen({
  id, orgName, userName, onContinue, onSkipChange, skip,
}: {
  id: RiriModelId;
  orgName: string;
  userName?: string | null;
  onContinue: () => void;
  onSkipChange: (v: boolean) => void;
  skip: boolean;
}) {
  const app = RIRI_APPS[id];
  const m = RIRI_MODELS[id];
  const Glyph = ICONS[m.icon] ?? Bot;

  return (
    <motion.div
      key={`brief-${id}`}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      className="flex h-full flex-col"
    >
      {/* Hero */}
      <div
        className="relative shrink-0 overflow-hidden px-4 pb-4 pt-5 text-white"
        style={{ background: `linear-gradient(145deg, ${app.tile.from}, ${app.tile.to})` }}
      >
        <span aria-hidden className="dock-scan pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-white/25 to-transparent" />
        <div className="relative flex items-center gap-3">
          <motion.span layoutId={`app-tile-${id}`} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/20 ring-1 ring-inset ring-white/30 backdrop-blur">
            <Glyph className="h-6 w-6" />
          </motion.span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h2 className="text-[17px] font-bold leading-tight">{m.name}</h2>
              <span className="rounded bg-white/20 px-1.5 py-px text-[9px] font-bold leading-none">{m.tag}</span>
            </div>
            <p className="mt-0.5 text-[11.5px] leading-snug text-white/85">{app.headline}</p>
          </div>
        </div>
        <p className="relative mt-3 text-[12.5px] leading-relaxed text-white/95">
          {personalise(app.intro, userName, orgName)}
        </p>
      </div>

      {/* Capabilities */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3.5">
        <p className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-zinc-400">What it does</p>
        <div className="mt-2 space-y-2">
          {app.capabilities.map((c, i) => (
            <motion.div
              key={c.title}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.05 + i * 0.045, duration: 0.3 }}
              className="flex gap-2.5"
            >
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ background: `${app.tile.from}1a`, color: app.tile.to }}>
                <Icon name={c.icon} className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0">
                <span className="block text-[12.5px] font-semibold leading-tight text-zinc-800">{c.title}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">{c.detail}</span>
              </span>
            </motion.div>
          ))}
        </div>

        <p className="mt-4 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-zinc-400">What you get back</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {app.outputs.map((o) => (
            <span key={o} className="rounded-full border px-2.5 py-1 text-[10.5px] font-medium" style={{ borderColor: `${app.tile.from}40`, color: app.tile.to, background: `${app.tile.from}0d` }}>
              {o}
            </span>
          ))}
        </div>

        <div className="mt-4 flex gap-2 rounded-xl border border-amber-300/50 bg-amber-50/70 px-3 py-2.5">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
          <p className="text-[10.5px] leading-snug text-amber-900">{app.limit}</p>
        </div>
      </div>

      {/* Continue */}
      <div className="shrink-0 border-t border-zinc-900/[0.07] bg-white/70 px-4 py-3">
        <button
          onClick={onContinue}
          className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[14px] font-semibold text-white shadow-lg transition-transform active:scale-[0.98]"
          style={{ background: `linear-gradient(120deg, ${app.tile.from}, ${app.tile.to})` }}
        >
          Continue <ArrowRight className="h-4 w-4" />
        </button>
        <label className="mt-2 flex cursor-pointer items-center justify-center gap-1.5 text-[10px] text-zinc-400">
          <input type="checkbox" checked={skip} onChange={(e) => onSkipChange(e.target.checked)} className="h-3 w-3 accent-[color:var(--brand)]" />
          Skip this next time
        </label>
      </div>
    </motion.div>
  );
}

// ── USE-CASE DECK ────────────────────────────────────────────────────────────
//
// Fills the screen on an empty thread. Grouped by intent, because "what can it
// do" and "what should I type" are different questions and a flat chip row
// answers neither.

export function UseCaseDeck({ id, onPick }: { id: RiriModelId; onPick: (prompt: string) => void }) {
  const app = RIRI_APPS[id];
  return (
    <div className="space-y-3.5">
      <div>
        <p className="text-[12.5px] font-semibold leading-tight text-zinc-800">What would you like to know?</p>
        <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">Tap one, or type your own below.</p>
      </div>
      {app.useCases.map((g, gi) => (
        <motion.div
          key={g.label}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: gi * 0.06, duration: 0.3 }}
        >
          <p className="flex items-center gap-1.5 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
            <Icon name={g.icon} className="h-3 w-3" /> {g.label}
          </p>
          <div className="mt-1.5 space-y-1">
            {g.prompts.map((p) => (
              <button
                key={p}
                onClick={() => onPick(p)}
                className="group flex w-full items-center gap-2 rounded-xl border border-zinc-900/[0.07] bg-white/70 px-2.5 py-2 text-left text-[11.5px] leading-snug text-zinc-700 transition-colors hover:border-[color:var(--brand)] hover:bg-white hover:text-zinc-900"
              >
                <span className="min-w-0 flex-1">{p}</span>
                <ArrowRight className="h-3 w-3 shrink-0 text-zinc-300 transition-colors group-hover:text-[color:var(--brand)]" />
              </button>
            ))}
          </div>
        </motion.div>
      ))}
    </div>
  );
}

// ── FIND A CUSTOMER ──────────────────────────────────────────────────────────
//
// Name, phone or national ID. The scope note at the bottom is not decoration: on
// OWN scope "no one by that name" and "no one by that name THAT YOU CAN SEE" are
// different facts, and an officer who is not told which one they got will call
// the customer a stranger to their face.

export function FindScreen({
  onOpen, onBack,
}: {
  onOpen: (m: LookupMatch) => void;
  onBack: () => void;
}) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ matches: LookupMatch[]; total: number; scope: string; query: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Debounced live search. `seq` guards the race: a fast typist can have three
  // requests in flight, and the slowest must not overwrite the newest.
  //
  // Every state change happens inside the timer, never in the effect body — a
  // synchronous setState on each keystroke is a cascading render per character,
  // which is exactly the pattern the react-hooks rules ban.
  useEffect(() => {
    const term = q.trim();
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      if (mine !== seq.current) return;
      if (term.length < 2) { setRes(null); setError(null); setBusy(false); return; }
      setBusy(true);
      try {
        const r = await fetch("/api/console/riri/lookup", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: term }),
        });
        const d = await r.json();
        if (mine !== seq.current) return;
        if (!d.success) { setError(d.message || "Could not search."); setRes(null); }
        else { setError(null); setRes({ matches: d.matches, total: d.total, scope: d.scope, query: d.query }); }
      } catch {
        if (mine === seq.current) { setError("Could not reach the server."); setRes(null); }
      } finally {
        if (mine === seq.current) setBusy(false);
      }
    }, term.length < 2 ? 0 : 280);
    return () => clearTimeout(t);
  }, [q]);

  const scopeNote =
    res?.scope === "OWN" ? "Searching customers you registered."
      : res?.scope === "BRANCH" ? "Searching your branch."
        : res?.scope === "BRANCH_TREE" ? "Searching your branch and the ones under it."
          : "Searching the whole book.";

  return (
    <motion.div
      key="find"
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24 }}
      transition={SPRING}
      className="flex h-full flex-col"
    >
      <div className="shrink-0 px-4 pt-3">
        <h2 className="text-[15px] font-bold leading-tight text-zinc-900">Find a customer</h2>
        <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">Name, phone number or national ID.</p>
        <div className="mt-2.5 flex items-center gap-2 rounded-xl border border-zinc-900/12 bg-white px-3 focus-within:border-[color:var(--brand)]">
          <Search className="h-4 w-4 shrink-0 text-zinc-400" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && onBack()}
            placeholder="e.g. Emmanuel Kipleting, 0712…, 3412…"
            className="flex-1 bg-transparent py-2.5 text-[13px] outline-none placeholder:text-zinc-400"
          />
          {busy && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-zinc-400" />}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3 pt-2.5">
        {error && (
          <p className="flex items-center gap-1.5 text-[11.5px] text-rose-600"><AlertCircle className="h-3.5 w-3.5" /> {error}</p>
        )}

        {res && res.matches.length === 0 && !busy && (
          <div className="rounded-2xl border border-zinc-900/[0.07] bg-white/70 px-3.5 py-4 text-center">
            <p className="text-[12.5px] font-semibold text-zinc-700">No one by &ldquo;{res.query}&rdquo;</p>
            <p className="mt-1 text-[11px] leading-snug text-zinc-500">{scopeNote} Try a phone number or national ID — those match exactly.</p>
          </div>
        )}

        {res && res.matches.length > 0 && (
          <>
            <p className="mb-1.5 text-[10px] text-zinc-500">
              {res.total === 1 ? "One match" : `${res.total} people match`} — {scopeNote.toLowerCase()}
            </p>
            <div className="space-y-1.5">
              {res.matches.map((m, i) => (
                <motion.button
                  key={m.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  onClick={() => onOpen(m)}
                  className="flex w-full items-center gap-2.5 rounded-2xl border border-zinc-900/[0.07] bg-white/70 px-3 py-2.5 text-left transition-colors hover:border-[color:var(--brand)] hover:bg-white"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white" style={{ backgroundColor: "var(--brand)" }}>
                    {m.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-semibold leading-tight text-zinc-800">{m.name}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] leading-tight text-zinc-500">
                      <span>{m.phoneMasked}</span>
                      {m.nationalIdMasked && <><span className="text-zinc-300">·</span><span>ID {m.nationalIdMasked}</span></>}
                      {m.branch && <><span className="text-zinc-300">·</span><span className="inline-flex items-center gap-0.5"><Building2 className="h-2.5 w-2.5" />{m.branch}</span></>}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-1">
                      {m.riskBand && (
                        <span className={`rounded px-1.5 py-px text-[9px] font-bold ${
                          m.riskBand === "PRIME" ? "bg-emerald-100 text-emerald-700"
                            : m.riskBand === "STRONG" ? "bg-sky-100 text-sky-700"
                              : m.riskBand === "WATCH" ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"}`}>
                          {m.riskBand}{m.creditScore ? ` ${m.creditScore}` : ""}
                        </span>
                      )}
                      {m.openLoans > 0 && (
                        <span className="rounded bg-zinc-900/5 px-1.5 py-px text-[9px] font-medium text-zinc-600">
                          {m.openLoans} open
                        </span>
                      )}
                      {m.arrears && <span className="rounded bg-rose-100 px-1.5 py-px text-[9px] font-bold text-rose-700">IN ARREARS</span>}
                      {m.kycStatus !== "VERIFIED" && (
                        <span className="rounded bg-zinc-900/5 px-1.5 py-px text-[9px] font-medium text-zinc-500">KYC {m.kycStatus.toLowerCase()}</span>
                      )}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-zinc-300" />
                </motion.button>
              ))}
            </div>
            {res.total > res.matches.length && (
              <p className="mt-2 text-center text-[10px] text-zinc-400">
                Showing the closest {res.matches.length} of {res.total}. Narrow it with a phone number or ID.
              </p>
            )}
          </>
        )}

        {!res && !error && (
          <div className="mt-6 space-y-2 text-center">
            <UserSearch className="mx-auto h-8 w-8 text-zinc-300" />
            <p className="text-[11.5px] leading-snug text-zinc-500">
              Type a name and I&apos;ll find them. If several people answer to it,
              <br />I&apos;ll ask which one you mean.
            </p>
          </div>
        )}
      </div>
    </motion.div>
  );
}

export { ICONS as DOCK_ICONS };
