// POST /api/portal/kyc — run one step of the elite KYC pipeline (borrower-facing).
// Body: { lenderSlug, nationalId?, step, sessionId?, payload }
//   step: "id" | "liveness" | "facematch" | "iprs" | "finalize"
// The wizard drives these in order; each returns the step result + updated
// session so the UI can render confidence rings and gates live. Every step is
// also written as a KycCheck (the audit + ML feature trail).
//
// REQUIRES a verified borrower session. A KYC session is the record that says
// "this face, this ID and this phone are one person", and it is later promoted
// onto a Borrower row. Letting the caller name the phone would let them attach
// their own verified identity to someone else's number.
//
// The captured images are uploaded to a PRIVATE bucket and only their keys are
// stored. They are written only once a step passes its quality gate: a rejected,
// blurry photo of someone's national ID is PII we gain nothing by keeping.
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveOrg } from "@/lib/tenancy";
import { enterOrg } from "@/lib/db/context";
import { borrowerFor, otpRequired } from "@/lib/portal/session";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { requireFeature } from "@/lib/billing/entitlements";
import { meter } from "@/lib/billing/meter";
import {
  kycMode, kycCapabilities, assessIdQuality, performIdOcr, verifyFace, performIprs, portraitIsStandardized,
} from "@/lib/kyc/provider";
import { matchNames, nameGatePasses } from "@/lib/kyc/namematch";
import { putKycObject, getObjectDataUrl, storageMode, InvalidImageError, MAX_IMAGE_BYTES, type KycAssetKind } from "@/lib/storage/provider";
import { attachKycSession } from "@/lib/kyc/attach";

export const runtime = "nodejs";

type Step = "id" | "facematch" | "iprs" | "finalize";

/**
 * Resume the caller's own KYC session, or start one. Scoped to the verified
 * phone as well as the org: a session id is a bearer token for an identity
 * record, and resuming someone else's would let you finish their verification.
 */
async function getSession(orgId: string, sessionId: string | undefined, phone: string, nationalId: string | undefined, provider: string) {
  if (sessionId) {
    const s = await prisma.kycSession.findFirst({ where: { id: sessionId, orgId, phone } });
    if (s) return s;
  }
  return prisma.kycSession.create({
    data: { orgId, phone, nationalId: nationalId || null, provider },
  });
}

/** base64 inflates by 4/3; leave room for the rest of the JSON envelope. */
const MAX_BODY_BYTES = Math.ceil(MAX_IMAGE_BYTES * 1.4);

