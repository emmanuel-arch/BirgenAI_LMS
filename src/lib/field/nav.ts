// ─────────────────────────────────────────────────────────────────────────────
// TURN-BY-TURN NAV MATH — pure functions, no window, no Google, no Prisma.
//
// The Route Planner gets a route from Google Directions once; everything that
// happens per GPS fix after that — "where am I on the route, which instruction
// applies, how far to the turn, how far to go, am I off the road" — is answered
// HERE, locally, in under a millisecond. Snapping every fix back to Google
// would cost a network round-trip per second of riding and die the moment the
// officer's phone drops to 2G between towns. The phone already knows the whole
// route; navigation is arithmetic, not another API.
//
// Geometry: positions are projected into local flat metres around the point
// being tested (equirectangular — Nairobi routes are far too short for the
// projection error to matter), and the fix is projected onto each nearby
// SEGMENT of the polyline, not just its vertices. Google's paths put vertices
// ~10–40 m apart; vertex-only snapping would make the distance-to-turn jump in
// 40 m steps, which reads as broken on a moving banner.
//
// This file is deliberately importable from a bare tsx script — verify-nav.ts
// exercises it with synthetic routes. Keep it dependency-free.
// ─────────────────────────────────────────────────────────────────────────────

export type LL = { lat: number; lng: number };

const EARTH_M = 6371000;
const toRad = (d: number) => (d * Math.PI) / 180;

/** Great-circle metres between two points. */
export function haversineM(a: LL, b: LL): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** One instruction's worth of road, as the planner stores it. */
export type NavStep = {
  /** Plain-text instruction ("Turn left onto Kikuyu Road"). Already stripped. */
  instruction: string;
  /** Google's maneuver id ("turn-left", "roundabout-right", "" for straight). */
  maneuver: string;
  path: LL[];
};

/**
 * The whole route flattened for snapping: every vertex with its cumulative
 * distance from the start, and which step it belongs to. Built once per route.
 */
export type NavRoute = {
  points: LL[];
  /** cumM[i] = metres from route start to points[i]. */
  cumM: number[];
  /** stepOf[i] = index into steps for the segment STARTING at points[i]. */
  stepOf: number[];
  /** stepEndM[s] = cumulative metres at which step s's maneuver happens. */
  stepEndM: number[];
  steps: NavStep[];
  totalM: number;
};

export function buildNavRoute(steps: NavStep[]): NavRoute {
  const points: LL[] = [];
  const cumM: number[] = [];
  const stepOf: number[] = [];
  const stepEndM: number[] = [];
  let cum = 0;

  steps.forEach((step, s) => {
    for (const p of step.path) {
      const last = points[points.length - 1];
      // Steps share their boundary vertex; keep one copy so segments stay real.
      if (last && last.lat === p.lat && last.lng === p.lng) { stepOf[points.length - 1] = s; continue; }
      if (last) cum += haversineM(last, p);
      points.push(p);
      cumM.push(cum);
      stepOf.push(s);
    }
    stepEndM.push(cum);
  });

  return { points, cumM, stepOf, stepEndM, steps, totalM: cum };
}

export type Snap = {
  /** Index of the segment (points[i] → points[i+1]) the fix landed on. */
  segIndex: number;
  /** Metres from route start to the snapped point. */
  alongM: number;
  /** How far the fix is from the road — the off-route signal. */
  offRouteM: number;
  /** Which instruction applies at the snapped point. */
  stepIndex: number;
};

/**
 * Project a GPS fix onto the route. `hint` is the last snap's segment index —
 * the search stays inside a window around it (a rider does not teleport), and
 * only widens to the whole route when the windowed answer looks wrong. The
 * window is also what stops a route that crosses itself from snapping the
 * rider onto the wrong pass through the junction.
 */
export function snapToRoute(route: NavRoute, pos: LL, hint = 0): Snap {
  const windowed = bestOnRange(route, pos, Math.max(0, hint - 8), Math.min(route.points.length - 1, hint + 60));
  if (windowed && windowed.offRouteM <= 120) return windowed;
  const full = bestOnRange(route, pos, 0, route.points.length - 1);
  return full ?? windowed ?? { segIndex: hint, alongM: route.cumM[hint] ?? 0, offRouteM: Infinity, stepIndex: route.stepOf[hint] ?? 0 };
}

