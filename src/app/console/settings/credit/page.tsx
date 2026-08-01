"use client";

// ─────────────────────────────────────────────────────────────────────────────
// CREDIT POLICY — the lender document that decides who borrows, how much, and
// what good repayment earns.
//
// This matrix has been a first-class object at the data layer for a while: it is
// versioned in the `credit` namespace, validated before write, and read live by
// the decision engine and the graduation cron. What it did not have was a door.
// Editing it meant PUT /api/config/credit with the whole document — which works,
// and which no lender will ever do.
//
// Two things make this more than a form over JSON:
//
//   THE FACTOR CURVES. A scoring band is four numbers whose consequence is a
//   shape. "One day late costs 70 points" is invisible as a number and obvious
//   as a cliff, so the bands are drawn and dragged (BandEditor).
//
//   THE LIVE PREVIEW. Every edit is run over the real book — the same pure
//   `assessLadder()` the cron uses — against the policy that is live today, so
//   the screen answers "this moves 340 customers, and here is one of them"
//   rather than "saved". Publishing a credit policy blind is how a lender
//   discovers in six weeks that nobody has graduated since March.
//
// One document, one dirty state, one Publish — the borrower-settings contract.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  Scale, Loader2, AlertTriangle, CheckCircle2, ArrowLeft, History, RotateCcw, Save,
  Layers, Wallet, Ban, Scissors, Package, Activity, TrendingUp, Gavel, X,
  BarChart3, Plus, Trash2, Wand2,
} from "lucide-react";
import { useLoad } from "@/lib/hooks/useLoad";
import {
  Toggle, SwitchRow, Choice, RuleBlock, NumberField, TextField, SelectField, Divider,
  SliderField, PillSet,
} from "@/components/settings/controls";
import type { ConfigIssue } from "@/lib/config/borrower";
import {
  SCORE_BANDS, validateCreditPolicy, CREDIT_DEFAULTS, MULAR_POLICY,
  type CreditPolicy, type ScoreBand, type AffordabilityBand,
} from "@/lib/decision/policy";
import {
  FACTOR_METRICS, BEHAVIOUR_DEFAULTS, MICROMART_BEHAVIOUR,
  type FactorMetric, type ScoreFactor, type RiskCategory,
} from "@/lib/scoring/behaviour-policy";
import type { PolicyImpact, BorrowerPreview } from "@/lib/risk/policy-impact";
import { BandEditor } from "./BandEditor";
import { ImpactPanel, type PreviewState } from "./ImpactPanel";

type Revision = { version: number; changed: string[]; createdAt: string };

const AFFORDABILITY_BANDS: AffordabilityBand[] = ["Low risk", "Moderate risk", "High risk", "Severe risk"];

const SECTIONS = [
  { key: "scoreCeilings", label: "Score ceilings", icon: Layers, blurb: "The most a statement of each quality can ever justify." },
  { key: "capacity", label: "Affordability", icon: Wallet, blurb: "How much of an assessed capacity you are willing to commit." },
  { key: "stops", label: "Hard stops", icon: Ban, blurb: "The conditions under which you will not lend at all." },
  { key: "haircuts", label: "Haircuts", icon: Scissors, blurb: "Signals that tighten a limit rather than refuse it." },
  { key: "match", label: "Product match", icon: Package, blurb: "How a qualified borrower is matched to one of your products." },
  { key: "behaviour", label: "Behaviour matrix", icon: Activity, blurb: "How a repeat borrower is scored on their own repayment record." },
  { key: "graduation", label: "Graduation ladder", icon: TrendingUp, blurb: "What a good record earns — and what a bad one costs." },
  { key: "verdict", label: "Auto-decision", icon: Gavel, blurb: "Where the engine may decide alone, and where a person must." },
] as const;

type SectionKey = (typeof SECTIONS)[number]["key"];

