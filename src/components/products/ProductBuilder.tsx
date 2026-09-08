"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE PRODUCT BUILDER — a full page, not a dialog.
//
// A loan product is the most consequential object an admin ever configures: it
// decides what money costs, what shape the repayments take, what a borrower must
// bring, who signs it off, and what happens when they run over. Eleven decisions
// deep, with cross-block validation, that is not a modal — a modal says "this will
// take a moment", and it takes an afternoon. It also cannot be linked to, cannot be
// left and returned to, and cannot show its own consequences beside it.
//
// So the builder is a page with a section rail, exactly like the credit policy: the
// same left-hand steps, the same one-document/one-dirty-state/one-Publish contract,
// the same live validation putting each problem under the control that caused it.
// A lender who has configured their credit policy already knows how to use this.
//
// TWO THINGS IT DOES THAT THE OLD WIZARD COULD NOT:
//
//   IT SHOWS THE BLAST RADIUS. Editing a live product tells you how many loans are
//   riding on the current version before you publish over it, because "who is still
//   on the old terms?" is the question a credit manager actually asks.
//
//   IT PRICES ITSELF. The review step runs a real schedule off the definition, so
//   an admin sees the instalment a customer will be quoted rather than the numbers
//   they typed.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Loader2, AlertTriangle, CheckCircle2, ArrowLeft, ArrowRight, Save, Package,
  Percent, CalendarDays, Wallet, RotateCw, ShieldCheck, GitBranch, Coins,
  Paperclip, Globe2, ClipboardCheck, History,
} from "lucide-react";
import { useLoad } from "@/lib/hooks/useLoad";
import {
  PRODUCT_DEFAULTS, mergeProduct, validateProduct, termDays,
  type ProductDefinition, type ProductIssue,
} from "@/lib/products/definition";
import { mergeAttachmentConfig, attachmentsForScope, type AttachmentItem } from "@/lib/config/attachments";
import { mergeDetailsConfig, type DetailGroup } from "@/lib/config/details";
import {
  BasicsStep, PricingStep, ScheduleStep, LimitsStep, RolloverStep,
  EligibilityStep, ProcessStep, EvidenceStep, AvailabilityStep,
  type Ctx, type StepProps,
} from "./ProductSteps";
import { ChargesStep } from "./ChargesStep";
import { ReviewStep } from "./ReviewStep";

