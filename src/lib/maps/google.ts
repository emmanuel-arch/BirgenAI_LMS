// ─────────────────────────────────────────────────────────────────────────────
// The Google Maps JavaScript API loader.
//
// SIMULATION-FIRST, like every other provider in this codebase (kycMode, crbMode,
// storageMode, iprsMode): with no key the map does not exist and the screen says
// so plainly. It never half-loads, and it never silently draws a map with a
// "For development purposes only" watermark across a field officer's phone.
//
// WHY THE KEY IS PUBLIC. Maps JS runs in the browser and authenticates from the
// browser; there is no server-side variant of a rendered map. Google's answer to
// this — the ONLY answer — is an HTTP-referrer restriction on the key, so a copy
// lifted from our bundle is worthless anywhere but our own domains. That
// restriction is not optional hardening, it IS the security model, and a key
// without one is a key anyone can bill to your project. See docs/MAPS.md.
//
// WHY NOT LEAFLET + OSM ANY MORE. Google's Maps Platform terms carry a "No Use
// With Non-Google Maps" clause, and the Directions policy names it outright:
// Directions content may not be displayed on a non-Google map. We want live
// Nairobi traffic, which only Directions gives us, so the basemap has to be
// Google's. Routing and cartography are a package deal, not two choices.
// ─────────────────────────────────────────────────────────────────────────────

/// <reference types="google.maps" />

export type MapsMode = "live" | "unconfigured";

/** Read at module scope in the browser — Next inlines NEXT_PUBLIC_* at build. */
export function mapsKey(): string | null {
  return process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() || null;
}

export function mapsMode(): MapsMode {
  return mapsKey() ? "live" : "unconfigured";
}

/** The one sentence that names the fix, shown on-screen rather than in a console. */
export const MAPS_UNCONFIGURED =
  "The map is not connected yet. Add NEXT_PUBLIC_GOOGLE_MAPS_API_KEY (a Google Maps Platform key with the Maps JavaScript API and Directions API enabled, restricted to this domain) and reload.";

/** The pieces of the API this app actually uses, resolved and ready to construct. */
export type GoogleMaps = {
  maps: google.maps.MapsLibrary;
  routes: google.maps.RoutesLibrary;
  marker: google.maps.MarkerLibrary;
};

let loader: Promise<GoogleMaps> | null = null;

/**
 * Load the Maps JS API once per page, however many components ask for it.
 *
 * ⚠ THE TRAP, PAID FOR IN A LIVE DEBUG SESSION: with `loading=async` (which Google
 * now REQUIRES — the alternative logs a deprecation warning) the classes are NOT
 * attached to `google.maps` eagerly. The namespace object exists almost immediately
 * while `google.maps.Map` is still undefined, so any loader that resolves on
 * "does window.google.maps exist" hands back a namespace whose constructors are
 * missing, and the first `new maps.Map(...)` dies with the wonderfully unhelpful
 * `t.Map is not a constructor`.
 *
 * The only correct signal is `importLibrary()`, Google's own dynamic-import
 * bootstrap: await the libraries you need and construct from what IT returns,
 * never from the bare namespace. That is what this resolves to.
 *
 * (Constants — TravelMode, TrafficModel, SymbolPath — DO live on the namespace, and
 * are safe to read once any library has been imported.)
 */
export function loadGoogleMaps(): Promise<GoogleMaps> {
  if (loader) return loader;

  const key = mapsKey();
  if (!key) return Promise.reject(new Error(MAPS_UNCONFIGURED));

  loader = (async () => {
    if (typeof window === "undefined") throw new Error("Maps can only load in the browser.");

    if (!window.google?.maps?.importLibrary) {
      await new Promise<void>((resolve, reject) => {
        // A fast refresh may have left the script in place mid-load.
        const existing = document.querySelector<HTMLScriptElement>("script[data-birgenai-maps]");
        if (existing) {
          existing.addEventListener("load", () => resolve());
          existing.addEventListener("error", () => reject(new Error("Google Maps failed to load.")));
          return;
        }
        const script = document.createElement("script");
        script.src =
          `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}` +
          `&v=weekly&loading=async&region=KE&language=en`;
        script.async = true;
        script.dataset.birgenaiMaps = "1";
        script.onload = () => resolve();
        script.onerror = () =>
          reject(new Error("Google Maps failed to load — check the key's referrer restrictions and that the Maps JavaScript API is enabled."));
        document.head.appendChild(script);
      });
    }

    // The bootstrap installs importLibrary before the script's load event settles
    // in some browsers; give it the few ticks it needs rather than racing it.
    const started = Date.now();
    while (!window.google?.maps?.importLibrary) {
      if (Date.now() - started > 10_000) throw new Error("Google Maps loaded but never initialised.");
      await new Promise((r) => setTimeout(r, 50));
    }

    const [maps, routes, marker] = await Promise.all([
      google.maps.importLibrary("maps") as Promise<google.maps.MapsLibrary>,
      google.maps.importLibrary("routes") as Promise<google.maps.RoutesLibrary>,
      google.maps.importLibrary("marker") as Promise<google.maps.MarkerLibrary>,
    ]);
    return { maps, routes, marker };
  })();

  // A failed load must not be cached forever — the next mount should retry.
  loader.catch(() => { loader = null; });
  return loader;
}
