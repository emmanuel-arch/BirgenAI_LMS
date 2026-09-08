// ─────────────────────────────────────────────────────────────────────────────
// POST /api/console/onboarding/ocr — read a customer's ID card BEFORE they are a
// customer.
//
// The OCR pipeline already existed, but only downstream of a KycSession, which is
// downstream of a Borrower row. That ordering makes the free rail useless for the
// job it is best at: turning a photograph into a filled-in registration form. A
// lender with no IPRS contract and no bureau account should still be able to
// onboard somebody in under a minute, and this is the endpoint that lets them.
//
// Body: { image: dataUrl, side?: "front" | "back", consent: boolean }
//   → { success, engine, confidence, person: { fullName, idNumber, dob, serial }, existing? }
//
// TWO THINGS IT DOES BEYOND READING THE CARD:
//
//   IT CHECKS FOR A DUPLICATE. The single most expensive data error in a lending
//   book is two records for one person, and the moment the ID number is legible is
//   the cheapest moment to catch it — before anything has been typed.
//
//   IT NEVER STORES THE IMAGE. The bytes are read and dropped; only the fields
//   survive, and they go back to the officer's screen for confirmation rather than
//   into a record. Nothing is created here.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { prisma } from "@/lib/prisma";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { performIdOcr } from "@/lib/kyc/provider";
import { readBorrowerConfig } from "@/lib/config/store";

export const runtime = "nodejs";

/** A generous ceiling for a phone photograph, and a hard stop on a video file. */
const MAX_BYTES = 12 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const session = await auth();
  const denied = await requireRight(session, "borrowers.create");
  if (denied) return denied;
  const orgId = session!.user!.orgId!;
  const staffId = session!.user!.id!;

  let body: { image?: string; side?: string; consent?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const image = typeof body.image === "string" ? body.image : "";
  if (!image.startsWith("data:image/")) {
    return NextResponse.json({ success: false, message: "Send a photograph of the ID." }, { status: 400 });
  }
  // A base64 payload is ~4/3 of the bytes it encodes.
  if (image.length * 0.75 > MAX_BYTES) {
    return NextResponse.json({ success: false, message: "That image is too large. Take the photo again at a lower resolution." }, { status: 413 });
  }

  const cfg = await readBorrowerConfig(orgId);
  if (!cfg.value.onboarding.methods.ocr) {
    return NextResponse.json({ success: false, message: "Document scanning is switched off for this lender." }, { status: 403 });
  }
  if (cfg.value.onboarding.requireConsent && !body.consent) {
    return NextResponse.json({ success: false, message: "Confirm the customer consented to their ID being read." }, { status: 400 });
  }

  // OCR is not billed per call the way a registry lookup is, but it IS compute and
  // it is reachable by anyone with a counter login — so it is rate-limited like the
  // rest of the identity surface rather than left open.
  const limited = await rateLimit(
    [
      { name: "onboarding-ocr:staff", subject: staffId, max: 40, windowSec: 60 },
      { name: "onboarding-ocr:ip", subject: clientIp(req), max: 120, windowSec: 300 },
    ],
    "Too many scans in a row. Give it a moment.",
  );
  if (limited) return limited;

  const seed = `${orgId}:${Date.now()}`;
  const read = await performIdOcr(seed, null, image);

  const min = Math.round(cfg.value.onboarding.ocr.minConfidence * 100);
  const confident = (read.confidence ?? 0) >= min;

  // Duplicate check at the cheapest possible moment: the number is legible and
  // nothing has been typed yet.
  let existing: { id: string; name: string; phone: string } | null = null;
  if (read.idNumber) {
    const found = await prisma.borrower.findFirst({
      where: { orgId, nationalId: read.idNumber, erasedAt: null },
      select: { id: true, firstName: true, otherName: true, phone: true },
    });
    if (found) {
      existing = {
        id: found.id,
        name: [found.firstName, found.otherName].filter(Boolean).join(" ").trim(),
        phone: found.phone,
      };
    }
  }

  await prisma.auditLog.create({
    data: {
      orgId, actorId: staffId, actorType: "staff", action: "onboarding.ocr",
      entity: "Borrower", entityId: existing?.id ?? null,
      meta: { engine: read.engine, confidence: read.confidence, side: body.side ?? "front", duplicate: Boolean(existing) },
    },
  }).catch(() => {});

  return NextResponse.json({
    success: true,
    engine: read.engine,
    confidence: read.confidence,
    // Below the lender's bar the read is offered for CORRECTION, not refused —
    // a smudged card is a reason to check the fields, not to turn the person away.
    confident,
    minConfidence: min,
    allowEdit: cfg.value.onboarding.ocr.allowEdit,
    person: {
      fullName: read.fullName ?? null,
      idNumber: read.idNumber ?? null,
      dob: read.dob ?? null,
      serial: read.serial ?? null,
    },
    existing,
    onDuplicate: cfg.value.onboarding.onDuplicate,
  });
}