export default function CreditPolicyScreen() {
  const reduce = useReducedMotion();
  const [cfg, setCfg] = useState<CreditPolicy | null>(null);
  const [saved, setSaved] = useState<CreditPolicy | null>(null);
  const [version, setVersion] = useState(0);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [section, setSection] = useState<SectionKey>("behaviour");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [issues, setIssues] = useState<ConfigIssue[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // ── Preview ────────────────────────────────────────────────────────────────
  const [previewState, setPreviewState] = useState<PreviewState>("idle");
  const [impact, setImpact] = useState<PolicyImpact | null>(null);
  const [detail, setDetail] = useState<BorrowerPreview | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [namesWithheld, setNamesWithheld] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: string; name: string | null; phone: string }[]>([]);
  // Only the newest preview may write state — a fast typist outruns the round trip.
  const seq = useRef(0);

  const load = async () => {
    try {
      const res = await fetch("/api/config/credit");
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not load the credit policy."); return; }
      setCfg(data.value); setSaved(data.value); setVersion(data.version);
      setRevisions(data.history ?? []); setError(null);
    } catch { setError("Could not load the credit policy."); }
  };
  useLoad(load);

  const dirty = useMemo(
    () => Boolean(cfg && saved && JSON.stringify(cfg) !== JSON.stringify(saved)),
    [cfg, saved],
  );

  const liveIssues = useMemo(() => (cfg ? validateCreditPolicy(cfg) : []), [cfg]);
  const issueFor = (prefix: string) =>
    [...issues, ...liveIssues].find((i) => i.path === prefix || i.path.startsWith(`${prefix}.`));

  const runPreview = useCallback(async (policy: CreditPolicy, borrowerId: string | null) => {
    const mine = ++seq.current;
    setPreviewState("loading");
    try {
      const res = await fetch("/api/config/credit/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policy, borrowerId: borrowerId ?? undefined }),
      });
      const data = await res.json();
      if (mine !== seq.current) return;
      if (!data.success) { setPreviewState("error"); return; }
      if (borrowerId) setDetail(data.borrower ?? null);
      else { setImpact(data.impact ?? null); setNamesWithheld(Boolean(data.namesWithheld)); }
      setPreviewState("ready");
    } catch {
      if (mine === seq.current) setPreviewState("error");
    }
  }, []);

  // Debounced: dragging a threshold fires an edit per pointer move, and the book
  // should be re-run when the hand stops, not sixty times on the way.
  const cfgKey = useMemo(() => JSON.stringify(cfg), [cfg]);
  useEffect(() => {
    if (!cfg) return;
    const t = setTimeout(() => { void runPreview(cfg, picked); }, 550);
    return () => clearTimeout(t);
    // `cfgKey` stands in for `cfg` by value — a new object identity with the same
    // content must not re-run the book.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfgKey, picked, runPreview]);

  // Borrower lookup, so any customer can be inspected — not only the ones who move.
  // Aborting on cleanup is what stops a slow response for "kip" overwriting the
  // list for "kiplet" that the user is already looking at.
  useEffect(() => {
    const needle = q.trim();
    if (needle.length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/console/borrowers?q=${encodeURIComponent(needle)}`, { signal: ctrl.signal });
        const data = await res.json();
        setResults(!data.success ? [] : (data.borrowers ?? []).slice(0, 8)
          .map((b: { id: string; name: string | null; phone: string }) => ({ id: b.id, name: b.name, phone: b.phone })));
      } catch { /* aborted, or offline — the previous list simply stands */ }
    }, 350);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q]);

  // Derived, not stored: a query too short to search shows nothing without an
  // effect having to reach back in and clear state.
  const visibleResults = q.trim().length >= 2 ? results : [];

  const pick = (id: string | null) => {
    setPicked(id);
    setQ(""); setResults([]);
    if (!id) setDetail(null);
  };

  const save = async () => {
    if (!cfg) return;
    setBusy(true); setError(null); setNotice(null); setIssues([]);
    try {
      const res = await fetch("/api/config/credit", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: cfg }),
      });
      const data = await res.json();
      if (res.status === 422) { setIssues(data.issues ?? []); setError(data.message); return; }
      if (!data.success) { setError(data.message || "Could not save."); return; }
      setSaved(data.value); setCfg(data.value); setVersion(data.version);
      setNotice(`Published as version ${data.version} — every decision from here uses it.`);
      const fresh = await fetch("/api/config/credit").then((r) => r.json()).catch(() => null);
      if (fresh?.success) setRevisions(fresh.history ?? []);
    } catch { setError("Could not save."); } finally { setBusy(false); }
  };

  if (error && !cfg) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <p className="flex items-start gap-2 rounded-xl bg-red-500/10 px-3 py-2.5 text-sm text-red-800 ring-1 ring-red-600/20">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      </main>
    );
  }
  if (!cfg) {
    return <main className="flex justify-center py-20"><Loader2 className="h-5 w-5 animate-spin text-[color:var(--ink-faint)]" /></main>;
  }

  const Active = SECTIONS.find((s) => s.key === section)!;
  const set = <K extends keyof CreditPolicy>(key: K, value: CreditPolicy[K]) =>
    setCfg((c) => (c ? { ...c, [key]: value } : c));

  const panel = (
    <ImpactPanel
      state={previewState}
      impact={impact}
      detail={detail}
      dirty={dirty}
      namesWithheld={namesWithheld}
      onRefresh={() => { void runPreview(cfg, picked); }}
      onPick={pick}
      search={{ q, onQ: setQ, results: visibleResults }}
    />
  );

  return (
    <main className="mx-auto max-w-[100rem] px-4 pb-24 pt-6 sm:px-6 sm:pt-8 xl:pb-8">
      <Link href="/console/settings" className="t-meta inline-flex items-center gap-1.5 text-[12px] hover:text-[color:var(--ink)]">
        <ArrowLeft className="h-3.5 w-3.5" /> Settings &amp; Vault
      </Link>

      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="t-display flex items-center gap-2 text-[1.6rem]">
            <Scale className="h-6 w-6" style={{ color: "var(--brand)" }} /> Credit policy
          </h1>
          <p className="t-meta mt-1 max-w-2xl">
            Your underwriting, as one versioned document — who qualifies, for how much, and what a
            good repayment record earns. Every change is previewed against your real book before it
            takes effect.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-[color:var(--ink-muted)] ring-1 ring-[color:var(--ink)]/10 hover:text-[color:var(--ink)]"
          >
            <History className="h-3.5 w-3.5" /> {version > 0 ? `v${version}` : "Defaults"}
          </button>
          {dirty && (
            <button
              type="button"
              onClick={() => { setCfg(saved); setIssues([]); }}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-[color:var(--ink-muted)] hover:text-[color:var(--ink)]"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Discard
            </button>
          )}
          <button
            type="button"
            onClick={save}
            disabled={busy || !dirty || liveIssues.length > 0}
            title={liveIssues.length > 0 ? "Resolve the highlighted problems first." : undefined}
            className="inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-[11px] font-bold text-white disabled:opacity-50"
            style={{ backgroundColor: "var(--brand)" }}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {dirty ? "Publish changes" : "Saved"}
          </button>
        </div>
      </div>

      {notice && (
        <div className="mt-4 flex items-start gap-2 rounded-xl bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-800 ring-1 ring-emerald-600/20">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {notice}
        </div>
      )}
      {(error || liveIssues.length > 0) && (
        <div className="mt-4 rounded-xl bg-amber-500/10 px-3 py-2.5 text-sm text-amber-900 ring-1 ring-amber-600/20">
          <p className="flex items-start gap-2 font-semibold">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {error ?? "This policy would not hold together."}
          </p>
          <ul className="mt-1.5 space-y-0.5 pl-6 text-[12px]">
            {[...new Map([...issues, ...liveIssues].map((i) => [i.path + i.message, i])).values()].map((i) => (
              <li key={i.path + i.message} className="list-disc">{i.message}</li>
            ))}
          </ul>
        </div>
      )}

      <AnimatePresence>
        {showHistory && (
          <motion.div
            initial={reduce ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={reduce ? undefined : { opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="glass mt-4 p-4">
              <p className="t-label">Published versions</p>
              {revisions.length === 0 ? (
                <p className="t-meta mt-2 text-[12px]">
                  Nothing published yet — you are looking at the BirgenAI defaults.
                </p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {revisions.map((r) => (
                    <li key={r.version} className="flex items-center justify-between gap-3 text-[12px]">
                      <span className="font-semibold text-[color:var(--ink)]">v{r.version}</span>
                      <span className="t-meta flex-1 truncate text-[11px]">
                        {(r.changed ?? []).length ? `changed: ${(r.changed as string[]).join(", ")}` : "initial"}
                      </span>
                      <span className="t-meta shrink-0 text-[11px]">
                        {new Date(r.createdAt).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-5 grid gap-4 lg:grid-cols-[14rem_minmax(0,1fr)] xl:grid-cols-[14rem_minmax(0,1fr)_21rem]">
        <nav className="flex gap-1.5 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
          {SECTIONS.map((s) => {
            const on = s.key === section;
            const problem = Boolean(issueFor(s.key));
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => setSection(s.key)}
                className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-2.5 text-left transition-colors lg:w-full ${
                  on ? "text-white" : "text-[color:var(--ink-body)] hover:bg-[color:var(--ink)]/[0.04]"
                }`}
                style={on ? { backgroundColor: "var(--brand)" } : undefined}
              >
                <s.icon className="h-4 w-4 shrink-0" />
                <span className="text-[12px] font-semibold">{s.label}</span>
                {problem && <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />}
              </button>
            );
          })}
        </nav>

        <div className="canvas min-w-0 rounded-2xl p-4 sm:p-6">
          <div className="mb-4 border-b border-[color:var(--ink)]/[0.07] pb-3">
            <h2 className="t-section flex items-center gap-2"><Active.icon className="h-4 w-4 text-[color:var(--brand)]" /> {Active.label}</h2>
            <p className="t-meta mt-0.5 text-[12px]">{Active.blurb}</p>
          </div>

          {section === "scoreCeilings" && <CeilingsSection cfg={cfg} set={set} />}
          {section === "capacity" && <CapacitySection cfg={cfg} set={set} />}
          {section === "stops" && <StopsSection cfg={cfg} set={set} />}
          {section === "haircuts" && <HaircutsSection cfg={cfg} set={set} />}
          {section === "match" && <MatchSection cfg={cfg} set={set} />}
          {section === "behaviour" && <BehaviourSection cfg={cfg} set={set} />}
          {section === "graduation" && <GraduationSection cfg={cfg} set={set} />}
          {section === "verdict" && <VerdictSection cfg={cfg} set={set} replace={(p) => setCfg(p)} />}
        </div>

        <aside className="hidden xl:block">
          <div className="glass sticky top-4 h-[calc(100vh-7rem)] overflow-hidden rounded-2xl">{panel}</div>
        </aside>
      </div>

      {/* The same panel on a phone: a bar you can always see, a sheet you can pull up. */}
      <div className="xl:hidden">
        <button
          type="button"
          onClick={() => setSheet(true)}
          className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 border-t border-[color:var(--ink)]/[0.08] bg-white/95 px-4 py-3 backdrop-blur"
        >
          <span className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-[color:var(--brand)]" />
            <span className="text-[12px] font-bold text-[color:var(--ink)]">
              {previewState === "loading"
                ? "Running the preview…"
                : impact
                  ? `${impact.changed.toLocaleString("en-KE")} of ${impact.sampled.toLocaleString("en-KE")} land somewhere else`
                  : "Live preview"}
            </span>
          </span>
          <span className="t-label shrink-0">View</span>
        </button>

        <AnimatePresence>
          {sheet && (
            <motion.div
              className="fixed inset-0 z-40 flex items-end bg-black/30"
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reduce ? undefined : { opacity: 0 }}
              onClick={() => setSheet(false)}
            >
              <motion.div
                className="max-h-[85vh] w-full overflow-hidden rounded-t-2xl bg-white"
                initial={reduce ? false : { y: 40 }}
                animate={{ y: 0 }}
                exit={reduce ? undefined : { y: 40 }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between px-3.5 pt-2.5">
                  <span className="mx-auto h-1 w-10 rounded-full bg-[color:var(--ink)]/15" />
                  <button
                    type="button"
                    aria-label="Close preview"
                    onClick={() => setSheet(false)}
                    className="rounded-md p-1 text-[color:var(--ink-muted)]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="h-[70vh]">{panel}</div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </main>
  );
}

