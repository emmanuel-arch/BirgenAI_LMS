"use client";

// ─────────────────────────────────────────────────────────────────────────────
// BORROWER SETTINGS — who your customers are, and what they must prove.
//
// Six sections, one document, one Save. The system this answers has the same six
// ideas spread across seven forms with seven separate Save buttons, no validation
// between them, and no way to see what changed or when. Here:
//
//   · ONE dirty state and ONE publish, so a half-applied configuration is not a
//     reachable state.
//   · VALIDATION BEFORE WRITE, surfaced against the control that caused it — the
//     server refuses "minimum age 70, maximum 22" instead of storing it.
//   · A VERSION and a history, because settings are the terms customers are held
//     to and "when did this change?" must have an answer.
//   · Live-apply: publishing re-reads and the console picks the new rules up on
//     the next request. No sign-out.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import {
  Users2, Loader2, AlertTriangle, CheckCircle2, ArrowLeft, IdCard, Hash, Wallet,
  Gauge, ClipboardList, Paperclip, History, RotateCcw, Save,
} from "lucide-react";
import { useLoad } from "@/lib/hooks/useLoad";
import {
  KYC_FIELDS, validateBorrowerConfig,
  type BorrowerConfig, type ConfigIssue, type KycFieldKey,
} from "@/lib/config/borrower";

type Revision = { version: number; changed: string[]; createdAt: string };

const SECTIONS = [
  { key: "kyc", label: "KYC & identity", icon: IdCard, blurb: "Which details you collect, which you verify, and which you never ask for." },
  { key: "account", label: "Account numbers", icon: Hash, blurb: "What a borrower's account number actually is." },
  { key: "limit", label: "Loan limits", icon: Wallet, blurb: "Where a new borrower's ceiling comes from, and how it grows." },
  { key: "scoring", label: "Credit scoring", icon: Gauge, blurb: "How you score a borrower — and how often you score the book." },
  { key: "rules", label: "Onboarding rules", icon: ClipboardList, blurb: "Age, fees, dormancy, referees and the conditions of joining." },
  { key: "attachments", label: "Attachments", icon: Paperclip, blurb: "Documents required at onboarding and on a loan application." },
] as const;

type SectionKey = (typeof SECTIONS)[number]["key"];

