"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE WORKFLOW BUILDER — a chain of stages, each of which can run anything.
//
// The system we are replacing has the right idea and the wrong shape. Its stage
// table is a row of hard-coded gates: `CanFinalize`, `CanUpdate`, `crbRequired`,
// and — added the day one lender asked for it — `RequestMpesaRatiba`. Every new
// verification anybody wants is a column, a migration and a Razor conditional, and
// because the gate lives ON THE STAGE, a lender who wants the bureau check at the
// front door instead of the finance stage simply cannot have it.
//
// Here a stage HOLDS checks rather than BEING a fixed set of them. The picker is
// the same control the borrower-onboarding screen and a product's evidence step
// use, over the same catalogue, so moving a CRB pull from finance to risk — or out
// of the workflow entirely and onto onboarding — is a toggle in each place.
//
// WHAT ELSE A STAGE CARRIES that theirs cannot:
//   · an SLA, so a case nobody touched escalates instead of ageing quietly
//   · attachments and extra fields, so "the approver must upload the signed form"
//     is configuration rather than a habit
//   · a finalize CAP, so a branch manager may sign 50,000 and not 500,000
//   · a disbursement ROUTE, so one product can pay out through our B2C queue while
//     everything else lands in the lender's own system
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  GitBranch, Loader2, AlertTriangle, CheckCircle2, ArrowLeft, Plus, Trash2, Save,
  ChevronDown, ChevronUp, ShieldCheck, Clock, Coins, Paperclip,
} from "lucide-react";
import { useLoad } from "@/lib/hooks/useLoad";
import {
  SwitchRow, Choice, NumberField, TextField, SelectField, Divider, INPUT,
} from "@/components/settings/controls";
import { ChecksPicker } from "@/components/settings/ChecksPicker";
import { type CheckBinding } from "@/lib/workflow/checks";
import {
  mergeAttachmentConfig, attachmentsForScope, type AttachmentItem,
} from "@/lib/config/attachments";
import { mergeDetailsConfig, type DetailGroup } from "@/lib/config/details";

/** What a chain approves. Mirrors the Prisma enum; the labels are the lender's words. */
export const WORKFLOW_KINDS = [
  { key: "LOAN", label: "Loan approval", blurb: "A new or repeat loan application, from submission to booking." },
  { key: "RESTRUCTURE", label: "Restructure", blurb: "Rescheduling a live loan." },
  { key: "TOPUP", label: "Top-up", blurb: "Lending more on a loan that is already running." },
  { key: "WAIVER", label: "Waiver", blurb: "Forgiving penalty, interest or fees." },
  { key: "WRITEOFF", label: "Write-off", blurb: "Taking a loss, deliberately." },
  { key: "REDISBURSEMENT", label: "Redisbursement", blurb: "Re-releasing money that came back." },
  { key: "DISBURSEMENT", label: "Disbursement", blurb: "Releasing money on an already-approved loan." },
  { key: "RECONCILIATION", label: "Reconciliation", blurb: "Releasing a suspended payment." },
  { key: "FLOAT", label: "Float", blurb: "Moving money into and out of a paying account." },
  { key: "EXPENSE", label: "Expense", blurb: "Anything the business spends that is not a loan." },
  { key: "OTHER", label: "Other", blurb: "Something else entirely." },
] as const;

const TIERS = [
  { value: "1", label: "Initiator", hint: "Raises and progresses the case. The first pair of hands." },
  { value: "2", label: "Authorizer", hint: "Signs it off. The second pair of eyes." },
  { value: "3", label: "Validator", hint: "The last word — usually the stage that finalizes." },
];

type Stage = {
  title: string;
  accessTier: number;
  canFinalize: boolean;
  canReschedule: boolean;
  otpRequired: boolean;
  maxAmount: string;
  slaHours: number;
  disbursementRoute: string;
  checks: CheckBinding[];
  attachments: string[];
  detailGroups: string[];
  roleIds: string[];
};

