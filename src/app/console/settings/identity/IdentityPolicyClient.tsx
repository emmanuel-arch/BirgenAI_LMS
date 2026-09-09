"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE IDENTITY POLICY SCREEN.
//
// Six signals, three outcomes each, four thresholds. The whole screen exists to
// make one thing obvious: WHICH OF THESE REFUSE A PERSON OUTRIGHT, and whether
// anybody is left in the loop when they do.
//
// ── WHY THE OUTCOME PICKER IS THREE BUTTONS AND NOT A DROPDOWN ──────────────
// A select hides the other options behind a click, and the other options are the
// entire point — a lender needs to see at a glance that they have set four
// signals to `refuse` and one to `pass`. Three visible segments make the shape
// of the policy readable across the page without opening anything.
//
// ── WHY `pass` IS SOMETIMES ABSENT ──────────────────────────────────────────
// It is not a rendering accident. `iprsUnmatched` and the two hard failures
// offer only review or refuse, because loosening a threshold is a commercial
// risk decision that belongs to the lender, while declaring that an unanswered
// registry counts as a match is a statement about a fact and is not theirs to
// make. The disabled state says so rather than silently omitting the option.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useState } from "react";
import { ScanFace, Loader2, AlertCircle, CheckCircle2, RotateCcw, Info } from "lucide-react";
import { useLoad } from "@/lib/hooks/useLoad";
import { PageHeader } from "@/components/shell/PageHeader";
import { KYC_SIGNALS, KYC_DEFAULTS, type KycConfig, type Outcome, type SignalKey } from "@/lib/config/kyc";

type Issue = { path: string; message: string };

const OUTCOMES: { key: Outcome; label: string; blurb: string }[] = [
  { key: "pass", label: "Allow", blurb: "Proceed. No person is involved." },
  { key: "review", label: "Review", blurb: "A person looks before anything is decided." },
  { key: "refuse", label: "Refuse", blurb: "Terminal. The customer is turned down." },
];

