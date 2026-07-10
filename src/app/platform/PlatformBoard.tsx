"use client";

// The platform board — review queue first, then the whole estate.
//
// The founder's flow: a lender onboards and configures itself; when they hit
// "Request activation" they rise to the top here with a setup-completeness
// meter; he reviews, flips them ACTIVE, and can step INTO any org's console
// ("Enter console" = audited impersonation with a permanent banner). Assigning
// a package records a commercial decision — the Hub wallet still collects the
// money, and PAST_DUE still switches metered features off.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLoad } from "@/lib/hooks/useLoad";
import {
  Loader2, AlertTriangle, ShieldCheck, CheckCircle2, Crown, Receipt,
  MessageSquare, Gift, LogOut, ArrowRightCircle, Circle, BadgeCheck,
} from "lucide-react";

type PlanOpt = { key: string; name: string; monthlyKes: number };
type Setup = { branding: boolean; products: boolean; workflows: boolean; roles: boolean; team: boolean; vault: boolean };
type OrgRow = {
  id: string; slug: string; name: string; mode: string; status: string; plan: string; createdAt: string;
  logoUrl: string | null; accent: string;
  activationRequestedAt: string | null;
  setup: Setup;
  subscription: { status: string; trialEndsAt: string | null; currentPeriodEnd: string } | null;
  lastInvoice: { number: string; totalKes: number; status: string } | null;
  smsBalance: number;
  _count: { staff: number; borrowers: number; loans: number; applications: number };
};

const TONE: Record<string, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-700",
  PENDING: "bg-amber-100 text-amber-700",
  SUSPENDED: "bg-red-100 text-red-700",
};
const SUB_TONE: Record<string, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-700",
  TRIALING: "bg-sky-100 text-sky-700",
  PAST_DUE: "bg-amber-100 text-amber-700",
  CANCELED: "bg-rose-100 text-rose-700",
};
const SETUP_LABEL: Record<keyof Setup, string> = {
  branding: "Logo", products: "Products", workflows: "Workflows", roles: "Roles", team: "Team", vault: "Vault",
};

const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

