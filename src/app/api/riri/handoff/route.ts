// ─────────────────────────────────────────────────────────────────────────────
// /api/riri/handoff — the signed deep link between systems.
//
//   POST { to: "app"|"lms", href, question }   staff only: sign a hand-off link
//   GET  ?token=…                               anyone: verify one, and read its reason
//
// Riri Ecosystem AI plan §06, the third rule: "A hand-off is a signed deep link
// with a reason. It carries the question that produced it and lands with a
// dismissible bar." The landing app cannot hold a secret, so it asks here; a token
// that fails verification yields nothing to display, because an unverified "Riri
// sent you here" is the sentence a phishing link would most like to borrow.
//
// Only destinations that exist in a published map can be signed. Riri cannot be
// talked into minting a signed link to an arbitrary URL.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { signHandoff, verifyHandoff } from "@/lib/riri/core/destination";
import { normaliseRoute, resolveScreen } from "@/lib/riri/core/context";
import { appManifestPublic, handoffSecret, lmsManifest } from "@/lib/riri/federation";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const secret = handoffSecret();
  const token = req.nextUrl.searchParams.get("token") ?? "";
  if (!secret || !token) return NextResponse.json({ success: false, reason: "malformed" }, { status: 400 });

  const r = await verifyHandoff(token, secret);
  if (!r.ok) return NextResponse.json({ success: false, reason: r.reason }, { status: 400 });

  return NextResponse.json({
    success: true,
    from: r.handoff.from,
    fromTitle: r.handoff.fromTitle,
    to: r.handoff.to,
    href: r.handoff.href,
    question: r.handoff.question,
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });

  let body: { to?: string; href?: string; question?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const secret = handoffSecret();
  if (!secret) return NextResponse.json({ success: false, message: "Hand-offs are not configured on this deployment." }, { status: 503 });

  const manifest = body.to === "app" ? appManifestPublic() : body.to === "lms" ? lmsManifest() : null;
  const route = normaliseRoute(body.href);
  const screen = manifest && route ? resolveScreen(manifest.screens, route) : null;
  if (!manifest || !route || !screen) {
    return NextResponse.json({ success: false, message: "That is not a screen in a published map." }, { status: 422 });
  }

  const question = (body.question ?? "").trim().slice(0, 160);
  const token = await signHandoff({ from: "lms", fromTitle: "the lending console", to: manifest.system, href: route, question }, secret);
  const url = new URL(route, manifest.base);
  url.searchParams.set("riri", token);

  return NextResponse.json({ success: true, url: url.toString(), screen: { id: screen.id, title: screen.title } });
}
