"use client";

// ─────────────────────────────────────────────────────────────────────────────
// CALLS — a keypad that knows who it is about to ring.
//
// The founder asked for "a calls app with a screen for dialing a number… more
// technical without overcomplicating it". The technical part is not the keypad. A
// keypad is four rows of buttons and every phone has one. The technical part is
// the half-second between the last digit and the call:
//
//   0712 345 678
//   ▸ Grace Wanjiru · KUZA · 12 days late · KES 4,200 overdue
//   ▸ Promised KES 4,200 on Tuesday — it didn't come
//   ▸ Last spoken to 6 days ago: "promise to pay"
//
// An officer who opens a call already holding that has a different conversation
// from one who opens it blind, and every line of it is read from the customer's
// own record, scope-fenced (api/console/riri/dial). That is the whole feature.
//
// WHAT IT DOES NOT DO, deliberately: place calls. It hands the handset a `tel:`
// URI and gets out of the way. Being in the path of somebody's voice call buys us
// a support burden, a compliance question and a recording problem, and buys the
// lender nothing their phone does not already do.
//
// Afterwards it logs the outcome — through the SAME disposition endpoint the
// Customer 360 uses, so a call logged here and a call logged there are one event
// on one timeline. Two write paths for the same fact is how two screens start
// disagreeing about whether anyone rang.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Phone, Delete, Loader2, PhoneOutgoing, UserRound, AlertTriangle, CalendarClock,
  MessageSquare, Check, History, ChevronRight,
} from "lucide-react";
import { Screen, SectionLabel, ago } from "../kit";
import type { DialMatch } from "@/app/api/console/riri/dial/route";

type Recent = { borrowerId: string; name: string; phone: string; tel: string; outcome: string; at: string };

const KEYS = [
  ["1", ""], ["2", "ABC"], ["3", "DEF"],
  ["4", "GHI"], ["5", "JKL"], ["6", "MNO"],
  ["7", "PQRS"], ["8", "TUV"], ["9", "WXYZ"],
  ["*", ""], ["0", "+"], ["#", ""],
] as const;

/** The dispositions a Kenyan collections desk actually uses. */
const DISPOSITIONS = [
  "Promise to pay", "Paid already", "No answer", "Wrong number",
  "Phone off", "Disputed", "Hardship", "Will call back",
] as const;

const pretty = (d: string) => {
  const s = d.replace(/\D/g, "");
  if (s.startsWith("254")) return `+254 ${s.slice(3, 6)} ${s.slice(6, 9)} ${s.slice(9)}`.trim();
  if (s.length <= 4) return s;
  if (s.length <= 7) return `${s.slice(0, 4)} ${s.slice(4)}`;
  return `${s.slice(0, 4)} ${s.slice(4, 7)} ${s.slice(7, 10)}`;
};