export default function BorrowerSettings() {
  const reduce = useReducedMotion();
  const [cfg, setCfg] = useState<BorrowerConfig | null>(null);
  const [saved, setSaved] = useState<BorrowerConfig | null>(null);
  const [version, setVersion] = useState(0);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [section, setSection] = useState<SectionKey>("kyc");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [issues, setIssues] = useState<ConfigIssue[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const load = async () => {
    try {
      const res = await fetch("/api/config/borrower");
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not load borrower settings."); return; }
      setCfg(data.value); setSaved(data.value); setVersion(data.version);
      setRevisions(data.history ?? []); setError(null);
    } catch { setError("Could not load borrower settings."); }
  };
  useLoad(load);

  const dirty = useMemo(
    () => Boolean(cfg && saved && JSON.stringify(cfg) !== JSON.stringify(saved)),
    [cfg, saved],
  );

  // Validate as you type, with the same function the server will run. The Save
  // button can then be honest about whether it will succeed.
  const liveIssues = useMemo(() => (cfg ? validateBorrowerConfig(cfg) : []), [cfg]);
  const issueFor = (prefix: string) =>
    [...issues, ...liveIssues].find((i) => i.path === prefix || i.path.startsWith(`${prefix}.`));

  const set = <K extends keyof BorrowerConfig>(key: K, value: BorrowerConfig[K]) =>
    setCfg((c) => (c ? { ...c, [key]: value } : c));

  const save = async () => {
    if (!cfg) return;
    setBusy(true); setError(null); setNotice(null); setIssues([]);
    try {
      const res = await fetch("/api/config/borrower", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: cfg }),
      });
      const data = await res.json();
      if (res.status === 422) { setIssues(data.issues ?? []); setError(data.message); return; }
      if (!data.success) { setError(data.message || "Could not save."); return; }
      setSaved(data.value); setCfg(data.value); setVersion(data.version);
      setNotice(`Published as version ${data.version} — live across the console and the portal.`);
      const fresh = await fetch("/api/config/borrower").then((r) => r.json()).catch(() => null);
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

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <Link href="/console/settings" className="t-meta inline-flex items-center gap-1.5 text-[12px] hover:text-[color:var(--ink)]">
        <ArrowLeft className="h-3.5 w-3.5" /> Settings &amp; Vault
      </Link>

      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="t-display flex items-center gap-2 text-[1.6rem]">
            <Users2 className="h-6 w-6" style={{ color: "var(--brand)" }} /> Borrower settings
          </h1>
          <p className="t-meta mt-1">
            One definition of who your customers are — applied everywhere at once: the console, the
            customer portal and the API.
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
            {error ?? "These settings would not hold together."}
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

      <div className="mt-5 grid gap-4 lg:grid-cols-[15rem_1fr]">
        {/* Section rail */}
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

        <div className="canvas rounded-2xl p-4 sm:p-6">
          <div className="mb-4 border-b border-[color:var(--ink)]/[0.07] pb-3">
            <h2 className="t-section flex items-center gap-2"><Active.icon className="h-4 w-4 text-[color:var(--brand)]" /> {Active.label}</h2>
            <p className="t-meta mt-0.5 text-[12px]">{Active.blurb}</p>
          </div>

          {section === "kyc" && <KycSection cfg={cfg} set={set} />}
          {section === "account" && <AccountSection cfg={cfg} set={set} />}
          {section === "limit" && <LimitSection cfg={cfg} set={set} />}
          {section === "scoring" && <ScoringSection cfg={cfg} set={set} />}
          {section === "rules" && <RulesSection cfg={cfg} set={set} />}
          {section === "attachments" && <AttachmentsSection cfg={cfg} set={set} />}
        </div>
      </div>
    </main>
  );
}

type SetFn = <K extends keyof BorrowerConfig>(key: K, value: BorrowerConfig[K]) => void;