type SetFn = <K extends keyof CreditPolicy>(key: K, value: CreditPolicy[K]) => void;

// ── Score ceilings ────────────────────────────────────────────────────────────
function CeilingsSection({ cfg, set }: { cfg: CreditPolicy; set: SetFn }) {
  const max = Math.max(1, ...SCORE_BANDS.map((b) => cfg.scoreCeilings[b]));
  return (
    <div className="space-y-5">
      <p className="t-meta text-[12px]">
        A borrower&rsquo;s statement earns them a quality band. This is the most that band can ever
        justify — before affordability, before haircuts, before the product&rsquo;s own limits. It is a
        ceiling, never an entitlement.
      </p>

      <div className="space-y-2">
        {SCORE_BANDS.map((band) => (
          <div key={band} className="grid grid-cols-[6.5rem_1fr_8rem] items-center gap-3">
            <span className="text-[13px] font-semibold text-[color:var(--ink)]">{band}</span>
            <span className="h-2 rounded-full bg-[color:var(--ink)]/[0.07]">
              <span
                className="block h-full rounded-full"
                style={{ width: `${(cfg.scoreCeilings[band] / max) * 100}%`, backgroundColor: "var(--brand)" }}
              />
            </span>
            <input
              type="number" inputMode="numeric" min={0} step={500}
              value={cfg.scoreCeilings[band]}
              onChange={(e) => set("scoreCeilings", { ...cfg.scoreCeilings, [band]: Number(e.target.value) || 0 } as Record<ScoreBand, number>)}
              className="w-full rounded-lg border border-[color:var(--ink)]/12 bg-white px-2.5 py-2 text-sm tabular-nums outline-none focus:border-[color:var(--brand)]"
            />
          </div>
        ))}
      </div>

      <p className="t-meta text-[11px]">
        A stronger statement may never be allowed less than a weaker one — the ladder has to read
        forwards to the customer it is explained to.
      </p>
    </div>
  );
}