function bestOnRange(route: NavRoute, pos: LL, from: number, to: number): Snap | null {
  const { points, cumM, stepOf } = route;
  if (points.length < 2 || from >= to) {
    if (points.length === 1) return { segIndex: 0, alongM: 0, offRouteM: haversineM(points[0], pos), stepIndex: 0 };
    return null;
  }

  // Local flat frame centred on the fix: metres east/north per degree.
  const mPerLat = 111320;
  const mPerLng = 111320 * Math.cos(toRad(pos.lat));
  const toXY = (p: LL) => ({ x: (p.lng - pos.lng) * mPerLng, y: (p.lat - pos.lat) * mPerLat });

  let best: Snap | null = null;
  for (let i = from; i < to; i++) {
    const a = toXY(points[i]);
    const b = toXY(points[i + 1]);
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    // The fix is at the origin of this frame, so projecting (0,0) onto a→b:
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, -(a.x * dx + a.y * dy) / len2));
    const px = a.x + t * dx, py = a.y + t * dy;
    const d = Math.hypot(px, py);
    if (!best || d < best.offRouteM) {
      const segLenM = cumM[i + 1] - cumM[i];
      best = {
        segIndex: i,
        alongM: cumM[i] + t * segLenM,
        offRouteM: d,
        stepIndex: stepOf[i],
      };
    }
  }
  return best;
}

export type Progress = {
  stepIndex: number;
  /** Metres from here to the current step's maneuver. */
  toManeuverM: number;
  /** Metres from here to the destination, along the road. */
  remainingM: number;
  /** Remaining seconds, scaled off the route's live-traffic total. */
  remainingSecs: number;
  /** 0..1 of the route ridden. */
  fraction: number;
};

/**
 * Turn a snap into everything the nav banner shows. `trafficSecs` is the
 * route's door-to-door seconds from Directions (live traffic when available);
 * remaining time scales it by remaining distance — honest enough turn to turn,
 * and it converges to zero exactly when the road does.
 */
export function progressOf(route: NavRoute, snap: Snap, trafficSecs: number): Progress {
  const remainingM = Math.max(0, route.totalM - snap.alongM);
  // The maneuver for step s happens at stepEndM[s]. If we're past this step's
  // end (shared boundary rounding), the next step's instruction is the truth.
  let stepIndex = snap.stepIndex;
  while (stepIndex < route.steps.length - 1 && route.stepEndM[stepIndex] - snap.alongM < 1) stepIndex++;
  return {
    stepIndex,
    toManeuverM: Math.max(0, route.stepEndM[stepIndex] - snap.alongM),
    remainingM,
    remainingSecs: route.totalM > 0 ? (remainingM / route.totalM) * trafficSecs : 0,
    fraction: route.totalM > 0 ? Math.min(1, snap.alongM / route.totalM) : 1,
  };
}

/** How far off the road counts as off the route (GPS drift is ~15–30 m urban). */
export const OFF_ROUTE_M = 80;
/** This close to the destination pin, the ride is over. */
export const ARRIVED_M = 40;

/** Google's step instructions arrive as HTML. The banner (and the voice) want text. */
export function stripHtml(html: string): string {
  return html
    .replace(/<div[^>]*>/gi, " — ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function fmtM(m: number): string {
  if (m < 20) return "now";
  if (m < 950) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

export function fmtMins(secs: number): string {
  const mins = Math.max(1, Math.round(secs / 60));
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)} h ${mins % 60} min`;
}

/** Clock-time ETA in Nairobi's timezone, e.g. "14:52". */
export function fmtEta(secsFromNow: number, now: Date = new Date()): string {
  const eta = new Date(now.getTime() + secsFromNow * 1000);
  return new Intl.DateTimeFormat("en-KE", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Nairobi" }).format(eta);
}
