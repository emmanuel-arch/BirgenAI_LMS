"use client";

// ─────────────────────────────────────────────────────────────────────────────
// VISITS & ROUTES — the field work queue.
//
// A verification (or collection, or KYC-assist) visit is dropped on a REAL map
// — the same Google basemap as everything else, via PinDropMap: tap it, drag
// the pin, or stand there and use GPS. The nearest available field agent is
// allocated automatically, and every allocated visit is one tap from
// turn-by-turn navigation on the Route Planner.
//
// This page used to be a hand-rolled SVG scatter plot ("the schematic") with
// hardcoded demo spots, built before the Maps key existed. Dropping a pin on a
// blank rectangle meant guessing coordinates against whatever happened to be
// plotted. The queue and the allocator were always the real product — now the
// map under them is real too.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useState } from "react";
import Link from "next/link";
import { useLoad } from "@/lib/hooks/useLoad";
import { motion } from "framer-motion";
import {
  Loader2, AlertTriangle, CheckCircle2, Navigation, UserCheck, Plus, Route,
} from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";
import { PinDropMap, type LatLng } from "@/components/maps/PinDropMap";

type Agent = { id: string; name: string; title: string | null; lat: number | null; lng: number | null; avatarSeed: string; openVisits: number };
type Visit = { id: string; label: string; kind: string; status: string; address: string | null; lat: number; lng: number; distanceKm: number | null; outcome: string | null; agentId: string | null; agentName: string | null; createdAt: string };

const STATUS_TONE: Record<string, string> = {
  QUEUED: "bg-zinc-900/5 text-zinc-600", ALLOCATED: "bg-blue-100 text-blue-700",
  EN_ROUTE: "bg-indigo-100 text-indigo-700", ARRIVED: "bg-amber-100 text-amber-700",
  VERIFIED: "bg-emerald-100 text-emerald-700", FAILED: "bg-red-100 text-red-700", CANCELLED: "bg-zinc-900/5 text-zinc-400",
};
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
const AVA = ["#f97316", "#3b82f6", "#10b981", "#8b5cf6", "#e11d48", "#0ea5e9"];
const avaColor = (seed: string) => AVA[[...seed].reduce((a, c) => a + c.charCodeAt(0), 0) % AVA.length];

