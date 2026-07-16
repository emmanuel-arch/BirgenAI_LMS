// Tests for the turn-by-turn nav math — the arithmetic under the moving banner.
//
//   npm run test:nav        (pure — no database, no Google, no browser)
//
// The danger under test: an instruction that lies while someone is riding. A
// snap that grabs the wrong pass through a junction sends the banner to the
// wrong street; a distance-to-turn that only updates at vertices reads as
// frozen; an off-route detector that trips on GPS drift reroutes a rider who
// never left the road. Every fix here is a synthetic GPS point whose right
// answer is known by construction.
import {
  buildNavRoute, snapToRoute, progressOf, stripHtml, fmtM, fmtMins, fmtEta,
  haversineM, OFF_ROUTE_M, ARRIVED_M, type NavStep,
} from "@/lib/field/nav";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ` — ${extra}` : ""}`); }
};

// Nairobi-ish local frame: 0.001° lat ≈ 111.3 m, 0.001° lng ≈ 111.3·cos(1.29°) m.
// A route shaped like an L: ~1113 m east along a "road", then ~1113 m north.
const O = { lat: -1.2864, lng: 36.8172 };
const east = (m: number) => ({ lat: O.lat, lng: O.lng + m / (111320 * Math.cos((O.lat * Math.PI) / 180)) });
const north = (m: number) => ({ lat: O.lat + m / 111320, lng: O.lng + 1113 / (111320 * Math.cos((O.lat * Math.PI) / 180)) });

const steps: NavStep[] = [
  { instruction: "Head east on Moi Avenue", maneuver: "", path: [east(0), east(400), east(800), east(1113)] },
  { instruction: "Turn left onto Kikuyu Road", maneuver: "turn-left", path: [east(1113), north(300), north(700), north(1113)] },
];
const route = buildNavRoute(steps);

console.log("1. The route flattens with honest cumulative distances");
ok("shared boundary vertex is kept once", route.points.length === 7, String(route.points.length));
ok(`total is ~2226 m`, Math.abs(route.totalM - 2226) < 10, route.totalM.toFixed(1));
ok("the turn happens at ~1113 m", Math.abs(route.stepEndM[0] - 1113) < 5, route.stepEndM[0].toFixed(1));
ok("the destination is the last step's end", Math.abs(route.stepEndM[1] - route.totalM) < 0.01);

console.log("\n2. Snapping: a fix lands on the segment, not the nearest vertex");
// 600 m along the first road, 15 m south of it (GPS drift).
const drift = { lat: east(600).lat - 15 / 111320, lng: east(600).lng };
const s1 = snapToRoute(route, drift);
ok("snapped between vertices (~600 m along)", Math.abs(s1.alongM - 600) < 8, s1.alongM.toFixed(1));
ok("15 m of drift measures as ~15 m off-road", Math.abs(s1.offRouteM - 15) < 3, s1.offRouteM.toFixed(1));
ok("drift is NOT off-route", s1.offRouteM < OFF_ROUTE_M);
ok("still on step 1's instruction", s1.stepIndex === 0);

console.log("\n3. Progress: the banner's numbers");
const p1 = progressOf(route, s1, 600 /* 10 min door-to-door */);
ok("distance to the turn counts down from where I am", Math.abs(p1.toManeuverM - 513) < 10, p1.toManeuverM.toFixed(1));
ok("remaining road is total minus ridden", Math.abs(p1.remainingM - (route.totalM - s1.alongM)) < 0.01);
ok("remaining time scales the live total", Math.abs(p1.remainingSecs - 600 * (p1.remainingM / route.totalM)) < 1);
ok("fraction ridden ~27%", Math.abs(p1.fraction - 0.27) < 0.01, p1.fraction.toFixed(3));

console.log("\n4. Past the corner, the instruction changes");
const s2 = snapToRoute(route, north(200), s1.segIndex);
ok("snapped onto the second road", s2.stepIndex === 1);
const p2 = progressOf(route, s2, 600);
ok("to-maneuver is now to the DESTINATION (~913 m)", Math.abs(p2.toManeuverM - 913) < 10, p2.toManeuverM.toFixed(1));
// Standing exactly on the corner: the first step is spent; the next one speaks.
const corner = snapToRoute(route, east(1113), s1.segIndex);
ok("on the corner itself, the turn instruction has taken over", progressOf(route, corner, 600).stepIndex === 1);

console.log("\n5. Off-route and arrival");
const lost = snapToRoute(route, { lat: O.lat - 200 / 111320, lng: east(500).lng }, s1.segIndex);
ok("200 m south of the road measures ~200 m off", Math.abs(lost.offRouteM - 200) < 10, lost.offRouteM.toFixed(1));
ok("…and that IS off-route", lost.offRouteM > OFF_ROUTE_M);
const nearEnd = snapToRoute(route, north(1100), 5);
ok("30 m from the pin is within the arrival ring", route.totalM - nearEnd.alongM < ARRIVED_M, (route.totalM - nearEnd.alongM).toFixed(1));
// The hint window must not trap a legitimately rerouted rider: a fix far ahead
// of a stale hint still finds the right segment via the full-route fallback.
const staleHint = snapToRoute(route, north(1000), 0);
ok("a stale hint still finds the far end of the route", Math.abs(staleHint.alongM - (1113 + 1000)) < 15, staleHint.alongM.toFixed(1));

console.log("\n6. Text: what the banner and the voice actually say");
ok("HTML instructions strip clean",
  stripHtml('Turn <b>left</b> onto <b>Kikuyu&nbsp;Rd</b><div style="font-size:0.9em">Pass by the bank</div>') ===
  "Turn left onto Kikuyu Rd — Pass by the bank");
ok("entities unescape", stripHtml("Ronald Ngala St &amp; Moi Ave") === "Ronald Ngala St & Moi Ave");
ok("metres round to tens", fmtM(347) === "350 m", fmtM(347));
ok("under 20 m reads as now", fmtM(12) === "now");
ok("long distances go to km", fmtM(2260) === "2.3 km", fmtM(2260));
ok("seconds format as minutes", fmtMins(540) === "9 min");
ok("an hour-plus ride formats as h+min", fmtMins(4500) === "1 h 15 min", fmtMins(4500));
ok("ETA is a Nairobi clock time", /^\d{2}:\d{2}$/.test(fmtEta(600, new Date("2026-07-16T09:00:00Z"))), fmtEta(600, new Date("2026-07-16T09:00:00Z")));
ok("ETA of a 10-min ride from 09:00 UTC is 12:10 EAT", fmtEta(600, new Date("2026-07-16T09:00:00Z")) === "12:10");

console.log("\n7. Degenerate routes don't divide by zero");
const dot = buildNavRoute([{ instruction: "You are here", maneuver: "", path: [O] }]);
const sDot = snapToRoute(dot, east(10));
ok("a single-point route still snaps", Math.abs(sDot.offRouteM - 10) < 2, sDot.offRouteM.toFixed(1));
ok("…and progress is total", progressOf(dot, sDot, 60).fraction === 1);
ok("haversine of a point to itself is 0", haversineM(O, O) === 0);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
