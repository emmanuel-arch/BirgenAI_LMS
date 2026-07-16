"use client";

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMERS NEAR ME — the loan officer's radius.
//
// Open your location and the book rearranges itself around you: every customer
// with a consented pin, nearest first, with the distance in metres you'd
// actually ride. One tap routes you to their door on real streets (/field/map).
//
// The second panel is the honest one: customers who NEVER pinned a location.
// They arrive as tasks, not surveillance — the fix is asking at the next
// counter visit, because we only ever save one consented snapshot.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useLoad } from "@/lib/hooks/useLoad";
import {
  Loader2, AlertTriangle, Navigation, MapPin, Store, Home, LocateFixed, CheckCircle2,
  Route, UserRound, TriangleAlert,
} from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";
import { BorrowerAvatar } from "@/components/kyc/BorrowerAvatar";

type Customer = {
  id: string; name: string; phone: string; verified: boolean; portraitUrl: string | null;
  lat: number; lng: number; locationType: string | null; address: string | null;
  homeLat: number | null; homeLng: number | null; homeAddress: string | null;
  olb: number; activeLoans: number; distanceKm: number | null;
};
type Unpinned = { id: string; name: string; phone: string; activeLoans: number; olb: number };

const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
const RADII = [2, 5, 10, 0] as const; // 0 = everyone

function fmtDist(km: number | null): string {
  if (km == null) return "—";
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

export function NearbyClient() {
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [unpinned, setUnpinned] = useState<Unpinned[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(true);
  const [radius, setRadius] = useState<number>(0);
  const [checkin, setCheckin] = useState<"idle" | "busy" | "done">("idle");

  const load = useCallback(async (pos: { lat: number; lng: number } | null) => {
    try {
      const q = pos ? `?lat=${pos.lat}&lng=${pos.lng}` : "";
      const res = await fetch(`/api/console/field/nearby${q}`);
      const d = await res.json();
      if (!d.success) { setError(d.message || "Could not load."); return; }
      setCustomers(d.customers);
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

  return (
    <main className="mx-auto max-w-5xl px-4 sm:px-6 py-8">
      <PageHeader
        icon={Navigation}
        title="Customers Near Me"
        subtitle="Your book, arranged around where you are standing. One consented pin per customer — snapshots, never tracking."
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
          Location is off — distances are hidden. Allow location access in the browser to see who is closest.
        </p>
      )}

      {/* Radius filter */}
      {here && (
        <div className="mt-4 flex items-center gap-1.5">
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

      {!visible && !error && <div className="mt-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-zinc-400" /></div>}
      {visible?.length === 0 && (
        <p className="mt-8 text-center text-sm text-zinc-500">
          {radius ? `No pinned customers within ${radius} km.` : "No customers have a location pin yet — capture one at onboarding or on the next visit."}
        </p>
      )}

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {visible?.map((c) => (
          <div key={c.id} className="glass p-3.5">
            <div className="flex items-center gap-3">
              <BorrowerAvatar name={c.name} portraitUrl={c.portraitUrl} verified={c.verified} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate">{c.name}</p>
                <p className="text-[11px] text-zinc-500 truncate">
                  {c.locationType === "home" ? <Home className="inline h-3 w-3 -mt-0.5" /> : <Store className="inline h-3 w-3 -mt-0.5" />}{" "}
                  {c.address ?? (c.locationType === "home" ? "home" : "business")}
                  {c.activeLoans > 0 && <> · <span className="font-semibold" style={{ color: "var(--brand)" }}>{kes(c.olb)}</span> out</>}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-bold tabular-nums">{fmtDist(c.distanceKm)}</p>
                <p className="text-[10px] text-zinc-400">away</p>
              </div>
            </div>
            <div className="mt-2.5 flex items-center gap-1.5">
              <Link href={`/console/field/map?toLat=${c.lat}&toLng=${c.lng}&toLabel=${encodeURIComponent(c.name)}`}
                className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-white" style={{ backgroundColor: "var(--brand)" }}>
                <Route className="h-3 w-3" /> Route to them
              </Link>
              {c.homeLat != null && c.homeLng != null && (
                <Link href={`/console/field/map?toLat=${c.homeLat}&toLng=${c.homeLng}&toLabel=${encodeURIComponent(`${c.name} — home`)}`}
                  className="inline-flex items-center gap-1 rounded-lg border border-zinc-900/15 bg-white/70 px-2.5 py-1.5 text-[11px] font-medium text-zinc-600 hover:bg-white">
                  <Home className="h-3 w-3" /> Home
                </Link>
              )}
              <Link href={`/console/borrowers/${c.id}`}
                className="inline-flex items-center gap-1 rounded-lg border border-zinc-900/15 bg-white/70 px-2.5 py-1.5 text-[11px] font-medium text-zinc-600 hover:bg-white">
                <UserRound className="h-3 w-3" /> 360
              </Link>
            </div>
          </div>
        ))}
      </div>

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
