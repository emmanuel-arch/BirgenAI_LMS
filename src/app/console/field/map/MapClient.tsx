"use client";

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE MAP — real Nairobi streets, real traffic, honest fares.
//
// Google Maps JS for the cartography, Google Directions for the route. Every
// customer with a consented pin is on the map; tap one (or arrive with ?toLat=…)
// and the route draws itself: distance, minutes, and what the ride SHOULD cost —
// boda, matatu, ride-hail, own fuel — priced with localized 2026 Nairobi rates.
//
// THE MINUTES ARE NOW MEASURED, NOT MODELLED. This screen used to route over the
// OSRM demo server and multiply the answer by a rush-hour factor derived from the
// EAT clock — an educated guess that could not know about a stalled lorry on
// Jogoo Road. Directions is asked with `departureTime: now`, so `duration_in_traffic`
// comes back from Google's live read of the actual roads. We still show what the
// trip takes on clear roads beside it, because the DIFFERENCE between the two is
// the information an officer plans their morning around.
//
// (Why not Leaflet + OSM any more: Google's terms forbid drawing Directions
// content on a non-Google map. Traffic and cartography come as a pair. See
// src/lib/maps/google.ts.)
//
// Riri rides along: one tap hands her the live route context and she guides —
// landmarks, fair prices, what to watch for. She is Nairobi-localised; this is
// her home turf.
// ─────────────────────────────────────────────────────────────────────────────
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Loader2, AlertTriangle, MapIcon, LocateFixed, Bike, Bus, CarTaxiFront, Fuel,
  Bot, X, Route as RouteIcon, Crosshair,
} from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";
import { loadGoogleMaps, mapsMode, MAPS_UNCONFIGURED } from "@/lib/maps/google";

type Customer = {
  id: string; name: string; lat: number; lng: number; locationType: string | null;
  address: string | null; homeLat: number | null; homeLng: number | null; olb: number;
};
type Pt = { lat: number; lng: number; label: string };
/** `trafficMins` is Google's live figure; `mins` is the same road with no traffic. */
type RouteInfo = { km: number; mins: number; trafficMins: number; peak: boolean; live: boolean };

const NAIROBI = { lat: -1.2864, lng: 36.8172 }; // CBD
const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;

// ── Nairobi fare arithmetic (2026 street rates, localized) ────────────────────
function fares(km: number, mins: number) {
  const boda = Math.max(50, Math.round((50 + km * 32) / 10) * 10);
  const matatu = km <= 3 ? 30 : km <= 7 ? 50 : km <= 12 ? 80 : km <= 20 ? 100 : 150;
  const ride = Math.max(200, Math.round(120 + km * 42 + mins * 7));
  const fuel = Math.round(km * 17); // ~8.5 L/100km at ~KES 199/L
  return { boda, matatu, ride, fuel };
}

/** Rush hour by the EAT clock. Now only a LABEL — the minutes come from Google. */
function isPeak(): boolean {
  const hour = Number(new Intl.DateTimeFormat("en-KE", { hour: "numeric", hour12: false, timeZone: "Africa/Nairobi" }).format(new Date()));
  return (hour >= 6 && hour < 10) || (hour >= 16 && hour < 20);
}

export function MapClient() {
  return (
    <Suspense fallback={null}>
      <RouteMap />
    </Suspense>
  );
}

