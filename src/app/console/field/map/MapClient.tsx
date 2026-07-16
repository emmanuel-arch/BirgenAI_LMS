"use client";

// ─────────────────────────────────────────────────────────────────────────────
// ROUTE PLANNER — ride to a customer the way Google Maps would take you.
//
// Destination first: search the book (their saved business or home) or any
// place in Kenya (Places API — "Archives, CBD" resolves like you'd hope).
// Start defaults to the officer's own GPS and can be overridden the same way.
// Directions returns ALTERNATIVES with live traffic; every candidate is drawn
// (grey) against the chosen one (blue), and picking a different road is one tap
// on its line or its card.
//
// Then STAKE THE RIDE: Start turns the screen into turn-by-turn navigation —
// the phone's GPS is snapped onto the route locally (src/lib/field/nav.ts,
// pure math, verified by test:nav), the banner says what to do and how far
// until you do it, ETA and distance count down as you ride, going off the road
// re-routes from where you actually are, and arriving is an explicit state,
// not a guess. No fix ever leaves the phone — navigation is arithmetic here,
// not another API call.
//
// Deep links: ?to=<borrowerId>&place=business|home is re-read SERVER-side
// (/api/console/field/place — same scope fence as the book), so a pasted link
// can't send an agent to coordinates someone edited in a URL bar. The legacy
// ?toLat/&toLng/&toLabel form (Dispatch, Nearby) still works.
//
// Fares stay: distance + live minutes priced as boda / matatu / ride-hail /
// own fuel, and Riri still rides along.
// ─────────────────────────────────────────────────────────────────────────────
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2, AlertTriangle, MapIcon, LocateFixed, Bike, Bus, CarTaxiFront, Fuel,
  Bot, X, Navigation, Search, ArrowUpDown, ArrowUp, CornerUpLeft, CornerUpRight,
  CornerDownLeft, CornerDownRight, MoveUpLeft, MoveUpRight, Undo2, Redo2,
  RotateCw, Merge, Split, Ship, Volume2, VolumeX, Flag, MapPin, Store, Home,
  CheckCircle2, Crosshair,
} from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";
import { BorrowerAvatar } from "@/components/kyc/BorrowerAvatar";
import { loadGoogleMaps, mapsMode, MAPS_UNCONFIGURED } from "@/lib/maps/google";
import {
  buildNavRoute, snapToRoute, progressOf, stripHtml, fmtM, fmtMins, fmtEta,
  haversineM, OFF_ROUTE_M, ARRIVED_M, type NavRoute, type LL,
} from "@/lib/field/nav";

type Customer = {
  id: string; name: string; phone: string; verified: boolean; portraitUrl: string | null;
  lat: number; lng: number; locationType: string | null; address: string | null;
  homeLat: number | null; homeLng: number | null; homeAddress: string | null;
  olb: number; activeLoans: number; distanceKm: number | null;
};
type Unpinned = { id: string; name: string; phone: string; activeLoans: number; olb: number };
type Pt = { lat: number; lng: number; label: string };
/** One Directions alternative, reduced to what the cards and fares need. */
type Alt = { summary: string; km: number; mins: number; trafficMins: number; live: boolean };
type NavState = {
  instruction: string; maneuver: string; nextInstruction: string | null;
  toManeuverM: number; remainingM: number; remainingSecs: number;
  fraction: number; speedKmh: number | null; rerouting: boolean;
};

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

/** Rush hour by the EAT clock — a label; the minutes come from Google. */
function isPeak(): boolean {
  const hour = Number(new Intl.DateTimeFormat("en-KE", { hour: "numeric", hour12: false, timeZone: "Africa/Nairobi" }).format(new Date()));
  return (hour >= 6 && hour < 10) || (hour >= 16 && hour < 20);
}

/** Google's maneuver ids → an arrow the rider reads at a glance. */
function ManeuverIcon({ m, className }: { m: string; className?: string }) {
  const c = className ?? "h-8 w-8";
  if (m.includes("uturn")) return m.includes("right") ? <Redo2 className={c} /> : <Undo2 className={c} />;
  if (m.includes("roundabout")) return <RotateCw className={c} />;
  if (m.includes("merge")) return <Merge className={c} />;
  if (m.includes("fork")) return <Split className={c} />;
  if (m.includes("ferry")) return <Ship className={c} />;
  if (m.includes("sharp-left")) return <CornerDownLeft className={c} />;
  if (m.includes("sharp-right")) return <CornerDownRight className={c} />;
  if (m.includes("slight-left") || m.includes("keep-left")) return <MoveUpLeft className={c} />;
  if (m.includes("slight-right") || m.includes("keep-right")) return <MoveUpRight className={c} />;
  if (m.includes("left")) return <CornerUpLeft className={c} />;
  if (m.includes("right")) return <CornerUpRight className={c} />;
  return <ArrowUp className={c} />;
}

export function MapClient() {
  return (
    <Suspense fallback={null}>
      <RoutePlanner />
    </Suspense>
  );
}