// ── KYC ───────────────────────────────────────────────────────────────────────
function KycSection({ cfg, set }: { cfg: BorrowerConfig; set: SetFn }) {
  const setField = (key: KycFieldKey, patch: Partial<BorrowerConfig["kyc"]["fields"][KycFieldKey]>) =>
    set("kyc", { ...cfg.kyc, fields: { ...cfg.kyc.fields, [key]: { ...cfg.kyc.fields[key], ...patch } } });

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 hidden grid-cols-[1fr_repeat(4,4.5rem)] gap-2 px-3 sm:grid">
          <span className="t-label">Field</span>
          {["Required", "Unique", "Hidden", "Verify"].map((h) => (
            <span key={h} className="t-label text-center">{h}</span>
          ))}
        </div>
        <div className="space-y-1">
          {KYC_FIELDS.map((f) => {
            const rule = cfg.kyc.fields[f.key];
            const locked = "lockRequired" in f && f.lockRequired === true;
            const verifiable = "canVerify" in f && f.canVerify === true;
            return (
              <div key={f.key} className="grid grid-cols-2 items-center gap-2 rounded-xl px-3 py-2.5 odd:bg-[color:var(--ink)]/[0.02] sm:grid-cols-[1fr_repeat(4,4.5rem)]">
                <div className="col-span-2 sm:col-span-1">
                  <p className="text-[13px] font-semibold text-[color:var(--ink)]">{f.label}</p>
                  <p className="t-meta text-[11px]">{f.desc}</p>
                </div>
                <Toggle label="Required" checked={rule.required} disabled={locked}
                  hint={locked ? "Always required" : undefined}
                  onChange={(v) => setField(f.key, { required: v })} />
                <Toggle label="Unique" checked={rule.unique} onChange={(v) => setField(f.key, { unique: v })} />
                <Toggle label="Hidden" checked={rule.hidden} disabled={locked}
                  onChange={(v) => setField(f.key, { hidden: v })} />
                <Toggle label="Verify" checked={rule.verify} disabled={!verifiable}
                  hint={!verifiable ? "Not checkable against the registry" : undefined}
                  onChange={(v) => setField(f.key, { verify: v })} />
              </div>
            );
          })}
        </div>
        <p className="t-meta mt-2 text-[11px]">
          <strong>Verify</strong> means the value is confirmed against the national registry (IPRS),
          not merely typed in. That is a check the borrower cannot talk their way past.
        </p>
      </div>

      <Divider label="Identity documents" />

      <Choice
        label="Which document may a borrower identify with?"
        value={cfg.kyc.idDocument}
        onChange={(v) => set("kyc", { ...cfg.kyc, idDocument: v as BorrowerConfig["kyc"]["idDocument"] })}
        options={[
          { value: "national_id", label: "National ID only", hint: "Kenyan citizens" },
          { value: "passport", label: "Passport only", hint: "Non-residents" },
          { value: "either", label: "Either", hint: "Whichever they hold" },
        ]}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <SwitchRow
          title="Passport photo of the person"
          desc="A selfie or studio photo of the borrower themselves."
          checked={cfg.kyc.passportPhoto.required}
          onChange={(v) => set("kyc", { ...cfg.kyc, passportPhoto: { ...cfg.kyc.passportPhoto, required: v } })}
        />
        <SwitchRow
          title="Photo of the ID document"
          desc="The card or passport page, for the reader to parse."
          checked={cfg.kyc.idPhoto.required}
          onChange={(v) => set("kyc", { ...cfg.kyc, idPhoto: { ...cfg.kyc.idPhoto, required: v } })}
        />
        <SwitchRow
          title="Face-match the selfie to the ID"
          desc="The person holding the card must be the person on it."
          checked={cfg.kyc.faceMatch}
          onChange={(v) => set("kyc", { ...cfg.kyc, faceMatch: v })}
        />
        <SwitchRow
          title="Human review before transacting"
          desc="A staff member signs off KYC even when every automated check passed."
          checked={cfg.kyc.manualReview}
          onChange={(v) => set("kyc", { ...cfg.kyc, manualReview: v })}
        />
      </div>
    </div>
  );
}

// ── Account numbering ─────────────────────────────────────────────────────────
function AccountSection({ cfg, set }: { cfg: BorrowerConfig; set: SetFn }) {
  return (
    <div className="space-y-5">
      <Choice
        label="Borrower account number type"
        value={cfg.account.numbering}
        onChange={(v) => set("account", { ...cfg.account, numbering: v as BorrowerConfig["account"]["numbering"] })}
        options={[
          { value: "phone", label: "Phone number", hint: "The borrower's telephone number is their account number." },
          { value: "national_id", label: "National ID number", hint: "Their identity document number is their account number." },
          { value: "system", label: "System generated", hint: "BirgenAI issues a sequential number with your prefix." },
        ]}
      />

      {cfg.account.numbering === "system" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <NumberOrText
            label="Prefix" value={cfg.account.prefix}
            placeholder="e.g. MM"
            help="Appears in front of every account number."
            onChange={(v) => set("account", { ...cfg.account, prefix: v })}
          />
          <NumberField
            label="Length" value={cfg.account.length} min={4} max={16}
            help="Digits after the prefix. 8 gives you 100 million accounts."
            onChange={(v) => set("account", { ...cfg.account, length: v })}
          />
          <p className="t-meta sm:col-span-2 text-[12px]">
            Preview: <span className="font-mono font-semibold text-[color:var(--ink)]">
              {(cfg.account.prefix || "—")}{"0".repeat(Math.max(0, cfg.account.length - 1))}1
            </span>
          </p>
        </div>
      )}
    </div>
  );
}