export default function PlatformBoard({ adminName }: { adminName: string }) {
  const router = useRouter();
  const [orgs, setOrgs] = useState<OrgRow[] | null>(null);
  const [plans, setPlans] = useState<PlanOpt[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  // Inline SMS-grant form, one org at a time. The note is mandatory — it is the
  // only record of why the platform gave credit away.
  const [grantFor, setGrantFor] = useState<string | null>(null);
  const [grantUnits, setGrantUnits] = useState("500");
  const [grantNote, setGrantNote] = useState("");

  const load = async () => {
    setError(null);
    try {
      const res = await fetch("/api/platform/orgs");
      const data = await res.json();
      if (!data.success) {
        if (res.status === 401) { router.replace("/platform/login"); return; }
        setError(data.message || "Could not load."); return;
      }
      setOrgs(data.orgs); setPlans(data.plans ?? []);
    } catch { setError("Could not load."); }
  };
  useLoad(load);

  const post = async (body: Record<string, unknown>, key: string) => {
    setActing(key); setError(null); setNotice(null);
    try {
      const res = await fetch("/api/platform/orgs", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "Action failed."); return; }
      setNotice(
        data.granted
          ? `${data.slug} +${Number(data.granted).toLocaleString()} SMS${data.flushed ? ` · ${data.flushed} queued messages sent` : ""}`
          : data.plan ? `${data.slug} → ${data.plan}` : `${data.slug} → ${data.status}`,
      );
      await load();
    } catch { setError("Action failed."); } finally { setActing(null); }
  };

  const impersonate = async (o: OrgRow) => {
    setActing(o.id + "enter"); setError(null);
    try {
      const res = await fetch("/api/platform/impersonate", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orgId: o.id }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not enter the console."); return; }
      window.location.assign("/console");
    } catch { setError("Could not enter the console."); } finally { setActing(null); }
  };

  const signOut = async () => {
    await fetch("/api/platform/auth/login", { method: "DELETE" });
    router.replace("/platform/login");
  };

  // Review queue first: activation requests, then other PENDING, then the rest.
  const sorted = orgs
    ? [...orgs].sort((a, b) => {
        const score = (o: OrgRow) => (o.activationRequestedAt && o.status === "PENDING" ? 0 : o.status === "PENDING" ? 1 : 2);
        return score(a) - score(b) || +new Date(b.createdAt) - +new Date(a.createdAt);
      })
    : null;

  return (
    <div className="min-h-screen relative text-zinc-900">
      <div aria-hidden className="fixed inset-0 z-0 bg-[url('/images/white-background.png')] bg-cover bg-center" />
      <main className="relative z-10 mx-auto max-w-5xl px-4 sm:px-6 py-10">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" style={{ color: "var(--brand)" }} /> BirgenAI Platform — Organizations
          </h1>
          <div className="flex items-center gap-2">
            <span className="hidden sm:block text-xs text-zinc-500">{adminName} · platform admin</span>
            <button onClick={signOut} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-900/15 bg-white/70 px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-white">
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </button>
          </div>
        </div>

        {notice && <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50/90 px-3 py-2.5 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> {notice}</div>}
        {error && <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}</div>}

        {!sorted ? (
          <div className="glass mt-5 p-5 text-sm text-zinc-500 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading the estate…</div>
        ) : (
          <>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Tile label="Lenders" value={String(sorted.length)} />
              <Tile label="Live" value={String(sorted.filter((o) => o.status === "ACTIVE").length)} />
              <Tile label="Awaiting review" value={String(sorted.filter((o) => o.status === "PENDING" && o.activationRequestedAt).length)} />
              <Tile label="Loans on the platform" value={sorted.reduce((s, o) => s + o._count.loans, 0).toLocaleString()} />
            </div>

            <div className="mt-5 space-y-3">
              {sorted.map((o) => {
                const setupDone = Object.values(o.setup).filter(Boolean).length;
                return (
                  <div key={o.id} className={`glass p-4 ${o.activationRequestedAt && o.status === "PENDING" ? "ring-1 ring-amber-400/60" : ""}`}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        {o.logoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={o.logoUrl} alt="" className="h-8 w-8 shrink-0 rounded-lg object-contain" />
                        ) : (
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white" style={{ backgroundColor: o.accent }}>
                            {o.name.slice(0, 1)}
                          </span>
                        )}
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">
                            {o.name} <span className="font-normal text-zinc-400">· {o.slug}.birgenai.com</span>
                          </p>
                          <p className="text-xs text-zinc-500">
                            {o.mode} · {o._count.staff} staff · {o._count.borrowers} borrowers · {o._count.loans} loans · {o._count.applications} apps
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        {o.activationRequestedAt && o.status === "PENDING" && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-700">
                            <BadgeCheck className="h-3 w-3" /> requested {day(o.activationRequestedAt)}
                          </span>
                        )}
                        <span className={`rounded-md px-2 py-1 text-[11px] font-semibold ${TONE[o.status] ?? TONE.PENDING}`}>{o.status}</span>
                        {o.status !== "ACTIVE" && (
                          <button disabled={!!acting} onClick={() => post({ orgId: o.id, action: "activate" }, o.id + "activate")}
                            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-zinc-800 disabled:opacity-60">
                            {acting === o.id + "activate" ? <Loader2 className="inline h-3 w-3 animate-spin" /> : "Activate"}
                          </button>
                        )}
                        {o.status === "ACTIVE" && (
                          <button disabled={!!acting} onClick={() => post({ orgId: o.id, action: "suspend" }, o.id + "suspend")}
                            className="rounded-lg border border-red-200 bg-white/70 px-3 py-1.5 text-[11px] font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60">
                            Suspend
                          </button>
                        )}
                        {o.status !== "SUSPENDED" && (
                          <button disabled={!!acting} onClick={() => impersonate(o)}
                            title="Open this lender's console as platform admin — audited, banner always on"
                            className="inline-flex items-center gap-1 rounded-lg border border-zinc-900/15 bg-white/70 px-3 py-1.5 text-[11px] font-semibold text-zinc-700 hover:bg-white disabled:opacity-60">
                            {acting === o.id + "enter" ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowRightCircle className="h-3 w-3" />} Enter console
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Setup completeness — can this lender actually lend if activated? */}
                    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-zinc-900/5 pt-3">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Setup {setupDone}/6</span>
                      {(Object.keys(o.setup) as (keyof Setup)[]).map((k) => (
                        <span key={k} className={`inline-flex items-center gap-1 text-[11px] ${o.setup[k] ? "text-emerald-600" : "text-zinc-400"}`}>
                          {o.setup[k] ? <CheckCircle2 className="h-3 w-3" /> : <Circle className="h-3 w-3" />} {SETUP_LABEL[k]}
                        </span>
                      ))}
                    </div>

                    {/* Commercials: what they are on, whether it is paid for, what they last owed. */}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Crown className="h-3.5 w-3.5 text-zinc-400" />
                      <select
                        value={o.plan}
                        disabled={!!acting}
                        onChange={(e) => post({ orgId: o.id, action: "plan", plan: e.target.value }, o.id + "plan")}
                        className="rounded-lg border border-zinc-900/15 bg-white px-2.5 py-1 text-xs font-semibold outline-none disabled:opacity-60"
                      >
                        {plans.map((p) => (
                          <option key={p.key} value={p.key}>{p.name} — {kes(p.monthlyKes)}/mo</option>
                        ))}
                      </select>
                      {acting === o.id + "plan" && <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" />}

                      {o.subscription ? (
                        <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${SUB_TONE[o.subscription.status] ?? "bg-zinc-900/5 text-zinc-500"}`}>
                          {o.subscription.status.replace("_", " ").toLowerCase()}
                          {o.subscription.status === "TRIALING" && o.subscription.trialEndsAt ? ` · ends ${day(o.subscription.trialEndsAt)}` : ""}
                        </span>
                      ) : (
                        <span className="rounded-md bg-zinc-900/5 px-2 py-0.5 text-[10px] font-semibold text-zinc-500">no subscription yet</span>
                      )}

                      {o.lastInvoice && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500">
                          <Receipt className="h-3 w-3" /> {o.lastInvoice.number} · {kes(o.lastInvoice.totalKes)} · {o.lastInvoice.status.toLowerCase()}
                        </span>
                      )}

                      {/* Prepaid comms: negative = we are fronting this lender's messages. */}
                      <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold ${o.smsBalance < 0 ? "bg-red-100 text-red-700" : "bg-zinc-900/5 text-zinc-500"}`}>
                        <MessageSquare className="h-3 w-3" /> {o.smsBalance.toLocaleString()} SMS
                      </span>
                      <button
                        onClick={() => { setGrantFor(grantFor === o.id ? null : o.id); setGrantUnits("500"); setGrantNote(""); }}
                        className="inline-flex items-center gap-1 rounded-md border border-zinc-900/10 bg-white/70 px-2 py-0.5 text-[10px] font-semibold text-zinc-600 hover:bg-white"
                      >
                        <Gift className="h-3 w-3" /> Grant
                      </button>
                    </div>

                    {grantFor === o.id && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <input
                          type="number" min={1} max={100000} value={grantUnits}
                          onChange={(e) => setGrantUnits(e.target.value)}
                          className="w-24 rounded-lg border border-zinc-900/15 bg-white px-2.5 py-1.5 text-xs tabular-nums outline-none"
                        />
                        <input
                          value={grantNote} onChange={(e) => setGrantNote(e.target.value)}
                          placeholder="Why? — recorded in the lender's ledger"
                          className="min-w-44 flex-1 rounded-lg border border-zinc-900/15 bg-white px-2.5 py-1.5 text-xs outline-none"
                        />
                        <button
                          disabled={!!acting || !grantNote.trim() || !(Number(grantUnits) >= 1)}
                          onClick={() => {
                            void post({ orgId: o.id, action: "grant-sms", units: Number(grantUnits), note: grantNote.trim() }, o.id + "grant");
                            setGrantFor(null);
                          }}
                          className="rounded-lg bg-zinc-900 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-zinc-800 disabled:opacity-60"
                        >
                          {acting === o.id + "grant" ? <Loader2 className="inline h-3 w-3 animate-spin" /> : "Grant SMS"}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <p className="mt-5 text-[11px] text-zinc-400">
              Assigning a package records a commercial decision. It does not collect money — the BirgenAI wallet does —
              and a past-due lender still loses its metered features whatever is set here. &quot;Enter console&quot; is audited on
              both sides and shows a permanent banner inside the org.
            </p>
          </>
        )}
      </main>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass p-3.5">
      <p className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-lg font-bold tabular-nums">{value}</p>
    </div>
  );
}