// ── Affordability ─────────────────────────────────────────────────────────────
function CapacitySection({ cfg, set }: { cfg: CreditPolicy; set: SetFn }) {
  const c = cfg.capacity;
  const patch = (p: Partial<CreditPolicy["capacity"]>) => set("capacity", { ...c, ...p });
  return (
    <div className="space-y-5">
      <SliderField
        label="How much of assessed capacity you will commit"
        value={Math.round(c.utilisation * 100)} min={10} max={100} step={5}
        format={(v) => `${v}%`}
        help="100% spends the whole repayment capacity the statement shows. Below that keeps headroom for the shock the statement cannot see."
        onChange={(v) => patch({ utilisation: v / 100 })}
      />

      <Divider label="The reference loan" />
      <p className="t-meta text-[12px]">
        Capacity is a number per month; a limit is a principal. This is the loan used to convert one
        into the other — your own typical term and its all-in cost, not a platform assumption.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField
          label="Term unit" value={c.referenceTermUnit}
          options={[{ value: "week", label: "Weeks" }, { value: "month", label: "Months" }]}
          onChange={(v) => patch({ referenceTermUnit: v as CreditPolicy["capacity"]["referenceTermUnit"] })}
        />
        <NumberField label="Term length" value={c.referenceTermCount} min={1} max={60}
          onChange={(v) => patch({ referenceTermCount: v })} />
        <NumberField label="All-in cost over the term" value={c.referenceAllInPct} min={0} max={400} step={0.5} suffix="%"
          help="Interest plus every charge."
          onChange={(v) => patch({ referenceAllInPct: v })} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <NumberField label="Round the ceiling down to" value={c.roundTo} min={1} step={100} money
          help="A limit of KES 8,500 is a decision; KES 8,473 is a leak."
          onChange={(v) => patch({ roundTo: v })} />
        <SliderField
          label="Affordability tolerance"
          value={Math.round(c.affordabilityTolerance * 100)} min={0} max={50} step={1}
          format={(v) => `${v}%`}
          help="How far an installment may exceed assessed capacity and still count affordable."
          onChange={(v) => patch({ affordabilityTolerance: v / 100 })}
        />
      </div>
    </div>
  );
}

// ── Hard stops ────────────────────────────────────────────────────────────────
function StopsSection({ cfg, set }: { cfg: CreditPolicy; set: SetFn }) {
  const s = cfg.stops;
  const patch = (p: Partial<CreditPolicy["stops"]>) => set("stops", { ...s, ...p });
  return (
    <div className="space-y-5">
      <p className="t-meta text-[12px]">
        Every stop that fires becomes a named decline reason on the application. A borrower is never
        refused by a silent zero — somebody has to be able to tell them why.
      </p>

      <PillSet<ScoreBand>
        label="Score bands you will not lend to"
        options={SCORE_BANDS.map((b) => ({ value: b, label: b }))}
        selected={s.refuseScoreBands}
        onChange={(v) => patch({ refuseScoreBands: v })}
      />

      <PillSet<AffordabilityBand>
        label="Affordability bands you will not lend to"
        options={AFFORDABILITY_BANDS.map((b) => ({ value: b, label: b }))}
        selected={s.refuseAffordabilityBands}
        onChange={(v) => patch({ refuseAffordabilityBands: v })}
      />

      <Divider label="Cashflow floors" />
      <SliderField
        label="Refuse when borrowed money is this much of inflow"
        value={Math.round(s.maxLoanDependency * 100)} min={0} max={100} step={5}
        format={(v) => (v === 0 ? "off" : `${v}%`)}
        help="Somebody whose income is mostly other lenders' money is refinancing, not trading. 0 switches the check off."
        onChange={(v) => patch({ maxLoanDependency: v / 100 })}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <NumberField label="Minimum net monthly cashflow" value={s.minMonthlyNet} min={0} step={500} money
          onChange={(v) => patch({ minMonthlyNet: v })} />
        <NumberField label="Minimum statement length" value={s.minMonthsCovered} min={0} max={24} suffix="mo"
          help="0 accepts any statement, however short."
          onChange={(v) => patch({ minMonthsCovered: v })} />
      </div>
    </div>
  );
}