// ── Limits ────────────────────────────────────────────────────────────────────
function LimitSection({ cfg, set }: { cfg: BorrowerConfig; set: SetFn }) {
  return (
    <div className="space-y-5">
      <Choice
        label="Where does a new borrower's limit come from?"
        value={cfg.limit.source}
        onChange={(v) => set("limit", { ...cfg.limit, source: v as BorrowerConfig["limit"]["source"] })}
        options={[
          { value: "onboarding", label: "Captured at onboarding", hint: "The officer sets it on the registration form." },
          { value: "default", label: "One default for everyone", hint: "Every new borrower starts at the same ceiling." },
          { value: "scored", label: "Derived from the score", hint: "The limit engine sets it from the borrower's own data. Recommended." },
        ]}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        {cfg.limit.source === "default" && (
          <NumberField
            label="Default loan limit" value={cfg.limit.defaultLimit} min={0} step={500} money
            onChange={(v) => set("limit", { ...cfg.limit, defaultLimit: v })}
          />
        )}
        <NumberField
          label="Maximum limit (hard ceiling)" value={cfg.limit.maxLimit} min={0} step={5000} money
          help="Never exceeded, whatever the engine derives."
          onChange={(v) => set("limit", { ...cfg.limit, maxLimit: v })}
        />
      </div>

      <Divider label="Graduation ladder" />
      <SwitchRow
        title="Raise a good repayer's limit automatically"
        desc="A borrower who clears loans without arrears earns a higher ceiling by rule, rather than by asking a manager."
        checked={cfg.limit.laddering.enabled}
        onChange={(v) => set("limit", { ...cfg.limit, laddering: { ...cfg.limit.laddering, enabled: v } })}
      />
      {cfg.limit.laddering.enabled && (
        <div className="grid gap-3 sm:grid-cols-2">
          <NumberField
            label="Raise by (%)" value={cfg.limit.laddering.stepPct} min={1} max={200}
            onChange={(v) => set("limit", { ...cfg.limit, laddering: { ...cfg.limit.laddering, stepPct: v } })}
          />
          <NumberField
            label="After this many clean loans" value={cfg.limit.laddering.afterCleanLoans} min={1} max={20}
            onChange={(v) => set("limit", { ...cfg.limit, laddering: { ...cfg.limit.laddering, afterCleanLoans: v } })}
          />
        </div>
      )}
    </div>
  );
}

// ── Scoring ───────────────────────────────────────────────────────────────────
function ScoringSection({ cfg, set }: { cfg: BorrowerConfig; set: SetFn }) {
  const sch = cfg.scoring.schedule;
  return (
    <div className="space-y-5">
      <Choice
        label="How is a borrower scored?"
        value={cfg.scoring.source}
        onChange={(v) => set("scoring", { ...cfg.scoring, source: v as BorrowerConfig["scoring"]["source"] })}
        options={[
          { value: "engine", label: "BirgenAI credit engine", hint: "M-Pesa cashflow, repayment history and bureau, fused. Recommended." },
          { value: "default", label: "One default score", hint: "Everyone starts at the same number." },
          { value: "none", label: "No scoring", hint: "Officers decide unaided." },
        ]}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        {cfg.scoring.source === "default" && (
          <NumberField
            label="Default credit score" value={cfg.scoring.defaultScore} min={0} max={1000}
            onChange={(v) => set("scoring", { ...cfg.scoring, defaultScore: v })}
          />
        )}
        <NumberField
          label="Minimum score to borrow" value={cfg.scoring.minToBorrow} min={0} max={1000}
          help="Below this, no product is offered. Products may set a higher bar of their own."
          onChange={(v) => set("scoring", { ...cfg.scoring, minToBorrow: v })}
        />
      </div>

      <Divider label="Scheduled re-scoring" />
      <p className="t-meta text-[12px]">
        Scoring only at application tells you what a customer looked like the day they asked. Scoring
        the book on a cadence tells you what they look like <em>now</em> — which is when arrears are
        still preventable.
      </p>
      <SwitchRow
        title="Re-score the book automatically"
        desc="A background run that refreshes scores and flags deterioration."
        checked={sch.enabled}
        onChange={(v) => set("scoring", { ...cfg.scoring, schedule: { ...sch, enabled: v } })}
      />
      {sch.enabled && (
        <div className="grid gap-3 sm:grid-cols-3">
          <SelectField
            label="How often" value={sch.cadence}
            options={[
              { value: "daily", label: "Every day" },
              { value: "weekly", label: "Every week" },
              { value: "monthly", label: "Every month" },
              { value: "quarterly", label: "Every quarter" },
            ]}
            onChange={(v) => set("scoring", { ...cfg.scoring, schedule: { ...sch, cadence: v as typeof sch.cadence } })}
          />
          <SelectField
            label="Who gets re-scored" value={sch.population}
            options={[
              { value: "active", label: "Borrowers with a live loan" },
              { value: "arrears", label: "Only borrowers in arrears" },
              { value: "all", label: "Everyone on the book" },
            ]}
            onChange={(v) => set("scoring", { ...cfg.scoring, schedule: { ...sch, population: v as typeof sch.population } })}
          />
          <NumberField
            label="Alert on a drop of" value={sch.alertOnDropBy} min={0} max={500}
            help="Points. Raises a watchlist item."
            onChange={(v) => set("scoring", { ...cfg.scoring, schedule: { ...sch, alertOnDropBy: v } })}
          />
        </div>
      )}
    </div>
  );
}

