// /.well-known/riri-map.json — the console's published map (plan §06, Table 5:
// "Serve it at the well-known path. An afternoon."). Same handler as
// /api/riri/map, defaulting to this system; staff session required.
export { GET } from "@/app/api/riri/map/route";

export const runtime = "nodejs";