export function FieldClient() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [form, setForm] = useState({ label: "", address: "", kind: "BUSINESS_VERIFICATION" });
  const [pin, setPin] = useState<LatLng | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/console/field");
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not load."); return; }
      setAgents(data.agents); setVisits(data.visits);
    } catch { setError("Could not load."); } finally { setLoading(false); }
  }, []);
  useLoad(load);

  const create = async () => {
    if (!form.label.trim() || !pin) { setError("Add a label and drop the visit's pin on the map."); return; }
    setActing("create"); setError(null); setNotice(null);
    try {
      const res = await fetch("/api/console/field", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, lat: pin.lat, lng: pin.lng }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not create."); return; }
      setNotice(data.allocation ? `Allocated to ${data.allocation.agentName} — ${data.allocation.distanceKm} km away (nearest of ${data.candidates.length}).` : "Visit queued — no field agent is geolocated yet.");
      setForm({ label: "", address: "", kind: "BUSINESS_VERIFICATION" });
      setPin(null);
      await load();
    } catch { setError("Could not create."); } finally { setActing(null); }
  };

  const act = async (id: string, action: string) => {
    setActing(id + action); setError(null); setNotice(null);
    try {
      const res = await fetch(`/api/console/field/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const data = await res.json();
      if (!data.success) { setError(data.message || "Action failed."); return; }
      if (data.allocation) setNotice(`Reallocated to ${data.allocation.agentName} — ${data.allocation.distanceKm} km.`);
      await load();
    } catch { setError("Action failed."); } finally { setActing(null); }
  };

  const navHref = (v: Visit) => `/console/field/map?toLat=${v.lat}&toLng=${v.lng}&toLabel=${encodeURIComponent(v.label)}`;

  return (
    <main className="mx-auto max-w-6xl px-4 sm:px-6 py-8">
      <PageHeader
        icon={Route}
        title="Visits & Routes"
        subtitle="Drop a visit where the customer actually is; the nearest available agent is allocated automatically — and every stop is one tap from turn-by-turn navigation."
      >
        <Link href="/console/field/map"
          className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-800">
          <Navigation className="h-3.5 w-3.5" /> Route Planner
        </Link>
      </PageHeader>

      {notice && <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50/90 px-3 py-2.5 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> {notice}</div>}
      {error && <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}</div>}
      {loading && <div className="mt-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-zinc-400" /></div>}

      {!loading && (
        <div className="mt-5 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          {/* New visit: a real pin on real streets */}
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass p-3">
            <PinDropMap value={pin} onChange={setPin} height={340} />
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <input value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder="Visit label (e.g. Jane's kiosk)"
                className="rounded-lg border border-zinc-900/15 bg-white/80 px-3 py-2 text-sm outline-none sm:col-span-2" />
              <input value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} placeholder="Address / landmark"
                className="rounded-lg border border-zinc-900/15 bg-white/80 px-3 py-2 text-sm outline-none" />
              <select value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}
                className="rounded-lg border border-zinc-900/15 bg-white/80 px-3 py-2 text-sm outline-none">
                <option value="BUSINESS_VERIFICATION">Business verification</option>
                <option value="HOME_VERIFICATION">Home verification</option>
                <option value="COLLECTION_VISIT">Collection visit</option>
                <option value="KYC_ASSIST">KYC assist</option>
              </select>
              <button onClick={create} disabled={acting === "create"}
                className="sm:col-span-2 inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60" style={{ backgroundColor: "var(--brand)" }}>
                {acting === "create" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create & auto-allocate
              </button>
            </div>
          </motion.div>

          {/* Roster + visits */}
          <div className="space-y-4">
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="glass p-4">
              <h2 className="text-sm font-semibold flex items-center gap-1.5"><Navigation className="h-4 w-4" style={{ color: "var(--brand)" }} /> Field agents ({agents.length})</h2>
              <div className="mt-3 space-y-2">
                {agents.map((a) => (
                  <div key={a.id} className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold text-white shrink-0" style={{ backgroundColor: avaColor(a.avatarSeed) }}>{initials(a.name)}</div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate">{a.name}</p>
                      <p className="text-[11px] text-zinc-500">{a.title ?? "Field agent"}{a.lat == null ? " · no location" : ""}</p>
                    </div>
                    <span className="rounded-md bg-zinc-900/5 px-2 py-1 text-[11px] font-semibold text-zinc-600 shrink-0">{a.openVisits} open</span>
                  </div>
                ))}
                {agents.length === 0 && <p className="text-xs text-zinc-500">No field agents yet — mark staff as field agents in Team & roles.</p>}
              </div>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass p-4">
              <h2 className="text-sm font-semibold">Visits ({visits.length})</h2>
              <div className="mt-3 space-y-2 max-h-[420px] overflow-y-auto">
                {visits.map((v) => (
                  <div key={v.id} className="rounded-xl border border-zinc-900/10 bg-white/70 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold truncate">{v.label}</p>
                      <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold shrink-0 ${STATUS_TONE[v.status]}`}>{v.status.replace("_", " ")}</span>
                    </div>
                    <p className="text-[11px] text-zinc-500 truncate">{v.address ?? v.kind.replace(/_/g, " ").toLowerCase()}{v.agentName ? ` · ${v.agentName}` : ""}{v.distanceKm != null ? ` · ${v.distanceKm} km` : ""}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {["ALLOCATED", "EN_ROUTE", "ARRIVED"].includes(v.status) && (
                        <>
                          <Link href={navHref(v)}
                            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-white"
                            style={{ background: "linear-gradient(135deg, var(--brand), #7c3aed)" }}>
                            <Navigation className="h-3 w-3" /> Navigate
                          </Link>
                          {v.status === "ALLOCATED" && <FieldBtn onClick={() => act(v.id, "en_route")} busy={acting === v.id + "en_route"} label="Start route" />}
                          {v.status === "EN_ROUTE" && <FieldBtn onClick={() => act(v.id, "arrived")} busy={acting === v.id + "arrived"} label="Arrived" />}
                          {v.status === "ARRIVED" && <FieldBtn onClick={() => act(v.id, "verify")} busy={acting === v.id + "verify"} label="Verify ✓" primary />}
                          <FieldBtn onClick={() => act(v.id, "reallocate")} busy={acting === v.id + "reallocate"} label="Reallocate" />
                        </>
                      )}
                      {v.status === "QUEUED" && <FieldBtn onClick={() => act(v.id, "reallocate")} busy={acting === v.id + "reallocate"} label="Allocate nearest" />}
                      {v.status === "VERIFIED" && <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600"><UserCheck className="h-3.5 w-3.5" /> {v.outcome}</span>}
                    </div>
                  </div>
                ))}
                {visits.length === 0 && <p className="text-xs text-zinc-500">No visits yet.</p>}
              </div>
            </motion.div>
          </div>
        </div>
      )}
    </main>
  );
}

function FieldBtn({ onClick, busy, label, primary }: { onClick: () => void; busy: boolean; label: string; primary?: boolean }) {
  return (
    <button onClick={onClick} disabled={busy}
      className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-60 ${primary ? "text-white" : "border border-zinc-900/15 bg-white/70 text-zinc-700 hover:bg-white"}`}
      style={primary ? { backgroundColor: "var(--brand)" } : undefined}>
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null} {label}
    </button>
  );
}