export function CallsScreen({ onOpenCustomer }: { onOpenCustomer: (id: string, name: string) => void }) {
  const [digits, setDigits] = useState("");
  const [match, setMatch] = useState<DialMatch | null>(null);
  const [state, setState] = useState<"typing" | "known" | "unknown">("typing");
  const [scope, setScope] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const [recents, setRecents] = useState<Recent[]>([]);
  const [logging, setLogging] = useState<{ borrowerId: string; name: string } | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/console/riri/dial");
        const d = await r.json();
        if (d.success) setRecents(d.recents ?? []);
      } catch { /* an empty recents list is a fine recents list */ }
    })();
  }, []);

  // Reverse-lookup as you type, debounced and race-guarded: a fast typist can have
  // three requests in flight and the slowest must not overwrite the newest.
  useEffect(() => {
    const mine = ++seq.current;
    const n = digits.replace(/\D/g, "");
    const t = window.setTimeout(async () => {
      if (mine !== seq.current) return;
      if (n.length < 6) { setMatch(null); setState("typing"); setLooking(false); return; }
      setLooking(true);
      try {
        const r = await fetch("/api/console/riri/dial", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ number: n }),
        });
        const d = await r.json();
        if (mine !== seq.current) return;
        setMatch(d.match ?? null);
        setState(d.state ?? "typing");
        setScope(d.scope ?? null);
      } catch {
        if (mine === seq.current) { setMatch(null); setState("typing"); }
      } finally {
        if (mine === seq.current) setLooking(false);
      }
    }, n.length < 6 ? 0 : 220);
    return () => window.clearTimeout(t);
  }, [digits]);

  const tap = useCallback((k: string) => setDigits((d) => (d.length >= 15 ? d : d + k)), []);
  const back = useCallback(() => setDigits((d) => d.slice(0, -1)), []);

  const dial = () => {
    const tel = match?.tel ?? (digits.replace(/\D/g, "").length >= 9 ? `tel:${digits}` : null);
    if (!tel) return;
    // The handset places the call. We open the URI and immediately offer the log
    // sheet, because the one moment a disposition actually gets recorded is the
    // moment the call ends — not when somebody remembers to open the 360.
    window.location.href = tel;
    if (match) setLogging({ borrowerId: match.borrowerId, name: match.name });
  };

  return (
    <Screen pad={false}>
      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-2">
        {/* THE NUMBER */}
        <div className="pt-2 text-center">
          <p className={`font-semibold tabular-nums tracking-tight text-zinc-900 ${digits.length > 10 ? "text-[22px]" : "text-[27px]"}`}>
            {digits ? pretty(digits) : <span className="text-zinc-300">Enter a number</span>}
          </p>
        </div>

        {/* WHO IT IS. The reason this app exists. */}
        <div className="mt-2 min-h-[74px]">
          <AnimatePresence mode="wait">
            {looking && (
              <motion.p key="l" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="flex items-center justify-center gap-1.5 pt-4 text-[11px] text-zinc-400">
                <Loader2 className="h-3 w-3 animate-spin" /> Checking your book…
              </motion.p>
            )}

            {!looking && state === "known" && match && (
              <motion.button
                key="k"
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                onClick={() => onOpenCustomer(match.borrowerId, match.name)}
                className="w-full rounded-2xl border border-zinc-900/[0.07] bg-white/80 px-3 py-2.5 text-left transition-colors hover:border-[color:var(--brand)]"
              >
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white" style={{ backgroundColor: "var(--brand)" }}>
                    {match.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold leading-tight text-zinc-900">{match.name}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1">
                      {match.riskBand && (
                        <span className={`rounded px-1.5 py-px text-[9px] font-bold ${
                          match.riskBand === "PRIME" ? "bg-emerald-100 text-emerald-700"
                            : match.riskBand === "STRONG" ? "bg-sky-100 text-sky-700"
                              : match.riskBand === "WATCH" ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"
                        }`}>
                          {match.riskBand}{match.creditScore ? ` ${match.creditScore}` : ""}
                        </span>
                      )}
                      {match.balance && <span className="text-[9.5px] text-zinc-500">{match.balance} out</span>}
                      {match.branch && <span className="text-[9.5px] text-zinc-400">· {match.branch}</span>}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-zinc-300" />
                </div>

                {/* The three lines that change the conversation. */}
                <div className="mt-1.5 space-y-1">
                  {match.daysLate != null && match.daysLate > 0 && (
                    <p className="flex items-center gap-1.5 text-[10.5px] font-semibold text-rose-600">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      {match.daysLate} day{match.daysLate === 1 ? "" : "s"} late{match.overdue ? ` · ${match.overdue} overdue` : ""}
                    </p>
                  )}
                  {match.promise && (
                    <p className="flex items-center gap-1.5 text-[10.5px] text-amber-700">
                      <CalendarClock className="h-3 w-3 shrink-0" />
                      Promised {match.promise.amount} for {new Date(match.promise.dueDate).toLocaleDateString("en-KE", { day: "numeric", month: "short" })}
                    </p>
                  )}
                  {match.lastContact && (
                    <p className="flex items-center gap-1.5 text-[10.5px] text-zinc-500">
                      <MessageSquare className="h-3 w-3 shrink-0" />
                      Last spoken to {ago(match.lastContact.at)} — {match.lastContact.what}
                    </p>
                  )}
                  {match.kycStatus !== "VERIFIED" && (
                    <p className="text-[10.5px] text-zinc-500">KYC {match.kycStatus.toLowerCase().replace(/_/g, " ")}</p>
                  )}
                </div>
              </motion.button>
            )}

            {!looking && state === "unknown" && (
              <motion.div key="u" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="rounded-2xl border border-dashed border-zinc-300 bg-white/50 px-3 py-2.5 text-center">
                <p className="text-[11.5px] font-semibold text-zinc-600">Not on your book</p>
                <p className="mt-0.5 text-[10px] leading-snug text-zinc-500">
                  {scope === "OWN" ? "Nobody you registered has this number — it may belong to a colleague's customer."
                    : scope === "BRANCH" || scope === "BRANCH_TREE" ? "Nobody in your branch has this number."
                      : "No customer on this book has this number."}
                  {" "}You can still dial it.
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* THE KEYPAD */}
        <div className="mt-1 grid grid-cols-3 gap-2">
          {KEYS.map(([k, sub]) => (
            <button
              key={k}
              onClick={() => tap(k)}
              className="os-key flex aspect-[1.5/1] flex-col items-center justify-center rounded-2xl border border-zinc-900/[0.07] bg-white/80 transition-all hover:bg-white active:scale-95"
            >
              <span className="text-[19px] font-semibold leading-none text-zinc-800">{k}</span>
              {sub && <span className="mt-0.5 text-[7.5px] font-bold tracking-[0.16em] text-zinc-400">{sub}</span>}
            </button>
          ))}
        </div>

        {/* CALL / BACKSPACE */}
        <div className="mt-2.5 flex items-center justify-center gap-3">
          <span className="w-11" />
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={dial}
            disabled={digits.replace(/\D/g, "").length < 6}
            className="flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg transition-opacity disabled:opacity-30"
            style={{ background: "linear-gradient(150deg, #22c55e, #15803d)" }}
            aria-label="Call"
          >
            <Phone className="h-6 w-6" />
          </motion.button>
          <button
            onClick={back}
            disabled={!digits}
            className="flex h-11 w-11 items-center justify-center rounded-full text-zinc-400 transition-colors hover:text-zinc-800 disabled:opacity-0"
            aria-label="Delete a digit"
          >
            <Delete className="h-5 w-5" />
          </button>
        </div>

        {/* RECENTS */}
        {recents.length > 0 && !digits && (
          <div className="mt-4">
            <SectionLabel className="flex items-center gap-1.5"><History className="h-3 w-3" /> Recent</SectionLabel>
            <div className="mt-1.5 space-y-1">
              {recents.map((r) => (
                <div key={`${r.borrowerId}-${r.at}`} className="flex items-center gap-2 rounded-xl border border-zinc-900/[0.06] bg-white/70 px-2.5 py-1.5">
                  <button onClick={() => onOpenCustomer(r.borrowerId, r.name)} className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-[11.5px] font-semibold leading-tight text-zinc-800">{r.name}</span>
                    <span className="block truncate text-[9.5px] leading-tight text-zinc-500">{r.outcome} · {ago(r.at)}</span>
                  </button>
                  <button
                    onClick={() => setDigits(r.phone)}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-emerald-600 hover:bg-emerald-50"
                    aria-label={`Dial ${r.name}`}
                  >
                    <PhoneOutgoing className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <AnimatePresence>
        {logging && (
          <LogSheet
            name={logging.name}
            borrowerId={logging.borrowerId}
            onClose={() => setLogging(null)}
          />
        )}
      </AnimatePresence>
    </Screen>
  );
}

/**
 * The log sheet.
 *
 * Appears the moment the call is handed to the handset, because the disposition
 * that gets recorded is the one asked for while the phone is still warm. It posts
 * to the SAME endpoint the Customer 360 uses — one event, one timeline.
 */
function LogSheet({ name, borrowerId, onClose }: { name: string; borrowerId: string; onClose: () => void }) {
  const [disposition, setDisposition] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!disposition) return;
    setSaving(true); setError(null);
    try {
      const r = await fetch(`/api/console/borrowers/${borrowerId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "interaction", disposition, channel: "CALL", note: note.trim() || undefined }),
      });
      const d = await r.json();
      if (!d.success) { setError(d.message || "Could not log that."); return; }
      setDone(true);
      window.setTimeout(onClose, 900);
    } catch {
      setError("Could not reach the server.");
    } finally { setSaving(false); }
  };

  return (
    <motion.div
      initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
      transition={{ type: "spring", stiffness: 380, damping: 34 }}
      className="absolute inset-x-0 bottom-0 z-30 rounded-t-3xl border-t border-zinc-900/10 bg-white p-3.5 shadow-2xl"
    >
      <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-zinc-200" />
      {done ? (
        <p className="flex items-center justify-center gap-2 py-4 text-[13px] font-semibold text-emerald-600">
          <Check className="h-4 w-4" /> Logged on {name}&apos;s timeline
        </p>
      ) : (
        <>
          <p className="flex items-center gap-1.5 text-[12.5px] font-bold text-zinc-900">
            <UserRound className="h-3.5 w-3.5 text-zinc-400" /> How did the call with {name} go?
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {DISPOSITIONS.map((d) => (
              <button
                key={d}
                onClick={() => setDisposition(d)}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                  disposition === d
                    ? "border-transparent text-white"
                    : "border-zinc-900/[0.12] bg-white text-zinc-600 hover:border-[color:var(--brand)]"
                }`}
                style={disposition === d ? { backgroundColor: "var(--brand)" } : undefined}
              >
                {d}
              </button>
            ))}
          </div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Anything worth remembering (optional)"
            className="mt-2 w-full rounded-xl border border-zinc-900/[0.12] bg-white px-2.5 py-2 text-[12px] outline-none placeholder:text-zinc-400 focus:border-[color:var(--brand)]"
          />
          {error && <p className="mt-1.5 text-[10.5px] text-rose-600">{error}</p>}
          <div className="mt-2.5 flex gap-2">
            <button onClick={onClose} className="flex-1 rounded-xl border border-zinc-900/10 py-2 text-[12px] font-semibold text-zinc-600 hover:text-zinc-900">
              Skip
            </button>
            <button
              onClick={save}
              disabled={!disposition || saving}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-[12px] font-semibold text-white disabled:opacity-40"
              style={{ backgroundColor: "var(--brand)" }}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Log it
            </button>
          </div>
        </>
      )}
    </motion.div>
  );
}
