"use client";

// ─────────────────────────────────────────────────────────────────────────────
// COMPLIANCE & DATA — the screen a lender opens when a customer says "delete me",
// and the one they show the ODPC when asked how they handle that.
//
// Three things, in the order they matter:
//   1. THE RETENTION SCHEDULE. What we keep, how long, and the law that says so.
//      Not a settings form — a statement of policy, rendered from the code that
//      actually enforces it (src/lib/compliance/retention.ts). The number beside
//      each row is what will age out of THIS lender's book tonight.
//   2. THE REGISTER. Every data-subject request and what was done about it.
//      Erasures wait here for a second pair of eyes.
//   3. THE EXPORT. Their book, on the way out, in a format a machine can read.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useState } from "react";
import { useLoad } from "@/lib/hooks/useLoad";
import {
  FileLock2, ShieldCheck, Download, Loader2, AlertTriangle, CheckCircle2, XCircle,
  Clock, Scale, Trash2, FileSpreadsheet,
} from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";

type PolicyRow = {
  key: string; label: string; what: string; days: number | null;
  basis: string; disposal: "delete" | "redact" | "purge-objects"; floor: boolean;
};
type RequestRow = {
  id: string; kind: string; status: string; subjectId: string | null; subjectLabel: string | null;
  reason: string; requestedBy: string; decidedBy: string | null; decidedAt: string | null;
  completedAt: string | null; result: unknown; createdAt: string;
};

const ORG_TABLES = ["borrowers", "applications", "loans", "installments", "repayments", "disbursements", "products", "staff", "branches"] as const;

const KIND_LABEL: Record<string, string> = {
  BORROWER_EXPORT: "Copy of their data",
  BORROWER_ERASURE: "Erase a customer",
  ORG_EXPORT: "Book export",
  ORG_DELETION: "Delete this organisation",
};
const STATUS_TONE: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-700",
  APPROVED: "bg-sky-100 text-sky-700",
  COMPLETED: "bg-emerald-100 text-emerald-700",
  REJECTED: "bg-zinc-200 text-zinc-600",
  FAILED: "bg-rose-100 text-rose-700",
};
const DISPOSAL_LABEL: Record<string, string> = {
  delete: "Deleted",
  redact: "Sensitive fields stripped, the record kept",
  "purge-objects": "The files destroyed, the result kept",
};

/** The browser takes it from here — the route answers with a Content-Disposition. */
function download(url: string) {
  window.location.href = url;
}

function windowOf(p: PolicyRow): string {
  if (p.days === null) return "Kept";
  if (p.days % 365 === 0) return `${p.days / 365} year${p.days === 365 ? "" : "s"}`;
  if (p.days >= 30) return `${Math.round(p.days / 30)} months`;
  return `${p.days} days`;
}

