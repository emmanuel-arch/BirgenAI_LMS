"use client";

// ─────────────────────────────────────────────────────────────────────────────
// SURETIES — the people standing behind the money, as cards, not a ledger row.
//
// A guarantor is a promise with a face, so each one is a card: who they are, who
// they're backing, how much they stood behind, and — the part a table buries —
// the EVIDENCE of consent: signed on this date, from this IP, or still waiting
// with a window that's closing. Coverage (the money actually consented to) leads,
// because that is the number that means the book is protected.
//
// Its own shape on purpose: a board you filter by consent state, so an officer
// chasing signatures sees the pending pile and the officer proving cover sees the
// signed one — neither has to read past the other.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useLoad } from "@/lib/hooks/useLoad";
import { motion } from "framer-motion";
import {
  Loader2, AlertTriangle, Handshake, ShieldCheck, Clock, ShieldX, Hourglass,
  Phone, UserRound, BadgeCheck, Globe, ChevronRight,
} from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";

type Surety = {
  id: string; name: string; phone: string; relationship: string | null; hasId: boolean;
  status: "INVITED" | "CONSENTED" | "DECLINED" | "EXPIRED";
  amountGuaranteed: number | null; invitedAt: string; remindedAt: string | null;
  consentedAt: string | null; declinedAt: string | null; expiresAt: string; consentIp: string | null;
  borrowerId: string; applicantName: string; applicationId: string | null;
  applicationStatus: string | null; amountRequested: number | null; productName: string | null;
};
type Summary = { total: number; consented: number; pending: number; lapsed: number; coverage: number };

const kes = (n: number | null) => (n == null ? "—" : `KES ${Math.round(n).toLocaleString()}`);

const STATUS: Record<Surety["status"], { label: string; color: string; soft: string; icon: typeof ShieldCheck }> = {
  CONSENTED: { label: "Consented", color: "#059669", soft: "rgba(5,150,105,0.12)", icon: ShieldCheck },
  INVITED: { label: "Awaiting signature", color: "#d97706", soft: "rgba(217,119,6,0.12)", icon: Hourglass },
  DECLINED: { label: "Declined", color: "#e11d48", soft: "rgba(225,29,72,0.12)", icon: ShieldX },
  EXPIRED: { label: "Lapsed", color: "#64748b", soft: "rgba(100,116,139,0.12)", icon: Clock },
};
const FILTERS: { key: "all" | Surety["status"]; label: string }[] = [
  { key: "all", label: "All" }, { key: "CONSENTED", label: "Consented" },
  { key: "INVITED", label: "Pending" }, { key: "EXPIRED", label: "Lapsed" }, { key: "DECLINED", label: "Declined" },
];

function fmtDate(iso: string) { return new Date(iso).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" }); }
function daysLeft(iso: string) { return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000); }
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");

