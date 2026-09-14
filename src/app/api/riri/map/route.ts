// ─────────────────────────────────────────────────────────────────────────────
// GET /api/riri/map?system=app|lms — a system's screens, in the one shape every map shares.
//
// Riri Ecosystem AI plan §06, "the federated map". Also served at
// /.well-known/riri-map.json for the console (which re-exports this handler).
//
//   system=app  public — the customer app's screens are what any borrower sees
//   system=lms  signed-in staff only — our console's map is not a partner's to read
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { appManifestPublic, lmsManifest } from "@/lib/riri/federation";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const system = req.nextUrl.searchParams.get("system") ?? "lms";

  if (system === "app") {
    return NextResponse.json(appManifestPublic(), { headers: { "Cache-Control": "public, max-age=300" } });
  }

  if (system === "lms") {
    const session = await auth();
    if (!session?.user?.orgId) {
      return NextResponse.json({ success: false, message: "The console's map is served to signed-in staff." }, { status: 401 });
    }
    return NextResponse.json(lmsManifest(), { headers: { "Cache-Control": "private, max-age=300" } });
  }

  return NextResponse.json({ success: false, message: "Unknown system." }, { status: 404 });
}
