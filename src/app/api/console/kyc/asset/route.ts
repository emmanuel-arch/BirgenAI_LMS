// GET /api/console/kyc/asset?key=<object key> — mint a short-lived signed URL
// for one KYC image (ID photo, selfie, portrait).
//
// This is the ONLY way an image leaves the private bucket. Three gates, and the
// third is the one that matters:
//   1. a staff session, scoped to an org
//   2. the key's `<orgId>/…` prefix matches that org — cheap, and catches typos
//   3. the key is actually REFERENCED by a KycSession or Borrower row this org
//      can see. RLS answers that, so a key belonging to another lender resolves
//      to no row no matter how it was obtained.
//
// Opening a borrower's national ID photo is exactly the kind of access the DPA
// expects a lender to be able to account for, so every mint is written to the
// audit log with the actor and the key.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/ratelimit";
import { signedUrl, keyBelongsToOrg, storageMode, SIGNED_URL_TTL_SEC } from "@/lib/storage/provider";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await auth();
  const orgId = session?.user?.orgId;
  if (!orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });

  const key = req.nextUrl.searchParams.get("key")?.trim() ?? "";
  if (!key || !keyBelongsToOrg(key, orgId)) {
    return NextResponse.json({ success: false, message: "Not found." }, { status: 404 });
  }

  const limited = await rateLimit([{ name: "kycasset:staff", subject: session.user!.id, max: 120, windowSec: 3600 }]);
  if (limited) return limited;

  // Does this org actually hold a record pointing at this object? RLS scopes both
  // queries, so this is the real authorization check.
  const [onSession, onBorrower] = await Promise.all([
    prisma.kycSession.findFirst({
      where: { OR: [{ idFrontKey: key }, { idBackKey: key }, { selfieKey: key }, { portraitKey: key }] },
      select: { id: true },
    }),
    prisma.borrower.findFirst({
      where: { OR: [{ idFrontKey: key }, { idBackKey: key }, { selfieKey: key }, { portraitKey: key }] },
      select: { id: true },
    }),
  ]);
  if (!onSession && !onBorrower) {
    return NextResponse.json({ success: false, message: "Not found." }, { status: 404 });
  }

  // A `sim/` key means storage was in simulation when this session ran: the row
  // is real, the bytes were never written. Say so rather than 404.
  if (key.startsWith("sim/") || storageMode() === "simulation") {
    return NextResponse.json({
      success: true,
      url: null,
      simulated: true,
      message: "This image was captured while storage was in simulation — no file was stored.",
    });
  }

  const url = await signedUrl(key);
  if (!url) return NextResponse.json({ success: false, message: "Could not open that image." }, { status: 502 });

  await prisma.auditLog.create({
    data: {
      orgId,
      actorId: session.user!.id,
      actorType: "staff",
      action: "kyc.asset.view",
      meta: { key, borrowerId: onBorrower?.id ?? null, sessionId: onSession?.id ?? null },
      ip: req.headers.get("x-forwarded-for"),
    },
  }).catch(() => {});

  return NextResponse.json({ success: true, url, expiresInSec: SIGNED_URL_TTL_SEC });
}
