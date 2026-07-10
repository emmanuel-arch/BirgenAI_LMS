"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useLoad } from "@/lib/hooks/useLoad";
import { motion } from "framer-motion";
import { Loader2, AlertTriangle, CheckCircle2, Navigation, UserCheck, Plus, Route } from "lucide-react";

type Agent = { id: string; name: string; title: string | null; lat: number | null; lng: number | null; avatarSeed: string; openVisits: number };
type Visit = { id: string; label: string; kind: string; status: string; address: string | null; lat: number; lng: number; distanceKm: number | null; outcome: string | null; agentId: string | null; agentName: string | null; createdAt: string };
type RouteLeg = { id: string; order: number; legKm: number };

// Preset demo locations around Nairobi so a visit can be dropped without a maps key.
const DEMO_SPOTS = [
  { name: "Gikomba Market", lat: -1.2833, lng: 36.8344 },
  { name: "Westlands", lat: -1.2676, lng: 36.8108 },
  { name: "Kawangware", lat: -1.2867, lng: 36.7517 },
  { name: "Embakasi", lat: -1.3200, lng: 36.9140 },
  { name: "Kasarani", lat: -1.2200, lng: 36.8969 },
  { name: "Karen", lat: -1.3190, lng: 36.7060 },
];

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
  const [routes, setRoutes] = useState<Record<string, RouteLeg[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [form, setForm] = useState({ label: "", address: "", kind: "BUSINESS_VERIFICATION", lat: 0, lng: 0 });
  const svgRef = useRef<SVGSVGElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/console/field");
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not load."); return; }
      setAgents(data.agents); setVisits(data.visits); setRoutes(data.routes);
    } catch { setError("Could not load."); } finally { setLoading(false); }
  }, []);
  useLoad(load);

  // Bounding box over agents + visits (+ demo spots as a floor) → SVG projection.
  const pts = useMemo(() => {
    const all = [
      ...agents.filter((a) => a.lat != null).map((a) => ({ lat: a.lat!, lng: a.lng! })),
      ...visits.map((v) => ({ lat: v.lat, lng: v.lng })),
      ...DEMO_SPOTS,
    ];
    const lats = all.map((p) => p.lat), lngs = all.map((p) => p.lng);
    const pad = 0.01;
    return { minLat: Math.min(...lats) - pad, maxLat: Math.max(...lats) + pad, minLng: Math.min(...lngs) - pad, maxLng: Math.max(...lngs) + pad };
  }, [agents, visits]);

  const W = 640, H = 380;
  const proj = (lat: number, lng: number) => ({
    x: ((lng - pts.minLng) / (pts.maxLng - pts.minLng || 1)) * W,
    y: (1 - (lat - pts.minLat) / (pts.maxLat - pts.minLat || 1)) * H,
  });
  const unproj = (x: number, y: number) => ({
    lng: pts.minLng + (x / W) * (pts.maxLng - pts.minLng),
    lat: pts.minLat + (1 - y / H) * (pts.maxLat - pts.minLat),
  });

  const onMapClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const y = ((e.clientY - rect.top) / rect.height) * H;
    const { lat, lng } = unproj(x, y);
    setForm((f) => ({ ...f, lat: Number(lat.toFixed(5)), lng: Number(lng.toFixed(5)) }));
  };

  const create = async () => {
    if (!form.label.trim() || (!form.lat && !form.lng)) { setError("Add a label and drop a location on the map."); return; }
    setActing("create"); setError(null); setNotice(null);
    try {
      const res = await fetch("/api/console/field", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not create."); return; }
      setNotice(data.allocation ? `Allocated to ${data.allocation.agentName} — ${data.allocation.distanceKm} km away (nearest of ${data.candidates.length}).` : "Visit queued — no field agent is geolocated yet.");
      setForm({ label: "", address: "", kind: "BUSINESS_VERIFICATION", lat: 0, lng: 0 });
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

  const agentById = (id: string | null) => agents.find((a) => a.id === id);
  const dropPin = form.lat && form.lng ? proj(form.lat, form.lng) : null;

  return (
    <main className="mx-auto max-w-6xl px-4 sm:px-6 py-8">
        <h1 className="mt-3 text-xl font-bold flex items-center gap-2"><Route className="h-5 w-5" style={{ color: "var(--brand)" }} /> Field & route planner</h1>
        <p className="mt-1 text-xs text-zinc-500">Drop a verification visit; the nearest available agent is allocated automatically. Every agent&apos;s queue is ordered into a drive route.</p>

        {notice && <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50/90 px-3 py-2.5 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> {notice}</div>}
        {error && <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}</div>}
        {loading && <div className="mt-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-zinc-400" /></div>}

        {!loading && (
          <div className="mt-5 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
            {/* Schematic map */}
            <div className="glass p-3">
              <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-slate-50 to-zinc-100 ring-1 ring-zinc-900/10">
                <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full cursor-crosshair" onClick={onMapClick}>
                  <defs>
                    <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
                      <path d="M 32 0 L 0 0 0 32" fill="none" stroke="rgba(0,0,0,0.05)" strokeWidth="1" />
                    </pattern>
                  </defs>
                  <rect width={W} height={H} fill="url(#grid)" />
                  {/* Route polylines per agent */}
                  {Object.entries(routes).map(([agentId, legs]) => {
                    const a = agentById(agentId); if (!a?.lat) return null;
                    const ordered = [...legs].sort((x, y) => x.order - y.order);
                    let prev = proj(a.lat!, a.lng!);
                    return (
                      <g key={agentId}>
                        {ordered.map((leg) => {
                          const v = visits.find((vv) => vv.id === leg.id); if (!v) return null;
                          const p = proj(v.lat, v.lng); const line = <line key={leg.id} x1={prev.x} y1={prev.y} x2={p.x} y2={p.y} stroke={avaColor(a.avatarSeed)} strokeWidth={2} strokeDasharray="5 4" opacity={0.6} />;
                          prev = p; return line;
                        })}
                      </g>
                    );
                  })}
                  {/* Visits */}
                  {visits.filter((v) => !["CANCELLED"].includes(v.status)).map((v) => {
                    const p = proj(v.lat, v.lng);
                    const done = v.status === "VERIFIED";
                    return (
                      <g key={v.id}>
                        <circle cx={p.x} cy={p.y} r={7} fill={done ? "#10b981" : "#fff"} stroke={done ? "#10b981" : "#71717a"} strokeWidth={2} />
                        <PinGlyph x={p.x - 5} y={p.y - 14} />
                      </g>
                    );
                  })}
                  {/* Agents */}
                  {agents.filter((a) => a.lat != null).map((a) => {
                    const p = proj(a.lat!, a.lng!);
                    return (
                      <g key={a.id}>
                        <circle cx={p.x} cy={p.y} r={13} fill={avaColor(a.avatarSeed)} stroke="#fff" strokeWidth={2.5} />
                        <text x={p.x} y={p.y + 4} textAnchor="middle" fontSize="10" fontWeight="700" fill="#fff">{initials(a.name)}</text>
                      </g>
                    );
                  })}
                  {/* Drop pin */}
                  {dropPin && <motion.circle initial={{ r: 0 }} animate={{ r: 9 }} cx={dropPin.x} cy={dropPin.y} fill="none" stroke="var(--brand)" strokeWidth={3} />}
                </svg>
                <span className="absolute bottom-2 right-2 rounded bg-white/80 px-2 py-0.5 text-[9px] text-zinc-400">Schematic · tap to drop a visit</span>
              </div>

              {/* New visit form */}
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
                <div className="sm:col-span-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-zinc-400">Quick drop:</span>
                  {DEMO_SPOTS.map((s) => (
                    <button key={s.name} onClick={() => setForm((f) => ({ ...f, lat: s.lat, lng: s.lng, label: f.label || s.name }))}
                      className="rounded-full border border-zinc-900/10 bg-white/70 px-2 py-0.5 text-[11px] hover:bg-white">{s.name}</button>
                  ))}
                </div>
                <button onClick={create} disabled={acting === "create"}
                  className="sm:col-span-2 inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60" style={{ backgroundColor: "var(--brand)" }}>
                  {acting === "create" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create & auto-allocate
                </button>
              </div>
            </div>

            {/* Roster + visits */}
            <div className="space-y-4">
              <div className="glass p-4">
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
              </div>

              <div className="glass p-4">
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
              </div>
            </div>
          </div>
        )}
      </main>
  );
}

// Tiny map-pin glyph as an SVG child (lucide MapPin isn't directly embeddable in <svg>).
function PinGlyph({ x, y }: { x: number; y: number }) {
  return <path transform={`translate(${x},${y}) scale(0.42)`} d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z" fill="none" stroke="#71717a" strokeWidth={3} opacity={0.7} />;
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