const emptyStage = (n: number): Stage => ({
  title: n === 1 ? "Officer review" : "Approval",
  accessTier: n === 1 ? 1 : 3,
  canFinalize: false,
  canReschedule: false,
  otpRequired: n !== 1,
  maxAmount: "",
  slaHours: 0,
  disbursementRoute: "",
  checks: [],
  attachments: [],
  detailGroups: [],
  roleIds: [],
});

export function WorkflowBuilder({ workflowId }: { workflowId: string | null }) {
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState("LOAN");
  const [multiApproval, setMultiApproval] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [stages, setStages] = useState<Stage[]>([
    { ...emptyStage(1), title: "Officer review" },
    { ...emptyStage(2), title: "Final approval", canFinalize: true },
  ]);

  const [open, setOpen] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(Boolean(workflowId));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [roles, setRoles] = useState<{ id: string; name: string }[]>([]);
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [detailGroups, setDetailGroups] = useState<DetailGroup[]>([]);
  const [connected, setConnected] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const [rRes, aRes, dRes, iRes] = await Promise.all([
        fetch("/api/console/roles").catch(() => null),
        fetch("/api/config/attachments"),
        fetch("/api/config/details"),
        fetch("/api/orgs/integrations").catch(() => null),
      ]);

      const rData = rRes ? await rRes.json().catch(() => null) : null;
      if (rData?.success) {
        setRoles((rData.roles ?? []).map((r: { id: string; name: string }) => ({ id: r.id, name: r.name })));
      }
      const aData = await aRes.json().catch(() => null);
      if (aData?.success) setAttachments(attachmentsForScope(mergeAttachmentConfig(aData.value), "approval"));
      const dData = await dRes.json().catch(() => null);
      if (dData?.success) {
        setDetailGroups(mergeDetailsConfig(dData.value).groups.filter((g) => g.active && g.scope === "approval"));
      }
      const iData = iRes ? await iRes.json().catch(() => null) : null;
      if (iData?.success) {
        setConnected(
          (iData.integrations ?? [])
            .filter((r: { status: string }) => r.status !== "UNCONFIGURED" && r.status !== "DISABLED")
            .map((r: { kind: string }) => r.kind),
        );
      }

      if (workflowId) {
        const res = await fetch("/api/console/workflows");
        const data = await res.json();
        if (!data.success) { setError(data.message || "Could not load the workflow."); return; }
        const w = (data.workflows ?? []).find((x: { id: string }) => x.id === workflowId);
        if (!w) { setError("Workflow not found."); return; }
        setTitle(w.title);
        setDescription(w.description ?? "");
        setKind(w.kind ?? "LOAN");
        setMultiApproval(Boolean(w.multiApproval));
        setIsActive(w.isActive !== false);
        setStages(
          (w.stages ?? []).map((s: Record<string, unknown>) => ({
            title: String(s.title ?? ""),
            accessTier: Number(s.accessTier ?? 1),
            canFinalize: Boolean(s.canFinalize),
            canReschedule: Boolean(s.canReschedule),
            otpRequired: s.otpRequired !== false,
            maxAmount: s.maxAmount != null ? String(s.maxAmount) : "",
            slaHours: Number(s.slaHours ?? 0),
            disbursementRoute: (s.disbursementRoute as string) ?? "",
            checks: (s.checks ?? []) as CheckBinding[],
            attachments: (s.attachments ?? []) as string[],
            detailGroups: (s.detailGroups ?? []) as string[],
            roleIds: (s.roleIds ?? []) as string[],
          })),
        );
      }
    } catch { setError("Could not load the workflow builder."); } finally { setLoading(false); }
  }, [workflowId]);
  useLoad(load);

  const isLoanChain = kind === "LOAN";

  const problems = useMemo(() => {
    const out: string[] = [];
    if (title.trim().length < 3) out.push("Give the workflow a name of at least three characters.");
    if (stages.length === 0) out.push("Add at least one stage.");
    if (stages.some((s) => !s.title.trim())) out.push("Every stage needs a title.");
    // A chain that never finalizes is a queue with no exit — cases enter it and stop.
    if (stages.length > 0 && !stages.some((s) => s.canFinalize)) {
      out.push("No stage finalizes, so nothing could ever leave this workflow.");
    }
    // A cap on a stage that cannot finalize is a setting that silently does nothing.
    for (const s of stages) {
      if (!s.canFinalize && s.disbursementRoute) {
        out.push(`"${s.title || "A stage"}" does not finalize, so it cannot choose a disbursement route.`);
      }
    }
    // Everyone-can-sign-everything is the configuration four eyes exists to prevent.
    if (multiApproval && stages.length > 1) {
      // Not fatal — some lenders genuinely run a one-person branch — but say it out loud.
      out.push("");
    }
    return out.filter(Boolean);
  }, [title, stages, multiApproval]);

  const setStage = (i: number, patch: Partial<Stage>) =>
    setStages((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const move = (i: number, dir: -1 | 1) => {
    const next = [...stages];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setStages(next);
    setOpen(j);
  };

  const save = async () => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const payload = {
        id: workflowId ?? undefined,
        title: title.trim(),
        description: description.trim(),
        kind,
        multiApproval,
        isActive,
        stages: stages.map((s) => ({
          ...s,
          maxAmount: s.maxAmount.trim() ? Number(s.maxAmount) : null,
          disbursementRoute: s.disbursementRoute || null,
        })),
      };
      const res = await fetch("/api/console/workflows", {
        method: workflowId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not save."); return; }
      setNotice(workflowId ? "Workflow saved." : `"${title}" created — assign it to a product or a loan action.`);
      if (!workflowId && data.workflow?.id) router.replace(`/console/workflows/${data.workflow.id}`);
    } catch { setError("Could not save."); } finally { setBusy(false); }
  };

  if (loading) {
    return <main className="flex justify-center py-20"><Loader2 className="h-5 w-5 animate-spin text-[color:var(--ink-faint)]" /></main>;
  }

  return (
    <main className="mx-auto max-w-4xl px-4 pb-24 pt-6 sm:px-6 sm:pt-8">
      <Link href="/console/workflows" className="t-meta inline-flex items-center gap-1.5 text-[12px] hover:text-[color:var(--ink)]">
        <ArrowLeft className="h-3.5 w-3.5" /> Workflows
      </Link>

      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="t-display flex items-center gap-2 text-[1.6rem]">
            <GitBranch className="h-6 w-6" style={{ color: "var(--brand)" }} />
            {workflowId ? title || "Workflow" : "New workflow"}
          </h1>
          <p className="t-meta mt-1 max-w-2xl">
            Stages run in order. Each one decides who may act, what must be checked, and
            what must be on file before the case moves on.
          </p>
        </div>
        <button type="button" onClick={save} disabled={busy || problems.length > 0}
          title={problems.length > 0 ? problems[0] : undefined}
          className="inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-[11px] font-bold text-white disabled:opacity-50"
          style={{ backgroundColor: "var(--brand)" }}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {workflowId ? "Save workflow" : "Create workflow"}
        </button>
      </div>

      {notice && (
        <div className="mt-4 flex items-start gap-2 rounded-xl bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-800 ring-1 ring-emerald-600/20">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {notice}
        </div>
      )}
      {(error || problems.length > 0) && (
        <div className="mt-4 rounded-xl bg-amber-500/10 px-3 py-2.5 text-sm text-amber-900 ring-1 ring-amber-600/20">
          <p className="flex items-start gap-2 font-semibold">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error ?? "This workflow would not hold together."}
          </p>
          {problems.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 pl-6 text-[12px]">
              {problems.map((p) => <li key={p} className="list-disc">{p}</li>)}
            </ul>
          )}
        </div>
      )}

      {/* ── The chain itself ── */}
      <div className="glass mt-5 p-4 sm:p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Title" value={title} onChange={setTitle} placeholder="SME loan approval" />
          <TextField label="Description" value={description} onChange={setDescription}
            placeholder="Three-tier chain for business loans above 100,000." />
        </div>

        <div className="mt-4">
          <SelectField
            label="What this approves" value={kind} onChange={setKind}
            options={WORKFLOW_KINDS.map((k) => ({ value: k.key, label: k.label }))}
            help={WORKFLOW_KINDS.find((k) => k.key === kind)?.blurb}
          />
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <SwitchRow
            title="One person may sign twice"
            desc="On: the same user may approve at more than one stage of the same case. Off is four eyes — whoever signed cannot sign again further up."
            checked={multiApproval}
            onChange={setMultiApproval}
          />
          <SwitchRow
            title="Available"
            desc="Off keeps it configured but stops it being offered to products and settings."
            checked={isActive}
            onChange={setIsActive}
          />
        </div>
        {multiApproval && (
          <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-2 text-[11.5px] text-amber-900 ring-1 ring-amber-600/20">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
            With this on, one person can carry a case from start to finish. That is a real
            choice for a one-branch lender and a control failure for anyone else.
          </p>
        )}
      </div>

      {/* ── Stages ── */}
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="t-label">Stages ({stages.length})</p>
        <button type="button"
          onClick={() => { setStages([...stages, emptyStage(stages.length + 1)]); setOpen(stages.length); }}
          disabled={stages.length >= 8}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-40"
          style={{ backgroundColor: "var(--brand)" }}>
          <Plus className="h-3.5 w-3.5" /> Add stage
        </button>
      </div>

      <div className="mt-2 space-y-2.5">
        {stages.map((s, i) => {
          const expanded = open === i;
          return (
            <div key={i} className="glass overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3">
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white"
                  style={{ backgroundColor: "var(--brand)" }}
                >
                  {i + 1}
                </span>
                <button type="button" onClick={() => setOpen(expanded ? -1 : i)} className="min-w-0 flex-1 text-left">
                  <p className="flex flex-wrap items-center gap-1.5 text-[13.5px] font-semibold text-[color:var(--ink)]">
                    {s.title || <span className="italic text-[color:var(--ink-faint)]">Untitled stage</span>}
                    {s.canFinalize && (
                      <span className="rounded-full bg-emerald-500/12 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-emerald-700">
                        Finalizes
                      </span>
                    )}
                  </p>
                  <p className="t-meta text-[11px]">
                    {TIERS.find((t) => t.value === String(s.accessTier))?.label}
                    {s.roleIds.length > 0 ? ` · ${s.roleIds.length} role${s.roleIds.length === 1 ? "" : "s"}` : " · any role"}
                    {s.checks.length > 0 ? ` · ${s.checks.length} check${s.checks.length === 1 ? "" : "s"}` : ""}
                    {s.maxAmount ? ` · up to KES ${Number(s.maxAmount).toLocaleString()}` : ""}
                    {s.slaHours > 0 ? ` · escalates after ${s.slaHours}h` : ""}
                  </p>
                </button>
                <div className="flex shrink-0 items-center gap-1">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                    className="p-1 text-[color:var(--ink-faint)] disabled:opacity-20 hover:text-[color:var(--ink)]">
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === stages.length - 1}
                    className="p-1 text-[color:var(--ink-faint)] disabled:opacity-20 hover:text-[color:var(--ink)]">
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                  {stages.length > 1 && (
                    <button type="button" onClick={() => setStages(stages.filter((_, j) => j !== i))}
                      className="p-1 text-[color:var(--ink-faint)] hover:text-red-500">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {expanded && (
                <div className="space-y-5 border-t border-[color:var(--ink)]/[0.07] px-4 py-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextField label="Stage title" value={s.title} onChange={(v) => setStage(i, { title: v })}
                      placeholder="Risk review" />
                    <SelectField label="Access tier" value={String(s.accessTier)}
                      onChange={(v) => setStage(i, { accessTier: Number(v) })}
                      options={TIERS.map((t) => ({ value: t.value, label: t.label }))}
                      help={TIERS.find((t) => t.value === String(s.accessTier))?.hint} />
                  </div>

                  <Divider label="Who may act here" />
                  {roles.length === 0 ? (
                    <p className="t-meta text-[12px]">
                      No roles defined yet — anyone with the approval right may act at this stage.{" "}
                      <Link href="/console/roles" className="font-semibold underline">Define roles</Link>
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {roles.map((r) => {
                        const on = s.roleIds.includes(r.id);
                        return (
                          <button key={r.id} type="button" aria-pressed={on}
                            onClick={() => setStage(i, {
                              roleIds: on ? s.roleIds.filter((x) => x !== r.id) : [...s.roleIds, r.id],
                            })}
                            className="rounded-full px-3 py-1.5 text-[12px] font-semibold ring-1 transition-colors"
                            style={on
                              ? { backgroundColor: "var(--brand-soft)", color: "var(--ink)", ["--tw-ring-color" as never]: "var(--brand)" }
                              : { color: "var(--ink-muted)", ["--tw-ring-color" as never]: "rgba(15,15,25,0.10)" }}>
                            {r.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <p className="t-meta text-[11px]">
                    {s.roleIds.length === 0
                      ? "No roles selected — anyone with the approval right may act here."
                      : `Only these roles may act at this stage.`}
                  </p>

                  <Divider label="What this stage can do" />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <SwitchRow
                      title="Finalizes the case"
                      desc="Clearing this stage ends the chain — for a loan, that means booking it."
                      checked={s.canFinalize}
                      onChange={(v) => setStage(i, { canFinalize: v, disbursementRoute: v ? s.disbursementRoute : "" })}
                    />
                    <SwitchRow
                      title="Requires an OTP"
                      desc="The approver confirms with a one-time code. Slower, and what an audit asks for."
                      checked={s.otpRequired}
                      onChange={(v) => setStage(i, { otpRequired: v })}
                    />
                    {isLoanChain && (
                      <SwitchRow
                        title="May reschedule"
                        desc="The approver can move the loan's dates from this stage."
                        checked={s.canReschedule}
                        onChange={(v) => setStage(i, { canReschedule: v })}
                      />
                    )}
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block">
                      <span className="t-label">Finalize cap (KES)</span>
                      <input
                        className={INPUT} inputMode="numeric" value={s.maxAmount}
                        onChange={(e) => setStage(i, { maxAmount: e.target.value.replace(/[^\d]/g, "") })}
                        placeholder="No cap"
                        disabled={!s.canFinalize}
                      />
                      <span className="mt-1 block text-[11px] text-[color:var(--ink-faint)]">
                        {s.canFinalize
                          ? "Above this, the case cannot be finalized here — it has to go further up."
                          : "Only meaningful on a stage that finalizes."}
                      </span>
                    </label>
                    <NumberField
                      label="Escalate after" suffix="hours" min={0} max={720}
                      value={s.slaHours} onChange={(v) => setStage(i, { slaHours: v })}
                      help="0 = never. A case nobody has touched for this long is raised rather than ageing quietly."
                    />
                  </div>

                  {s.canFinalize && isLoanChain && (
                    <Choice
                      label="Where the money goes when this stage finalizes"
                      value={s.disbursementRoute || "inherit"}
                      onChange={(v) => setStage(i, { disbursementRoute: v === "inherit" ? "" : v })}
                      cols={3}
                      options={[
                        { value: "inherit", label: "Inherit", hint: "Whatever your organisation is set to. The safe default." },
                        { value: "LMS_NATIVE", label: "This platform", hint: "Our maker-checker queue pays it out through the product's own mode." },
                        { value: "LENDER_BRIDGE", label: "Your own system", hint: "Posted into your existing process. We keep the application, the score and the audit trail." },
                      ]}
                    />
                  )}

                  <Divider label="What must be on file" />
                  {attachments.length === 0 ? (
                    <p className="t-meta text-[12px]">
                      No approval-scoped attachments in your catalogue.{" "}
                      <Link href="/console/settings/attachments" className="font-semibold underline">Add one</Link> to
                      require, say, a signed committee minute before this stage clears.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {attachments.map((a) => {
                        const on = s.attachments.includes(a.code);
                        return (
                          <button key={a.code} type="button" aria-pressed={on}
                            onClick={() => setStage(i, {
                              attachments: on ? s.attachments.filter((x) => x !== a.code) : [...s.attachments, a.code],
                            })}
                            className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[12px] font-semibold ring-1 transition-colors"
                            style={on
                              ? { backgroundColor: "var(--brand-soft)", color: "var(--ink)", ["--tw-ring-color" as never]: "var(--brand)" }
                              : { color: "var(--ink-muted)", ["--tw-ring-color" as never]: "rgba(15,15,25,0.10)" }}>
                            <Paperclip className="h-3 w-3" /> {a.name}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {detailGroups.length > 0 && (
                    <>
                      <Divider label="What the approver fills in" />
                      <div className="flex flex-wrap gap-1.5">
                        {detailGroups.map((g) => {
                          const on = s.detailGroups.includes(g.code);
                          return (
                            <button key={g.code} type="button" aria-pressed={on}
                              onClick={() => setStage(i, {
                                detailGroups: on ? s.detailGroups.filter((x) => x !== g.code) : [...s.detailGroups, g.code],
                              })}
                              className="rounded-full px-3 py-1.5 text-[12px] font-semibold ring-1 transition-colors"
                              style={on
                                ? { backgroundColor: "var(--brand-soft)", color: "var(--ink)", ["--tw-ring-color" as never]: "var(--brand)" }
                                : { color: "var(--ink-muted)", ["--tw-ring-color" as never]: "rgba(15,15,25,0.10)" }}>
                              {g.title} ({g.items.length})
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}

                  <Divider label="What runs automatically here" />
                  <p className="t-meta text-[12px]">
                    Any of these can sit at any stage. A bureau pull at risk review, a Ratiba
                    mandate before finance signs, a float check before the money leaves — it is
                    the same picker in each place, and you can move a check by switching it off
                    here and on somewhere else.
                  </p>
                  <ChecksPicker
                    surface="stage"
                    value={s.checks}
                    onChange={(v) => setStage(i, { checks: v })}
                    connected={connected}
                    emptyHint="Nothing runs here — this stage is a human judgment on whatever earlier stages produced."
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── What the chain adds up to ── */}
      <div className="glass mt-5 p-4">
        <p className="t-label">In plain words</p>
        <ol className="mt-2 space-y-1.5">
          {stages.map((s, i) => (
            <li key={i} className="flex gap-2 text-[12.5px] text-[color:var(--ink-body)]">
              <span className="t-meta shrink-0 text-[11px]">{i + 1}.</span>
              <span>
                <span className="font-semibold text-[color:var(--ink)]">{s.title || "Untitled"}</span>
                {" — "}
                {s.roleIds.length > 0
                  ? `${s.roleIds.map((id) => roles.find((r) => r.id === id)?.name ?? "a role").join(" or ")}`
                  : "anyone with the approval right"}
                {s.checks.length > 0 && (
                  <>, after {s.checks.filter((c) => c.blocking).length} blocking check
                    {s.checks.filter((c) => c.blocking).length === 1 ? "" : "s"}</>
                )}
                {s.otpRequired && <>, confirmed with an OTP</>}
                {s.canFinalize && (
                  <>. <span className="font-semibold">This stage finalizes</span>
                    {s.maxAmount ? ` up to KES ${Number(s.maxAmount).toLocaleString()}` : ""}.</>
                )}
                {!s.canFinalize && "."}
              </span>
            </li>
          ))}
        </ol>
        <p className="t-meta mt-2 flex flex-wrap items-center gap-3 text-[11px]">
          <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3 w-3" />
            {multiApproval ? "One person may sign more than once" : "Four eyes — nobody signs twice"}</span>
          <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />
            {stages.some((s) => s.slaHours > 0) ? "Escalates on inaction" : "No escalation"}</span>
          <span className="inline-flex items-center gap-1"><Coins className="h-3 w-3" />
            {stages.filter((s) => s.canFinalize).length} finalizing stage
            {stages.filter((s) => s.canFinalize).length === 1 ? "" : "s"}</span>
        </p>
      </div>
    </main>
  );
}

