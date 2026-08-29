// Which book the caller is standing in.
//   GET  → the realms this lender has, and the one currently selected
//   POST → { realm: "sme" | "fintech" } — change it
//
// No right guards this. Choosing a book is not a privilege: the realms a person
// can reach are the ones their ORGANISATION has, and everything they may see or
// do inside one is still decided by rights and scope exactly as before. Gating
// the switch would only mean a manager could be locked into a book while their
// data scope let them read the other, which is the confusing half of both.
//
// Tenant isolation is structural. The realm is resolved against
// realmsFor(session.orgSlug) — a body naming another lender's book does not
// return an error so much as fail to exist, because the allowlist is built from
// the caller's own org and nothing else is ever considered.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { realmsFor, defaultRealm, findRealm } from "@/lib/suite/realms";
import { activeRealm, setRealmCookie } from "@/lib/suite/realm-server";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });

  const slug = session.user.orgSlug;
  const realms = realmsFor(slug);
  const active = await activeRealm(slug);
  return NextResponse.json({
    success: true,
    realms: realms.map((r) => ({ id: r.id, label: r.label, name: r.name, blurb: r.blurb, entityId: r.entityId })),
    active: active?.id ?? null,
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ success: false, message: "Not signed in." }, { status: 401 });

  const slug = session.user.orgSlug;
  if (!realmsFor(slug).length) {
    return NextResponse.json({ success: false, message: "This lender has one book." }, { status: 400 });
  }

  let body: { realm?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  // findRealm falls back to the default for anything unrecognised, which is the
  // right behaviour for a stale cookie being READ. It is the wrong behaviour for
  // a body being WRITTEN: silently storing "fintech" when the caller asked for
  // something else would leave the UI showing a book nobody selected. So the
  // write path insists on an exact hit.
  const requested = (body.realm ?? "").trim();
  const realm = findRealm(slug, requested);
  if (!realm || realm.id !== requested) {
    const names = realmsFor(slug).map((r) => r.id).join(", ");
    return NextResponse.json({ success: false, message: `Unknown book. Expected one of: ${names}.` }, { status: 400 });
  }

  await setRealmCookie(realm.id);
  return NextResponse.json({
    success: true,
    active: realm.id,
    name: realm.name,
    entityId: realm.entityId,
    // Echoed so the caller can confirm what it optimistically painted; the
    // default is included for a client that needs to reset.
    fallback: defaultRealm(slug)?.id ?? null,
  });
}
