"use client";

// ─────────────────────────────────────────────────────────────────────────────
// PIN-DROP MAP — place one point by hand.
//
// The onboarding snapshot comes off the customer's own device with consent. This
// is the other case: a field officer is standing WITH a customer who never saved
// a location, and needs to put their business (or home) on the map so they stop
// being invisible to routes and can be disbursed to. Tap the map, or drag the pin,
// or use the officer's own GPS — whichever is closest to where the customer is.
//
// SIMULATION-FIRST like every provider here (see src/lib/maps/google.ts): with no
// Maps key the component still works — "use current location" and a manual lat/lng
// entry — it just can't draw the basemap, and says so plainly.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState } from "react";
import { LocateFixed, Loader2 } from "lucide-react";
import { loadGoogleMaps, mapsMode } from "@/lib/maps/google";

const NAIROBI = { lat: -1.2864, lng: 36.8172 }; // CBD fallback centre
export type LatLng = { lat: number; lng: number };

export function PinDropMap({ value, onChange, height = 300 }: {
  value: LatLng | null;
  onChange: (p: LatLng) => void;
  height?: number;
}) {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  // The map's click/drag handlers outlive every render — they read through a ref.
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unconfigured = mapsMode() === "unconfigured";

  /** Move the pin and report the new coordinates — used by the GPS + manual paths. */
  const place = useCallback((p: LatLng) => {
    onChangeRef.current(p);
    const map = mapRef.current;
    if (map && markerRef.current) { markerRef.current.setPosition(p); map.panTo(p); }
  }, []);

  const locate = useCallback(() => {
    if (!navigator.geolocation) { setError("This device can't share a location — drop the pin by hand."); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => { setError(null); place({ lat: pos.coords.latitude, lng: pos.coords.longitude }); },
      () => setError("Couldn't read your location — allow access, or drop the pin by hand."),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, [place]);

  // ── Boot the map once. Value changes are pushed onto the marker, never a re-boot.
  useEffect(() => {
    if (unconfigured) return;
    let disposed = false;
    (async () => {
      try {
        // Constructors come from importLibrary, not the bare namespace (google.ts).
        const { maps } = await loadGoogleMaps();
        if (disposed || !mapEl.current || mapRef.current) return;
        const center = value ?? NAIROBI;
        const map = new maps.Map(mapEl.current, {
          center, zoom: value ? 16 : 12,
          mapTypeControl: false, streetViewControl: false, fullscreenControl: false, clickableIcons: false,
        });
        const marker = new google.maps.Marker({
          map, position: center, draggable: true,
          icon: { path: google.maps.SymbolPath.CIRCLE, scale: 9, fillColor: "#e11d48", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 3 },
        });
        marker.addListener("dragend", (e: google.maps.MapMouseEvent) => {
          if (e.latLng) onChangeRef.current({ lat: e.latLng.lat(), lng: e.latLng.lng() });
        });
        map.addListener("click", (e: google.maps.MapMouseEvent) => {
          if (!e.latLng) return;
          const p = { lat: e.latLng.lat(), lng: e.latLng.lng() };
          marker.setPosition(p);
          onChangeRef.current(p);
        });
        mapRef.current = map;
        markerRef.current = marker;
        // A pre-existing pin should report itself, so the caller has coordinates
        // without the officer having to touch a map that is already correct.
        if (value) onChangeRef.current(value);
        setReady(true);
      } catch (err) {
        if (!disposed) setError(err instanceof Error ? err.message : "The map could not load.");
      }
    })();
    return () => { disposed = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unconfigured]);

  if (unconfigured) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50/70 p-3 text-xs text-amber-800">
        <p>The map isn&apos;t connected, but you can still capture the pin.</p>
        <button type="button" onClick={locate}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-amber-400 bg-white px-3 py-1.5 font-semibold text-amber-800 hover:bg-amber-50">
          <LocateFixed className="h-3.5 w-3.5" /> Use current location
        </button>
        <div className="mt-2 flex gap-2">
          <input inputMode="decimal" placeholder="Latitude" defaultValue={value?.lat ?? ""}
            onChange={(e) => { const lat = Number(e.target.value); if (Number.isFinite(lat) && value) onChange({ lat, lng: value.lng }); else if (Number.isFinite(lat)) onChange({ lat, lng: NAIROBI.lng }); }}
            className="w-1/2 rounded-lg border border-amber-300 bg-white px-2 py-1.5" />
          <input inputMode="decimal" placeholder="Longitude" defaultValue={value?.lng ?? ""}
            onChange={(e) => { const lng = Number(e.target.value); if (Number.isFinite(lng) && value) onChange({ lat: value.lat, lng }); else if (Number.isFinite(lng)) onChange({ lat: NAIROBI.lat, lng }); }}
            className="w-1/2 rounded-lg border border-amber-300 bg-white px-2 py-1.5" />
        </div>
        {value && <p className="mt-2 tabular-nums text-amber-700">{value.lat.toFixed(5)}, {value.lng.toFixed(5)}</p>}
        {error && <p className="mt-2 text-rose-600">{error}</p>}
      </div>
    );
  }

  return (
    <div>
      <div className="relative overflow-hidden rounded-xl ring-1 ring-zinc-900/10" style={{ height }}>
        <div ref={mapEl} className="h-full w-full" />
        {!ready && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-100 text-xs text-zinc-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading the map…
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-50 p-4 text-center text-xs text-rose-600">{error}</div>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <button type="button" onClick={locate}
          className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-900/15 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50">
          <LocateFixed className="h-3.5 w-3.5" /> Use current location
        </button>
        <span className="text-[11px] tabular-nums text-zinc-400">
          {value ? `${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}` : "Tap the map or drag the pin"}
        </span>
      </div>
    </div>
  );
}