export async function POST(req: NextRequest) {
  // Reject an oversized body before req.json() buffers the whole thing.
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) {
    return NextResponse.json({ success: false, message: "That image is too large — retake it." }, { status: 413 });
  }

  let body: {
    lenderSlug?: string; nationalId?: string; step?: Step; sessionId?: string;
    /** `image` is a base64 data URL from the camera/upload surface. */
    payload?: {
      bytes?: number; brightness?: number; blurVar?: number; image?: string;
      /** Active liveness: one frame per issued challenge, in order. */
      frames?: { challenge?: string; bytes?: number; image?: string }[];
    };
  };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const org = await resolveOrg(body.lenderSlug ?? "");
  // Bind the RLS tenant in OUR async context (enterWith does not escape a callee).
  if (org) enterOrg(org.id);
  if (!org) return NextResponse.json({ success: false, message: "Choose a lender." }, { status: 400 });

  const verified = await borrowerFor(org.id);
  if (!verified) return otpRequired();
  const phone = verified.phone;

  // Each step is a provider call the lender pays for once Smile ID is live.
  // Generous enough for a borrower who has to retake a blurry ID a few times.
  const limited = await rateLimit([
    { name: "kyc:phone", subject: `${org.id}:${phone}`, max: 40, windowSec: 3600 },
    { name: "kyc:ip", subject: clientIp(req), max: 120, windowSec: 3600 },
  ]);
  if (limited) return limited;

  // The licensed identity provider bills the lender's plan. A lender who has not
  // bought the ID Verifier still gets the funnel — just without this step.
  const gated = await requireFeature(org.id, "id-verify");
  if (gated) return gated;

  // A demo click must never cost a billed registry lookup or a Rekognition call.
  const sim = { forceSimulation: !!org.isDemo };
  const mode = await kycMode(org.id, sim);
  const capabilities = await kycCapabilities(org.id, sim);
  const session = await getSession(org.id, body.sessionId, phone, body.nationalId, mode);
  // Seed the deterministic simulation off ID (or phone) so a person is consistent.
  const seed = `${org.id}:${body.nationalId?.replace(/\D/g, "") || phone}`;
  const bytes = Number(body.payload?.bytes) || 0;
  const p = body.payload ?? {};

  const writeCheck = (kind: "ID_QUALITY" | "ID_OCR" | "FACE_MATCH" | "IPRS" | "PORTRAIT_STANDARDIZE", passed: boolean | null, score: number | null, payload: unknown) =>
    prisma.kycCheck.create({
      data: {
        orgId: org.id, sessionId: session.id, kind, passed, score, provider: mode,
        payload: payload as Prisma.InputJsonValue,
      },
    }).catch(() => {});

  /**
   * Persist the step's image to the private bucket. Called only AFTER the step
   * passes, so failed retakes leave no trace. Returns null when the client sent
   * nothing (older clients, or a browser that could not read the camera).
   */
  const store = async (kind: KycAssetKind): Promise<string | null> => {
    if (!p.image) return null;
    return putKycObject(org.id, session.id, kind, p.image);
  };

  const step = body.step;

  try {
    if (step === "id") {
      const quality = assessIdQuality(seed, bytes, { brightness: p.brightness, blurVar: p.blurVar });
      await writeCheck("ID_QUALITY", quality.passed, quality.score, quality);
      if (!quality.passed) {
        return NextResponse.json({ success: true, sessionId: session.id, mode, capabilities, step, quality, retake: true });
      }

      // 1. READ THE CARD (Google Vision).
      const idFrontKey = await store("id-front");
      const ocr = await performIdOcr(seed, body.nationalId, typeof p.image === "string" ? p.image : null);
      await writeCheck("ID_OCR", true, ocr.confidence, ocr);

      const readId = (ocr.idNumber || "").replace(/\D/g, "");
      const typedId = (body.nationalId || "").replace(/\D/g, "");
      const idMismatch = !!(typedId && readId && typedId !== readId);
      const lookupId = readId || typedId;

      // 2. ASK THE NATIONAL REGISTRY WHO THAT NUMBER BELONGS TO.
      // On the portal the CUSTOMER gives consent themselves, in the funnel.
      const iprs = await performIprs(seed, lookupId, ocr.fullName, `portal:${org.slug}`, sim);
      await writeCheck("IPRS", iprs.matched, iprs.matched ? 100 : 0, iprs);

      // 3. THE GATE: the name on the card must be the name the registry holds.
      const name = matchNames(ocr.fullName, iprs.name);
      const registryFound = iprs.matched;
      const gatePassed = registryFound && nameGatePasses(name.verdict);
      await writeCheck("ID_OCR", gatePassed, name.score, {
        check: "name-gate", ...name, documentName: ocr.fullName, registryName: iprs.name,
      });

      await prisma.kycSession.update({
        where: { id: session.id },
        data: {
          idQualityScore: quality.score, idOcrName: ocr.fullName, idOcrNumber: ocr.idNumber, idOcrDob: ocr.dob,
          iprsMatched: iprs.matched, iprsName: iprs.name,
          ...(lookupId ? { nationalId: lookupId } : {}),
          ...(idFrontKey ? { idFrontKey } : {}),
        },
      }).catch(() => {});

      return NextResponse.json({
        success: true, sessionId: session.id, mode, capabilities, step,
        quality, ocr, iprs, name, idMismatch, registryFound,
        gatePassed,
        blocked: !gatePassed,
        message: !registryFound
          ? (iprs.note || "We could not find that ID number in the national registry.")
          : gatePassed ? undefined : name.summary,
      });
    }

    if (step === "facematch") {
      // The source face is read back from OUR bucket, never taken from the browser —
      // a forged client could otherwise send the selfie as both images and match itself.
      const fresh = await prisma.kycSession.findUnique({
        where: { id: session.id },
        select: { idFrontKey: true },
      });
      const idImage = fresh?.idFrontKey ? await getObjectDataUrl(fresh.idFrontKey) : null;
      const selfie = typeof p.image === "string" ? p.image : null;

      const fm = await verifyFace(seed, idImage, selfie, sim);
      await writeCheck("FACE_MATCH", fm.passed, fm.score, fm);

      const retake = !fm.passed && (!!fm.noFaceInSource || (!!fm.capture && !fm.capture.passed));
      if (retake) {
        return NextResponse.json({
          success: true, sessionId: session.id, mode, capabilities, step,
          faceMatch: fm, retake: true, message: fm.summary,
        });
      }

      const selfieKey = await store("selfie");
      const portraitKey = await store("portrait");
      const standardized = portraitIsStandardized(mode);
      await writeCheck("PORTRAIT_STANDARDIZE", true, null, { portraitKey, whiteBackground: standardized, stored: storageMode() });
      await prisma.kycSession.update({
        where: { id: session.id },
        data: {
          faceMatchScore: fm.score,
          livenessPassed: fm.capture ? fm.capture.passed : fm.passed,
          livenessScore: fm.score,
          ...(selfieKey ? { selfieKey } : {}),
          ...(portraitKey ? { portraitKey } : {}),
        },
      });
      return NextResponse.json({
        success: true, sessionId: session.id, mode, capabilities, step,
        faceMatch: fm, standardized, message: fm.summary,
      });
    }

    if (step === "iprs") {
      // Already answered at the gate in step 1 — a second lookup is a second bill.
      const held = await prisma.kycSession.findUnique({
        where: { id: session.id },
        select: { iprsMatched: true, iprsName: true, idOcrDob: true },
      });
      const iprs = {
        matched: held?.iprsMatched === true,
        name: held?.iprsName ?? null,
        dob: held?.idOcrDob ?? null,
        gender: null as string | null,
        note: held?.iprsMatched
          ? `Confirmed against the national registry${capabilities.registry === "live" ? " (IPRS)" : " (simulated)"}.`
          : "No matching record in the national registry.",
      };
      return NextResponse.json({ success: true, sessionId: session.id, mode, capabilities, step, iprs });
    }
  } catch (err) {
    if (err instanceof InvalidImageError) {
      return NextResponse.json({ success: true, sessionId: session.id, mode, step, retake: true, message: err.message });
    }
    console.error("[kyc] step failed:", err);
    return NextResponse.json({ success: false, message: "That step could not be completed. Please try again." }, { status: 500 });
  }

  if (step === "finalize") {
    const s = await prisma.kycSession.findUnique({ where: { id: session.id } });
    if (!s) return NextResponse.json({ success: false, message: "Session expired." }, { status: 404 });
    // Rollup decision.
    const flags: string[] = [];
    if ((s.idQualityScore ?? 0) < 70) flags.push("low-id-quality");
    if ((s.faceMatchScore ?? 0) < 80) flags.push("face-mismatch");
    if (s.iprsMatched !== true) flags.push("iprs-unmatched");
    const faceReview = (s.faceMatchScore ?? 0) >= 80 && (s.faceMatchScore ?? 0) < 92;

    const status = flags.length > 0 ? "FAILED" : faceReview ? "PENDING_REVIEW" : "VERIFIED";
    const updated = await prisma.kycSession.update({
      where: { id: s.id },
      data: { status, riskFlags: flags as unknown as Prisma.InputJsonValue, completedAt: new Date() },
    });

    // One completed session = one identity verification, however many retakes it
    // took. Charging per capture would bill a lender for their borrower's bad light.
    void meter(org.id, "kyc", 1, { sessionId: s.id, status, mode });

    // A returning borrower already has a record — promote the fresh KYC result
    // onto it right away. New applicants get linked at apply-time instead.
    const last9 = phone.slice(-9);
    const existing = last9.length === 9
      ? await prisma.borrower.findFirst({ where: { orgId: org.id, phone: { endsWith: last9 } }, select: { id: true } })
      : null;
    if (existing) {
      try { await attachKycSession(org.id, existing.id, phone, s.nationalId); }
      catch (err) { console.error("[kyc] attach failed:", err); }
    }

    return NextResponse.json({ success: true, sessionId: s.id, mode, step, status, flags, session: updated });
  }

  return NextResponse.json({ success: false, message: "Unknown step." }, { status: 400 });
}