export default function SuretiesPage() {
  const [sureties, setSureties] = useState<Surety[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | Surety["status"]>("all");

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/console/sureties");
      const d = await res.json();
      if (!d.success) { setError(d.message || "Could not load sureties."); return; }
      setSureties(d.sureties); setSummary(d.summary);
    } catch { setError("Could not load sureties."); }
  }, []);
  useLoad(load);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sureties ?? []) m.set(s.status, (m.get(s.status) ?? 0) + 1);
    return m;
  }, [sureties]);

  const visible = useMemo(() => {
    if (!sureties) return null;
    return filter === "all" ? sureties : sureties.filter((s) => s.status === filter);
  }, [sureties, filter]);

  return (
    <main className="mx-auto max-w-5xl px-4 sm:px-6 py-8">
      <PageHeader
        icon={Handshake}
        title="Sureties"
        subtitle="Everyone standing behind a loan — who they back, how much they stood behind, and the evidence of their consent. Coverage is the money the book is actually protected by."
      />

      {error && <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}</div>}

      {/* Coverage-led summary */}
      {summary && (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="glass col-span-2 flex flex-col justify-center px-4 py-3 sm:col-span-1" style={{ background: "linear-gradient(135deg, rgba(5,150,105,0.10), transparent)" }}>
            <p className="text-2xl font-black tabular-nums text-emerald-700">{kes(summary.coverage)}</p>
            <p className="text-[11px] text-zinc-500">consented coverage</p>
          </div>
          <SummaryTile label="consented" value={summary.consented} tone="#059669" />
          <SummaryTile label="awaiting signature" value={summary.pending} tone="#d97706" />
          <SummaryTile label="lapsed / declined" value={summary.lapsed} tone="#64748b" />
        </div>
      )}

      {/* Filters */}
      <div className="mt-4 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const count = f.key === "all" ? sureties?.length ?? 0 : counts.get(f.key) ?? 0;
          if (f.key !== "all" && count === 0) return null;
          const on = filter === f.key;
          return (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${on ? "text-white" : "border border-zinc-900/10 bg-white/70 text-zinc-600 hover:bg-white"}`}
              style={on ? { backgroundColor: "var(--brand)" } : undefined}>
              {f.label} <span className={on ? "text-white/80" : "text-zinc-400"}>{count}</span>
            </button>
          );
        })}
      </div>

      {!sureties && !error && <div className="mt-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-zinc-400" /></div>}
      {visible && visible.length === 0 && (
        <p className="mt-10 text-center text-sm text-zinc-500">
          {filter === "all" ? "No guarantors on the book yet — they're invited from an application that requires one." : "None in this state."}
        </p>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {visible?.map((s, i) => <SuretyCard key={s.id} s={s} delay={i * 0.03} />)}
      </div>
    </main>
  );
}

function SuretyCard({ s, delay }: { s: Surety; delay: number }) {
  const st = STATUS[s.status];
  const left = daysLeft(s.expiresAt);
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.25 }}
      className="glass overflow-hidden p-4"
      style={{ borderTop: `3px solid ${st.color}` }}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-sm font-bold text-white" style={{ backgroundColor: st.color }}>
          {initials(s.name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-base font-bold text-zinc-800">{s.name}</p>
            {s.hasId && <BadgeCheck className="h-4 w-4 shrink-0 text-sky-500" />}
          </div>
          <p className="text-[12px] text-zinc-500">
            {s.relationship ?? "Guarantor"} · <a href={`tel:${s.phone}`} className="inline-flex items-center gap-1 hover:text-zinc-700"><Phone className="h-3 w-3" /> {s.phone}</a>
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[10px] font-bold" style={{ backgroundColor: st.soft, color: st.color }}>
          <st.icon className="h-3 w-3" /> {st.label}
        </span>
      </div>

      {/* The promise */}
      <div className="mt-3 flex items-end justify-between gap-3 rounded-xl bg-zinc-900/[0.03] px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-zinc-400">Stood behind</p>
          <p className="truncate text-[12px] font-medium text-zinc-600">
            {s.applicantName}{s.productName ? ` · ${s.productName}` : ""}
          </p>
        </div>
        <p className="shrink-0 text-lg font-black tabular-nums text-zinc-800">{kes(s.amountGuaranteed ?? s.amountRequested)}</p>
      </div>

      {/* The evidence — the part a table hides */}
      <div className="mt-2.5 flex items-center justify-between gap-2 text-[11px]">
        <span className="text-zinc-500">
          {s.status === "CONSENTED" && s.consentedAt && (
            <span className="inline-flex flex-wrap items-center gap-x-1.5">
              <ShieldCheck className="h-3 w-3 text-emerald-600" /> Signed {fmtDate(s.consentedAt)}
              {s.consentIp && <span className="inline-flex items-center gap-1 text-zinc-400"><Globe className="h-3 w-3" /> {s.consentIp}</span>}
            </span>
          )}
          {s.status === "INVITED" && (
            <span className={left <= 3 ? "font-semibold text-amber-600" : ""}>
              Invited {fmtDate(s.invitedAt)} · {left > 0 ? `${left}d to sign` : "window closed"}
            </span>
          )}
          {s.status === "DECLINED" && s.declinedAt && <span className="text-rose-600">Declined {fmtDate(s.declinedAt)}</span>}
          {s.status === "EXPIRED" && <span>Window lapsed {fmtDate(s.expiresAt)}</span>}
        </span>
        <Link href={s.applicationId ? `/console/applications/${s.applicationId}` : `/console/borrowers/${s.borrowerId}`}
          className="inline-flex shrink-0 items-center gap-0.5 font-semibold text-[var(--brand)] hover:underline">
          <UserRound className="h-3 w-3" /> Open file <ChevronRight className="h-3 w-3" />
        </Link>
      </div>
    </motion.div>
  );
}

function SummaryTile({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="glass px-3 py-2.5">
      <p className="text-2xl font-black tabular-nums" style={{ color: tone }}>{value}</p>
      <p className="text-[11px] text-zinc-500">{label}</p>
    </div>
  );
}