export default function IdentityPolicyClient() {
  const [cfg, setCfg] = useState<KycConfig | null>(null);
  const [version, setVersion] = useState(0);
  const [isDefault, setIsDefault] = useState(true);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/config/kyc", { cache: "no-store" });
      const j = await r.json();
      if (!j.success) throw new Error(j.message ?? "Could not load the policy.");
      setCfg(j.value as KycConfig);
      setVersion(j.version as number);
      setIsDefault(Boolean(j.isDefault));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the policy.");
    }
  }, []);

  useLoad(load, []);

  const save = async () => {
    if (!cfg || saving) return;
    setSaving(true);
    setIssues([]);
    setError(null);
    setSaved(false);
    try {
      const r = await fetch("/api/config/kyc", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: cfg }),
      });
      const j = await r.json();
      if (r.status === 422 && Array.isArray(j.issues)) {
        setIssues(j.issues as Issue[]);
        return;
      }
      if (!j.success) throw new Error(j.message ?? "Could not publish.");
      setVersion(j.version as number);
      setIsDefault(false);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not publish.");
    } finally {
      setSaving(false);
    }
  };

  const issueFor = (path: string) => issues.find((i) => i.path === path)?.message ?? null;

  if (!cfg) {
    return (
      <div className="space-y-5">
        <PageHeader icon={ScanFace} title="Identity Policy" />
        <div className="flex items-center gap-2 rounded-xl border border-ash-900/10 p-4 text-[13px] text-ash-600">
          {error ? (
            <>
              <AlertCircle className="h-4 w-4 text-rose-600" /> {error}
            </>
          ) : (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </>
          )}
        </div>
      </div>
    );
  }

  const refusing = KYC_SIGNALS.filter((s) => cfg.outcomes[s.key] === "refuse");

  return (
    <div className="space-y-5">
      <PageHeader
        icon={ScanFace}
        title="Identity Policy"
        subtitle="What happens when an automated identity check is not sure. Every one of these can send the case to a person instead of refusing it."
      >
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCfg(structuredClone(KYC_DEFAULTS))}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ash-900/10 px-3 py-2 text-[13px] font-medium text-ash-600 hover:bg-ash-900/5"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Platform defaults
          </button>
          <button
            onClick={() => void save()}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-navy px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Publish
          </button>
        </div>
      </PageHeader>

      {isDefault && (
        <p className="flex items-start gap-2 rounded-lg bg-sky-50 p-3 text-[12.5px] text-sky-800">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Nothing has been published yet, so these are the platform defaults. They are in force — publishing only makes
          them yours to change.
        </p>
      )}
      {saved && (
        <p className="flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-[12.5px] text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Published as version {version}. It applies to the next check that finishes.
        </p>
      )}
      {error && (
        <p className="flex items-start gap-2 rounded-lg bg-rose-50 p-3 text-[12.5px] text-rose-700">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}

      {/* ── THE HEADLINE FACT ─────────────────────────────────────────────
          A lender should never have to count down a list to discover how many
          of these turn somebody away with no human involved. */}
      <div className="rounded-xl border border-ash-900/10 p-4">
        <p className="text-[13.5px] font-semibold text-ash-900">
          {refusing.length === 0
            ? "No check refuses anyone automatically."
            : `${refusing.length} ${refusing.length === 1 ? "check refuses" : "checks refuse"} a customer automatically.`}
        </p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ash-600">
          {refusing.length === 0
            ? "Every unclear result goes to a person. This is the platform default and the safest place to start."
            : `${refusing.map((s) => s.label).join(" · ")}. Everything else goes to a person.`}
        </p>
      </div>

      {/* ── THE SIGNALS ───────────────────────────────────────────────────── */}
      <div className="space-y-2">
        {KYC_SIGNALS.map((sig) => (
          <div key={sig.key} className="rounded-xl border border-ash-900/10 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-semibold text-ash-900">{sig.label}</p>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-ash-600">{sig.blurb}</p>
                <p className="mt-1.5 text-[12px] italic leading-relaxed text-ash-500">
                  The customer is told: “{sig.customerSays}”
                </p>
              </div>

              <div className="flex shrink-0 overflow-hidden rounded-lg border border-ash-900/10">
                {OUTCOMES.map((o) => {
                  const allowed = (sig.allowed as readonly string[]).includes(o.key);
                  const active = cfg.outcomes[sig.key] === o.key;
                  return (
                    <button
                      key={o.key}
                      disabled={!allowed}
                      title={
                        allowed
                          ? o.blurb
                          : "Not available for this check — an unanswered check can never be treated as a pass."
                      }
                      onClick={() =>
                        setCfg({ ...cfg, outcomes: { ...cfg.outcomes, [sig.key]: o.key as Outcome } })
                      }
                      className={`px-3 py-2 text-[12.5px] font-semibold transition-colors ${
                        !allowed
                          ? "cursor-not-allowed bg-ash-900/[0.03] text-ash-300"
                          : active
                            ? o.key === "refuse"
                              ? "bg-rose-600 text-white"
                              : o.key === "review"
                                ? "bg-navy text-white"
                                : "bg-emerald-600 text-white"
                            : "text-ash-600 hover:bg-ash-900/5"
                      }`}
                    >
                      {o.label}
                    </button>
                  );
                })}
              </div>
            </div>
            {issueFor(`outcomes.${sig.key}`) && (
              <p className="mt-2 text-[12px] text-rose-700">{issueFor(`outcomes.${sig.key}`)}</p>
            )}
          </div>
        ))}
      </div>

      {/* ── THE NUMBERS ───────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-ash-900/10 p-4">
        <p className="text-[13.5px] font-semibold text-ash-900">Where the bands sit</p>
        <p className="mt-0.5 text-[12.5px] leading-relaxed text-ash-600">
          Scores out of 100. The two face numbers define three bands — below the first is a refusal, above the second is
          an automatic match, and the gap between them is what a person reviews.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Num
            label="ID photo quality floor"
            hint="Below this, the capture is treated as unclear."
            value={cfg.thresholds.idQualityFloor}
            issue={issueFor("thresholds.idQualityFloor")}
            onChange={(v) => setCfg({ ...cfg, thresholds: { ...cfg.thresholds, idQualityFloor: v } })}
          />
          <Num
            label="Liveness floor"
            hint="Below this, the selfie is not accepted as a live person."
            value={cfg.thresholds.livenessFloor}
            issue={issueFor("thresholds.livenessFloor")}
            onChange={(v) => setCfg({ ...cfg, thresholds: { ...cfg.thresholds, livenessFloor: v } })}
          />
          <Num
            label="Face: no-match below"
            hint="Below this the selfie and the ID portrait are treated as different people."
            value={cfg.thresholds.faceNoMatchBelow}
            issue={issueFor("thresholds.faceNoMatchBelow")}
            onChange={(v) => setCfg({ ...cfg, thresholds: { ...cfg.thresholds, faceNoMatchBelow: v } })}
          />
          <Num
            label="Face: automatic match at"
            hint="At or above this, no person is asked to look."
            value={cfg.thresholds.faceMatchAtOrAbove}
            issue={issueFor("thresholds.faceMatchAtOrAbove")}
            onChange={(v) => setCfg({ ...cfg, thresholds: { ...cfg.thresholds, faceMatchAtOrAbove: v } })}
          />
        </div>
      </div>

      {/* ── THE REVIEW ITSELF ─────────────────────────────────────────────── */}
      <div className="rounded-xl border border-ash-900/10 p-4">
        <p className="text-[13.5px] font-semibold text-ash-900">When a person reviews</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Num
            label="Retakes before a person is asked"
            hint="A customer with a genuinely worn card must not loop on “try again” for ever."
            value={cfg.review.maxRetakes}
            min={1}
            max={10}
            issue={issueFor("review.maxRetakes")}
            onChange={(v) => setCfg({ ...cfg, review: { ...cfg.review, maxRetakes: v } })}
          />
          <Num
            label="Hours before the queue is overdue"
            hint="Shown to the customer as “usually within…”. Zero means no fixed time, and the app says so."
            value={cfg.review.slaHours}
            min={0}
            max={720}
            issue={issueFor("review.slaHours")}
            onChange={(v) => setCfg({ ...cfg, review: { ...cfg.review, slaHours: v } })}
          />
        </div>

        <label className="mt-4 flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            checked={cfg.review.openConversation}
            onChange={(e) => setCfg({ ...cfg, review: { ...cfg.review, openConversation: e.target.checked } })}
            className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--navy,#012863)]"
          />
          <span>
            <span className="block text-[13px] font-medium text-ash-900">
              Open a conversation when a check is referred
            </span>
            <span className="block text-[12.5px] leading-relaxed text-ash-600">
              The customer is told what was unclear and can reply from the app. Their message arrives in Customer
              Messages. Without this, a referred customer has no way to reach anyone.
            </span>
          </span>
        </label>
        {issueFor("review.openConversation") && (
          <p className="mt-2 text-[12px] text-rose-700">{issueFor("review.openConversation")}</p>
        )}
      </div>
    </div>
  );
}

function Num({
  label,
  hint,
  value,
  onChange,
  min = 0,
  max = 100,
  issue,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  issue?: string | null;
}) {
  return (
    <div>
      <label className="block text-[13px] font-medium text-ash-900">{label}</label>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1.5 w-full rounded-lg border border-ash-900/10 px-3 py-2 text-[13px] outline-none focus:border-navy/40"
      />
      <p className="mt-1 text-[12px] leading-relaxed text-ash-500">{hint}</p>
      {issue && <p className="mt-1 text-[12px] text-rose-700">{issue}</p>}
    </div>
  );
}