function RouteMap() {
  const search = useSearchParams();
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const directionsRef = useRef<google.maps.DirectionsService | null>(null);
  const rendererRef = useRef<google.maps.DirectionsRenderer | null>(null);
  const pinsRef = useRef<google.maps.Marker[]>([]);
  const endMarkersRef = useRef<google.maps.Marker[]>([]);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [start, setStart] = useState<Pt | null>(null);
  // ?toLat=… deep links (Nearby, Dispatch, 360) arrive with the destination set.
  const [dest, setDest] = useState<Pt | null>(() => {
    const toLat = Number(search.get("toLat")), toLng = Number(search.get("toLng"));
    return Number.isFinite(toLat) && Number.isFinite(toLng)
      ? { lat: toLat, lng: toLng, label: search.get("toLabel") ?? "Destination" }
      : null;
  });
  const [route, setRoute] = useState<RouteInfo | null>(null);
  const [routing, setRouting] = useState(false);
  // Which end the next map tap sets. Starts on "start" until located, then "dest".
  const [arm, setArm] = useState<"start" | "dest">("dest");
  // The map click handler outlives every render — it reads through refs.
  const armRef = useRef(arm);
  const startRef = useRef(start);
  useEffect(() => { armRef.current = arm; startRef.current = start; }, [arm, start]);

  const unconfigured = mapsMode() === "unconfigured";

  // ── Boot the map ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (unconfigured) return;
    let disposed = false;
    (async () => {
      try {
        // Constructors come from importLibrary, NOT from the bare google.maps
        // namespace — see the warning in src/lib/maps/google.ts.
        const { maps, routes } = await loadGoogleMaps();
        if (disposed || !mapEl.current || mapRef.current) return;

        const map = new maps.Map(mapEl.current, {
          center: NAIROBI,
          zoom: 12,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          clickableIcons: false,
        });
        // Google's own traffic overlay, so the officer SEES the jam that the ETA is
        // telling them about rather than having to take the number on faith.
        new maps.TrafficLayer().setMap(map);

        directionsRef.current = new routes.DirectionsService();
        rendererRef.current = new routes.DirectionsRenderer({
          map,
          suppressMarkers: true, // we draw our own labelled start/dest pins
          polylineOptions: { strokeColor: "#0284c7", strokeWeight: 5, strokeOpacity: 0.9 },
        });

        map.addListener("click", (e: google.maps.MapMouseEvent) => {
          if (!e.latLng) return;
          const p = { lat: e.latLng.lat(), lng: e.latLng.lng() };
          if (armRef.current === "start" || !startRef.current) {
            setStart({ ...p, label: "Dropped pin" }); setArm("dest");
          } else {
            setDest({ ...p, label: "Dropped pin" });
          }
        });

        mapRef.current = map;
        setReady(true);
      } catch (err) {
        if (!disposed) setError(err instanceof Error ? err.message : "The map could not load.");
      }
    })();
    return () => { disposed = true; };
  }, [unconfigured]);

  // ── My location as the default start ───────────────────────────────────────
  const locate = useCallback(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => { setStart({ lat: p.coords.latitude, lng: p.coords.longitude, label: "My location" }); setArm("dest"); },
      () => { setArm("start"); },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, []);
  useEffect(() => { locate(); }, [locate]);

  // ── The book's pins ─────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/console/field/nearby");
        const d = await res.json();
        if (d.success) setCustomers(d.customers ?? []);
      } catch { /* pins are decoration; routing still works */ }
    })();
  }, []);

  // ── Draw customer pins ──────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !window.google) return;
    for (const m of pinsRef.current) m.setMap(null);
    pinsRef.current = [];

    for (const c of customers) {
      const marker = new google.maps.Marker({
        map,
        position: { lat: c.lat, lng: c.lng },
        title: `${c.name}${c.olb > 0 ? ` · ${kes(c.olb)} out` : ""}`,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 6,
          fillColor: "#3b82f6",
          fillOpacity: 0.9,
          strokeColor: "#fff",
          strokeWeight: 2,
        },
      });
      marker.addListener("click", () => setDest({ lat: c.lat, lng: c.lng, label: c.name }));
      pinsRef.current.push(marker);
    }
  }, [ready, customers]);

  // ── Route: Google Directions, asked about the traffic that is out there NOW ──
  useEffect(() => {
    const map = mapRef.current, svc = directionsRef.current, renderer = rendererRef.current;
    if (!ready || !map || !svc || !renderer || !window.google) return;

    for (const m of endMarkersRef.current) m.setMap(null);
    endMarkersRef.current = [];

    const mk = (p: Pt, color: string, label: string) =>
      endMarkersRef.current.push(new google.maps.Marker({
        map,
        position: { lat: p.lat, lng: p.lng },
        label: { text: label, className: "map-end-label", color: "#fff", fontSize: "10px", fontWeight: "700" },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 8, fillColor: color, fillOpacity: 1, strokeColor: "#fff", strokeWeight: 3,
        },
      }));

    if (start) mk(start, "#059669", start.label);
    if (dest) mk(dest, "#e11d48", dest.label);

    if (!start || !dest) {
      renderer.setMap(null);
      renderer.setMap(map);
      return;
    }

    let stale = false;
    (async () => {
      setRouting(true); setError(null);
      try {
        const result = await svc.route({
          origin: { lat: start.lat, lng: start.lng },
          destination: { lat: dest.lat, lng: dest.lng },
          travelMode: google.maps.TravelMode.DRIVING,
          // THIS is the line that buys live traffic. Without drivingOptions the
          // response carries `duration` only, and we are back to guessing.
          drivingOptions: { departureTime: new Date(), trafficModel: google.maps.TrafficModel.BEST_GUESS },
          region: "KE",
        });
        if (stale) return;

        const leg = result.routes[0]?.legs[0];
        if (!leg) { setError("No road route found between those points."); setRoute(null); return; }

        renderer.setDirections(result);

        const km = (leg.distance?.value ?? 0) / 1000;
        const freeFlow = (leg.duration?.value ?? 0) / 60;
        // duration_in_traffic is only populated for DRIVING with a departureTime,
        // and Google may still omit it (no traffic model for the road). Falling
        // back to the free-flow number and SAYING SO beats inventing a multiplier.
        const withTraffic = leg.duration_in_traffic?.value;
        const live = typeof withTraffic === "number";

        setRoute({
          km: Number(km.toFixed(1)),
          mins: Math.round(freeFlow),
          trafficMins: Math.round(live ? withTraffic! / 60 : freeFlow),
          peak: isPeak(),
          live,
        });
      } catch (err) {
        if (stale) return;
        const status = (err as { code?: string })?.code ?? "";
        setError(
          status === "REQUEST_DENIED"
            ? "Google refused the routing request — check that the Directions API is enabled on the key and that this domain is allowed."
            : status === "ZERO_RESULTS"
              ? "No road route found between those points."
              : "The routing service is unreachable — check the connection and try again.",
        );
        setRoute(null);
      } finally {
        if (!stale) setRouting(false);
      }
    })();
    return () => { stale = true; };
  }, [ready, start, dest]);

  const askRiri = () => {
    if (!route || !start || !dest) return;
    const f = fares(route.km, route.trafficMins);
    window.dispatchEvent(new CustomEvent("riri:open", {
      detail: {
        model: "analyst",
        prompt:
          `I'm a field officer riding from "${start.label}" to "${dest.label}" in Nairobi — ${route.km} km, ` +
          `about ${route.trafficMins} min in ${route.live ? "the live traffic right now" : "current conditions"}` +
          `${route.peak ? " (rush hour)" : ""}. ` +
          `My fare estimates: boda ${kes(f.boda)}, matatu ${kes(f.matatu)}, ride-hail ${kes(f.ride)}. ` +
          `Guide me like a local: the sensible way to ride it, landmarks to aim for, whether those prices are fair, and anything to watch out for on the way.`,
      },
    }));
  };

  // Both ends must still be set for the verdict to mean anything — clearing an
  // end hides the panel rather than clearing route state from inside an effect.
  const showRoute = route && start && dest ? route : null;
  const f = showRoute ? fares(showRoute.km, showRoute.trafficMins) : null;
  const delay = showRoute ? showRoute.trafficMins - showRoute.mins : 0;

  return (
    <main className="mx-auto max-w-6xl px-4 sm:px-6 py-8">
      <PageHeader
        icon={MapIcon}
        title="Route Map"
        subtitle="Real Nairobi streets and the traffic that is on them right now. Pick a start and a customer — the route, the minutes, and the fair price of getting there."
      >
        <button onClick={locate} className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-800">
          <LocateFixed className="h-3.5 w-3.5" /> Start = my location
        </button>
      </PageHeader>

      {unconfigured && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50/90 px-3 py-2.5 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {MAPS_UNCONFIGURED}
        </div>
      )}
      {error && !unconfigured && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {/* Ends bar */}
      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
        <button onClick={() => setArm("start")}
          className={`inline-flex min-w-0 items-center gap-1.5 rounded-lg border px-3 py-2 ${arm === "start" ? "border-emerald-500 bg-emerald-50 font-semibold text-emerald-700" : "border-zinc-900/15 bg-white/70 text-zinc-600"}`}>
          <Crosshair className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{start ? start.label : "Tap the map to set the start"}</span>
          {start && <X className="h-3 w-3 shrink-0 opacity-60" onClick={(e) => { e.stopPropagation(); setStart(null); setArm("start"); }} />}
        </button>
        <span className="text-zinc-400">→</span>
        <button onClick={() => setArm("dest")}
          className={`inline-flex min-w-0 items-center gap-1.5 rounded-lg border px-3 py-2 ${arm === "dest" ? "border-rose-500 bg-rose-50 font-semibold text-rose-700" : "border-zinc-900/15 bg-white/70 text-zinc-600"}`}>
          <RouteIcon className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{dest ? dest.label : "Tap a customer pin (or the map)"}</span>
          {dest && <X className="h-3 w-3 shrink-0 opacity-60" onClick={(e) => { e.stopPropagation(); setDest(null); }} />}
        </button>
        <select
          className="rounded-lg border border-zinc-900/15 bg-white/80 px-2.5 py-2 outline-none"
          value=""
          onChange={(e) => {
            const c = customers.find((x) => x.id === e.target.value);
            if (c) setDest({ lat: c.lat, lng: c.lng, label: c.name });
          }}>
          <option value="">Ride to a customer…</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.olb > 0 ? ` — ${kes(c.olb)} out` : ""}</option>)}
        </select>
        {routing && <span className="inline-flex items-center gap-1.5 text-zinc-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> routing…</span>}
      </div>

      {/* The map */}
      <div className="glass mt-3 overflow-hidden p-1.5">
        <div ref={mapEl} className="h-[440px] w-full rounded-xl bg-zinc-100" />
      </div>

      {/* The verdict strip: distance, minutes, and what the ride should cost. */}
      {showRoute && f && (
        <div className="glass mt-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-lg font-bold">
                {showRoute.km} km · ~{showRoute.trafficMins} min
                <span className="ml-2 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                  style={{ backgroundColor: showRoute.peak ? "#fef3c7" : "#dcfce7", color: showRoute.peak ? "#b45309" : "#047857" }}>
                  {showRoute.peak ? "rush hour" : "off-peak"} · EAT
                </span>
              </p>
              {showRoute.live ? (
                <p className="text-[11px] text-zinc-500">
                  {delay > 0
                    ? <>Live traffic. {showRoute.mins} min on clear roads — the jam is costing you <strong className="text-zinc-700">{delay} min</strong>.</>
                    : <>Live traffic. The roads are running clear right now.</>}
                </p>
              ) : (
                <p className="text-[11px] text-zinc-500">{showRoute.mins} min on clear roads — Google has no live traffic read for this route.</p>
              )}
            </div>
            <button onClick={askRiri}
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white shadow-md"
              style={{ background: "linear-gradient(135deg, var(--brand), #7c3aed)" }}>
              <Bot className="h-4 w-4" /> Let Riri guide the ride
            </button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <FareTile icon={<Bike className="h-4 w-4" />} label="Boda-boda" value={kes(f.boda)} note="negotiated at the stage" />
            <FareTile icon={<Bus className="h-4 w-4" />} label="Matatu" value={kes(f.matatu)} note="stage fare, off-peak" />
            <FareTile icon={<CarTaxiFront className="h-4 w-4" />} label="Ride-hail" value={kes(f.ride)} note="Bolt/Uber estimate" />
            <FareTile icon={<Fuel className="h-4 w-4" />} label="Own car (fuel)" value={kes(f.fuel)} note="~17 KES/km" />
          </div>
        </div>
      )}
    </main>
  );
}

function FareTile({ icon, label, value, note }: { icon: React.ReactNode; label: string; value: string; note: string }) {
  return (
    <div className="rounded-xl border border-zinc-900/10 bg-white/60 px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{icon} {label}</p>
      <p className="mt-0.5 text-base font-bold text-zinc-800">{value}</p>
      <p className="text-[10px] text-zinc-400">{note}</p>
    </div>
  );
}
