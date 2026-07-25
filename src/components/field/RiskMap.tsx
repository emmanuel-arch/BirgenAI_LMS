"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE RISK MAP — the whole book on one map, coloured by who needs a visit today.
//
// Every consented pin is a dot: green current, amber slipping (1–29 days late),
// red in default (30+). The single worst account in view PULSES — a red beacon
// the officer's eye lands on before they read a word. A ring around where the
// officer stands is the radius they're working; pins beyond it fade back but
// never disappear, because "who's just outside my circle" is a real question.
//
// Tap a dot and it's selected — name, distance, an ETA estimate, what's overdue —
// and one tap from there hands the door to the Route Planner, which asks Google
// for the real traffic-aware ride. Branches sit under it all as faint anchors so
// a national book reads as a network, not a scatter of dots.
//
// The estimate here is straight-line arithmetic (a country of pins can't each
// cost a Directions call); the real minutes come when a single door is chosen.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Crosshair, Locate } from "lucide-react";
import { loadGoogleMaps, mapsMode, MAPS_UNCONFIGURED } from "@/lib/maps/google";
import { RISK_TONE, type RiskLevel } from "@/lib/field/risk";

export type MapCustomer = {
  id: string; name: string; lat: number; lng: number;
  risk: RiskLevel; dpd: number; overdue: number; weight: number;
  olb: number; distanceKm: number | null; etaMin: number | null;
};
export type MapBranch = { id: string; name: string; code: string | null; lat: number; lng: number; root: boolean };

const KENYA = { center: { lat: -0.6, lng: 37.4 }, zoom: 6 };