export default function CompliancePage() {
  const [tab, setTab] = useState<"policy" | "register">("policy");
  const [policy, setPolicy] = useState<PolicyRow[]>([]);
  const [due, setDue] = useState<Record<string, number>>({});
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [solo, setSolo] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/console/compliance");
      const d = await res.json();
      if (!d.success) { setError(d.message ?? "Could not load."); return; }
      setPolicy(d.policy ?? []);
      setDue(d.due ?? {});
      setRequests(d.requests ?? []);
      setSolo(!!d.solo);
    } catch { setError("Could not reach the server."); }
  }, []);
  useLoad(load);

  const decide = async (id: string, action: "approve" | "reject") => {
    let reason = "";
    if (action === "reject") {
      reason = window.prompt("Why is this being refused? The customer is entitled to a reason.") ?? "";
      if (reason.trim().length < 10) return;
    } else if (!window.confirm("Approve and carry this out now? Erasure cannot be undone.")) {
      return;
    }
    setBusy(id); setError(null); setNote(null);
    try {
      const res = await fetch(`/api/console/compliance/${id}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason }),
      });
      const d = await res.json();
      if (!d.success) setError(d.message ?? "That did not work.");
      else setNote(action === "approve" ? "Done. The record shows what was destroyed and what the law made you keep." : "Refused, with your reason on the record.");
      await load();
    } catch { setError("Could not reach the server."); }
    finally { setBusy(null); }
  };

  const pending = requests.filter((r) => r.status === "PENDING");

  return (
    <main className="mx-auto max-w-6xl px-4 sm:px-6 py-8">
      <PageHeader
        icon={FileLock2}
        title="Compliance & Data"
        subtitle="What you keep, how long you keep it, and what happens when a customer asks for their data — or asks you to erase it."
      />

      {error && <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}</div>}
      {note && <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50/90 px-3 py-2.5 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> {note}</div>}

      {/* Tabs */}
      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
        <button onClick={() => setTab("policy")}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 ${tab === "policy" ? "border-zinc-900 bg-zinc-900 font-semibold text-white" : "border-zinc-900/15 bg-white/70 text-zinc-600"}`}>
          <Scale className="h-3.5 w-3.5" /> Retention schedule
        </button>
        <button onClick={() => setTab("register")}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 ${tab === "register" ? "border-zinc-900 bg-zinc-900 font-semibold text-white" : "border-zinc-900/15 bg-white/70 text-zinc-600"}`}>
          <ShieldCheck className="h-3.5 w-3.5" /> Requests
          {pending.length > 0 && <span className="rounded-full bg-amber-400 px-1.5 text-[10px] font-bold text-amber-950">{pending.length}</span>}
        </button>
      </div>

      {tab === "policy" && (
        <>
          <div className="glass mt-3 p-4">
            <p className="text-[13px] leading-relaxed text-zinc-600">
              Two laws pull in opposite directions here, and both are right. The <strong>Data Protection Act 2019</strong> says
              do not keep personal data longer than you need it, and delete it when the person asks.{" "}
              <strong>POCAMLA s.46</strong> says keep every transaction and customer due-diligence record for{" "}
              <strong>seven years</strong> after the relationship ends. So a customer&apos;s selfie has a deadline, and the loan you
              gave them has a floor — and when someone asks to be erased, you honour it as far as the law allows and keep the
              rest with their name taken out of it.
            </p>
          </div>

          <div className="mt-3 space-y-2">
            {policy.map((p) => (
              <div key={p.key} className={`glass p-4 ${p.floor ? "border-l-4 border-l-amber-400" : ""}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-bold text-zinc-800">
                      {p.label}
                      {p.floor && (
                        <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                          Legal floor — never auto-deleted
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-[13px] text-zinc-600">{p.what}</p>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">{p.basis}</p>
                  </div>
                  <div className="w-full shrink-0 text-left sm:w-40 sm:text-right">
                    <p className="text-lg font-bold text-zinc-800">{windowOf(p)}</p>
                    <p className="text-[10px] text-zinc-400">{p.floor ? "for as long as the law requires" : DISPOSAL_LABEL[p.disposal]}</p>
                    {!p.floor && due[p.key] > 0 && (
                      <p className="mt-1 inline-flex items-center gap-1 rounded-md bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">
                        <Clock className="h-3 w-3" /> {due[p.key].toLocaleString()} due tonight
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Export lives under the policy: it is the other half of "it's their data". */}
          <div className="glass mt-4 p-4">
            <p className="flex items-center gap-1.5 font-bold text-zinc-800"><Download className="h-4 w-4" /> Take your data with you</p>
            <p className="mt-0.5 text-[13px] text-zinc-600">
              Your whole book, machine-readable, whenever you want it. Credentials and staff passwords are never included.
              Every export is written to the register below.
            </p>
            {/* Buttons, not links: an export is an ACT — it writes a row to the
                register below — and it is served as a download, not a page. */}
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => download("/api/console/compliance/export?scope=org")}
                className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-800">
                <Download className="h-3.5 w-3.5" /> Everything (JSON)
              </button>
              {ORG_TABLES.map((t) => (
                <button key={t} onClick={() => download(`/api/console/compliance/export?scope=org&format=csv&table=${t}`)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-900/15 bg-white/70 px-3 py-2 text-xs font-medium text-zinc-600 hover:bg-white">
                  <FileSpreadsheet className="h-3.5 w-3.5" /> {t}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {tab === "register" && (
        <>
          {solo && (
            <div className="glass mt-3 flex items-start gap-2 p-3 text-[12px] text-zinc-600">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              You are the only active member of staff, so you may approve your own requests. Add a colleague and erasures will
              need a second pair of eyes — which is what you want, once there is somebody to ask.
            </div>
          )}

          {requests.length === 0 && (
            <div className="glass mt-3 p-8 text-center text-sm text-zinc-500">
              Nothing yet. Requests appear here when a customer asks for a copy of their data, or asks to be erased —
              start one from their profile.
            </div>
          )}

          <div className="mt-3 space-y-2">
            {requests.map((r) => (
              <div key={r.id} className="glass p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-bold text-zinc-800">
                      {r.kind === "BORROWER_ERASURE" ? <Trash2 className="h-3.5 w-3.5 text-rose-500" /> : <Download className="h-3.5 w-3.5 text-zinc-400" />}
                      {KIND_LABEL[r.kind] ?? r.kind}
                      {r.subjectLabel && <span className="font-mono text-[11px] font-normal text-zinc-500">{r.subjectLabel}</span>}
                      <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_TONE[r.status] ?? ""}`}>
                        {r.status}
                      </span>
                    </p>
                    <p className="mt-1 text-[13px] text-zinc-600">{r.reason}</p>
                    <p className="mt-1 text-[11px] text-zinc-400">
                      Raised by {r.requestedBy} · {new Date(r.createdAt).toLocaleString("en-KE")}
                      {r.decidedBy && ` · decided by ${r.decidedBy}`}
                    </p>
                    <Outcome result={r.result} />
                  </div>

                  {r.status === "PENDING" && r.kind === "BORROWER_ERASURE" && (
                    <div className="flex w-full min-w-0 shrink-0 gap-2 sm:w-auto">
                      <button disabled={busy === r.id} onClick={() => decide(r.id, "approve")}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50">
                        {busy === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Approve & erase
                      </button>
                      <button disabled={busy === r.id} onClick={() => decide(r.id, "reject")}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-900/15 bg-white/70 px-3 py-2 text-xs font-medium text-zinc-600 hover:bg-white disabled:opacity-50">
                        <XCircle className="h-3.5 w-3.5" /> Refuse
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}

/** What the law made us keep, and what we destroyed — rendered from the frozen record. */
function Outcome({ result }: { result: unknown }) {
  const r = result as {
    summary?: string;
    retains?: { what: string; basis: string }[];
    outcome?: { mode?: string; objectsDeleted?: number; rowsDeleted?: Record<string, number>; rowsAnonymised?: Record<string, number> };
    rejectedBecause?: string;
    error?: string;
    note?: string;
  } | null;
  if (!r) return null;

  const sum = (o?: Record<string, number>) => Object.values(o ?? {}).reduce((a, b) => a + b, 0);

  return (
    <div className="mt-2 space-y-1.5">
      {r.note && <p className="text-[12px] italic text-zinc-500">{r.note}</p>}
      {r.summary && !r.outcome && <p className="rounded-lg bg-zinc-900/5 px-2.5 py-1.5 text-[12px] leading-relaxed text-zinc-600">{r.summary}</p>}
      {r.rejectedBecause && <p className="text-[12px] text-zinc-500">Refused: {r.rejectedBecause}</p>}
      {r.error && <p className="text-[12px] text-rose-600">{r.error}</p>}
      {r.outcome && (
        <p className="text-[12px] text-zinc-600">
          <strong>{r.outcome.mode === "HARD_DELETE" ? "Deleted completely" : "Anonymised"}</strong>
          {" — "}
          {sum(r.outcome.rowsDeleted)} record{sum(r.outcome.rowsDeleted) === 1 ? "" : "s"} destroyed,{" "}
          {r.outcome.objectsDeleted ?? 0} file{(r.outcome.objectsDeleted ?? 0) === 1 ? "" : "s"} destroyed
          {sum(r.outcome.rowsAnonymised) > 0 && <>, {sum(r.outcome.rowsAnonymised)} kept with their identity stripped out</>}.
        </p>
      )}
      {r.retains && r.retains.length > 0 && !r.outcome && (
        <ul className="space-y-0.5 text-[11px] text-zinc-500">
          {r.retains.map((x, i) => <li key={i}>• Kept: {x.what} — <span className="italic">{x.basis}</span></li>)}
        </ul>
      )}
    </div>
  );
}