// ── Haircuts ──────────────────────────────────────────────────────────────────
function HaircutsSection({ cfg, set }: { cfg: CreditPolicy; set: SetFn }) {
  const h = cfg.haircuts;
  const patch = (p: Partial<CreditPolicy["haircuts"]>) => set("haircuts", { ...h, ...p });
  return (
    <div className="space-y-4">
      <p className="t-meta text-[12px]">
        A haircut is the honest middle between approving and refusing: the signal is real, so the
        limit comes down and the reason is recorded — rather than the application being declined for
        something the borrower could have fixed.
      </p>

      <RuleBlock
        title="Betting" desc="Above this share of outflow, the limit is cut."
        checked={h.bettingCutPct > 0}
        onChange={(v) => patch({ bettingCutPct: v ? 20 : 0 })}
      >
        <div className="grid grid-cols-2 gap-3">
          <SliderField label="Betting above" value={Math.round(h.bettingRatio * 100)} min={0} max={50} step={1}
            format={(v) => `${v}% of outflow`} onChange={(v) => patch({ bettingRatio: v / 100 })} />
          <SliderField label="Cuts the limit by" value={h.bettingCutPct} min={0} max={90} step={5}
            format={(v) => `${v}%`} onChange={(v) => patch({ bettingCutPct: v })} />
        </div>
      </RuleBlock>

      <RuleBlock
        title="Income volatility" desc="An income that swings is an income that misses an installment."
        checked={h.volatilityCutPct > 0}
        onChange={(v) => patch({ volatilityCutPct: v ? 15 : 0 })}
      >
        <div className="grid grid-cols-2 gap-3">
          <SliderField label="Variation above" value={Math.round(h.incomeVolatility * 100)} min={10} max={150} step={5}
            format={(v) => `${v}%`} onChange={(v) => patch({ incomeVolatility: v / 100 })} />
          <SliderField label="Cuts the limit by" value={h.volatilityCutPct} min={0} max={90} step={5}
            format={(v) => `${v}%`} onChange={(v) => patch({ volatilityCutPct: v })} />
        </div>
      </RuleBlock>

      <RuleBlock
        title="Thin file" desc="A short statement is not a bad one — it is simply less evidence."
        checked={h.thinFileCutPct > 0}
        onChange={(v) => patch({ thinFileCutPct: v ? 25 : 0 })}
      >
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Shorter than" value={h.thinFileMonths} min={1} max={12} suffix="mo"
            onChange={(v) => patch({ thinFileMonths: v })} />
          <SliderField label="Cuts the limit by" value={h.thinFileCutPct} min={0} max={90} step={5}
            format={(v) => `${v}%`} onChange={(v) => patch({ thinFileCutPct: v })} />
        </div>
      </RuleBlock>
    </div>
  );
}