export function RiskMap({
  customers, branches, here, radius, selectedId, onSelect, blinkCount = 3,
}: {
  customers: MapCustomer[];
  branches: MapBranch[];
  here: { lat: number; lng: number } | null;
  radius: number; // km, 0 = everyone
  selectedId: string | null;
  onSelect: (c: MapCustomer) => void;
  blinkCount?: number;
}) {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const dotsRef = useRef<Map<string, google.maps.Marker>>(new Map());
  const branchRef = useRef<google.maps.Marker[]>([]);
  const halosRef = useRef<google.maps.Marker[]>([]);
  const meRef = useRef<google.maps.Marker | null>(null);
  const circleRef = useRef<google.maps.Circle | null>(null);
  const lineRef = useRef<google.maps.Polyline | null>(null);
  const didFitRef = useRef(false);
  const onSelectRef = useRef(onSelect);
  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unconfigured = mapsMode() === "unconfigured";

  // The pins that pulse: the worst red accounts by weight (money × how sour).
  const blinkIds = useMemo(() => {
    return customers
      .filter((c) => c.risk === "red")
      .sort((a, b) => b.weight - a.weight)
      .slice(0, blinkCount)
      .map((c) => c.id);
  }, [customers, blinkCount]);

  const inRadius = (c: MapCustomer) => !radius || !here || (c.distanceKm != null && c.distanceKm <= radius);

  // ── Boot ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (unconfigured) return;
    let disposed = false;
    (async () => {
      try {
        const g = await loadGoogleMaps();
        if (disposed || !mapEl.current || mapRef.current) return;
        mapRef.current = new g.maps.Map(mapEl.current, {
          center: KENYA.center, zoom: KENYA.zoom,
          mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
          clickableIcons: false, gestureHandling: "greedy",
          styles: [
            { featureType: "poi", stylers: [{ visibility: "off" }] },
            { featureType: "transit", stylers: [{ visibility: "off" }] },
          ],
        });
        setReady(true);
      } catch (err) {
        if (!disposed) setError(err instanceof Error ? err.message : "The map could not load.");
      }
    })();
    return () => { disposed = true; };
  }, [unconfigured]);

  // ── Branch anchors ────────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !window.google) return;
    for (const m of branchRef.current) m.setMap(null);
    branchRef.current = branches.map((b) => {
      // The head office (the tree's root) and any branch that calls itself an HQ
      // read as the network's anchors; the rest are faint pins under the dots.
      const anchor = b.root || /\bHQ\b|head office/i.test(b.name);
      return new google.maps.Marker({
        map, position: { lat: b.lat, lng: b.lng }, title: `${b.name}${b.code ? ` · ${b.code}` : ""}`,
        zIndex: 1,
        icon: {
          path: "M -6 4 L 0 -7 L 6 4 Z", // a small anchor triangle for the network
          fillColor: anchor ? "#4338ca" : "#94a3b8",
          fillOpacity: anchor ? 0.95 : 0.7,
          strokeColor: "#fff", strokeWeight: 1.5, scale: anchor ? 1.6 : 1,
        },
      });
    });
  }, [ready, branches]);

  // ── Customer dots ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !window.google) return;
    const live = dotsRef.current;
    const seen = new Set<string>();

    for (const c of customers) {
      seen.add(c.id);
      const near = inRadius(c);
      const sel = c.id === selectedId;
      const tone = RISK_TONE[c.risk];
      const icon: google.maps.Symbol = {
        path: google.maps.SymbolPath.CIRCLE,
        fillColor: tone.dot,
        fillOpacity: near ? 1 : 0.32,
        strokeColor: sel ? "#0f172a" : "#ffffff",
        strokeWeight: sel ? 3 : near ? 1.6 : 1,
        scale: sel ? 10 : near ? 6.5 : 4,
      };
      let m = live.get(c.id);
      if (!m) {
        m = new google.maps.Marker({ map, position: { lat: c.lat, lng: c.lng } });
        m.addListener("click", () => onSelectRef.current(c));
        live.set(c.id, m);
      } else {
        m.setPosition({ lat: c.lat, lng: c.lng });
      }
      m.setIcon(icon);
      m.setTitle(`${c.name} · ${tone.label}${c.dpd ? ` · ${c.dpd}d late` : ""}`);
      m.setZIndex(sel ? 40 : c.risk === "red" ? 20 : near ? 10 : 5);
    }
    // Drop markers for customers no longer present.
    for (const [id, m] of live) if (!seen.has(id)) { m.setMap(null); live.delete(id); }
  }, [ready, customers, radius, here, selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── The pulse: haloes on the worst accounts, toggled on an interval ───────────
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !window.google) return;
    for (const h of halosRef.current) h.setMap(null);
    halosRef.current = blinkIds
      .map((id) => customers.find((c) => c.id === id))
      .filter((c): c is MapCustomer => !!c)
      .map((c) =>
        new google.maps.Marker({
          map, position: { lat: c.lat, lng: c.lng }, clickable: false, zIndex: 15,
          icon: { path: google.maps.SymbolPath.CIRCLE, scale: 16, fillColor: "#ef4444", fillOpacity: 0.28, strokeWeight: 0 },
        }),
      );
    if (!halosRef.current.length) return;
    let on = true;
    const t = setInterval(() => {
      on = !on;
      for (const h of halosRef.current) {
        const ic = h.getIcon() as google.maps.Symbol;
        h.setIcon({ ...ic, scale: on ? 22 : 13, fillOpacity: on ? 0.30 : 0.06 });
      }
    }, 650);
    return () => { clearInterval(t); for (const h of halosRef.current) h.setMap(null); halosRef.current = []; };
  }, [ready, blinkIds, customers]);

  // ── "Me" + the working radius ─────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !window.google) return;
    meRef.current?.setMap(null); meRef.current = null;
    circleRef.current?.setMap(null); circleRef.current = null;
    if (!here) return;
    meRef.current = new google.maps.Marker({
      map, position: here, title: "You are here", zIndex: 45,
      icon: { path: google.maps.SymbolPath.CIRCLE, scale: 7, fillColor: "#2563eb", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 3 },
    });
    if (radius) {
      circleRef.current = new google.maps.Circle({
        map, center: here, radius: radius * 1000,
        fillColor: "#2563eb", fillOpacity: 0.06, strokeColor: "#2563eb", strokeOpacity: 0.35, strokeWeight: 1.5,
        clickable: false, zIndex: 2,
      });
    }
  }, [ready, here, radius]);

  // ── A faint crow-flies hint to the selected door ──────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !window.google) return;
    lineRef.current?.setMap(null); lineRef.current = null;
    const sel = customers.find((c) => c.id === selectedId);
    if (!here || !sel) return;
    lineRef.current = new google.maps.Polyline({
      map, path: [here, { lat: sel.lat, lng: sel.lng }], geodesic: true, clickable: false,
      strokeColor: "#0f172a", strokeOpacity: 0, zIndex: 3,
      icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 0.5, scale: 3 }, offset: "0", repeat: "12px" }],
    });
    map.panTo({ lat: sel.lat, lng: sel.lng });
  }, [ready, selectedId, customers, here]);

  // ── Frame the book once (and on demand) ───────────────────────────────────────
  const fit = useMemo(() => () => {
    const map = mapRef.current;
    if (!map || !window.google) return;
    const pts = customers.filter(inRadius);
    if (!pts.length && !here) { map.setCenter(KENYA.center); map.setZoom(KENYA.zoom); return; }
    const b = new google.maps.LatLngBounds();
    for (const c of pts) b.extend({ lat: c.lat, lng: c.lng });
    if (here) b.extend(here);
    if (b.isEmpty()) { map.setCenter(KENYA.center); map.setZoom(KENYA.zoom); return; }
    map.fitBounds(b, 64);
  }, [customers, radius, here]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ready || didFitRef.current) return;
    if (customers.length || here) { fit(); didFitRef.current = true; }
  }, [ready, customers, here, fit]);

  if (unconfigured) {
    return (
      <div className="flex h-[56dvh] min-h-[360px] items-center justify-center rounded-2xl border border-amber-300 bg-amber-50/80 p-6 text-center">
        <p className="flex max-w-md items-start gap-2 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {MAPS_UNCONFIGURED}
        </p>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-2xl">
      <div ref={mapEl} className="h-[56dvh] min-h-[360px] w-full bg-zinc-100" />

      {error && (
        <div className="absolute inset-x-3 top-3 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/95 px-3 py-2 text-xs text-red-700 shadow">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {/* Legend */}
      <div className="pointer-events-none absolute left-3 bottom-3 rounded-xl bg-white/90 px-3 py-2 text-[11px] shadow-lg backdrop-blur">
        <p className="mb-1 font-bold uppercase tracking-wide text-zinc-400">Risk on the ground</p>
        <div className="flex flex-col gap-1">
          <Legend color={RISK_TONE.green.dot} label="Current" />
          <Legend color={RISK_TONE.amber.dot} label="Slipping · 1–29 days" />
          <Legend color={RISK_TONE.red.dot} label="In default · 30+ days" />
          <span className="mt-0.5 flex items-center gap-1.5 text-zinc-500">
            <span className="relative flex h-2.5 w-2.5 items-center justify-center">
              <span className="absolute h-2.5 w-2.5 animate-ping rounded-full bg-red-500/60" />
              <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
            </span>
            Pulsing = highest risk
          </span>
        </div>
      </div>

      {/* Recenter */}
      <button
        onClick={() => fit()}
        className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-lg bg-white/90 px-3 py-2 text-[11px] font-semibold text-zinc-700 shadow-lg backdrop-blur hover:bg-white"
      >
        {here ? <Locate className="h-3.5 w-3.5" /> : <Crosshair className="h-3.5 w-3.5" />} Fit book
      </button>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-zinc-600">
      <span className="h-2.5 w-2.5 rounded-full ring-1 ring-white" style={{ backgroundColor: color }} /> {label}
    </span>
  );
}
