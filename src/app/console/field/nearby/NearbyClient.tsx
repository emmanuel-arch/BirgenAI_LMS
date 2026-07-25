"use client";

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMERS NEAR ME — the officer's book, on a map, coloured by who to visit.
//
// The whole consented book lands on one national map: green current, amber
// slipping, red in default, and the single worst account pulsing red so the eye
// finds it first. A ring is the radius being worked; pins beyond it fade but stay,
// because "who's just outside my circle" is a real question. Tap a dot (or a row)
// and it's the selected door — distance, an ETA estimate, what's overdue — one
// tap from turn-by-turn on the Route Planner.
//
// The honest second list stays: customers who NEVER pinned a location. They are a
// task for the next counter visit, not surveillance — one consented snapshot only.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useLoad } from "@/lib/hooks/useLoad";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2, AlertTriangle, Navigation, MapPin, Store, Home, LocateFixed, CheckCircle2,
  Route, UserRound, TriangleAlert, X, Clock, Banknote,
} from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";
import { BorrowerAvatar } from "@/components/kyc/BorrowerAvatar";
import { RiskMap, type MapCustomer, type MapBranch } from "@/components/field/RiskMap";
import { RISK_TONE, fmtEtaMin, type RiskLevel } from "@/lib/field/risk";

type Customer = {
  id: string; name: string; phone: string; verified: boolean; portraitUrl: string | null;
  lat: number; lng: number; locationType: string | null; address: string | null;
  homeLat: number | null; homeLng: number | null; homeAddress: string | null;
  riskBand: string | null;
  olb: number; activeLoans: number; distanceKm: number | null; etaMin: number | null;
  risk: RiskLevel; dpd: number; overdue: number; weight: number;
};
type Unpinned = { id: string; name: string; phone: string; activeLoans: number; olb: number };

const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
const RADII = [2, 5, 10, 0] as const; // 0 = everyone

function fmtDist(km: number | null): string {
  if (km == null) return "—";
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

function RiskChip({ level, dpd }: { level: RiskLevel; dpd: number }) {
  const t = RISK_TONE[level];
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ backgroundColor: t.soft, color: t.ink }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: t.dot }} />
      {level === "green" ? "Current" : `${dpd}d late`}
    </span>
  );
}

