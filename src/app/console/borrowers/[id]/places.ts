// Where a customer can be found.
//
// This lived in BorrowerMenu.tsx, which is a "use client" module — and that was
// fine for exactly as long as only the client called it. Customer 360 is a SERVER
// component and now builds the Places section itself, and every export of a
// "use client" module reaches a server component as a client REFERENCE, not as
// the function: calling it server-side throws at request time, not at build time,
// which is the worst place to find out.
//
// So it lives here, in a module with no directive and no imports, and both sides
// import it from the same place.

/** A pinned place. `address` may be null — a pin without one still routes. */
export type Place = {
  kind: "business" | "home";
  lat: number;
  lng: number;
  address: string | null;
};

/**
 * The places we hold for this customer.
 *
 * The primary pin (lat/lng) is whichever place was captured first — locationType says
 * which — and homeLat/homeLng holds a home captured alongside a business. So "which
 * pin is the business?" is a question about locationType, not about the column name.
 */
export function placesOf(p: {
  lat: number | null; lng: number | null; locationType: string | null; locationAddress: string | null;
  homeLat: number | null; homeLng: number | null; homeAddress: string | null;
}): Place[] {
  const out: Place[] = [];
  if (p.lat != null && p.lng != null) {
    out.push({
      kind: p.locationType === "home" ? "home" : "business",
      lat: p.lat, lng: p.lng, address: p.locationAddress,
    });
  }
  if (p.homeLat != null && p.homeLng != null && !out.some((x) => x.kind === "home")) {
    out.push({ kind: "home", lat: p.homeLat, lng: p.homeLng, address: p.homeAddress });
  }
  return out;
}
