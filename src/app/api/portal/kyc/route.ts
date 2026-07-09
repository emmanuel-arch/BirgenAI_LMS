// POST /api/portal/kyc — run one step of the elite KYC pipeline (borrower-facing).
// Body: { lenderSlug, phone, nationalId?, step, sessionId?, payload }
//   step: "id" | "liveness" | "facematch" | "iprs" | "finalize"
// The wizard drives these in order; each returns the step result + updated
// session so the UI can render confidence rings and gates live. Every step is
// also written as a KycCheck (the audit + ML feature trail).
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveOrg } from "@/lib/tenancy";
import {
  kycMode, assessIdQuality, extractId, assessLiveness, faceMatch, iprsLookup, portraitKeyFrom,
} from "@/lib/kyc/provider";

export const runtime = "nodejs";

type Step = "id" | "liveness" | "facematch" | "iprs" | "finalize";

async function getSession(orgId: string, sessionId: string | undefined, phone: string, nationalId: string | undefined, provider: string) {
  if (sessionId) {
    const s = await prisma.kycSession.findFirst({ where: { id: sessionId, orgId } });
    if (s) return s;
  }
  return prisma.kycSession.create({
    data: { orgId, phone: phone.replace(/\D/g, ""), nationalId: nationalId || null, provider },
  });
}

export async function POST(req: NextRequest) {
  let body: {
    lenderSlug?: string; phone?: string; nationalId?: string; step?: Step; sessionId?: string;
    payload?: { bytes?: number; brightness?: number; blurVar?: number; imageKey?: string };
  };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const org = await resolveOrg(body.lenderSlug ?? "");
  if (!org) return NextResponse.json({ success: false, message: "Choose a lender." }, { status: 400 });

  const phone = (body.phone ?? "").replace(/\D/g, "");
  if (phone.length < 9) return NextResponse.json({ success: false, message: "Enter your phone number." }, { status: 400 });

  const mode = await kycMode(org.id);
  const session = await getSession(org.id, body.sessionId, phone, body.nationalId, mode);
  // Seed the deterministic simulation off ID (or phone) so a person is consistent.
  const seed = `${org.id}:${body.nationalId?.replace(/\D/g, "") || phone}`;
  const bytes = Number(body.payload?.bytes) || 0;
  const p = body.payload ?? {};

  const writeCheck = (kind: "ID_QUALITY" | "ID_OCR" | "LIVENESS" | "FACE_MATCH" | "IPRS" | "PORTRAIT_STANDARDIZE", passed: boolean | null, score: number | null, payload: unknown) =>
    prisma.kycCheck.create({
      data: {
        orgId: org.id, sessionId: session.id, kind, passed, score, provider: mode,
        payload: payload as Prisma.InputJsonValue,
      },
    }).catch(() => {});

  const step = body.step;

  if (step === "id") {
    const quality = assessIdQuality(seed, bytes, { brightness: p.brightness, blurVar: p.blurVar });
    await writeCheck("ID_QUALITY", quality.passed, quality.score, quality);
    if (!quality.passed) {
      return NextResponse.json({ success: true, sessionId: session.id, mode, step, quality, retake: true });
    }
    const ocr = extractId(seed, body.nationalId);
    await writeCheck("ID_OCR", true, ocr.confidence, ocr);
    // Cross-check typed ID vs OCR when the borrower entered one.
    const typedId = (body.nationalId || "").replace(/\D/g, "");
    const idMismatch = typedId && ocr.idNumber && typedId !== ocr.idNumber.replace(/\D/g, "");
    const updated = await prisma.kycSession.update({
      where: { id: session.id },
      data: { idQualityScore: quality.score, idOcrName: ocr.fullName, idOcrNumber: ocr.idNumber, idOcrDob: ocr.dob },
    }).catch(() => session);
    return NextResponse.json({ success: true, sessionId: session.id, mode, step, quality, ocr, idMismatch: !!idMismatch, session: updated });
  }

  if (step === "liveness") {
    const liveness = assessLiveness(seed, bytes);
    await writeCheck("LIVENESS", liveness.passed, liveness.score, liveness);
    await prisma.kycSession.update({
      where: { id: session.id },
      data: { livenessScore: liveness.score, livenessPassed: liveness.passed },
    });
    return NextResponse.json({ success: true, sessionId: session.id, mode, step, liveness, retake: !liveness.passed });
  }

  if (step === "facematch") {
    const fm = faceMatch(seed);
    await writeCheck("FACE_MATCH", fm.passed, fm.score, fm);
    const portraitKey = portraitKeyFrom(p.imageKey ?? `selfie/${session.id}`);
    await writeCheck("PORTRAIT_STANDARDIZE", true, null, { portraitKey, whiteBackground: true });
    await prisma.kycSession.update({
      where: { id: session.id },
      data: { faceMatchScore: fm.score, portraitKey },
    });
    return NextResponse.json({ success: true, sessionId: session.id, mode, step, faceMatch: fm, portraitKey });
  }

  if (step === "iprs") {
    const nid = body.nationalId || session.idOcrNumber || "";
    const iprs = iprsLookup(seed, nid, session.idOcrName);
    await writeCheck("IPRS", iprs.matched, iprs.matched ? 100 : 0, iprs);
    await prisma.kycSession.update({
      where: { id: session.id },
      data: { iprsMatched: iprs.matched, iprsName: iprs.name, nationalId: nid.replace(/\D/g, "") || undefined },
    });
    return NextResponse.json({ success: true, sessionId: session.id, mode, step, iprs });
  }

  if (step === "finalize") {
    const s = await prisma.kycSession.findUnique({ where: { id: session.id } });
    if (!s) return NextResponse.json({ success: false, message: "Session expired." }, { status: 404 });
    // Rollup decision.
    const flags: string[] = [];
    if ((s.idQualityScore ?? 0) < 70) flags.push("low-id-quality");
    if (s.livenessPassed === false) flags.push("liveness-failed");
    if ((s.faceMatchScore ?? 0) < 70) flags.push("face-mismatch");
    if (s.iprsMatched === false) flags.push("iprs-unmatched");
    const faceReview = (s.faceMatchScore ?? 0) >= 70 && (s.faceMatchScore ?? 0) < 85;

    const status = flags.length > 0 ? "FAILED" : faceReview ? "PENDING_REVIEW" : "VERIFIED";
    const updated = await prisma.kycSession.update({
      where: { id: s.id },
      data: { status, riskFlags: flags as unknown as Prisma.InputJsonValue, completedAt: new Date() },
    });
    return NextResponse.json({ success: true, sessionId: s.id, mode, step, status, flags, session: updated });
  }

  return NextResponse.json({ success: false, message: "Unknown step." }, { status: 400 });
}