export function NearbyClient() {
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [branches, setBranches] = useState<MapBranch[]>([]);
  const [unpinned, setUnpinned] = useState<Unpinned[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(true);
  const [radius, setRadius] = useState<number>(0);
  const [checkin, setCheckin] = useState<"idle" | "busy" | "done">("idle");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async (pos: { lat: number; lng: number } | null) => {
    try {
      const q = pos ? `?lat=${pos.lat}&lng=${pos.lng}` : "";
      const res = await fetch(`/api/console/field/nearby${q}`);
      const d = await res.json();
      if (!d.success) { setError(d.message || "Could not load."); return; }
      setCustomers(d.customers);
      setBranches(d.branches ?? []);
      setUnpinned(d.unpinned ?? []);
    } catch { setError("Could not load."); }
  }, []);

  // Find me, then rank the book around me. Denied location still loads the book
  // (distances just go blank) — the page degrades, never dies.
  useLoad(() => {
    if (!navigator.geolocation) { setLocating(false); void load(null); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const pos = { lat: p.coords.latitude, lng: p.coords.longitude };
        setHere(pos); setLocating(false); void load(pos);
      },
      () => { setLocating(false); void load(null); },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });

  // Check in: my position becomes my dispatch base — "nearest agent" is me-aware.
  const checkIn = async () => {
    if (!here) return;
    setCheckin("busy");
    try {
      const res = await fetch("/api/console/field/nearby", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(here),
      });
      const d = await res.json();
      setCheckin(d.success ? "done" : "idle");
      if (!d.success) setError(d.message || "Check-in failed.");
    } catch { setCheckin("idle"); setError("Check-in failed."); }
  };

  const visible = useMemo(() => {
    if (!customers) return null;
    if (!radius || !here) return customers;
    return customers.filter((c) => c.distanceKm != null && c.distanceKm <= radius);
  }, [customers, radius, here]);

  const stats = useMemo(() => {
    const v = visible ?? [];
    return {
      total: v.length,
      red: v.filter((c) => c.risk === "red").length,
      amber: v.filter((c) => c.risk === "amber").length,
      overdue: v.reduce((s, c) => s + c.overdue, 0),
    };
  }, [visible]);

  const selected = useMemo(() => customers?.find((c) => c.id === selectedId) ?? null, [customers, selectedId]);

  // The map plots the WHOLE book (radius only dims, never hides).
  const mapCustomers: MapCustomer[] = useMemo(
    () => (customers ?? []).map((c) => ({
      id: c.id, name: c.name, lat: c.lat, lng: c.lng, risk: c.risk, dpd: c.dpd,
      overdue: c.overdue, weight: c.weight, olb: c.olb, distanceKm: c.distanceKm, etaMin: c.etaMin,
    })),
    [customers],
  );

  const navHref = (c: Customer) => `/console/field/map?toLat=${c.lat}&toLng=${c.lng}&toLabel=${encodeURIComponent(c.name)}`;

  return (
    <main className="mx-auto max-w-6xl px-4 sm:px-6 py-8">
      <PageHeader
        icon={Navigation}
        title="Customers Near Me"
        subtitle="Your whole book on one map, coloured by who needs a visit today — the worst account pulses. One consented pin per customer; snapshots, never tracking."
      >
        <button onClick={checkIn} disabled={!here || checkin !== "idle"}
          className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-50">
          {checkin === "busy" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : checkin === "done" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <LocateFixed className="h-3.5 w-3.5" />}
          {checkin === "done" ? "Checked in" : "Check in here"}
        </button>
      </PageHeader>

      {error && <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}</div>}
      {locating && <p className="mt-4 flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Reading your location…</p>}
      {!locating && !here && (
        <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50/90 px-3 py-2.5 text-xs text-amber-800">
          Location is off — the radius and distances are hidden, but the risk map still shows the whole book. Allow location access to work a circle around you.
        </p>
      )}

      {/* Stats + radius */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Stat label={radius && here ? `within ${radius} km` : "on the map"} value={stats.total} tone="#0f172a" />
          <Stat label="in default" value={stats.red} tone={RISK_TONE.red.dot} pulse={stats.red > 0} />
          <Stat label="slipping" value={stats.amber} tone={RISK_TONE.amber.dot} />
          <Stat label="overdue" value={kes(stats.overdue)} tone={RISK_TONE.red.ink} wide />
        </div>
        {here && (
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-zinc-500 mr-1">Within</span>
            {RADII.map((r) => (
              <button key={r} onClick={() => setRadius(r)}
                className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${radius === r ? "text-white" : "border border-zinc-900/10 bg-white/70 text-zinc-600 hover:bg-white"}`}
                style={radius === r ? { backgroundColor: "var(--brand)" } : undefined}>
                {r === 0 ? "Everyone" : `${r} km`}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* The map */}
      <div className="glass mt-4 p-1.5">
        {!customers && !error
          ? <div className="flex h-[56dvh] min-h-[360px] items-center justify-center rounded-2xl bg-zinc-100"><Loader2 className="h-5 w-5 animate-spin text-zinc-400" /></div>
          : <RiskMap customers={mapCustomers} branches={branches} here={here} radius={radius} selectedId={selectedId} onSelect={(c) => setSelectedId(c.id)} />}
      </div>

      {/* The selected door */}
      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}
            className="glass mt-3 p-4"
            style={{ borderLeft: `4px solid ${RISK_TONE[selected.risk].dot}` }}
          >
            <div className="flex items-start gap-3">
              <BorrowerAvatar name={selected.name} portraitUrl={selected.portraitUrl} verified={selected.verified} size="md" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-base font-bold truncate">{selected.name}</p>
                  <RiskChip level={selected.risk} dpd={selected.dpd} />
                </div>
                <p className="mt-0.5 text-[12px] text-zinc-500 truncate">
                  {selected.locationType === "home" ? <Home className="inline h-3 w-3 -mt-0.5" /> : <Store className="inline h-3 w-3 -mt-0.5" />}{" "}
                  {selected.address ?? (selected.locationType === "home" ? "home" : "business")}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px]">
                  <span className="inline-flex items-center gap-1 font-semibold text-zinc-700"><Route className="h-3.5 w-3.5 text-zinc-400" /> {fmtDist(selected.distanceKm)}</span>
                  <span className="inline-flex items-center gap-1 text-zinc-600"><Clock className="h-3.5 w-3.5 text-zinc-400" /> ~{fmtEtaMin(selected.etaMin)}</span>
                  {selected.olb > 0 && <span className="inline-flex items-center gap-1 text-zinc-600"><Banknote className="h-3.5 w-3.5 text-zinc-400" /> {kes(selected.olb)} out</span>}
                  {selected.overdue > 0 && <span className="font-bold" style={{ color: RISK_TONE.red.ink }}>{kes(selected.overdue)} overdue</span>}
                </div>
              </div>
              <button onClick={() => setSelectedId(null)} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href={navHref(selected)}
                className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[12px] font-bold text-white shadow"
                style={{ background: "linear-gradient(135deg, var(--brand), #7c3aed)" }}>
                <Navigation className="h-3.5 w-3.5" /> Route to their door
              </Link>
              <Link href={`/console/borrowers/${selected.id}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-900/15 bg-white/70 px-4 py-2 text-[12px] font-semibold text-zinc-700 hover:bg-white">
                <UserRound className="h-3.5 w-3.5" /> Customer 360
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* The queue, worst first. Sorting by risk weight puts the account the book
          can least afford to lose at the top — the same order the map pulses in. */}
      {visible && visible.length > 0 && (
        <div className="mt-5">
          <h2 className="mb-2 text-sm font-semibold text-zinc-700">Work the list — most urgent first</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {[...visible].sort((a, b) => b.weight - a.weight || (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity)).map((c) => (
              <button key={c.id} onClick={() => setSelectedId(c.id)}
                className={`glass p-3.5 text-left transition-shadow ${selectedId === c.id ? "ring-2 ring-[var(--brand)]" : "hover:shadow-md"}`}>
                <div className="flex items-center gap-3">
                  <span className="relative shrink-0">
                    <BorrowerAvatar name={c.name} portraitUrl={c.portraitUrl} verified={c.verified} size="sm" />
                    <span className="absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full ring-2 ring-white" style={{ backgroundColor: RISK_TONE[c.risk].dot }} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold truncate">{c.name}</p>
                      <RiskChip level={c.risk} dpd={c.dpd} />
                    </div>
                    <p className="text-[11px] text-zinc-500 truncate">
                      {c.address ?? (c.locationType === "home" ? "home" : "business")}
                      {c.overdue > 0 && <> · <span className="font-semibold" style={{ color: RISK_TONE.red.ink }}>{kes(c.overdue)} overdue</span></>}
                      {c.overdue === 0 && c.olb > 0 && <> · {kes(c.olb)} out</>}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold tabular-nums">{fmtDist(c.distanceKm)}</p>
                    <p className="text-[10px] text-zinc-400">~{fmtEtaMin(c.etaMin)}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {visible?.length === 0 && (
        <p className="mt-8 text-center text-sm text-zinc-500">
          {radius ? `No pinned customers within ${radius} km — widen the radius.` : "No customers have a location pin yet — capture one at onboarding or on the next visit."}
        </p>
      )}

      {/* The tasks: no pin on file. Sorted by money outstanding — the customer
          you most need to find is the one the book can least afford to lose. */}
      {unpinned.length > 0 && (
        <div className="glass mt-6 p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <TriangleAlert className="h-4 w-4 text-amber-500" /> No location on file ({unpinned.length})
          </h2>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            Ask for a one-time pin at their next visit or repayment — from their 360 → Update details, or re-run onboarding capture.
          </p>
          <div className="mt-2.5 grid gap-1.5 sm:grid-cols-2">
            {unpinned.slice(0, 10).map((u) => (
              <Link key={u.id} href={`/console/borrowers/${u.id}`}
                className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs hover:bg-amber-50">
                <span className="min-w-0">
                  <span className="block truncate font-medium text-zinc-800">{u.name}</span>
                  <span className="text-[10px] text-zinc-500">{u.phone}</span>
                </span>
                <span className="shrink-0 text-right">
                  {u.activeLoans > 0
                    ? <span className="font-semibold text-amber-700">{kes(u.olb)} out</span>
                    : <span className="text-zinc-400"><MapPin className="inline h-3 w-3" /> pin missing</span>}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}

function Stat({ label, value, tone, wide, pulse }: { label: string; value: number | string; tone: string; wide?: boolean; pulse?: boolean }) {
  return (
    <div className={`glass flex items-center gap-2 px-3 py-1.5 ${wide ? "" : ""}`}>
      <span className="relative flex h-2.5 w-2.5 items-center justify-center">
        {pulse && <span className="absolute h-2.5 w-2.5 animate-ping rounded-full" style={{ backgroundColor: tone, opacity: 0.5 }} />}
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tone }} />
      </span>
      <span className="text-base font-black tabular-nums text-zinc-900">{value}</span>
      <span className="text-[11px] text-zinc-500">{label}</span>
    </div>
  );
}
