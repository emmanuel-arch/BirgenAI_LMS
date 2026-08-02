"use client";

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMERS — find a person, then talk about them.
//
// Name, phone or national ID. The scope note at the bottom is not decoration: on
// OWN scope, "no one by that name" and "no one by that name THAT YOU CAN SEE" are
// different facts, and an officer who is not told which one they got will call a
// colleague's customer a stranger to their face.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Search, Loader2, AlertCircle, Building2, ChevronRight, UserSearch } from "lucide-react";
import { Screen } from "../kit";
import type { LookupMatch } from "@/app/api/console/riri/lookup/route";

export function FindScreen({ onOpen }: { onOpen: (m: LookupMatch) => void }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ matches: LookupMatch[]; total: number; scope: string; query: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Debounced live search, race-guarded — a fast typist can have three requests in
  // flight and the slowest must not overwrite the newest. Every state change
  // happens inside the timer, never in the effect body: a synchronous setState per
  // keystroke is a cascading render per character.
  useEffect(() => {
    const term = q.trim();
    const mine = ++seq.current;
    const t = window.setTimeout(async () => {
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
    return () => window.clearTimeout(t);
  }, [q]);

  const scopeNote =
    res?.scope === "OWN" ? "Searching customers you registered."
      : res?.scope === "BRANCH" ? "Searching your branch."
        : res?.scope === "BRANCH_TREE" ? "Searching your branch and the ones under it."
          : "Searching the whole book.";

  return (
    <Screen>
      <div className="shrink-0 pb-2 pt-1">
        <div className="flex items-center gap-2 rounded-xl border border-zinc-900/[0.12] bg-white px-3 focus-within:border-[color:var(--brand)]">
          <Search className="h-4 w-4 shrink-0 text-zinc-400" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name, phone or national ID"
            className="flex-1 bg-transparent py-2.5 text-[13px] outline-none placeholder:text-zinc-400"
          />
          {busy && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-zinc-400" />}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
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
                  className="flex w-full items-center gap-2.5 rounded-2xl border border-zinc-900/[0.07] bg-white/75 px-3 py-2.5 text-left transition-all hover:border-[color:var(--brand)] hover:bg-white active:scale-[0.985]"
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
                        <span className="rounded bg-zinc-900/5 px-1.5 py-px text-[9px] font-medium text-zinc-600">{m.openLoans} open</span>
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
              Type a name and I&apos;ll find them. Pick one and every question
              <br />after that is about them.
            </p>
          </div>
        )}
      </div>
    </Screen>
  );
}