// ── Product match ─────────────────────────────────────────────────────────────
function MatchSection({ cfg, set }: { cfg: CreditPolicy; set: SetFn }) {
  const m = cfg.match;
  const patch = (p: Partial<CreditPolicy["match"]>) => set("match", { ...m, ...p });

  const setRung = (i: number, p: Partial<CreditPolicy["match"]["ladder"][number]>) =>
    patch({ ladder: m.ladder.map((r, idx) => (idx === i ? { ...r, ...p } : r)) });

  return (
    <div className="space-y-5">
      <Choice
        label="How is a borrower matched to one of your products?"
        value={m.mode} cols={2}
        onChange={(v) => patch({ mode: v as CreditPolicy["match"]["mode"] })}
        options={[
          { value: "rules", label: "By the product's own rules", hint: "Each product's eligibility and limit blocks decide. Recommended — it works for products you have not created yet." },
          { value: "ladder", label: "By a named tier ladder", hint: "The starting limit is snapped into a rung, and the rung's name prefixes the product." },
        ]}
      />

      {m.mode === "ladder" && (
        <div>
          <p className="t-label mb-2">Tier ladder</p>
          <div className="space-y-2">
            {m.ladder.map((r, i) => (
              <div key={i} className="grid grid-cols-2 gap-2 rounded-xl px-3 py-3 ring-1 ring-[color:var(--ink)]/[0.07] sm:grid-cols-[1fr_1fr_1fr_1fr_1fr_2rem]">
                <TextField label="Product prefix" value={r.key} onChange={(v) => setRung(i, { key: v.toUpperCase() })} />
                <TextField label="Shown as" value={r.label} onChange={(v) => setRung(i, { label: v })} />
                <NumberField label="From" value={r.min} min={0} step={500} money onChange={(v) => setRung(i, { min: v })} />
                <NumberField label="To" value={r.max} min={0} step={500} money onChange={(v) => setRung(i, { max: v })} />
                <NumberField label="Step" value={r.step} min={1} step={100} onChange={(v) => setRung(i, { step: v })} />
                <button
                  type="button"
                  aria-label={`Remove ${r.label}`}
                  onClick={() => patch({ ladder: m.ladder.filter((_, idx) => idx !== i) })}
                  className="mt-5 h-8 rounded-md text-[color:var(--ink-faint)] hover:bg-red-500/10 hover:text-red-700"
                >
                  <Trash2 className="mx-auto h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => patch({ ladder: [...m.ladder, { key: "TIER", label: "New tier", min: 0, max: 10_000, step: 500 }] })}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-[color:var(--ink-muted)] ring-1 ring-[color:var(--ink)]/10 hover:text-[color:var(--ink)]"
          >
            <Plus className="h-3.5 w-3.5" /> Add a rung
          </button>
          <p className="t-meta mt-2 text-[11px]">
            Rungs run bottom to top and each must start above the one below it. The prefix is matched
            against your product names, so <span className="font-semibold">INUKA</span> matches
            &ldquo;Inuka Weekly&rdquo; and &ldquo;Inuka Bi-weekly&rdquo;.
          </p>
        </div>
      )}

      <Divider label="When several products fit" />
      <Choice
        label="Which one do you offer?"
        value={m.prefer}
        onChange={(v) => patch({ prefer: v as CreditPolicy["match"]["prefer"] })}
        options={[
          { value: "shortest_affordable", label: "Shortest affordable term", hint: "Money back soonest. Turns the book over fastest." },
          { value: "lowest_installment", label: "Lowest installment", hint: "Easiest for the borrower to carry." },
          { value: "cheapest_total", label: "Cheapest overall", hint: "Least total cost to the borrower." },
        ]}
      />
    </div>
  );
}

// ── Behaviour matrix ──────────────────────────────────────────────────────────
function BehaviourSection({ cfg, set }: { cfg: CreditPolicy; set: SetFn }) {
  const b = cfg.behaviour;
  const patch = (p: Partial<CreditPolicy["behaviour"]>) => set("behaviour", { ...b, ...p });
  const setFactor = (i: number, next: ScoreFactor) => patch({ factors: b.factors.map((f, idx) => (idx === i ? next : f)) });

  const active = b.factors.filter((f) => f.enabled);
  const total = active.reduce((s, f) => s + f.weight, 0);
  const balanced = Math.abs(total - 100) < 0.01;

  const setCategory = (i: number, p: Partial<RiskCategory>) =>
    patch({ categories: b.categories.map((c, idx) => (idx === i ? { ...c, ...p } : c)) });

  return (
    <div className="space-y-5">
      <p className="t-meta text-[12px]">
        This is the matrix that scores a customer on their own repayment record — the one thing you
        know about them that no bureau does. It decides the score, the risk band, and therefore what
        the graduation ladder is allowed to do.
      </p>

      <SwitchRow
        title="Score borrowers on their repayment record"
        desc="Off, and every repeat customer is judged only on the statement they first arrived with."
        checked={b.enabled}
        onChange={(v) => patch({ enabled: v })}
      />

      <div className="flex flex-wrap items-center gap-2">
        <span className="t-label">Start from</span>
        <button
          type="button"
          onClick={() => patch({ ...BEHAVIOUR_DEFAULTS })}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-[color:var(--ink-muted)] ring-1 ring-[color:var(--ink)]/10 hover:text-[color:var(--ink)]"
        >
          <Wand2 className="h-3.5 w-3.5" /> BirgenAI four-band ladder
        </button>
        <button
          type="button"
          onClick={() => patch({ ...MICROMART_BEHAVIOUR })}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-[color:var(--ink-muted)] ring-1 ring-[color:var(--ink)]/10 hover:text-[color:var(--ink)]"
        >
          <Wand2 className="h-3.5 w-3.5" /> ServiceSuite parity
        </button>
        <span className="t-meta text-[11px]">A preset replaces the factors and bands below — the preview will show you what it costs.</span>
      </div>

      <Divider label="Which loans are scored" />
      <div className="grid gap-3 sm:grid-cols-3">
        <NumberField label="Recent loans that count" value={b.window.lookbackLoans} min={1} max={12}
          onChange={(v) => patch({ window: { ...b.window, lookbackLoans: v } })} />
        <NumberField label="Ignore loans shorter than" value={b.window.minInstallments} min={1} max={24} suffix="inst"
          onChange={(v) => patch({ window: { ...b.window, minInstallments: v } })} />
        <SliderField label="Older loans count less" value={Math.round(b.window.recencyDecay * 100)} min={0} max={90} step={5}
          format={(v) => (v === 0 ? "all equal" : `−${v}% each`)}
          onChange={(v) => patch({ window: { ...b.window, recencyDecay: v / 100 } })} />
      </div>
      <SwitchRow
        title="Include the loan they are repaying now"
        desc="Without this a customer's score is frozen between borrowing and clearing — a post-mortem rather than a monitor. With it, an installment paid this morning moves the score this morning."
        checked={b.window.includeActive}
        onChange={(v) => patch({ window: { ...b.window, includeActive: v } })}
      />

      <Divider label="Factors" />
      <div
        className="flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-[12px] font-semibold"
        style={{
          backgroundColor: balanced ? "rgba(16,185,129,0.10)" : "rgba(245,158,11,0.12)",
          color: balanced ? "#047857" : "#92400e",
        }}
      >
        <span>{balanced ? "Weights balance." : "Weights must add up to 100%."}</span>
        <span className="tabular-nums">{Math.round(total * 100) / 100}%</span>
      </div>

      <div className="space-y-4">
        {b.factors.map((f, i) => (
          <div key={f.key} className="rounded-2xl p-3 ring-1 ring-[color:var(--ink)]/[0.07] sm:p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[9rem] flex-1">
                <TextField label="Factor" value={f.label} onChange={(v) => setFactor(i, { ...f, label: v })} />
              </div>
              <div className="w-full sm:w-56">
                <SelectField
                  label="Measures" value={f.metric}
                  options={FACTOR_METRICS.map((x) => ({ value: x.key, label: x.label }))}
                  onChange={(v) => setFactor(i, { ...f, metric: v as FactorMetric })}
                />
              </div>
              <div className="w-24">
                <NumberField label="Weight" value={f.weight} min={0} max={100} suffix="%"
                  onChange={(v) => setFactor(i, { ...f, weight: v })} />
              </div>
              <div className="pb-2">
                <Toggle label={`${f.label} enabled`} checked={f.enabled} onChange={(v) => setFactor(i, { ...f, enabled: v })} />
              </div>
              <button
                type="button"
                aria-label={`Remove ${f.label}`}
                disabled={b.factors.length <= 1}
                onClick={() => patch({ factors: b.factors.filter((_, idx) => idx !== i) })}
                className="mb-2 rounded-md p-1.5 text-[color:var(--ink-faint)] hover:bg-red-500/10 hover:text-red-700 disabled:pointer-events-none disabled:opacity-30"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className={`mt-3 ${f.enabled ? "" : "pointer-events-none opacity-40"}`}>
              <BandEditor factor={f} onChange={(next) => setFactor(i, next)} />
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => patch({
          factors: [...b.factors, {
            key: `factor_${Date.now().toString(36)}`,
            label: "New factor",
            weight: 0,
            metric: "days_early",
            enabled: true,
            bands: [
              { threshold: 3, points: 100, label: "Three days early or more" },
              { threshold: null, points: 50, label: "Anything else" },
            ],
          }],
        })}
        className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-[color:var(--ink-muted)] ring-1 ring-[color:var(--ink)]/10 hover:text-[color:var(--ink)]"
      >
        <Plus className="h-3.5 w-3.5" /> Add a factor
      </button>

      <Divider label="Risk categories" />
      <CategoryStrip categories={b.categories} />
      <div className="space-y-2">
        {b.categories.map((c, i) => (
          <div key={i} className="grid grid-cols-2 gap-2 rounded-xl px-3 py-3 ring-1 ring-[color:var(--ink)]/[0.07] sm:grid-cols-[1.4fr_1fr_1fr_1fr_1fr_2rem]">
            <TextField label="Category" value={c.label} onChange={(v) => setCategory(i, { label: v })} />
            <NumberField label="From score" value={c.minScore} min={0} max={100} step={0.01}
              onChange={(v) => setCategory(i, { minScore: v })} />
            <NumberField label="Earns" value={c.graduationPercent} min={0} max={100} suffix="%"
              onChange={(v) => setCategory(i, { graduationPercent: v })} />
            <NumberField label="PD from" value={c.pdMin} min={0} max={1} step={0.01}
              onChange={(v) => setCategory(i, { pdMin: v })} />
            <NumberField label="PD to" value={c.pdMax} min={0} max={1} step={0.01}
              onChange={(v) => setCategory(i, { pdMax: v })} />
            <button
              type="button"
              aria-label={`Remove ${c.label}`}
              disabled={b.categories.length <= 1}
              onClick={() => patch({ categories: b.categories.filter((_, idx) => idx !== i) })}
              className="mt-5 h-8 rounded-md text-[color:var(--ink-faint)] hover:bg-red-500/10 hover:text-red-700 disabled:pointer-events-none disabled:opacity-30"
            >
              <Trash2 className="mx-auto h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => {
          const lowest = b.categories[b.categories.length - 1];
          patch({
            categories: [...b.categories, {
              key: `BAND_${b.categories.length + 1}`,
              label: "New category",
              minScore: Math.max(0, (lowest?.minScore ?? 20) - 20),
              graduationPercent: 0, pdMin: 0.25, pdMax: 0.9,
            }],
          });
        }}
        className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-[color:var(--ink-muted)] ring-1 ring-[color:var(--ink)]/10 hover:text-[color:var(--ink)]"
      >
        <Plus className="h-3.5 w-3.5" /> Add a category
      </button>
      <p className="t-meta text-[11px]">
        Categories run best to worst and the last one must start at zero, so no score can fall
        through into nothing. <span className="font-semibold">Earns</span> is what a clean record in
        that category is worth on the graduation ladder — set it to 0% for a band that should not
        grow at all.
      </p>
    </div>
  );
}

/** The band ladder as one strip, so "78 and 99 both score the same" is visible. */
function CategoryStrip({ categories }: { categories: RiskCategory[] }) {
  const sorted = [...categories].sort((a, b) => a.minScore - b.minScore);
  return (
    <div>
      <div className="flex h-8 overflow-hidden rounded-lg ring-1 ring-[color:var(--ink)]/[0.07]">
        {sorted.map((c, i) => {
          const next = sorted[i + 1]?.minScore ?? 100;
          const width = Math.max(0, next - c.minScore);
          if (width <= 0) return null;
          return (
            <div
              key={`${c.key}-${i}`}
              className="flex items-center justify-center overflow-hidden whitespace-nowrap px-1 text-[10px] font-bold text-white"
              style={{ width: `${width}%`, backgroundColor: "var(--brand)", opacity: 0.35 + (i / Math.max(1, sorted.length - 1)) * 0.6 }}
              title={`${c.label}: ${c.minScore}+ earns ${c.graduationPercent}%`}
            >
              {width > 12 ? `${c.label} · ${c.graduationPercent}%` : ""}
            </div>
          );
        })}
      </div>
      <div className="mt-0.5 flex justify-between">
        <span className="t-meta text-[10px]">0</span>
        <span className="t-meta text-[10px]">100</span>
      </div>
    </div>
  );
}

// ── Graduation ────────────────────────────────────────────────────────────────
function GraduationSection({ cfg, set }: { cfg: CreditPolicy; set: SetFn }) {
  const g = cfg.graduation;
  const patch = (p: Partial<CreditPolicy["graduation"]>) => set("graduation", { ...g, ...p });
  return (
    <div className="space-y-5">
      <SwitchRow
        title="Move limits automatically"
        desc="A borrower who has earned an increase gets it by rule rather than by asking a manager — and one who is sliding is brought down before the write-off."
        checked={g.enabled}
        onChange={(v) => patch({ enabled: v })}
      />

      <Choice
        label="When is the ladder evaluated?"
        value={g.trigger}
        onChange={(v) => patch({ trigger: v as CreditPolicy["graduation"]["trigger"] })}
        options={[
          { value: "on_repayment", label: "On every repayment", hint: "The limit responds the moment money lands. Needs live loans included in scoring." },
          { value: "on_clearance", label: "When a loan clears", hint: "The traditional behaviour — one move per completed cycle." },
          { value: "scheduled", label: "Only on the batch run", hint: "Nothing moves until the scheduled job runs." },
        ]}
      />

      <Divider label="What must be proved first" />
      <div className="grid gap-3 sm:grid-cols-2">
        <NumberField label="Cleared loans required" value={g.requireClearedLoans} min={0} max={20}
          onChange={(v) => patch({ requireClearedLoans: v })} />
        <NumberField label="…of which at the same amount" value={g.requireSamePrincipalCycles} min={0} max={20}
          help="Not 'have they borrowed twice' but 'have they cleared the SAME amount twice' — that is what shows the ceiling is holding them back. 0 turns the rule off."
          onChange={(v) => patch({ requireSamePrincipalCycles: v })} />
      </div>

      <Choice
        label="What is the increase calculated from?"
        value={g.basis}
        onChange={(v) => patch({ basis: v as CreditPolicy["graduation"]["basis"] })}
        options={[
          { value: "higher_of", label: "Whichever is higher", hint: "A graduation can never reduce anybody. Recommended." },
          { value: "current_limit", label: "The limit they hold", hint: "Grow the ceiling itself, whatever they last borrowed." },
          { value: "last_principal", label: "What they last borrowed", hint: "Legacy behaviour: a borrower who stayed well inside their limit is CUT by the graduation routine." },
        ]}
      />
      {g.basis === "last_principal" && (
        <p className="flex items-start gap-2 rounded-xl bg-amber-500/10 px-3 py-2.5 text-[12px] text-amber-900 ring-1 ring-amber-600/20">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          A borrower whose limit is 10,000 but who borrowed 5,000 twice and repaid perfectly is
          &ldquo;graduated&rdquo; to 6,500 — a 35% cut, recorded as a success. Kept only so a
          migrating lender&rsquo;s numbers do not move on the day they switch.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <NumberField label="Most one step may add" value={g.capPerStep} min={0} step={500} money
          help="0 for uncapped." onChange={(v) => patch({ capPerStep: v })} />
        <NumberField label="Absolute ceiling" value={g.ceiling} min={0} step={5000} money
          help="0 for uncapped." onChange={(v) => patch({ ceiling: v })} />
        <NumberField label="Round the new limit to" value={g.roundTo} min={1} step={100} money
          onChange={(v) => patch({ roundTo: v })} />
      </div>

      <Divider label="Demotion — the other half of the ladder" />
      <RuleBlock
        title="Bring a deteriorating borrower's limit down"
        desc="Without this, somebody who graduated to 30,000 and then started missing installments keeps 30,000 forever."
        checked={g.demotion.enabled}
        onChange={(v) => patch({ demotion: { ...g.demotion, enabled: v } })}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <SelectField
            label="At or below category" value={g.demotion.belowCategory}
            options={cfg.behaviour.categories.map((c) => ({ value: c.key, label: c.label }))}
            onChange={(v) => patch({ demotion: { ...g.demotion, belowCategory: v } })}
          />
          <NumberField label="Remove" value={g.demotion.percent} min={1} max={99} suffix="%"
            onChange={(v) => patch({ demotion: { ...g.demotion, percent: v } })} />
          <NumberField label="Never below" value={g.demotion.floor} min={0} step={500} money
            onChange={(v) => patch({ demotion: { ...g.demotion, floor: v } })} />
        </div>
      </RuleBlock>
    </div>
  );
}

// ── Verdict ───────────────────────────────────────────────────────────────────
function VerdictSection({ cfg, set, replace }: { cfg: CreditPolicy; set: SetFn; replace: (p: CreditPolicy) => void }) {
  const v = cfg.verdict;
  const patch = (p: Partial<CreditPolicy["verdict"]>) => set("verdict", { ...v, ...p });
  return (
    <div className="space-y-5">
      <p className="t-meta text-[12px]">
        Where the engine may decide on its own, and where it must hand the application to a person.
        Everything between the two thresholds is referred — which is the honest answer far more often
        than either extreme.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <NumberField label="Auto-approve at or above" value={v.autoApproveAbove} min={0} max={1000}
          help="Set above 1000 to approve nothing automatically."
          onChange={(x) => patch({ autoApproveAbove: x })} />
        <NumberField label="Auto-decline below" value={v.autoDeclineBelow} min={0} max={1000}
          help="Set to 0 to decline nothing automatically."
          onChange={(x) => patch({ autoDeclineBelow: x })} />
      </div>

      <div className="flex h-9 overflow-hidden rounded-lg text-[10px] font-bold text-white ring-1 ring-[color:var(--ink)]/[0.07]">
        <div className="flex items-center justify-center bg-red-500/70" style={{ width: `${Math.max(0, Math.min(100, v.autoDeclineBelow / 10))}%` }}>
          {v.autoDeclineBelow > 80 ? "Decline" : ""}
        </div>
        <div
          className="flex flex-1 items-center justify-center bg-amber-500/70"
        >
          Refer to an officer
        </div>
        <div className="flex items-center justify-center bg-emerald-500/70" style={{ width: `${Math.max(0, Math.min(100, (1000 - v.autoApproveAbove) / 10))}%` }}>
          {1000 - v.autoApproveAbove > 80 ? "Approve" : ""}
        </div>
      </div>

      <NumberField label="Never auto-approve more than" value={v.autoApproveMaxAmount} min={0} step={5000} money
        help="However good the score. 0 removes the cap — which means a machine may commit any amount you would."
        onChange={(x) => patch({ autoApproveMaxAmount: x })} />

      <Divider label="Start the whole policy from a preset" />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => replace(CREDIT_DEFAULTS)}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-[color:var(--ink-muted)] ring-1 ring-[color:var(--ink)]/10 hover:text-[color:var(--ink)]"
        >
          <Wand2 className="h-3.5 w-3.5" /> BirgenAI defaults
        </button>
        <button
          type="button"
          onClick={() => replace(MULAR_POLICY)}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-[color:var(--ink-muted)] ring-1 ring-[color:var(--ink)]/10 hover:text-[color:var(--ink)]"
        >
          <Wand2 className="h-3.5 w-3.5" /> Micromart parity
        </button>
      </div>
      <p className="t-meta text-[11px]">
        A preset loads into the editor — nothing is published until you press Publish, and the preview
        will tell you what it would cost first.
      </p>
    </div>
  );
}