// ── Onboarding rules ──────────────────────────────────────────────────────────
function RulesSection({ cfg, set }: { cfg: BorrowerConfig; set: SetFn }) {
  const r = cfg.rules;
  const patch = (p: Partial<BorrowerConfig["rules"]>) => set("rules", { ...r, ...p });

  return (
    <div className="space-y-4">
      <RuleBlock
        title="Age limit" desc="Only borrowers within this range may be registered."
        checked={r.age.enabled} onChange={(v) => patch({ age: { ...r.age, enabled: v } })}
      >
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Minimum age" value={r.age.min} min={18} max={100} onChange={(v) => patch({ age: { ...r.age, min: v } })} />
          <NumberField label="Maximum age" value={r.age.max} min={18} max={100} onChange={(v) => patch({ age: { ...r.age, max: v } })} />
        </div>
      </RuleBlock>

      <RuleBlock
        title="Joining fee" desc="Borrowers pay this once to activate their account."
        checked={r.joiningFee.enabled} onChange={(v) => patch({ joiningFee: { ...r.joiningFee, enabled: v } })}
      >
        <NumberField label="Amount" value={r.joiningFee.amount} min={0} step={50} money
          onChange={(v) => patch({ joiningFee: { ...r.joiningFee, amount: v } })} />
      </RuleBlock>

      <RuleBlock
        title="Account dormancy" desc="An account with no loan for this long becomes dormant."
        checked={r.dormancy.enabled} onChange={(v) => patch({ dormancy: { ...r.dormancy, enabled: v } })}
      >
        <NumberField label="Dormant after (days)" value={r.dormancy.afterDays} min={30} max={1095}
          onChange={(v) => patch({ dormancy: { ...r.dormancy, afterDays: v } })} />
      </RuleBlock>

      <RuleBlock
        title="Reactivation fee" desc="Charged when a dormant account is brought back."
        checked={r.reactivationFee.enabled} onChange={(v) => patch({ reactivationFee: { ...r.reactivationFee, enabled: v } })}
      >
        <NumberField label="Amount" value={r.reactivationFee.amount} min={0} step={50} money
          onChange={(v) => patch({ reactivationFee: { ...r.reactivationFee, amount: v } })} />
      </RuleBlock>

      <RuleBlock
        title="Referees" desc="People who vouch for the borrower at registration."
        checked={r.referees.enabled} onChange={(v) => patch({ referees: { ...r.referees, enabled: v } })}
      >
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Minimum" value={r.referees.min} min={0} max={10} onChange={(v) => patch({ referees: { ...r.referees, min: v } })} />
          <NumberField label="Maximum" value={r.referees.max} min={1} max={10} onChange={(v) => patch({ referees: { ...r.referees, max: v } })} />
        </div>
      </RuleBlock>

      <Divider label="Lending conditions" />
      <div className="grid gap-3 sm:grid-cols-2">
        <SwitchRow
          title="Require a location pin before disbursement"
          desc="You should know where a borrower's business is before you lend against it — and a customer with no pin never appears on a field officer's route."
          checked={r.requireGeoPin} onChange={(v) => patch({ requireGeoPin: v })}
        />
        <SwitchRow
          title="One active loan per borrower"
          desc="A borrower may not take a second loan while one is running."
          checked={r.oneActiveLoan} onChange={(v) => patch({ oneActiveLoan: v })}
        />
      </div>
    </div>
  );
}