const STEPS = [
  { key: "basics", label: "Product details", icon: Package, blurb: "What it is called, and what shape the schedule takes.", block: "name" },
  { key: "pricing", label: "Pricing", icon: Percent, blurb: "What it costs — rate, method, penalties, settling early.", block: "pricing" },
  { key: "schedule", label: "Repayment", icon: CalendarDays, blurb: "How often, how many, and which days are never due.", block: "schedule" },
  { key: "limits", label: "Limits", icon: Wallet, blurb: "How much a borrower may take, and where that comes from.", block: "limit" },
  { key: "rollover", label: "Rollover", icon: RotateCw, blurb: "What happens past maturity.", block: "rollover" },
  { key: "eligibility", label: "Rules", icon: ShieldCheck, blurb: "Who may have this product at all.", block: "eligibility" },
  { key: "process", label: "Options", icon: GitBranch, blurb: "Who approves it, and how the money leaves.", block: "process" },
  { key: "charges", label: "Charges", icon: Coins, blurb: "The fees this product carries.", block: null },
  { key: "evidence", label: "Attachments", icon: Paperclip, blurb: "What the borrower must bring, and what runs automatically.", block: "evidence" },
  { key: "availability", label: "Availability", icon: Globe2, blurb: "Where and through what channel it is sold.", block: "availability" },
  { key: "review", label: "Review & publish", icon: ClipboardCheck, blurb: "What a customer will actually be quoted.", block: null },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

type Loaded = {
  definition: ProductDefinition;
  version: number;
  isActive: boolean;
  book: { loanCount: number; activeCount: number; outstanding: number };
  versions: { version: number; changed: string[]; note: string | null; createdAt: string; loanCount: number }[];
};

export function ProductBuilder({ productId }: { productId: string | null }) {
  const router = useRouter();

  const [d, setD] = useState<ProductDefinition | null>(productId ? null : { ...PRODUCT_DEFAULTS });
  const [saved, setSaved] = useState<ProductDefinition | null>(productId ? null : { ...PRODUCT_DEFAULTS });
  const [meta, setMeta] = useState<Omit<Loaded, "definition"> | null>(
    productId ? null : { version: 0, isActive: true, book: { loanCount: 0, activeCount: 0, outstanding: 0 }, versions: [] },
  );
  const [step, setStep] = useState<StepKey>("basics");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [serverIssues, setServerIssues] = useState<ProductIssue[]>([]);
  const [note, setNote] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [id, setId] = useState<string | null>(productId);

  const [ctx, setCtx] = useState<Ctx>({
    workflows: [], branches: [], attachments: [], detailGroups: [], connected: [],
  });

  const load = useCallback(async () => {
    try {
      const [wRes, bRes, aRes, dRes, iRes] = await Promise.all([
        fetch("/api/console/workflows"),
        fetch("/api/console/branches").catch(() => null),
        fetch("/api/config/attachments"),
        fetch("/api/config/details"),
        fetch("/api/orgs/integrations").catch(() => null),
      ]);

      const wData = await wRes.json().catch(() => null);
      const bData = bRes ? await bRes.json().catch(() => null) : null;
      const aData = await aRes.json().catch(() => null);
      const dData = await dRes.json().catch(() => null);
      const iData = iRes ? await iRes.json().catch(() => null) : null;

      const attachments: AttachmentItem[] = aData?.success
        ? attachmentsForScope(mergeAttachmentConfig(aData.value), "loan")
        : [];
      const detailGroups: DetailGroup[] = dData?.success
        ? mergeDetailsConfig(dData.value).groups.filter((g) => g.active)
        : [];

      setCtx({
        workflows: wData?.success
          ? wData.workflows.map((w: { id: string; title: string; kind?: string }) => ({ id: w.id, title: w.title, kind: w.kind ?? "LOAN" }))
          : [],
        branches: bData?.success ? bData.branches.map((b: { id: string; name: string }) => ({ id: b.id, name: b.name })) : [],
        attachments,
        detailGroups,
        connected: iData?.success
          ? (iData.integrations ?? [])
              .filter((r: { status: string }) => r.status !== "UNCONFIGURED" && r.status !== "DISABLED")
              .map((r: { kind: string }) => r.kind)
          : [],
      });

      // A template picked on the shelf arrives here, once. Read-and-clear, so a
      // reload of the builder does not silently re-seed a form the admin has edited.
      if (!productId) {
        try {
          const raw = sessionStorage.getItem("product-template");
          if (raw) {
            sessionStorage.removeItem("product-template");
            const seeded = mergeProduct(JSON.parse(raw));
            setD(seeded);
            setSaved(seeded);
          }
        } catch { /* private mode, or a stale value — the builder opens blank */ }
      }

      if (productId) {
        const res = await fetch(`/api/console/products/${productId}`);
        const data = await res.json();
        if (!data.success) { setError(data.message || "Could not load the product."); return; }
        setD(data.definition);
        setSaved(data.definition);
        setMeta({
          version: data.product.version,
          isActive: data.product.isActive,
          book: data.book,
          versions: data.versions ?? [],
        });
      }
    } catch { setError("Could not load the product builder."); }
  }, [productId]);
  useLoad(load);

  const dirty = useMemo(
    () => Boolean(d && saved && JSON.stringify(d) !== JSON.stringify(saved)),
    [d, saved],
  );

  const liveIssues = useMemo(() => (d ? validateProduct(d) : []), [d]);
  const allIssues = useMemo(() => {
    const seen = new Map<string, ProductIssue>();
    for (const i of [...serverIssues, ...liveIssues]) seen.set(i.path + i.message, i);
    return [...seen.values()];
  }, [serverIssues, liveIssues]);

  const issueFor = useCallback(
    (prefix: string) => allIssues.find((i) => i.path === prefix || i.path.startsWith(`${prefix}.`))?.message ?? null,
    [allIssues],
  );

  const publish = async () => {
    if (!d) return;
    setBusy(true); setError(null); setNotice(null); setServerIssues([]);
    try {
      const res = await fetch("/api/console/products/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: id ?? undefined, definition: d, note: note.trim() || undefined }),
      });
      const data = await res.json();
      if (res.status === 422) {
        setServerIssues(data.issues ?? []);
        setError(data.message || "This product would not hold together.");
        // Jump to the first step that owns a problem, so the message is never
        // somewhere the admin cannot see.
        const first = (data.issues ?? [])[0] as ProductIssue | undefined;
        const owner = first && STEPS.find((s) => s.block && first.path.startsWith(s.block));
        if (owner) setStep(owner.key);
        return;
      }
      if (!data.success) { setError(data.message || "Could not publish."); return; }

      setSaved(data.definition);
      setD(data.definition);
      setNote("");
      setNotice(
        id
          ? `Published as version ${data.version}. Loans booked from now use it; every existing loan keeps the terms it agreed to.`
          : `${d.name} created. It is on the shelf as version ${data.version}.`,
      );
      if (!id) {
        setId(data.productId);
        // Move the URL to the edit route so a reload does not offer to create a
        // second product, and so the Charges step has something to hang fees off.
        router.replace(`/console/products/${data.productId}/edit`);
      }
      setMeta((m) => (m ? { ...m, version: data.version } : m));
    } catch { setError("Could not publish."); } finally { setBusy(false); }
  };

  if (error && !d) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <p className="flex items-start gap-2 rounded-xl bg-red-500/10 px-3 py-2.5 text-sm text-red-800 ring-1 ring-red-600/20">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      </main>
    );
  }
  if (!d || !meta) {
    return <main className="flex justify-center py-20"><Loader2 className="h-5 w-5 animate-spin text-[color:var(--ink-faint)]" /></main>;
  }

  const idx = STEPS.findIndex((s) => s.key === step);
  const Active = STEPS[idx];
  const stepProps: StepProps = { d, set: setD, ctx, issueFor };

  // A sample loan the fee step and the review step both price against, so an admin
  // sees one consistent worked example rather than two.
  const samplePrincipal = d.limit.basis === "fixed"
    ? d.limit.fixedAmount
    : d.limit.basis === "bands" && d.limit.bands.length
      ? d.limit.bands[Math.floor(d.limit.bands.length / 2)]
      : Math.round((d.limit.min + d.limit.max) / 2);
  const sampleInterest = d.pricing.ratePeriod === "term"
    ? (samplePrincipal * d.pricing.rate) / 100
    : (samplePrincipal * d.pricing.rate * d.schedule.installments) / 100;
  const sample = {
    principal: samplePrincipal,
    totalRepayable: samplePrincipal + sampleInterest,
    instalment: Math.round((samplePrincipal + sampleInterest) / Math.max(1, d.schedule.installments)),
  };

  return (
    <main className="mx-auto max-w-[92rem] px-4 pb-24 pt-6 sm:px-6 sm:pt-8">
      <Link href="/console/products" className="t-meta inline-flex items-center gap-1.5 text-[12px] hover:text-[color:var(--ink)]">
        <ArrowLeft className="h-3.5 w-3.5" /> Products
      </Link>

      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="t-display flex items-center gap-2 text-[1.6rem]">
            <Package className="h-6 w-6" style={{ color: "var(--brand)" }} />
            {id ? d.name || "Product" : "New product"}
          </h1>
          <p className="t-meta mt-1 max-w-2xl">
            {id
              ? "Every change is published as a new version. Loans already booked keep the terms they agreed to."
              : "Eleven decisions, one at a time. Nothing is saved until you publish."}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {id && (
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-[color:var(--ink-muted)] ring-1 ring-[color:var(--ink)]/10 hover:text-[color:var(--ink)]"
            >
              <History className="h-3.5 w-3.5" /> {meta.version > 0 ? `v${meta.version}` : "Unversioned"}
            </button>
          )}
          <button
            type="button"
            onClick={publish}
            disabled={busy || liveIssues.length > 0 || (!dirty && Boolean(id))}
            title={liveIssues.length > 0 ? "Resolve the highlighted problems first." : undefined}
            className="inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-[11px] font-bold text-white disabled:opacity-50"
            style={{ backgroundColor: "var(--brand)" }}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {id ? (dirty ? "Publish changes" : "Published") : "Create product"}
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
            {error ?? "This product would not hold together."}
          </p>
          <ul className="mt-1.5 space-y-0.5 pl-6 text-[12px]">
            {allIssues.map((i) => <li key={i.path + i.message} className="list-disc">{i.message}</li>)}
          </ul>
        </div>
      )}

      {showHistory && id && (
        <div className="glass mt-4 p-4">
          <p className="t-label">Published versions</p>
          {meta.versions.length === 0 ? (
            <p className="t-meta mt-2 text-[12px]">Nothing published yet.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {meta.versions.map((v) => (
                <li key={v.version} className="flex items-center justify-between gap-3 text-[12px]">
                  <span className="font-semibold text-[color:var(--ink)]">v{v.version}</span>
                  <span className="t-meta flex-1 truncate text-[11px]">
                    {v.note || (v.changed.length ? `changed: ${v.changed.join(", ")}` : "initial")}
                  </span>
                  <span className="t-meta shrink-0 text-[11px]">
                    {v.loanCount} loan{v.loanCount === 1 ? "" : "s"} ·{" "}
                    {new Date(v.createdAt).toLocaleDateString("en-KE", { dateStyle: "medium" })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-5 grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
        {/* The rail. Horizontal on a phone, a column from `lg` — the credit-policy
            shape, so the two most complex screens in the console feel like one. */}
        <nav className="flex gap-1.5 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
          {STEPS.map((s, i) => {
            const on = s.key === step;
            const problem = Boolean(s.block && issueFor(s.block));
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => setStep(s.key)}
                className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-2.5 text-left transition-colors lg:w-full ${
                  on ? "text-white" : "text-[color:var(--ink-body)] hover:bg-[color:var(--ink)]/[0.04]"
                }`}
                style={on ? { backgroundColor: "var(--brand)" } : undefined}
              >
                <s.icon className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold">{s.label}</span>
                  <span className={`hidden truncate text-[10.5px] lg:block ${on ? "text-white/70" : "text-[color:var(--ink-faint)]"}`}>
                    Step {i + 1}
                  </span>
                </span>
                {problem && (
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: on ? "rgba(255,255,255,0.9)" : "#d97706" }}
                    aria-label="Needs attention"
                  />
                )}
              </button>
            );
          })}
        </nav>

        <section className="glass p-4 sm:p-5">
          <div className="mb-4 border-b border-[color:var(--ink)]/[0.07] pb-3">
            <h2 className="t-display text-[1.05rem]">{Active.label}</h2>
            <p className="t-meta mt-0.5 text-[12px]">{Active.blurb}</p>
          </div>

          {step === "basics" && <BasicsStep {...stepProps} />}
          {step === "pricing" && <PricingStep {...stepProps} />}
          {step === "schedule" && <ScheduleStep {...stepProps} />}
          {step === "limits" && <LimitsStep {...stepProps} />}
          {step === "rollover" && <RolloverStep {...stepProps} />}
          {step === "eligibility" && <EligibilityStep {...stepProps} />}
          {step === "process" && <ProcessStep {...stepProps} />}
          {step === "charges" && <ChargesStep productId={id} sample={sample} />}
          {step === "evidence" && <EvidenceStep {...stepProps} />}
          {step === "availability" && <AvailabilityStep {...stepProps} />}
          {step === "review" && (
            <ReviewStep
              d={d}
              ctx={ctx}
              productId={id}
              version={meta.version}
              book={meta.book}
              note={note}
              onNote={setNote}
              termDays={termDays(d.schedule)}
            />
          )}

          <div className="mt-6 flex items-center justify-between gap-3 border-t border-[color:var(--ink)]/[0.07] pt-4">
            <button
              type="button"
              onClick={() => setStep(STEPS[Math.max(0, idx - 1)].key)}
              disabled={idx === 0}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold text-[color:var(--ink-muted)] hover:text-[color:var(--ink)] disabled:opacity-30"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Previous
            </button>

            {idx < STEPS.length - 1 ? (
              <button
                type="button"
                onClick={() => setStep(STEPS[idx + 1].key)}
                className="inline-flex items-center gap-1.5 rounded-lg px-5 py-2 text-[12px] font-bold text-white"
                style={{ backgroundColor: "var(--brand)" }}
              >
                Next <ArrowRight className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={publish}
                disabled={busy || liveIssues.length > 0 || (!dirty && Boolean(id))}
                className="inline-flex items-center gap-1.5 rounded-lg px-5 py-2 text-[12px] font-bold text-white disabled:opacity-50"
                style={{ backgroundColor: "var(--brand)" }}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                {id ? "Publish changes" : "Create product"}
              </button>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
