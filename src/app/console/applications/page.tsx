"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE APPLICATION QUEUE — a list, not an accordion.
//
// Every row is a person waiting on a decision, and a decision that large deserves a
// page, not a drawer that unfolds under the row above. So the queue reads like the
// Borrowers list: name, amount, where it is — and clicking it opens the full dossier
// at /console/applications/[id], where the officer sees the face, the model, the
// schedule and the three buttons that move it.
// ─────────────────────────────────────────────────────────────────────────────
import { Suspense, useCallback, useState } from "react";
import Link from "next/link";
import { useLoad } from "@/lib/hooks/useLoad";
import { Loader2, AlertTriangle, FileText, FilePlus2, ChevronRight, Gauge } from "lucide-react";

type App = {
  id: string; createdAt: string; status: string; stageTitle: string | null;
  borrowerName: string | null; phone: string | null; amountRequested: number;
  productName: string | null; score: number | null; pd: number | null;
  approvedLimit: number | string | null; deviceSharedWith: number;
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
  const [scope, setScope] = useState<"live" | "all">("live");
  const [apps, setApps] = useState<App[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <main className="mx-auto max-w-5xl px-4 sm:px-6 py-8">
      <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-bold flex items-center gap-2"><FileText className="h-5 w-5" style={{ color: "var(--brand)" }} /> Applications</h1>
        <div className="flex items-center gap-2">
          <Link href="/console/applications/new" className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-800">
            <FilePlus2 className="h-3.5 w-3.5" /> New application
          </Link>
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

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}
      {!apps && !error && <div className="mt-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-zinc-400" /></div>}
      {apps?.length === 0 && <p className="mt-10 text-center text-sm text-zinc-500">No applications {scope === "live" ? "waiting for action" : "yet"}.</p>}

      <div className="mt-5 space-y-2.5">
        {apps?.map((a) => (
          <Link key={a.id} href={`/console/applications/${a.id}`}
            className="glass flex items-center gap-3 p-4 transition-colors hover:bg-white/70">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-semibold truncate">{a.borrowerName || a.phone || "Applicant"}</p>
                <span className="text-sm font-semibold" style={{ color: "var(--brand)" }}>{fmtKES(a.amountRequested)}</span>
                {a.deviceSharedWith > 0 && (
                  <span className="rounded-md bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700" title="This device has applied for other borrowers too">
                    Device ×{a.deviceSharedWith + 1}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-zinc-500 truncate">
                {a.productName ?? "No product"} · {new Date(a.createdAt).toLocaleString("en-KE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                {a.score != null && <> · <Gauge className="inline h-3 w-3" /> score <span className="font-semibold">{a.score}</span></>}
                {a.approvedLimit != null && Number(a.approvedLimit) > 0 && <> · up to <span className="font-semibold">{fmtKES(Number(a.approvedLimit))}</span></>}
              </p>
            </div>
            <span className={`rounded-md px-2 py-1 text-[11px] font-semibold shrink-0 ${STATUS_TONE[a.status] ?? "bg-zinc-900/5 text-zinc-600"}`}>
              {a.stageTitle ?? a.status}
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-zinc-300" />
          </Link>
        ))}
      </div>
    </main>
  );
}