// ── Attachments ───────────────────────────────────────────────────────────────
// The catalogue is platform-wide (DocumentKind); a lender chooses which apply
// where. Products may require MORE on top of the application list, never less.
const DOC_CATALOGUE: { key: string; label: string; hint: string }[] = [
  { key: "MPESA_STATEMENT", label: "M-Pesa statement", hint: "6-month PDF — feeds the cashflow score" },
  { key: "ID_FRONT", label: "ID — front", hint: "Read by the document parser" },
  { key: "ID_BACK", label: "ID — back", hint: "Read by the document parser" },
  { key: "SELFIE", label: "Selfie", hint: "Face-matched against the ID" },
  { key: "BUSINESS_PHOTO", label: "Business photo", hint: "The premises being lent against" },
  { key: "HOME_PHOTO", label: "Home photo", hint: "Residence verification" },
  { key: "BUSINESS_LICENCE", label: "Business licence", hint: "Single business permit" },
  { key: "KRA_PIN", label: "KRA PIN", hint: "Tax registration certificate" },
  { key: "PAYSLIP", label: "Payslip", hint: "Salary-advance lending" },
  { key: "EMPLOYMENT_LETTER", label: "Employment letter", hint: "Confirms the salary claim" },
  { key: "BANK_STATEMENT", label: "Bank statement", hint: "For banked borrowers" },
  { key: "SECURITY_PHOTO", label: "Security photo", hint: "The collateral itself" },
  { key: "LOGBOOK", label: "Logbook", hint: "Asset finance / logbook loans" },
  { key: "LOAN_FORM", label: "Signed loan form", hint: "The executed agreement" },
];

function AttachmentsSection({ cfg, set }: { cfg: BorrowerConfig; set: SetFn }) {
  const toggle = (list: "onboarding" | "application", key: string) => {
    const cur = cfg.attachments[list];
    set("attachments", {
      ...cfg.attachments,
      [list]: cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key],
    });
  };

  return (
    <div>
      <div className="mb-2 grid grid-cols-[1fr_6rem_6rem] gap-2 px-3">
        <span className="t-label">Document</span>
        <span className="t-label text-center">Onboarding</span>
        <span className="t-label text-center">Application</span>
      </div>
      <div className="space-y-1">
        {DOC_CATALOGUE.map((d) => (
          <div key={d.key} className="grid grid-cols-[1fr_6rem_6rem] items-center gap-2 rounded-xl px-3 py-2.5 odd:bg-[color:var(--ink)]/[0.02]">
            <div>
              <p className="text-[13px] font-semibold text-[color:var(--ink)]">{d.label}</p>
              <p className="t-meta text-[11px]">{d.hint}</p>
            </div>
            <Toggle label="Onboarding" checked={cfg.attachments.onboarding.includes(d.key)} onChange={() => toggle("onboarding", d.key)} />
            <Toggle label="Application" checked={cfg.attachments.application.includes(d.key)} onChange={() => toggle("application", d.key)} />
          </div>
        ))}
      </div>
      <p className="t-meta mt-3 text-[11px]">
        A loan product may require additional documents on top of the application list — never fewer.
      </p>
    </div>
  );
}

