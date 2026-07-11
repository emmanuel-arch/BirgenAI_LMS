"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLoad } from "@/lib/hooks/useLoad";
import { Loader2, AlertTriangle, CheckCircle2, XCircle, FileText, ChevronDown, FilePlus2, Search } from "lucide-react";
import { OfferPanel } from "./OfferPanel";
import { SecurityPanel } from "./SecurityPanel";

type App = {
  id: string; createdAt: string; status: string; stageTitle: string | null; currentStageId: string | null;
  borrowerName: string | null; phone: string | null; amountRequested: number;
  productName: string | null; score: number | null; pd: number | null; decision: string | null;
  reasonCodes: { factor?: string; detail?: string; direction?: string }[] | null;
  graduated: boolean; postedToServiceSuite: boolean; serviceSuiteLoanId: string | null;
  loan: { id: string; status: string } | null;
};

const fmtKES = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
const STATUS_TONE: Record<string, string> = {
  OFFICER_REVIEW: "bg-amber-100 text-amber-700",
  REFERRED: "bg-orange-100 text-orange-700",
  APPROVED: "bg-emerald-100 text-emerald-700",
  DECLINED: "bg-red-100 text-red-700",
  SUBMITTED: "bg-zinc-900/5 text-zinc-600",
};

export default function ApplicationsPage() {
  return (
    <Suspense fallback={null}>
      <ApplicationsQueue />
    </Suspense>
  );
}

