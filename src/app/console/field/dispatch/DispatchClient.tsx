"use client";

// ─────────────────────────────────────────────────────────────────────────────
// DISPATCH INBOX — where "Dispatch agent" requests actually land.
//
// Customer-360 and Collections fire a dispatch; every field agent sees it here.
// The one who says YES gets it: the visit allocates to them, the distance from
// their last check-in appears, and one tap opens the real-streets route
// (/field/map). Auto-allocated visits show up under MY TASKS the same way.
//
// The board is honest about states: open requests anyone can take, my tasks
// with the next verb (start → arrived → verify), and what closed today.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useState } from "react";
import Link from "next/link";
import { useLoad } from "@/lib/hooks/useLoad";
import {
  Loader2, AlertTriangle, Send, CheckCircle2, Route, Inbox, ClipboardList, MapPin,
} from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";

type Visit = {
  id: string; label: string; kind: string; status: string; address: string | null;
  lat: number; lng: number; distanceKm: number | null; outcome: string | null;
  agentId: string | null; agentName: string | null; createdAt: string;
};
type Me = { id: string; isFieldAgent: boolean };

const KIND_LABEL: Record<string, string> = {
  BUSINESS_VERIFICATION: "Business verification", HOME_VERIFICATION: "Home verification",
  COLLECTION_VISIT: "Collection visit", KYC_ASSIST: "KYC assist",
};
const STATUS_TONE: Record<string, string> = {
  QUEUED: "bg-zinc-900/5 text-zinc-600", ALLOCATED: "bg-blue-100 text-blue-700",
  EN_ROUTE: "bg-indigo-100 text-indigo-700", ARRIVED: "bg-amber-100 text-amber-700",
  VERIFIED: "bg-emerald-100 text-emerald-700", FAILED: "bg-red-100 text-red-700",
};