// ── Controls ──────────────────────────────────────────────────────────────────

function Toggle({
  label, checked, onChange, disabled, hint,
}: {
  label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: string;
}) {
  return (
    <label
      title={hint}
      className={`flex items-center justify-center gap-1.5 sm:justify-center ${disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
    >
      <span className="t-label sm:hidden">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
        style={{ backgroundColor: checked ? "var(--brand)" : "rgba(15,15,25,0.15)" }}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${checked ? "translate-x-[1.15rem]" : "translate-x-0.5"}`} />
      </button>
    </label>
  );
}

function SwitchRow({
  title, desc, checked, onChange,
}: {
  title: string; desc: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl px-3 py-2.5 ring-1 ring-[color:var(--ink)]/[0.07]">
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-[color:var(--ink)]">{title}</p>
        <p className="t-meta text-[11px] leading-snug">{desc}</p>
      </div>
      <Toggle label={title} checked={checked} onChange={onChange} />
    </div>
  );
}

function Choice({
  label, value, onChange, options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; hint: string }[];
}) {
  return (
    <div>
      <p className="t-label mb-2">{label}</p>
      <div className="grid gap-2 sm:grid-cols-3">
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(o.value)}
              className="rounded-xl px-3 py-3 text-left ring-1 transition-colors"
              style={
                on
                  ? { backgroundColor: "var(--brand-soft)", ["--tw-ring-color" as never]: "var(--brand)" }
                  : { ["--tw-ring-color" as never]: "rgba(15,15,25,0.09)" }
              }
            >
              <span className="flex items-center gap-2">
                <span
                  className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full ring-2"
                  style={{ ["--tw-ring-color" as never]: on ? "var(--brand)" : "rgba(15,15,25,0.2)" }}
                >
                  {on && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "var(--brand)" }} />}
                </span>
                <span className="text-[13px] font-semibold text-[color:var(--ink)]">{o.label}</span>
              </span>
              <span className="t-meta mt-1 block text-[11px] leading-snug">{o.hint}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RuleBlock({
  title, desc, checked, onChange, children,
}: {
  title: string; desc: string; checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl ring-1 ring-[color:var(--ink)]/[0.07]">
      <div className="flex items-start justify-between gap-3 px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-[color:var(--ink)]">{title}</p>
          <p className="t-meta text-[11px] leading-snug">{desc}</p>
        </div>
        <Toggle label={title} checked={checked} onChange={onChange} />
      </div>
      {checked && <div className="border-t border-[color:var(--ink)]/[0.07] px-3 py-3">{children}</div>}
    </div>
  );
}

const INPUT =
  "mt-1 w-full rounded-lg border border-[color:var(--ink)]/12 bg-white px-3 py-2.5 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-[color:var(--brand)]";

function NumberField({
  label, value, onChange, min, max, step, help, money,
}: {
  label: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; step?: number; help?: string; money?: boolean;
}) {
  return (
    <label className="block">
      <span className="t-label">{label}{money ? " (KES)" : ""}</span>
      <input
        type="number" inputMode="numeric" value={Number.isFinite(value) ? value : 0}
        min={min} max={max} step={step ?? 1}
        onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
        className={INPUT}
      />
      {help && <span className="mt-1 block text-[11px] text-[color:var(--ink-faint)]">{help}</span>}
    </label>
  );
}

function NumberOrText({
  label, value, onChange, placeholder, help,
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; help?: string;
}) {
  return (
    <label className="block">
      <span className="t-label">{label}</span>
      <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={INPUT} />
      {help && <span className="mt-1 block text-[11px] text-[color:var(--ink-faint)]">{help}</span>}
    </label>
  );
}

function SelectField({
  label, value, onChange, options,
}: {
  label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[];
}) {
  return (
    <label className="block">
      <span className="t-label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={INPUT}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <span className="t-label shrink-0">{label}</span>
      <span className="h-px flex-1 bg-[color:var(--ink)]/[0.08]" />
    </div>
  );
}
