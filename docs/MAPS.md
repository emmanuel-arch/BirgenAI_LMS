# Maps & routing — Google Maps Platform

The Route Map (`/console/field/map`) draws real Nairobi streets, routes an officer to a
customer over them, and prices the ride. As of this change the minutes are **measured, not
modelled**: Directions is asked with `departureTime: now`, so `duration_in_traffic` is
Google's live read of the actual roads rather than our old rush-hour multiplier.

## Why Google, and why the whole map

We previously used Leaflet + OpenStreetMap tiles with routing from the public OSRM demo
server. That gave real streets but **no traffic**, which in Nairobi is most of the answer.

Moving routing to Google forced the basemap to move too. Google's Maps Platform terms carry
a **"No Use With Non-Google Maps"** restriction, and the Directions API policy names it
outright: Directions content may not be displayed in conjunction with a non-Google map.
Drawing a Google route polyline on a Leaflet/OSM canvas is a terms breach, and the
enforcement is key suspension. Traffic and cartography are a package deal.

(This also removes a mechanical problem: the Directions REST API sends no CORS headers, so
the browser could never have called it directly anyway. The Maps JS `DirectionsService`
handles that for us.)

`leaflet` and `@types/leaflet` are gone from `package.json`.

## Cloud console setup

In the **birgen-ai-2025** project, enable **both**:

| API                     | What it's for                                        |
| ----------------------- | ---------------------------------------------------- |
| Maps JavaScript API     | The basemap and the traffic layer                    |
| Directions API          | The route, and `duration_in_traffic`                 |

Nothing else is needed. In particular we do **not** use Distance Matrix (the "Customers Near
Me" list ranks by haversine, which is free and good enough for a straight-line sort) or
Geocoding (addresses come from IPRS and manual entry).

## The key

```
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY="…"
```

in `lms/.env`, and the same variable on Vercel.

**Create a NEW key for this. Do not reuse `GOOGLE_API_KEY` or `GOOGLE_CLOUD_API_KEY` from the
Hub or the agent projects.** Maps JS authenticates from the browser — there is no server-side
variant of a rendered map — so this key is compiled into the client bundle and is readable by
anyone who views source. That is normal and expected for a Maps key, but it means a key that
can *also* call Gemini would be handing out Gemini billing to the public.

Because the key is public, the referrer restriction **is** the security model, not optional
hardening:

- **Application restrictions → HTTP referrers**: `lms.birgenai.com/*`, `*.birgenai.com/*`,
  `localhost:3000/*` (and `localhost:3100/*` if you run the E2E build locally).
- **API restrictions → Restrict key**: Maps JavaScript API and Directions API only.

A key without these two restrictions can be lifted from the bundle and billed to the project
by anyone.

## Behaviour without a key

Simulation-first, like every other provider in this codebase (`kycMode`, `crbMode`,
`storageMode`, `iprsMode`). With no key, `mapsMode()` returns `unconfigured`, the Route Map
renders an amber notice naming the missing variable, and nothing else in the console is
affected. It never half-loads a watermarked "for development purposes only" map onto a field
officer's phone.

## Cost

Both APIs bill per call/load. Check current rates and the monthly free allowance in the Cloud
console — Google restructured Maps pricing in 2025 and any number written here would go stale.
Set a **budget alert** on the project: the Route Map is used by field agents in the field, and
a runaway loop on a phone is a bill.

## Where the code is

- `src/lib/maps/google.ts` — the loader, the mode check, the unconfigured message.
- `src/app/console/field/map/MapClient.tsx` — the map, the Directions call, the fares.

The fare arithmetic (boda/matatu/ride-hail/fuel at 2026 Nairobi street rates) is ours and is
unchanged — Google tells us the distance and the minutes; what a boda *should* cost for them
is local knowledge, not an API.