export function DispatchClient() {
  const [me, setMe] = useState<Me | null>(null);
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/console/field");
      const d = await res.json();
      if (!d.success) { setError(d.message || "Could not load."); return; }
      setMe(d.me ?? null);
      setVisits(d.visits ?? []);
    } catch { setError("Could not load."); }
  }, []);
  useLoad(load);

  const act = async (id: string, action: string) => {
    setActing(id + action); setError(null); setNotice(null);
    try {
      const res = await fetch(`/api/console/field/${id}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
      });
      const d = await res.json();
      if (!d.success) { setError(d.message || "Action failed."); return; }
      if (action === "accept") setNotice(d.distanceKm != null ? `Yours — ${d.distanceKm} km from your last check-in. Ride safe.` : "Yours. Check in on Customers Near Me so distances show.");
      await load();
    } catch { setError("Action failed."); } finally { setActing(null); }
  };

  const open = visits?.filter((v) => v.status === "QUEUED") ?? [];
  const mine = visits?.filter((v) => v.agentId === me?.id && ["ALLOCATED", "EN_ROUTE", "ARRIVED"].includes(v.status)) ?? [];
  const others = visits?.filter((v) => v.agentId && v.agentId !== me?.id && ["ALLOCATED", "EN_ROUTE", "ARRIVED"].includes(v.status)) ?? [];
  const closed = visits?.filter((v) => ["VERIFIED", "FAILED"].includes(v.status)).slice(0, 6) ?? [];

  const routeHref = (v: Visit) => `/console/field/map?toLat=${v.lat}&toLng=${v.lng}&toLabel=${encodeURIComponent(v.label)}`;

  const card = (v: Visit, actions: React.ReactNode) => (
    <div key={v.id} className="glass p-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold truncate">{v.label}</p>
        <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold shrink-0 ${STATUS_TONE[v.status] ?? "bg-zinc-900/5 text-zinc-500"}`}>{v.status.replace("_", " ")}</span>
      </div>
      <p className="mt-0.5 text-[11px] text-zinc-500 truncate">
        {KIND_LABEL[v.kind] ?? v.kind}{v.address ? ` · ${v.address}` : ""}
        {v.agentName ? ` · ${v.agentName}` : ""}
        {v.distanceKm != null ? ` · ${v.distanceKm} km` : ""}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">{actions}</div>
    </div>
  );

  const btn = (label: string, onClick: () => void, busy: boolean, primary = false) => (
    <button onClick={onClick} disabled={busy}
      className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-60 ${primary ? "text-white" : "border border-zinc-900/15 bg-white/70 text-zinc-700 hover:bg-white"}`}
      style={primary ? { backgroundColor: "var(--brand)" } : undefined}>
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null} {label}
    </button>
  );

  return (
    <main className="mx-auto max-w-5xl px-4 sm:px-6 py-8">
      <PageHeader
        icon={Send}
        title="Dispatch Inbox"
        subtitle="Requests from Customer-360 and Collections. The nearest agent says yes — and gets the route."
      />

      {notice && <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50/90 px-3 py-2.5 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> {notice}</div>}
      {error && <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}</div>}
      {!visits && !error && <div className="mt-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-zinc-400" /></div>}

      {visits && me && !me.isFieldAgent && (
        <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50/90 px-3 py-2.5 text-xs text-amber-800">
          You are not flagged as a field agent, so you can watch the board but not accept — an admin flips that in Team &amp; roles.
        </p>
      )}

      {visits && (
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          {/* Open requests */}
          <section>
            <h2 className="flex items-center gap-1.5 text-sm font-semibold"><Inbox className="h-4 w-4" style={{ color: "var(--brand)" }} /> Open requests ({open.length})</h2>
            <div className="mt-2.5 space-y-2">
              {open.length === 0 && <p className="text-xs text-zinc-500">Nothing waiting — every request has an agent.</p>}
              {open.map((v) => card(v, <>
                {me?.isFieldAgent && btn("Yes — I'll take it", () => act(v.id, "accept"), acting === v.id + "accept", true)}
                <Link href={routeHref(v)} className="inline-flex items-center gap-1 rounded-lg border border-zinc-900/15 bg-white/70 px-2.5 py-1.5 text-[11px] font-medium text-zinc-600 hover:bg-white">
                  <Route className="h-3 w-3" /> See route
                </Link>
              </>))}
            </div>
          </section>

          {/* My tasks */}
          <section>
            <h2 className="flex items-center gap-1.5 text-sm font-semibold"><ClipboardList className="h-4 w-4" style={{ color: "var(--brand)" }} /> My tasks ({mine.length})</h2>
            <div className="mt-2.5 space-y-2">
              {mine.length === 0 && <p className="text-xs text-zinc-500">No visits on your plate.</p>}
              {mine.map((v) => card(v, <>
                {v.status === "ALLOCATED" && btn("Start route", () => act(v.id, "en_route"), acting === v.id + "en_route", true)}
                {v.status === "EN_ROUTE" && btn("Arrived", () => act(v.id, "arrived"), acting === v.id + "arrived", true)}
                {v.status === "ARRIVED" && btn("Verify ✓", () => act(v.id, "verify"), acting === v.id + "verify", true)}
                <Link href={routeHref(v)} className="inline-flex items-center gap-1 rounded-lg border border-zinc-900/15 bg-white/70 px-2.5 py-1.5 text-[11px] font-medium text-zinc-600 hover:bg-white">
                  <Route className="h-3 w-3" /> Route
                </Link>
              </>))}
            </div>

            {others.length > 0 && (
              <>
                <h3 className="mt-5 text-[11px] font-bold uppercase tracking-wide text-zinc-400">With other agents ({others.length})</h3>
                <div className="mt-2 space-y-2">
                  {others.map((v) => card(v, me?.isFieldAgent
                    ? btn("Take it over", () => act(v.id, "accept"), acting === v.id + "accept")
                    : <span className="text-[11px] text-zinc-400"><MapPin className="inline h-3 w-3" /> {v.agentName}</span>))}
                </div>
              </>
            )}

            {closed.length > 0 && (
              <>
                <h3 className="mt-5 text-[11px] font-bold uppercase tracking-wide text-zinc-400">Recently closed</h3>
                <div className="mt-2 space-y-1.5">
                  {closed.map((v) => (
                    <div key={v.id} className="flex items-center justify-between gap-2 rounded-lg border border-zinc-900/10 bg-white/60 px-3 py-2 text-xs">
                      <span className="truncate text-zinc-600">{v.label}{v.agentName ? ` · ${v.agentName}` : ""}</span>
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_TONE[v.status]}`}>{v.status}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