function RoutePlanner() {
  const search = useSearchParams();
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const directionsRef = useRef<google.maps.DirectionsService | null>(null);
  const resultRef = useRef<google.maps.DirectionsResult | null>(null);
  // We draw the routes ourselves — DirectionsRenderer can only show one route,
  // and alternatives-you-can-tap is the whole point. [casing, line] per route.
  const routeLinesRef = useRef<google.maps.Polyline[][]>([]);
  const pinsRef = useRef<google.maps.Marker[]>([]);
  const endMarkersRef = useRef<google.maps.Marker[]>([]);
  const navMarkerRef = useRef<google.maps.Marker | null>(null);
  const navHaloRef = useRef<google.maps.Marker | null>(null);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [unpinned, setUnpinned] = useState<Unpinned[]>([]);
  const [myPos, setMyPos] = useState<LL | null>(null);
  const [start, setStart] = useState<Pt | null>(null);
  const [dest, setDest] = useState<Pt | null>(() => {
    const toLat = Number(search.get("toLat")), toLng = Number(search.get("toLng"));
    return Number.isFinite(toLat) && Number.isFinite(toLng)
      ? { lat: toLat, lng: toLng, label: search.get("toLabel") ?? "Destination" }
      : null;
  });
  const [alts, setAlts] = useState<Alt[]>([]);
  const [selIdx, setSelIdx] = useState(0);
  const [routing, setRouting] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [noPin, setNoPin] = useState<{ message: string; borrowerId: string | null } | null>(null);
  const [searchFor, setSearchFor] = useState<null | "start" | "dest">(null);
  const [phase, setPhase] = useState<"plan" | "nav" | "arrived">("plan");
  const [nav, setNav] = useState<NavState | null>(null);
  const [muted, setMuted] = useState(false);

  // Values the GPS callback (which outlives every render) reads through refs.
  const navRouteRef = useRef<NavRoute | null>(null);
  const trafficSecsRef = useRef(0);
  const snapHintRef = useRef(0);
  const offCountRef = useRef(0);
  const spokenRef = useRef({ step: -1, far: false, near: false });
  const watchIdRef = useRef<number | null>(null);
  const reroutingRef = useRef(false);
  const mutedRef = useRef(muted);
  const destRef = useRef(dest);
  const phaseRef = useRef(phase);
  useEffect(() => { mutedRef.current = muted; destRef.current = dest; phaseRef.current = phase; }, [muted, dest, phase]);

  const unconfigured = mapsMode() === "unconfigured";

  // ── Boot the map ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (unconfigured) return;
    let disposed = false;
    (async () => {
      try {
        const g = await loadGoogleMaps();
        if (disposed || !mapEl.current || mapRef.current) return;

        const map = new g.maps.Map(mapEl.current, {
          center: NAIROBI,
          zoom: 12,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          clickableIcons: false,
          gestureHandling: "greedy",
        });
        new g.maps.TrafficLayer().setMap(map);
        directionsRef.current = new g.routes.DirectionsService();

        // A bare map tap is still the fastest "ride to THERE" for a place with
        // no name — it sets the destination (search sets everything else).
        map.addListener("click", (e: google.maps.MapMouseEvent) => {
          if (!e.latLng || phaseRef.current !== "plan") return;
          setDest({ lat: e.latLng.lat(), lng: e.latLng.lng(), label: "Dropped pin" });
        });

        mapRef.current = map;
        setReady(true);
      } catch (err) {
        if (!disposed) setError(err instanceof Error ? err.message : "The map could not load.");
      }
    })();
    return () => { disposed = true; };
  }, [unconfigured]);

  // The nav overlay re-shapes the map's container; Google must be told.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !window.google) return;
    google.maps.event.trigger(map, "resize");
    if (phase === "nav" && navMarkerRef.current?.getPosition()) {
      map.setZoom(17);
      map.panTo(navMarkerRef.current.getPosition()!);
    }
  }, [phase]);

  // ── My location: the default start ──────────────────────────────────────────
  const locate = useCallback(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const pos = { lat: p.coords.latitude, lng: p.coords.longitude };
        setMyPos(pos);
        setStart((s) => (s && s.label !== "My location" ? s : { ...pos, label: "My location" }));
      },
      () => { /* denied — search or a map tap still sets a start */ },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, []);
  useEffect(() => { locate(); }, [locate]);

  // ── The book (pins for the map, rows for the search) ────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const q = myPos ? `?lat=${myPos.lat}&lng=${myPos.lng}` : "";
        const res = await fetch(`/api/console/field/nearby${q}`);
        const d = await res.json();
        if (d.success) { setCustomers(d.customers ?? []); setUnpinned(d.unpinned ?? []); }
      } catch { /* pins are decoration; routing still works */ }
    })();
  }, [myPos]);

  // ── Deep link: ?to=<borrowerId>&place= is re-read server-side ───────────────
  useEffect(() => {
    const to = search.get("to");
    if (!to) return;
    const kind = search.get("place") === "home" ? "home" : "business";
    let stale = false;
    (async () => {
      setResolving(true);
      try {
        const res = await fetch(`/api/console/field/place?borrowerId=${encodeURIComponent(to)}&kind=${kind}`);
        const d = await res.json();
        if (stale) return;
        if (d.success) setDest({ lat: d.place.lat, lng: d.place.lng, label: d.place.label });
        else setNoPin({ message: d.message ?? "That pin could not be found.", borrowerId: d.borrowerId ?? null });
      } catch {
        if (!stale) setNoPin({ message: "The customer's pin could not be read — try again.", borrowerId: null });
      } finally {
        if (!stale) setResolving(false);
      }
    })();
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Customer pins on the plan map ───────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !window.google) return;
    for (const m of pinsRef.current) m.setMap(null);
    pinsRef.current = [];
    if (phase !== "plan") return;
    for (const c of customers) {
      const marker = new google.maps.Marker({
        map,
        position: { lat: c.lat, lng: c.lng },
        title: `${c.name}${c.olb > 0 ? ` · ${kes(c.olb)} out` : ""}`,
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 6, fillColor: "#3b82f6", fillOpacity: 0.9, strokeColor: "#fff", strokeWeight: 2 },
      });
      marker.addListener("click", () => setDest({ lat: c.lat, lng: c.lng, label: c.name }));
      pinsRef.current.push(marker);
    }
  }, [ready, customers, phase]);

  // ── Start/destination markers ───────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !window.google) return;
    for (const m of endMarkersRef.current) m.setMap(null);
    endMarkersRef.current = [];
    const mk = (p: Pt, color: string) =>
      endMarkersRef.current.push(new google.maps.Marker({
        map,
        position: { lat: p.lat, lng: p.lng },
        title: p.label,
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 8, fillColor: color, fillOpacity: 1, strokeColor: "#fff", strokeWeight: 3 },
      }));
    if (start && phase === "plan") mk(start, "#059669");
    if (dest) mk(dest, "#e11d48");
  }, [ready, start, dest, phase]);

  const clearRouteLines = () => {
    for (const pair of routeLinesRef.current) for (const l of pair) l.setMap(null);
    routeLinesRef.current = [];
  };

  /** Paint every alternative; the chosen one wears blue with a darker casing.
   *  `solo` paints only the chosen road — navigation has no use for the others. */
  const paintRoutes = useCallback((result: google.maps.DirectionsResult, chosen: number, solo = false) => {
    const map = mapRef.current;
    if (!map) return;
    clearRouteLines();
    result.routes.forEach((r, i) => {
      if (solo && i !== chosen) return;
      const path = r.overview_path;
      const sel = i === chosen;
      const casing = new google.maps.Polyline({
        map, path, strokeColor: sel ? "#1e40af" : "#6b7280", strokeWeight: sel ? 9 : 6,
        strokeOpacity: sel ? 0.95 : 0.5, zIndex: sel ? 10 : 2,
      });
      const line = new google.maps.Polyline({
        map, path, strokeColor: sel ? "#3b82f6" : "#d1d5db", strokeWeight: sel ? 5 : 3.5,
        strokeOpacity: sel ? 1 : 0.9, zIndex: sel ? 11 : 3,
      });
      // Tapping a grey road IS choosing it.
      for (const l of [casing, line]) l.addListener("click", () => setSelIdx(i));
      routeLinesRef.current.push([casing, line]);
    });
  }, []);

  // ── Route: alternatives, asked about the traffic that is out there NOW ──────
  useEffect(() => {
    const map = mapRef.current, svc = directionsRef.current;
    if (!ready || !map || !svc || !window.google) return;
    if (!start || !dest || phase !== "plan") {
      // The cards derive their own visibility from start/dest; only the lines
      // (an external system) need clearing here.
      if (phase === "plan") { clearRouteLines(); resultRef.current = null; }
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
          provideRouteAlternatives: true,
          // THIS line buys live traffic — without drivingOptions the response
          // carries free-flow `duration` only, and we are back to guessing.
          drivingOptions: { departureTime: new Date(), trafficModel: google.maps.TrafficModel.BEST_GUESS },
          region: "KE",
        });
        if (stale) return;
        if (!result.routes.length) { setError("No road route found between those points."); setAlts([]); return; }

        resultRef.current = result;
        const summaries = result.routes.map((r) => {
          const leg = r.legs[0];
          const km = (leg?.distance?.value ?? 0) / 1000;
          const freeFlow = (leg?.duration?.value ?? 0) / 60;
          const withTraffic = leg?.duration_in_traffic?.value;
          const live = typeof withTraffic === "number";
          return {
            summary: r.summary || "the direct road",
            km: Number(km.toFixed(1)),
            mins: Math.round(freeFlow),
            trafficMins: Math.round(live ? withTraffic! / 60 : freeFlow),
            live,
          };
        });
        // Google usually leads with the fastest; trust but verify.
        const fastest = summaries.reduce((b, a, i) => (a.trafficMins < summaries[b].trafficMins ? i : b), 0);
        setAlts(summaries);
        setSelIdx(fastest);
        paintRoutes(result, fastest);
        if (result.routes[fastest].bounds) map.fitBounds(result.routes[fastest].bounds, 56);
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
        setAlts([]);
      } finally {
        if (!stale) setRouting(false);
      }
    })();
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, start, dest, phase]);

  // Re-paint when the officer picks a different road.
  useEffect(() => {
    if (resultRef.current && phase === "plan") paintRoutes(resultRef.current, selIdx);
  }, [selIdx, phase, paintRoutes]);

  // ── The voice ────────────────────────────────────────────────────────────────
  const speak = useCallback((text: string) => {
    if (mutedRef.current || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "en-KE";
      u.rate = 1.02;
      window.speechSynthesis.speak(u);
    } catch { /* a silent banner still navigates */ }
  }, []);

  // ── Turn-by-turn ─────────────────────────────────────────────────────────────
  const stopWatch = useCallback(() => {
    if (watchIdRef.current != null && navigator.geolocation) navigator.geolocation.clearWatch(watchIdRef.current);
    watchIdRef.current = null;
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);
  useEffect(() => stopWatch, [stopWatch]);

  /** Directions route → the flat NavRoute the snapping math walks. */
  const toNavRoute = (r: google.maps.DirectionsRoute): NavRoute =>
    buildNavRoute((r.legs[0]?.steps ?? []).map((s) => ({
      instruction: stripHtml(s.instructions ?? ""),
      maneuver: (s as { maneuver?: string }).maneuver ?? "",
      path: (s.path ?? []).map((p) => ({ lat: p.lat(), lng: p.lng() })),
    })));

  const applyNavResult = useCallback((r: google.maps.DirectionsRoute) => {
    navRouteRef.current = toNavRoute(r);
    const leg = r.legs[0];
    trafficSecsRef.current = leg?.duration_in_traffic?.value ?? leg?.duration?.value ?? 0;
    snapHintRef.current = 0;
    offCountRef.current = 0;
    spokenRef.current = { step: -1, far: false, near: false };
  }, []);

  const rerouteFrom = useCallback(async (p: LL) => {
    const svc = directionsRef.current, d = destRef.current;
    if (!svc || !d || reroutingRef.current) return;
    reroutingRef.current = true;
    setNav((n) => (n ? { ...n, rerouting: true } : n));
    try {
      const result = await svc.route({
        origin: p,
        destination: { lat: d.lat, lng: d.lng },
        travelMode: google.maps.TravelMode.DRIVING,
        drivingOptions: { departureTime: new Date(), trafficModel: google.maps.TrafficModel.BEST_GUESS },
        region: "KE",
      });
      const r = result.routes[0];
      if (r) { applyNavResult(r); paintRoutes(result, 0); speak("Rerouting."); }
    } catch { /* keep guiding on the old line; the next fix may recover */ }
    finally {
      reroutingRef.current = false;
      setNav((n) => (n ? { ...n, rerouting: false } : n));
    }
  }, [applyNavResult, paintRoutes, speak]);

  const onFix = useCallback((posn: GeolocationPosition) => {
    const route = navRouteRef.current, map = mapRef.current;
    if (!route || !map || phaseRef.current !== "nav") return;
    const p = { lat: posn.coords.latitude, lng: posn.coords.longitude };
    const heading = posn.coords.heading;

    // The rider's chevron + a soft halo, created lazily on the first fix.
    if (!navMarkerRef.current) {
      navHaloRef.current = new google.maps.Marker({
        map, position: p, clickable: false, zIndex: 20,
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 18, fillColor: "#3b82f6", fillOpacity: 0.18, strokeWeight: 0 },
      });
      navMarkerRef.current = new google.maps.Marker({
        map, position: p, clickable: false, zIndex: 21,
        icon: {
          path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 7, rotation: heading ?? 0,
          fillColor: "#1d4ed8", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2,
        },
      });
    } else {
      navMarkerRef.current.setPosition(p);
      navHaloRef.current?.setPosition(p);
      if (heading != null && !Number.isNaN(heading)) {
        const icon = navMarkerRef.current.getIcon() as google.maps.Symbol;
        navMarkerRef.current.setIcon({ ...icon, rotation: heading });
      }
    }
    map.panTo(p);

    const snap = snapToRoute(route, p, snapHintRef.current);
    snapHintRef.current = snap.segIndex;
    const prog = progressOf(route, snap, trafficSecsRef.current);
    const d = destRef.current;

    // Arrived: the route ran out, or we are standing at the pin itself.
    if (prog.remainingM < ARRIVED_M || (d && haversineM(p, d) < ARRIVED_M)) {
      stopWatch();
      speak(`You have arrived${d ? ` at ${d.label}` : ""}.`);
      setPhase("arrived");
      return;
    }

    // Off the road for three straight fixes = actually off it, not GPS drift.
    if (snap.offRouteM > OFF_ROUTE_M) {
      offCountRef.current += 1;
      if (offCountRef.current >= 3) { offCountRef.current = 0; void rerouteFrom(p); }
    } else {
      offCountRef.current = 0;
    }

    const step = route.steps[prog.stepIndex];
    const next = route.steps[prog.stepIndex + 1] ?? null;

    // The voice speaks twice per turn: heads-up, then at the corner.
    const spoken = spokenRef.current;
    if (spoken.step !== prog.stepIndex) spokenRef.current = { step: prog.stepIndex, far: false, near: false };
    if (!spokenRef.current.far && prog.toManeuverM <= 350 && prog.toManeuverM > 60 && step) {
      spokenRef.current.far = true;
      speak(`In ${fmtM(prog.toManeuverM)}, ${step.instruction}`);
    }
    if (!spokenRef.current.near && prog.toManeuverM <= 60 && step) {
      spokenRef.current.near = true;
      speak(step.instruction);
    }

    setNav({
      instruction: step?.instruction ?? "Continue",
      maneuver: step?.maneuver ?? "",
      nextInstruction: next?.instruction ?? null,
      toManeuverM: prog.toManeuverM,
      remainingM: prog.remainingM,
      remainingSecs: prog.remainingSecs,
      fraction: prog.fraction,
      speedKmh: posn.coords.speed != null && !Number.isNaN(posn.coords.speed) ? Math.max(0, Math.round(posn.coords.speed * 3.6)) : null,
      rerouting: reroutingRef.current,
    });
  }, [rerouteFrom, speak, stopWatch]);

  const beginNav = useCallback(() => {
    const result = resultRef.current;
    const r = result?.routes[selIdx];
    if (!r || !navigator.geolocation) {
      if (!navigator.geolocation) setError("This device can't share a location, so it can't navigate — the route above still stands.");
      return;
    }
    applyNavResult(r);
    if (result) paintRoutes(result, selIdx, true); // the ride keeps only its own road
    setPhase("nav");
    setNav(null);
    speak("Starting navigation.");
    watchIdRef.current = navigator.geolocation.watchPosition(
      onFix,
      () => setError("The GPS signal was lost — navigation is paused until it returns."),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 },
    );
  }, [selIdx, applyNavResult, paintRoutes, onFix, speak]);

  const endNav = useCallback(() => {
    stopWatch();
    navMarkerRef.current?.setMap(null); navMarkerRef.current = null;
    navHaloRef.current?.setMap(null); navHaloRef.current = null;
    navRouteRef.current = null;
    setNav(null);
    setPhase("plan");
  }, [stopWatch]);

  const askRiri = () => {
    const a = alts[selIdx];
    if (!a || !start || !dest) return;
    const f = fares(a.km, a.trafficMins);
    window.dispatchEvent(new CustomEvent("riri:open", {
      detail: {
        model: "assistant",
        prompt:
          `I'm a field officer riding from "${start.label}" to "${dest.label}" in Nairobi — ${a.km} km via ${a.summary}, ` +
          `about ${a.trafficMins} min in ${a.live ? "the live traffic right now" : "current conditions"}${isPeak() ? " (rush hour)" : ""}. ` +
          `My fare estimates: boda ${kes(f.boda)}, matatu ${kes(f.matatu)}, ride-hail ${kes(f.ride)}. ` +
          `Guide me like a local: the sensible way to ride it, landmarks to aim for, whether those prices are fair, and anything to watch out for on the way.`,
      },
    }));
  };

  // Both ends must still be set for a route to mean anything — clearing an end
  // hides the cards rather than clearing route state from inside an effect.
  const shownAlts = start && dest ? alts : [];
  const active = shownAlts[selIdx] ?? null;
  const f = active ? fares(active.km, active.trafficMins) : null;
  const delay = active ? active.trafficMins - active.mins : 0;
  const navMode = phase === "nav" || phase === "arrived";

  return (
    <main className={navMode ? "" : "mx-auto max-w-6xl px-4 sm:px-6 py-8"}>
      {!navMode && (
        <PageHeader
          icon={MapIcon}
          title="Route Planner"
          subtitle="Search the customer, pick the road, press start — the phone guides the ride to their door on real Nairobi streets and live traffic."
        >
          <button onClick={locate} className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-800">
            <LocateFixed className="h-3.5 w-3.5" /> Start = my location
          </button>
        </PageHeader>
      )}

      {!navMode && unconfigured && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50/90 px-3 py-2.5 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {MAPS_UNCONFIGURED}
        </div>
      )}
      {!navMode && error && !unconfigured && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}
      {!navMode && noPin && (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50/90 px-3 py-2.5 text-sm text-amber-800">
          <MapPin className="h-4 w-4 shrink-0" /> {noPin.message}
          {noPin.borrowerId && (
            <Link href={`/console/borrowers/${noPin.borrowerId}?drop=location`} className="font-semibold underline underline-offset-2">
              Drop their pin →
            </Link>
          )}
        </div>
      )}
      {!navMode && resolving && (
        <p className="mt-4 flex items-center gap-2 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Reading the customer&apos;s pin…</p>
      )}

      {/* ── Where from / where to ─────────────────────────────────────────────── */}
      {!navMode && (
        <div className="glass mt-4 p-3">
          <div className="flex items-stretch gap-2.5">
            {/* The dots-and-line motif every maps user already reads. */}
            <div className="flex w-4 flex-col items-center py-3">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-emerald-200" />
              <span className="my-1 w-px flex-1 border-l-2 border-dotted border-zinc-300" />
              <MapPin className="h-3.5 w-3.5 text-rose-500" />
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <button onClick={() => setSearchFor("start")}
                className="flex w-full items-center gap-2 rounded-xl border border-zinc-900/10 bg-white/80 px-3 py-2.5 text-left text-sm hover:bg-white">
                <Crosshair className="h-4 w-4 shrink-0 text-emerald-600" />
                <span className={`truncate ${start ? "font-semibold text-zinc-800" : "text-zinc-400"}`}>{start?.label ?? "Where from? (usually: right here)"}</span>
                {start && <X className="ml-auto h-3.5 w-3.5 shrink-0 opacity-50" onClick={(e) => { e.stopPropagation(); setStart(null); }} />}
              </button>
              <button onClick={() => setSearchFor("dest")}
                className="flex w-full items-center gap-2 rounded-xl border border-zinc-900/10 bg-white/80 px-3 py-2.5 text-left text-sm hover:bg-white">
                <Search className="h-4 w-4 shrink-0 text-rose-500" />
                <span className={`truncate ${dest ? "font-semibold text-zinc-800" : "text-zinc-400"}`}>{dest?.label ?? "Search a customer or any place…"}</span>
                {dest && <X className="ml-auto h-3.5 w-3.5 shrink-0 opacity-50" onClick={(e) => { e.stopPropagation(); setDest(null); }} />}
              </button>
            </div>
            <button onClick={() => { setStart(dest); setDest(start); }} title="Swap"
              className="self-center rounded-xl border border-zinc-900/10 bg-white/70 p-2.5 text-zinc-500 hover:bg-white hover:text-zinc-800">
              <ArrowUpDown className="h-4 w-4" />
            </button>
          </div>
          {routing && <p className="mt-2 flex items-center gap-1.5 pl-7 text-[11px] text-zinc-500"><Loader2 className="h-3 w-3 animate-spin" /> Asking the roads…</p>}
        </div>
      )}

      {/* ── The map (fullscreen while navigating) ─────────────────────────────── */}
      <div className={navMode ? "fixed inset-0 z-[80] bg-zinc-950" : "glass mt-3 overflow-hidden p-1.5"}>
        <div ref={mapEl} className={navMode ? "h-full w-full" : "h-[52dvh] min-h-[340px] w-full rounded-xl bg-zinc-100"} />

        {/* Instruction banner */}
        <AnimatePresence>
          {phase === "nav" && nav && (
            <motion.div
              initial={{ y: -90, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -90, opacity: 0 }}
              transition={{ type: "spring", stiffness: 320, damping: 30 }}
              className="absolute left-3 right-3 top-3 z-10"
              style={{ paddingTop: "env(safe-area-inset-top)" }}
            >
              <div className="rounded-2xl bg-emerald-700 px-4 py-3 text-white shadow-2xl shadow-emerald-950/40">
                <div className="flex items-center gap-3">
                  <ManeuverIcon m={nav.maneuver} className="h-9 w-9 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-2xl font-black leading-none tabular-nums">{fmtM(nav.toManeuverM)}</p>
                    <p className="mt-1 truncate text-sm font-semibold text-emerald-50">{nav.instruction}</p>
                  </div>
                </div>
                {nav.nextInstruction && (
                  <p className="mt-2 truncate border-t border-white/15 pt-1.5 text-[11px] text-emerald-100/90">
                    then · {nav.nextInstruction}
                  </p>
                )}
              </div>
              {nav.rerouting && (
                <div className="mx-auto mt-2 w-fit rounded-full bg-zinc-900/90 px-3 py-1 text-[11px] font-semibold text-amber-300">
                  <Loader2 className="mr-1.5 inline h-3 w-3 animate-spin" /> Rerouting…
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Bottom stats bar */}
        <AnimatePresence>
          {phase === "nav" && (
            <motion.div
              initial={{ y: 120, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 120, opacity: 0 }}
              transition={{ type: "spring", stiffness: 320, damping: 32 }}
              className="absolute inset-x-0 bottom-0 z-10"
              style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
            >
              <div className="mx-3 mb-3 rounded-2xl bg-zinc-900/95 px-4 py-3 text-white shadow-2xl backdrop-blur">
                <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-sky-400 transition-[width] duration-700"
                    style={{ width: `${Math.round((nav?.fraction ?? 0) * 100)}%` }} />
                </div>
                <div className="mt-2.5 flex items-center justify-between gap-3">
                  <div className="flex items-baseline gap-3 tabular-nums">
                    <span className="text-xl font-black text-emerald-300">{nav ? fmtEta(nav.remainingSecs) : "—:—"}</span>
                    <span className="text-sm font-semibold text-zinc-300">{nav ? fmtMins(nav.remainingSecs) : "…"}</span>
                    <span className="text-sm text-zinc-400">{nav ? fmtM(nav.remainingM) : ""}</span>
                    {nav?.speedKmh != null && <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[11px] font-semibold text-zinc-200">{nav.speedKmh} km/h</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setMuted((m) => !m)} title={muted ? "Unmute" : "Mute"}
                      className="rounded-xl bg-white/10 p-2.5 text-zinc-200 hover:bg-white/20">
                      {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                    </button>
                    <button onClick={endNav}
                      className="rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-rose-500">
                      End
                    </button>
                  </div>
                </div>
                {!nav && <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-zinc-400"><Loader2 className="h-3 w-3 animate-spin" /> Waiting for the first GPS fix…</p>}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Arrival */}
        <AnimatePresence>
          {phase === "arrived" && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 z-20 flex items-center justify-center bg-zinc-950/70 backdrop-blur-sm">
              <motion.div
                initial={{ scale: 0.8, y: 24, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }}
                transition={{ type: "spring", stiffness: 260, damping: 20 }}
                className="mx-6 w-full max-w-sm rounded-3xl bg-white p-8 text-center shadow-2xl"
              >
                <div className="relative mx-auto h-20 w-20">
                  <motion.span
                    className="absolute inset-0 rounded-full bg-emerald-400/30"
                    animate={{ scale: [1, 1.7], opacity: [0.7, 0] }}
                    transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
                  />
                  <span className="absolute inset-0 flex items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg shadow-emerald-500/40">
                    <Flag className="h-9 w-9" />
                  </span>
                </div>
                <h2 className="mt-5 text-xl font-black text-zinc-900">You have arrived</h2>
                <p className="mt-1 truncate text-sm text-zinc-500">{dest?.label ?? "Destination"}</p>
                <button onClick={endNav}
                  className="mt-6 w-full rounded-2xl px-4 py-3 text-sm font-bold text-white shadow-md"
                  style={{ background: "linear-gradient(135deg, var(--brand), #7c3aed)" }}>
                  <CheckCircle2 className="mr-1.5 inline h-4 w-4" /> Done — back to the map
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Alternatives ──────────────────────────────────────────────────────── */}
      {!navMode && shownAlts.length > 0 && (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {shownAlts.map((a, i) => {
            const fastest = shownAlts.reduce((b, x, j) => (x.trafficMins < shownAlts[b].trafficMins ? j : b), 0);
            const sel = i === selIdx;
            return (
              <motion.button key={i} onClick={() => setSelIdx(i)}
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
                className={`min-w-[168px] shrink-0 rounded-2xl border px-4 py-3 text-left transition-shadow ${
                  sel ? "border-transparent bg-white shadow-lg ring-2 ring-[var(--brand)]" : "border-zinc-900/10 bg-white/60 hover:bg-white/90"}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-lg font-black tabular-nums text-zinc-900">{a.trafficMins} min</span>
                  {i === fastest
                    ? <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">Fastest</span>
                    : <span className="text-[11px] font-semibold text-zinc-400">+{a.trafficMins - alts[fastest].trafficMins} min</span>}
                </div>
                <p className="mt-0.5 truncate text-[11px] text-zinc-500">via {a.summary} · {a.km} km</p>
              </motion.button>
            );
          })}
        </div>
      )}

      {/* ── The verdict strip: minutes, money, and the button that starts the ride */}
      {!navMode && active && f && start && dest && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass mt-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-lg font-bold">
                {active.km} km · ~{active.trafficMins} min
                <span className="ml-2 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                  style={{ backgroundColor: isPeak() ? "#fef3c7" : "#dcfce7", color: isPeak() ? "#b45309" : "#047857" }}>
                  {isPeak() ? "rush hour" : "off-peak"} · EAT
                </span>
              </p>
              {active.live ? (
                <p className="text-[11px] text-zinc-500">
                  {delay > 0
                    ? <>Live traffic. {active.mins} min on clear roads — the jam is costing you <strong className="text-zinc-700">{delay} min</strong>.</>
                    : <>Live traffic. The roads are running clear right now.</>}
                </p>
              ) : (
                <p className="text-[11px] text-zinc-500">{active.mins} min on clear roads — Google has no live traffic read for this route.</p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={askRiri}
                className="inline-flex items-center gap-2 rounded-xl border border-zinc-900/10 bg-white/80 px-4 py-2.5 text-sm font-bold text-zinc-800 hover:bg-white">
                <Bot className="h-4 w-4" style={{ color: "var(--brand)" }} /> Riri, guide the ride
              </button>
              <motion.button onClick={beginNav} whileTap={{ scale: 0.96 }}
                className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-indigo-500/25"
                style={{ background: "linear-gradient(135deg, var(--brand), #7c3aed)" }}>
                <Navigation className="h-4 w-4" /> Start
              </motion.button>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <FareTile icon={<Bike className="h-4 w-4" />} label="Boda-boda" value={kes(f.boda)} note="negotiated at the stage" />
            <FareTile icon={<Bus className="h-4 w-4" />} label="Matatu" value={kes(f.matatu)} note="stage fare, off-peak" />
            <FareTile icon={<CarTaxiFront className="h-4 w-4" />} label="Ride-hail" value={kes(f.ride)} note="Bolt/Uber estimate" />
            <FareTile icon={<Fuel className="h-4 w-4" />} label="Own car (fuel)" value={kes(f.fuel)} note="~17 KES/km" />
          </div>
        </motion.div>
      )}

      {/* ── Search sheet ─────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {searchFor && (
          <SearchSheet
            kind={searchFor}
            customers={customers}
            unpinned={unpinned}
            myPos={myPos}
            onPick={(p) => { (searchFor === "start" ? setStart : setDest)(p); setSearchFor(null); setNoPin(null); }}
            onClose={() => setSearchFor(null)}
          />
        )}
      </AnimatePresence>
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SEARCH — the book first, then the whole map.
//
// Typing filters the officer's own customers instantly (business AND home rows,
// with distance and what they owe); anything the book can't answer falls
// through to Places, biased to where the officer is standing. Customers with
// no pin surface too — as the task they are, with the one link that fixes it.
// ─────────────────────────────────────────────────────────────────────────────
function SearchSheet({ kind, customers, unpinned, myPos, onPick, onClose }: {
  kind: "start" | "dest";
  customers: Customer[];
  unpinned: Unpinned[];
  myPos: LL | null;
  onPick: (p: Pt) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [placeHits, setPlaceHits] = useState<{ id: string; main: string; secondary: string; pick: () => Promise<Pt | null> }[]>([]);
  const [searching, setSearching] = useState(false);
  const tokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const needle = q.trim().toLowerCase();
  const book = useMemo(() => {
    if (!needle) return customers.slice(0, 8);
    return customers.filter((c) => c.name.toLowerCase().includes(needle) || c.phone.includes(needle)).slice(0, 12);
  }, [customers, needle]);
  const missing = useMemo(() => {
    if (!needle) return [];
    return unpinned.filter((c) => c.name.toLowerCase().includes(needle) || c.phone.includes(needle)).slice(0, 4);
  }, [unpinned, needle]);

  // Places, debounced. A session token spans the typing and the one pick that
  // ends it — that is how Google bills a search as ONE search. Short queries
  // don't clear state; the render below simply doesn't show stale hits.
  useEffect(() => {
    if (needle.length < 3 || mapsMode() === "unconfigured") return;
    let stale = false;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const g = await loadGoogleMaps();
        if (stale) return;
        if (!tokenRef.current) tokenRef.current = new g.places.AutocompleteSessionToken();
        const { suggestions } = await g.places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: q.trim(),
          sessionToken: tokenRef.current,
          includedRegionCodes: ["ke"],
          locationBias: { center: myPos ?? NAIROBI, radius: 30000 },
        });
        if (stale) return;
        setPlaceHits(suggestions.flatMap((s) => {
          const pr = s.placePrediction;
          if (!pr) return [];
          return [{
            id: pr.placeId,
            main: pr.mainText?.text ?? pr.text.text,
            secondary: pr.secondaryText?.text ?? "",
            pick: async () => {
              const place = pr.toPlace();
              await place.fetchFields({ fields: ["location", "displayName", "formattedAddress"] });
              tokenRef.current = null; // the session concluded with this pick
              const loc = place.location;
              if (!loc) return null;
              return { lat: loc.lat(), lng: loc.lng(), label: place.displayName ?? pr.text.text };
            },
          }];
        }));
      } catch { if (!stale) setPlaceHits([]); }
      finally { if (!stale) setSearching(false); }
    }, 280);
    return () => { stale = true; clearTimeout(t); };
  }, [q, needle, myPos]);

  // Hits from a longer query never show against a shortened one.
  const visibleHits = needle.length >= 3 ? placeHits : [];
  const fmtDist = (km: number | null) => km == null ? null : km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[90] bg-zinc-950/45 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 48, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 48, opacity: 0 }}
        transition={{ type: "spring", stiffness: 340, damping: 32 }}
        onClick={(e) => e.stopPropagation()}
        className="mx-auto mt-[8dvh] flex max-h-[84dvh] w-[min(94vw,540px)] flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-zinc-900/10 px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-zinc-400" />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={kind === "start" ? "Search where you're starting from…" : "Customer name, phone, or any place…"}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-400" />
          {searching && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-zinc-400" />}
          <button onClick={onClose} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"><X className="h-4 w-4" /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {kind === "start" && myPos && (
            <Row icon={<LocateFixed className="h-4 w-4 text-emerald-600" />} title="My location" sub="Where you are standing right now"
              onClick={() => onPick({ ...myPos, label: "My location" })} />
          )}

          {book.length > 0 && <p className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-zinc-400">Your book</p>}
          {book.map((c) => (
            <div key={c.id}>
              <Row
                icon={<BorrowerAvatar name={c.name} portraitUrl={c.portraitUrl} verified={c.verified} size="sm" />}
                title={c.name}
                sub={[c.address ?? "business", fmtDist(c.distanceKm), c.olb > 0 ? `${kes(c.olb)} out` : null].filter(Boolean).join(" · ")}
                trailing={<Store className="h-3.5 w-3.5 text-zinc-300" />}
                onClick={() => onPick({ lat: c.lat, lng: c.lng, label: c.name })}
              />
              {c.homeLat != null && c.homeLng != null && (
                <Row
                  icon={<span className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-zinc-100"><Home className="h-3.5 w-3.5 text-zinc-500" /></span>}
                  title={`${c.name} — home`}
                  sub={c.homeAddress ?? "home pin"}
                  onClick={() => onPick({ lat: c.homeLat!, lng: c.homeLng!, label: `${c.name} — home` })}
                />
              )}
            </div>
          ))}

          {missing.length > 0 && <p className="px-3 pb-1 pt-3 text-[10px] font-bold uppercase tracking-wider text-amber-500">No pin yet</p>}
          {missing.map((c) => (
            <Link key={c.id} href={`/console/borrowers/${c.id}?drop=location`}
              className="flex items-center gap-3 rounded-2xl px-3 py-2.5 hover:bg-amber-50">
              <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-amber-100"><MapPin className="h-3.5 w-3.5 text-amber-600" /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-zinc-800">{c.name}</span>
                <span className="block truncate text-[11px] text-amber-600">No location on file — drop their pin →</span>
              </span>
            </Link>
          ))}

          {visibleHits.length > 0 && <p className="px-3 pb-1 pt-3 text-[10px] font-bold uppercase tracking-wider text-zinc-400">Places</p>}
          {visibleHits.map((h) => (
            <Row key={h.id}
              icon={<span className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-zinc-100"><MapPin className="h-3.5 w-3.5 text-zinc-500" /></span>}
              title={h.main} sub={h.secondary}
              onClick={async () => { const p = await h.pick(); if (p) onPick(p); }}
            />
          ))}

          {needle && !searching && book.length === 0 && missing.length === 0 && visibleHits.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-zinc-400">Nothing on the book or the map matches “{q.trim()}”.</p>
          )}
        </div>
        <p className="border-t border-zinc-900/5 px-4 py-2 text-right text-[9px] uppercase tracking-wide text-zinc-300">Search powered by Google</p>
      </motion.div>
    </motion.div>
  );
}

function Row({ icon, title, sub, trailing, onClick }: {
  icon: React.ReactNode; title: string; sub?: string; trailing?: React.ReactNode; onClick: () => void;
}) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left hover:bg-zinc-50">
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-zinc-800">{title}</span>
        {sub && <span className="block truncate text-[11px] text-zinc-500">{sub}</span>}
      </span>
      {trailing}
    </button>
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
