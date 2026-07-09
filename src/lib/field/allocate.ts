// ─────────────────────────────────────────────────────────────────────────────
// Field allocation — "the RO becomes an API".
//
// When software can't confirm physical reality (does the shop/stock exist?), it
// schedules a geolocated visit and allocates the NEAREST available field agent
// automatically (Haversine great-circle distance). Any agent in the org with a
// known location is a candidate; the closest wins. A simple greedy route order
// per agent (nearest-next) turns their queue into a drive plan.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";

const R = 6371; // km
const toRad = (d: number) => (d * Math.PI) / 180;

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export type Candidate = { id: string; name: string; lat: number; lng: number; openVisits: number; distanceKm: number };

/**
 * Rank field agents for a target point. Closest first; ties broken by lighter
 * workload (fewer open visits) so we don't pile everything on one nearby agent.
 */
export async function rankAgents(orgId: string, target: { lat: number; lng: number }): Promise<Candidate[]> {
  const agents = await prisma.staffUser.findMany({
    where: { orgId, isFieldAgent: true, status: "ACTIVE", lat: { not: null }, lng: { not: null } },
    select: {
      id: true, firstName: true, otherName: true, lat: true, lng: true,
      _count: { select: { visitsAssigned: true } },
    },
  });
  const openCounts = await prisma.fieldVisit.groupBy({
    by: ["agentId"],
    where: { orgId, status: { in: ["ALLOCATED", "EN_ROUTE", "ARRIVED"] } },
    _count: { _all: true },
  });
  const openByAgent = new Map(openCounts.map((c) => [c.agentId, c._count._all]));

  return agents
    .map((a) => ({
      id: a.id,
      name: `${a.firstName}${a.otherName ? " " + a.otherName : ""}`,
      lat: a.lat!, lng: a.lng!,
      openVisits: openByAgent.get(a.id) ?? 0,
      distanceKm: Number(haversineKm(target, { lat: a.lat!, lng: a.lng! }).toFixed(2)),
    }))
    .sort((x, y) => x.distanceKm - y.distanceKm || x.openVisits - y.openVisits);
}

/** Greedy nearest-next ordering of an agent's open visits from their base. */
export function routeOrder(base: { lat: number; lng: number }, stops: { id: string; lat: number; lng: number }[]): { id: string; legKm: number; order: number }[] {
  const remaining = [...stops];
  const out: { id: string; legKm: number; order: number }[] = [];
  let cur = base;
  let n = 1;
  while (remaining.length) {
    let bestIdx = 0, bestKm = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const km = haversineKm(cur, remaining[i]);
      if (km < bestKm) { bestKm = km; bestIdx = i; }
    }
    const stop = remaining.splice(bestIdx, 1)[0];
    out.push({ id: stop.id, legKm: Number(bestKm.toFixed(2)), order: n++ });
    cur = stop;
  }
  return out;
}
