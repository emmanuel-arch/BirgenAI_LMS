"use client";

// ── The location snapshot — consent, then a pin per place ─────────────────────
//
// The officer is STANDING at the business (or home) during onboarding; the pin is
// the device's position at that moment. One snapshot, never tracked — this is what
// dispatch and route planning run on.
//
// Which places are offered, and whether one is compulsory, now come from the
// borrower onboarding config rather than being fixed at two-and-optional. A field
// lender can insist on a business pin; a desk lender can switch the whole block off.
import { useState } from "react";
import { Loader2, MapPin, Store, Home, CheckCircle2, X } from "lucide-react";

export type Pin = { lat: number; lng: number; accuracy: number | null };
export type Place = "business" | "home";

export function GeoBlock({
  places, required, consent, setConsent,
  pins, setPin, addresses, setAddress, onError,
}: {
  places: Place[];
  required: boolean;
  consent: boolean;
  setConsent: (v: boolean) => void;
  pins: Record<Place, Pin | null>;
  setPin: (place: Place, pin: Pin | null) => void;
  addresses: Record<Place, string>;
  setAddress: (place: Place, value: string) => void;
  onError: (s: string | null) => void;
}) {
  const [locating, setLocating] = useState<Place | null>(null);
  if (places.length === 0) return null;

  const capture = (kind: Place) => {
    if (!navigator.geolocation) { onError("This device has no location service."); return; }
    setLocating(kind); onError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPin(kind, {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy ? Math.round(pos.coords.accuracy) : null,
        });
        setLocating(null);
      },
      () => { onError("Could not read the location — check the browser's location permission."); setLocating(null); },
      { enableHighAccuracy: true, timeout: 12000 },
    );
  };

  const slot = (kind: Place) => {
    const pin = pins[kind];
    const Icon = kind === "business" ? Store : Home;
    return (
      <div key={kind} className={`rounded-xl border p-2.5 ${pin ? "border-emerald-300 bg-emerald-50/60" : "border-ash-900/10 bg-paper/60"}`}>
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold capitalize text-ash-700">
            <Icon className="h-3.5 w-3.5" style={{ color: "var(--brand)" }} /> {kind}
          </span>
          {pin ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" /> pinned{pin.accuracy ? ` ±${pin.accuracy}m` : ""}
              <button onClick={() => setPin(kind, null)} aria-label={`Clear ${kind} pin`} className="text-ash-400 hover:text-ash-700">
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ) : (
            <button onClick={() => capture(kind)} disabled={!consent || locating !== null}
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-40"
              style={{ backgroundColor: "var(--brand)" }}>
              {locating === kind ? <Loader2 className="h-3 w-3 animate-spin" /> : <MapPin className="h-3 w-3" />} Pin here
            </button>
          )}
        </div>
        <input
          className="mt-2 w-full rounded-lg border border-ash-900/10 bg-paper/80 px-2.5 py-1.5 text-xs outline-none placeholder:text-ash-400"
          placeholder={`${kind === "business" ? "Shop / stall" : "House"} landmark (optional)`}
          value={addresses[kind]}
          onChange={(e) => setAddress(kind, e.target.value)}
        />
      </div>
    );
  };

  return (
    <div className="mt-3 border-t border-ash-900/10 pt-3">
      <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-ash-900/10 bg-paper/60 p-3">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5 h-4 w-4" style={{ accentColor: "var(--brand)" }} />
        <span className="text-xs text-ash-600">
          The customer consents to a <span className="font-semibold">one-time location snapshot</span> of where we are
          right now{places.length === 2 ? " (their business and/or home)" : ` (their ${places[0]})`}. It is saved once
          for field visits — never tracked.
          {required && <span className="font-semibold"> This lender requires it.</span>}
        </span>
      </label>
      <div className={`mt-2 grid gap-2 ${places.length > 1 ? "sm:grid-cols-2" : ""}`}>
        {places.map(slot)}
      </div>
    </div>
  );
}

/** Is the geo requirement satisfied? One pin is enough — a lender asking for two is asking, not insisting. */
export const geoSatisfied = (
  required: boolean, places: Place[], pins: Record<Place, Pin | null>,
) => !required || places.some((p) => pins[p] !== null);