function ApplicationsQueue() {
  const search = useSearchParams();
  // The sidebar's "Apply for a Borrower" deep-links here with ?apply=1.
  const [applying, setApplying] = useState(search.get("apply") === "1");
  const [scope, setScope] = useState<"live" | "all">("live");
  const [apps, setApps] = useState<App[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [otpFor, setOtpFor] = useState<string | null>(null);
  const [otp, setOtp] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/console/applications?scope=${scope}`);
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not load applications."); return; }
      setApps(data.applications);
    } catch { setError("Could not load applications."); }
  }, [scope]);

  useLoad(() => { setApps(null); return load(); }, [load]);

  const act = async (id: string, action: "approve" | "decline", otpCode?: string) => {
    setActing(id + action); setNotice(null); setError(null);
    try {
      const res = await fetch(`/api/console/applications/${id}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(otpCode ? { otp: otpCode } : {}) }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "Action failed."); return; }
      if (data.otpRequired) {
        // Final approval is OTP-gated — the code just went to the approver's email.
        setOtpFor(id); setOtp("");
        setNotice(data.message);
        return;
      }
      setOtpFor(null); setOtp("");
      setNotice(
        data.booked
          ? `Loan booked: ${fmtKES(data.booked.loanAmount)} over ${data.booked.installments} installments — queued for disbursement.`
          : `Application ${data.status === "DECLINED" ? "declined" : data.stageTitle ? `moved to ${data.stageTitle}` : data.status.toLowerCase()}.`,
      );
      await load();
    } catch { setError("Action failed."); } finally { setActing(null); }
  };

  return (
    <main className="mx-auto max-w-5xl px-4 sm:px-6 py-8">
        <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-xl font-bold flex items-center gap-2"><FileText className="h-5 w-5" style={{ color: "var(--brand)" }} /> Applications</h1>
          <div className="flex items-center gap-2">
          <button onClick={() => setApplying((v) => !v)} className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-800">
            <FilePlus2 className="h-3.5 w-3.5" /> New application
          </button>
          <div className="flex gap-1 rounded-lg border border-zinc-900/10 bg-white/70 p-1 text-xs font-semibold">
            {(["live", "all"] as const).map((s) => (
              <button key={s} onClick={() => setScope(s)}
                className={`rounded-md px-3 py-1.5 ${scope === s ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-white"}`}>
                {s === "live" ? "Needs action" : "All"}
              </button>
            ))}
          </div>
          </div>
        </div>

        {applying && (
          <AssistedApplyPanel
            onClose={() => setApplying(false)}
            onCreated={async (msg) => { setApplying(false); setNotice(msg); setError(null); await load(); }}
            setError={setError}
          />
        )}

        {notice && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50/90 px-3 py-2.5 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> {notice}
          </div>
        )}
        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
          </div>
        )}
        {!apps && !error && <div className="mt-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-zinc-400" /></div>}
        {apps?.length === 0 && <p className="mt-10 text-center text-sm text-zinc-500">No applications {scope === "live" ? "waiting for action" : "yet"}.</p>}

        <div className="mt-5 space-y-3">
          {apps?.map((a) => {
            const expanded = open === a.id;
            const live = ["SUBMITTED", "AI_PRESCREEN", "OFFICER_REVIEW", "REFERRED"].includes(a.status);
            return (
              <div key={a.id} className="glass p-4">
                <button className="w-full flex items-center gap-3 text-left" onClick={() => setOpen(expanded ? null : a.id)}>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate">{a.borrowerName || a.phone || "Applicant"} · {fmtKES(a.amountRequested)}</p>
                    <p className="text-xs text-zinc-500 truncate">
                      {a.productName ?? "No product"} · {new Date(a.createdAt).toLocaleString("en-KE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                      {a.score != null && <> · score <span className="font-semibold">{a.score}</span>/900</>}
                    </p>
                  </div>
                  <span className={`rounded-md px-2 py-1 text-[11px] font-semibold shrink-0 ${STATUS_TONE[a.status] ?? "bg-zinc-900/5 text-zinc-600"}`}>
                    {a.stageTitle ?? a.status}
                  </span>
                  <ChevronDown className={`h-4 w-4 text-zinc-400 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
                </button>

                {expanded && (
                  <div className="mt-3 border-t border-zinc-900/10 pt-3">
                    {Array.isArray(a.reasonCodes) && a.reasonCodes.length > 0 && (
                      <ul className="space-y-1">
                        {a.reasonCodes.map((r, i) => (
                          <li key={i} className="text-xs text-zinc-600">
                            <span className={r.direction === "down" ? "text-red-600" : "text-emerald-600"}>{r.direction === "down" ? "▼" : "▲"}</span>{" "}
                            <span className="font-semibold">{r.factor}</span>{r.detail ? ` — ${r.detail}` : ""}
                          </li>
                        ))}
                      </ul>
                    )}
                    {a.loan && <p className="mt-2 text-xs text-zinc-500">Loan {a.loan.id.slice(0, 8)}… · {a.loan.status}</p>}
                    {/* A loan will not book until this says "Signed". */}
                    {!a.loan && <OfferPanel applicationId={a.id} onChanged={load} />}
                    {/* Who stands behind it, and what secures it. Booking checks both. */}
                    {!a.loan && <SecurityPanel applicationId={a.id} onChanged={load} />}
                    {live && otpFor !== a.id && (
                      <div className="mt-3 flex gap-2">
                        <button disabled={!!acting} onClick={() => act(a.id, "approve")}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-60">
                          {acting === a.id + "approve" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                          {a.currentStageId === "virtual:final" ? "Final approve & book" : "Approve"}
                        </button>
                        <button disabled={!!acting} onClick={() => act(a.id, "decline")}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white/70 px-4 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60">
                          {acting === a.id + "decline" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
                          Decline
                        </button>
                      </div>
                    )}
                    {live && otpFor === a.id && (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                          inputMode="numeric" placeholder="6-digit code from your email"
                          className="rounded-lg border border-zinc-900/15 bg-white/80 px-3 py-2 text-sm outline-none w-52" />
                        <button disabled={otp.length !== 6 || !!acting} onClick={() => act(a.id, "approve", otp)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-60">
                          {acting === a.id + "approve" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Confirm & book
                        </button>
                        <button onClick={() => act(a.id, "approve")} disabled={!!acting}
                          className="text-xs text-zinc-500 underline hover:text-zinc-800">Resend code</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </main>
  );
}

// An officer applies on a walk-in borrower's behalf. The application enters the
// same approval chain as a funnel one — same offer signature before booking
// (BRANCH channel exists for the counter), same audit trail, no invented score.
function AssistedApplyPanel({ onClose, onCreated, setError }: {
  onClose: () => void; onCreated: (msg: string) => void; setError: (s: string | null) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: string; name: string | null; phone: string; activeLoans: number }[]>([]);
  const [borrower, setBorrower] = useState<{ id: string; name: string | null; phone: string } | null>(null);
  const [products, setProducts] = useState<{ id: string; name: string; minPrincipal: number; maxPrincipal: number; interestRate: number; repaymentPeriod: number; repaymentPeriodUnit: string }[]>([]);
  const [productId, setProductId] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/console/products");
      const data = await res.json().catch(() => ({}));
      if (data.success) {
        setProducts((data.products ?? []).filter((p: { isActive?: boolean }) => p.isActive !== false));
      }
    })();
  }, []);

  const searchBorrowers = async () => {
    if (!q.trim()) return;
    const res = await fetch(`/api/console/borrowers?q=${encodeURIComponent(q.trim())}`);
    const data = await res.json().catch(() => ({}));
    if (data.success) setResults((data.borrowers ?? []).slice(0, 5));
  };

  const product = products.find((p) => p.id === productId) ?? null;

  const submit = async () => {
    if (!borrower || !product) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/console/applications", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ borrowerId: borrower.id, productId, amount: Number(amount) }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not create the application."); return; }
      onCreated(`Application created for ${borrower.name ?? borrower.phone} — it's in the queue below, entering your approval workflow at stage 1.`);
    } catch { setError("Could not create the application."); } finally { setBusy(false); }
  };

  const field = "w-full rounded-lg border border-zinc-900/15 bg-white/80 px-3 py-2.5 text-sm outline-none placeholder:text-zinc-400";

  return (
    <div className="glass mt-4 p-5">
      <p className="text-sm font-semibold">Apply on a borrower&apos;s behalf</p>
      <p className="mt-0.5 text-[11px] text-zinc-500">
        Walk-in customer at the counter. The application joins the same queue and approval workflow — booking still
        requires the borrower&apos;s signed offer (a paper signature at the branch counts).
      </p>

      {!borrower ? (
        <>
          <div className="mt-3 flex gap-2 max-w-md">
            <input className={field} placeholder="Find the borrower — name, phone or ID" value={q}
              onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && searchBorrowers()} />
            <button onClick={searchBorrowers} className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-semibold text-white"><Search className="h-4 w-4" /></button>
          </div>
          <div className="mt-2 space-y-1 max-w-md">
            {results.map((b) => (
              <button key={b.id} onClick={() => setBorrower(b)} className="flex w-full items-center justify-between rounded-lg border border-zinc-900/10 bg-white/70 px-3 py-2 text-left text-sm hover:bg-white">
                <span className="font-medium">{b.name ?? "Borrower"}</span>
                <span className="text-xs text-zinc-500">{b.phone}{b.activeLoans > 0 ? ` · ${b.activeLoans} active` : ""}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-zinc-400">Not registered yet? Add them under Borrowers → New borrower first.</p>
        </>
      ) : (
        <>
          <p className="mt-3 text-xs text-zinc-500">
            For <span className="font-semibold text-zinc-800">{borrower.name ?? borrower.phone}</span>{" "}
            <button className="underline" onClick={() => setBorrower(null)}>change</button>
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 max-w-2xl">
            <select className={field} value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">Product…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {Number(p.interestRate)}% / {p.repaymentPeriod} {p.repaymentPeriodUnit}s
                </option>
              ))}
            </select>
            <input className={field} inputMode="numeric" placeholder="Amount (KES)" value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} />
          </div>
          {product && (
            <p className="mt-1.5 text-[11px] text-zinc-400">
              {Number(product.minPrincipal) > 0 || Number(product.maxPrincipal) > 0
                ? `${product.name} lends ${Number(product.minPrincipal) > 0 ? `from KES ${Number(product.minPrincipal).toLocaleString()}` : ""}${Number(product.maxPrincipal) > 0 ? ` up to KES ${Number(product.maxPrincipal).toLocaleString()}` : ""}.`
                : `${product.name} has no fixed amount limits.`}
            </p>
          )}
          <div className="mt-4 flex items-center gap-2">
            <button onClick={submit} disabled={busy || !productId || !(Number(amount) > 0)}
              className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "var(--brand)" }}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FilePlus2 className="h-4 w-4" />} Create application
            </button>
            <button onClick={onClose} className="rounded-lg border border-zinc-900/15 bg-white/70 px-4 py-2.5 text-sm font-medium text-zinc-600">Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}
