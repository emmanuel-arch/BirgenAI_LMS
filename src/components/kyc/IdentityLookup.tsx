"use client";

// ─────────────────────────────────────────────────────────────────────────────
// IDENTITY LOOKUP — the borrower onboarding trick, reused for everyone else on a
// file. Type ONE ID number and the national registry (IPRS) fills the person in.
// Drop it wherever a human is captured by hand today — a guarantor, a next-of-kin —
// so nobody types a name we could have proven, and nobody invents one.
//
// It refuses to resolve to the borrower's own ID (a guarantor/next-of-kin must be a
// DIFFERENT person — the exact hole in the systems we are replacing), and a manual
// fallback keeps a registry outage from stopping the counter.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import { Loader2, Search, ShieldCheck, FlaskConical, CheckCircle2, AlertTriangle, PenLine, X } from "lucide-react";

export type ResolvedPerson = {
  nationalId: string;
  fullName: string;
  firstName: string | null; otherName: string | null; surname: string | null;
  gender: string | null; dob: string | null; phone: string | null;
};

export function IdentityLookup({
  role, excludeNationalId, onResolved, onManual, compact = true,
}: {
  role: string; // "guarantor" | "next-of-kin"
  excludeNationalId?: string | null;
  onResolved: (p: ResolvedPerson | null) => void;
  onManual?: () => void;
  compact?: boolean;
}) {
  const [nid, setNid] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [person, setPerson] = useState<ResolvedPerson | null>(null);
  const [mode, setMode] = useState<"live" | "simulation" | null>(null);

  const digits = nid.replace(/\D/g, "");

  const lookup = async () => {
    setBusy(true); setError(null); setNote(null);
    try {
      const res = await fetch("/api/console/identity/lookup", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nationalId: digits, consent, role }),
      });
      const d = await res.json();
      if (!d.success) { setError(d.message || "Registry lookup failed."); return; }
      if (!d.found || !d.person) { setNote(d.note || `No registry record for that ID. Enter the ${role} manually.`); return; }
      if (excludeNationalId && digits === excludeNationalId.replace(/\D/g, "")) {
        setError(`That is the borrower's own ID — a ${role} must be a different person.`);
        return;
      }
      const p: ResolvedPerson = {
        nationalId: digits,
        fullName: d.person.fullName ?? [d.person.firstName, d.person.surname].filter(Boolean).join(" "),
        firstName: d.person.firstName ?? null, otherName: d.person.otherName ?? null, surname: d.person.surname ?? null,
        gender: d.person.gender ?? null, dob: d.person.dob ?? null, phone: d.person.phone ?? null,
      };
      setPerson(p); setMode(d.mode); onResolved(p);
    } catch { setError("Registry lookup failed."); } finally { setBusy(false); }
  };

  const clear = () => { setPerson(null); setMode(null); setNid(""); setConsent(false); setError(null); setNote(null); onResolved(null); };

  // Resolved — the person, as the registry knows them.
  if (person) {
    return (
      <div className="rounded-lg border border-emerald-300 bg-emerald-50/70 px-3 py-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-900">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> {person.fullName}
            </p>
            <p className="mt-0.5 text-[11px] text-emerald-700/80">
              ID {person.nationalId}{person.dob ? ` · born ${person.dob}` : ""}{person.gender ? ` · ${person.gender}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold ${mode === "live" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
              {mode === "live" ? <><ShieldCheck className="h-2.5 w-2.5" /> REGISTRY</> : <><FlaskConical className="h-2.5 w-2.5" /> SIMULATED</>}
            </span>
            <button onClick={clear} aria-label="Change" className="rounded p-0.5 text-emerald-700/60 hover:text-emerald-900"><X className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      </div>
    );
  }

  const inputCls = "w-full rounded-lg border border-ash-900/15 bg-paper px-2.5 py-1.5 text-xs outline-none placeholder:text-ash-400 focus:border-[var(--brand)]";
  return (
    <div className={compact ? "" : "rounded-xl border border-ash-900/10 bg-paper/60 p-3"}>
      <div className="flex gap-1.5">
        <input className={inputCls} inputMode="numeric" placeholder={`${role} national ID`}
          value={nid} onChange={(e) => setNid(e.target.value.replace(/[^0-9]/g, "").slice(0, 10))}
          onKeyDown={(e) => e.key === "Enter" && consent && digits.length >= 6 && !busy && lookup()} />
        <button onClick={lookup} disabled={busy || !consent || digits.length < 6}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
          style={{ backgroundColor: "var(--brand)" }}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />} Fetch
        </button>
      </div>
      <label className="mt-1.5 flex items-start gap-2 text-[10px] text-ash-500 cursor-pointer">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-3.5 w-3.5" style={{ accentColor: "var(--brand)" }} />
        <span>The {role} consents to an identity check against the national registry. Your name goes on the lookup.</span>
      </label>
      {error && <p className="mt-1.5 flex items-start gap-1 text-[11px] text-red-600"><AlertTriangle className="mt-px h-3 w-3 shrink-0" /> {error}</p>}
      {note && <p className="mt-1.5 text-[11px] text-amber-700">{note}</p>}
      {onManual && (
        <button onClick={onManual} className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-ash-500 hover:text-ash-800">
          <PenLine className="h-3 w-3" /> Enter manually instead
        </button>
      )}
    </div>
  );
}
