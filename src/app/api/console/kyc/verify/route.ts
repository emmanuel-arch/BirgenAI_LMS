// POST /api/console/kyc/verify — verify a customer standing at the counter.
//
// Body: { borrowerId, step, sessionId?, payload }
//   step: "id" | "facematch" | "iprs" | "finalize"
//
// THE PIPELINE IS THREE STEPS AND EACH ONE ANSWERS A DIFFERENT QUESTION:
//
//   "id"        Read the card (Google Vision) AND look the number up in the national
//               registry (IPRS) — then CHECK THE NAME ON THE CARD IS THE NAME THE
//               REGISTRY HOLDS FOR THAT NUMBER. This is the fraud gate. A borrowed
//               or altered ID dies here, before a photograph is ever taken, and the
//               step will not advance without it.
//   "facematch" One selfie, compared by AWS Rekognition against the portrait printed
//               on the document we just stored. (Liveness challenges are gone — see
//               src/lib/kyc/provider.ts for why they were theatre.)
//   "iprs"      Show the officer the government record the gate already matched. It
//               does NOT re-query: the lookup is billed per call, and asking the
//               same question twice about the same person is just paying twice.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS EXISTS, AND WHY IT IS NOT /api/portal/kyc.
//
// The counter flow used to send the officer to /verify — the BORROWER's portal —
// in a new tab. That page has no session to tell it which lender it is serving, so
// it works out the org from the address bar: the subdomain, or ?lender=. On the
// console's own host (localhost, birgenai.com — both reserved labels) it resolves
// to nothing and falls back to `hub`.
//
// So an officer at Techcrast who verified a customer wrote that customer's KYC
// session, checks and photographs into the HUB org, and at finalize the code went
// looking for a borrower in HUB with that phone number. There wasn't one. The
// verification did not fail to save — it saved into another lender's books, and
// the officer was told "you're verified" while their customer stayed blocked.
//
// A staff member's org is not a guess. It is on their session. This route takes it
// from there and takes the borrower explicitly, so the class of bug cannot recur.
//
// WHAT REPLACES THE OTP. On the portal, an OTP proves the person holds the phone —
// that is what stops someone attaching their own verified face to another person's
// account. Here the officer IS the proof: they are looking at the customer. So the
// binding is asserted by a named member of staff, and that assertion is written to
// the audit log with their id. A machine's word or a human's word — but never
// nobody's.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { prisma } from "@/lib/prisma";
import { resolveScope, canSeeBorrower } from "@/lib/rbac/scope";
import { rateLimit } from "@/lib/ratelimit";
import { requireFeature } from "@/lib/billing/entitlements";
import { meter } from "@/lib/billing/meter";
import {
  kycMode, kycCapabilities, assessIdQuality, performIdOcr, verifyFace, performIprs, portraitIsStandardized,
} from "@/lib/kyc/provider";
import { matchNames, nameGatePasses, identityBinding } from "@/lib/kyc/namematch";
import { putKycObject, getObjectDataUrl, storageMode, InvalidImageError, MAX_IMAGE_BYTES, type KycAssetKind } from "@/lib/storage/provider";
import { attachKycSession } from "@/lib/kyc/attach";

export const runtime = "nodejs";

type Step = "id" | "facematch" | "iprs" | "finalize";

/** base64 inflates by 4/3; leave room for the rest of the JSON envelope. */
const MAX_BODY_BYTES = Math.ceil(MAX_IMAGE_BYTES * 1.4);

export async function POST(req: NextRequest) {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) {
    return NextResponse.json({ success: false, message: "That image is too large — retake it." }, { status: 413 });
  }

  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "kyc.verify");
  if (denied) return denied;

  const orgId = session.user.orgId;
  const staffId = session.user.id;

  let body: {
    borrowerId?: string; step?: Step; sessionId?: string;
    payload?: {
      bytes?: number; brightness?: number; blurVar?: number; image?: string;
      frames?: { challenge?: string; bytes?: number; image?: string }[];
    };
  };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const borrowerId = (body.borrowerId ?? "").trim();
  if (!borrowerId) return NextResponse.json({ success: false, message: "Which customer?" }, { status: 400 });

  // An officer may only verify a customer they can actually see. Without this, the
  // borrowerId in the body is an open door into every book in the org.
  const scope = await resolveScope(session);
  if (!(await canSeeBorrower(scope, borrowerId))) {
    return NextResponse.json({ success: false, message: "That customer isn't on your book." }, { status: 404 });
  }

  const borrower = await prisma.borrower.findFirst({
    where: { id: borrowerId, orgId },
    select: { id: true, firstName: true, otherName: true, phone: true, nationalId: true },
  });
  if (!borrower) return NextResponse.json({ success: false, message: "Customer not found." }, { status: 404 });

  const limited = await rateLimit([
    { name: "kycverify:staff", subject: staffId, max: 300, windowSec: 3600 },
    { name: "kycverify:borrower", subject: `${orgId}:${borrowerId}`, max: 60, windowSec: 3600 },
  ]);
  if (limited) return limited;

  // The licensed identity provider bills the lender's plan, at the counter exactly
  // as it does on the phone.
  const gated = await requireFeature(orgId, "id-verify");
  if (gated) return gated;

  // A demo click must never cost a billed registry lookup or a Rekognition call.
  const demoOrg = await prisma.org.findUnique({ where: { id: orgId }, select: { isDemo: true } });
  const sim = { forceSimulation: !!demoOrg?.isDemo };
  const mode = await kycMode(orgId, sim);
  const capabilities = await kycCapabilities(orgId, sim);
  const phone = borrower.phone;
  const nationalId = borrower.nationalId ?? undefined;

  // Resume this borrower's own in-flight session, or open one. Scoped to the org AND
  // the borrower: a session id is a bearer token for an identity record.
  const existing = body.sessionId
    ? await prisma.kycSession.findFirst({ where: { id: body.sessionId, orgId, borrowerId } })
    : null;
  const kycSession = existing ?? await prisma.kycSession.create({
    data: { orgId, borrowerId, phone, nationalId: nationalId || null, provider: mode },
  });

  // Deterministic simulation seed — the same person is the same person every time.
  const seed = `${orgId}:${nationalId?.replace(/\D/g, "") || phone}`;
  const p = body.payload ?? {};
  const bytes = Number(p.bytes) || 0;

  const writeCheck = (
    kind: "ID_QUALITY" | "ID_OCR" | "FACE_MATCH" | "IPRS" | "PORTRAIT_STANDARDIZE",
    passed: boolean | null, score: number | null, payload: unknown,
  ) =>
    prisma.kycCheck.create({
      data: {
        orgId, sessionId: kycSession.id, borrowerId, kind, passed, score, provider: mode,
        payload: payload as Prisma.InputJsonValue,
      },
    }).catch(() => {});

  /** Persist the step's image — only AFTER it passes, so failed retakes leave no PII behind. */
  const store = async (kind: KycAssetKind): Promise<string | null> => {
    if (!p.image) return null;
    return putKycObject(orgId, kycSession.id, kind, p.image);
  };

  const step = body.step;

  try {
    if (step === "id") {
      const quality = assessIdQuality(seed, bytes, { brightness: p.brightness, blurVar: p.blurVar });
      await writeCheck("ID_QUALITY", quality.passed, quality.score, quality);
      if (!quality.passed) {
        return NextResponse.json({ success: true, sessionId: kycSession.id, mode, capabilities, step, quality, retake: true });
      }

      // 1. READ THE CARD.
      const idFrontKey = await store("id-front");
      const ocr = await performIdOcr(seed, nationalId, typeof p.image === "string" ? p.image : null);
      await writeCheck("ID_OCR", true, ocr.confidence, ocr);

      // The number we act on is the one PRINTED ON THE CARD. A number an officer
      // typed is a claim; the card is evidence. Where they disagree, say so.
      const readId = (ocr.idNumber || "").replace(/\D/g, "");
      const typedId = (nationalId || "").replace(/\D/g, "");
      const idMismatch = !!(typedId && readId && typedId !== readId);
      const lookupId = readId || typedId;

      // 2. ASK THE GOVERNMENT WHO THAT NUMBER BELONGS TO.
      const iprs = await performIprs(seed, lookupId, ocr.fullName, session.user.name ?? `staff:${staffId}`, sim);
      await writeCheck("IPRS", iprs.matched, iprs.matched ? 100 : 0, iprs);

      // 3. THE GATE: is the name on the card the name the registry holds for it?
      const name = matchNames(ocr.fullName, iprs.name);
      const registryFound = iprs.matched;
      const docGatePassed = registryFound && nameGatePasses(name.verdict);
      await writeCheck("ID_OCR", docGatePassed, name.score, {
        check: "name-gate", ...name, documentName: ocr.fullName, registryName: iprs.name,
      });

      // ── 4. THE BINDING GATE — the fraud check the old flow was missing. ──────────
      //
      // Steps 1–3 prove the DOCUMENT is internally honest: the name printed on the
      // card is the name the registry holds for the number printed on the card. They
      // prove NOTHING about whether that document is THIS customer's.
      //
      // The hole this closes: an officer opens Julia's record, presents Emmanuel's
      // genuine ID and Emmanuel's genuine face. OCR reads Emmanuel; IPRS confirms
      // Emmanuel for Emmanuel's number; the name-gate passes; the selfie matches
      // Emmanuel's portrait at 100%. Every internal check is green — and a fraudulent
      // "Julia is verified" is written over another human's identity.
      //
      // So the identity the registry just confirmed MUST be the borrower we opened:
      //   (a) if the customer's record already carries a national ID, the card MUST
      //       present that SAME number — a different number is a different person,
      //       full stop (this is the strongest, most objective bind);
      //   (b) otherwise (thin onboarding, no ID on file) the registry's name MUST be
      //       the name on the customer's record.
      const borrowerName = `${borrower.firstName ?? ""} ${borrower.otherName ?? ""}`.trim();
      const borrowerIdDigits = (borrower.nationalId || "").replace(/\D/g, "");
      const recordedNameForBind = iprs.name || ocr.fullName;

      const bind = identityBinding({
        borrowerName, borrowerNationalId: borrowerIdDigits,
        cardNationalId: lookupId, registryName: recordedNameForBind,
      });
      const bindingReason =
        bind.reason === "id-mismatch"
          ? `This ID belongs to a different person than the customer on this record. ` +
            `The card presents ID ${lookupId}${recordedNameForBind ? ` (${recordedNameForBind})` : ""}, ` +
            `but ${borrowerName || "this customer"}'s record is ID ${borrowerIdDigits}. ` +
            `You cannot verify one customer with another person's ID.`
          : bind.reason === "name-mismatch"
            ? `This ID is registered to ${recordedNameForBind || "someone else"}, which does not match ` +
              `the customer on this record (${borrowerName}). Verify the person whose account this is.`
            : undefined;
      await writeCheck("ID_OCR", bind.passed, matchNames(borrowerName, recordedNameForBind).score, {
        check: "borrower-binding",
        borrowerName, borrowerId: borrowerIdDigits, cardId: lookupId,
        idBinds: bind.idBinds, identityVerdict: bind.nameVerdict, registryName: recordedNameForBind,
      });

      const gatePassed = docGatePassed && bind.passed;

      await prisma.kycSession.update({
        where: { id: kycSession.id },
        data: {
          idQualityScore: quality.score, idOcrName: ocr.fullName, idOcrNumber: ocr.idNumber, idOcrDob: ocr.dob,
          iprsMatched: iprs.matched, iprsName: iprs.name,
          ...(lookupId ? { nationalId: lookupId } : {}),
          ...(idFrontKey ? { idFrontKey } : {}),
        },
      }).catch(() => {});

      return NextResponse.json({
        success: true, sessionId: kycSession.id, mode, capabilities, step,
        quality, ocr, iprs, name, idMismatch, registryFound,
        // The three-way identity picture the officer sees on screen: the name read
        // off the card, the name the registry returned, and the customer we opened.
        binding: {
          borrowerName, borrowerId: borrowerIdDigits, cardId: lookupId,
          idBinds: bind.idBinds, identityVerdict: bind.nameVerdict, passed: bind.passed,
        },
        // A failed gate does NOT advance — whether the document lied or the document
        // belongs to someone other than this customer. The officer sees which.
        gatePassed,
        blocked: !gatePassed,
        message: bindingReason
          ? bindingReason
          : !registryFound
          ? (iprs.note || "The national registry has no record of that ID number.")
          : docGatePassed ? undefined : name.summary,
      });
    }

    if (step === "facematch") {
      // THE SOURCE FACE COMES FROM THE BUCKET, NOT FROM THE BROWSER. If the client
      // supplied both images, a forged client could send the same selfie twice and
      // match itself at 100%. The portrait we compare against is the one WE stored
      // and OCR'd in step 1.
      const fresh = await prisma.kycSession.findUnique({
        where: { id: kycSession.id },
        select: { idFrontKey: true },
      });
      const idImage = fresh?.idFrontKey ? await getObjectDataUrl(fresh.idFrontKey) : null;
      const selfie = typeof p.image === "string" ? p.image : null;

      const fm = await verifyFace(seed, idImage, selfie, sim);
      await writeCheck("FACE_MATCH", fm.passed, fm.score, fm);

      // A bad CAPTURE is a retake, not a verdict on the person — and stores nothing.
      const retake = !fm.passed && (!!fm.noFaceInSource || (!!fm.capture && !fm.capture.passed));
      if (retake) {
        return NextResponse.json({
          success: true, sessionId: kycSession.id, mode, capabilities, step,
          faceMatch: fm, retake: true, message: fm.summary,
        });
      }

      const selfieKey = await store("selfie");
      const portraitKey = await store("portrait");
      const standardized = portraitIsStandardized(mode);
      await writeCheck("PORTRAIT_STANDARDIZE", true, null, { portraitKey, whiteBackground: standardized, stored: storageMode() });
      await prisma.kycSession.update({
        where: { id: kycSession.id },
        data: {
          faceMatchScore: fm.score,
          // The face step IS the liveness signal now: Rekognition's face detection
          // (one face, front-on, eyes open, not a photo of a photo) ran inside it.
          livenessPassed: fm.capture ? fm.capture.passed : fm.passed,
          livenessScore: fm.score,
          ...(selfieKey ? { selfieKey } : {}),
          ...(portraitKey ? { portraitKey } : {}),
        },
      });
      return NextResponse.json({
        success: true, sessionId: kycSession.id, mode, capabilities, step,
        faceMatch: fm, standardized, message: fm.summary,
      });
    }

    if (step === "iprs") {
      // The registry already answered, at the gate in step 1. Asking again would bill
      // the lender a second time for the same question about the same person.
      const held = await prisma.kycSession.findUnique({
        where: { id: kycSession.id },
        select: { iprsMatched: true, iprsName: true, idOcrDob: true },
      });
      const iprs = {
        matched: held?.iprsMatched === true,
        name: held?.iprsName ?? null,
        dob: held?.idOcrDob ?? null,
        gender: null as string | null,
        note: held?.iprsMatched
          ? `Confirmed against the national registry${capabilities.registry === "live" ? " (IPRS · live)" : " (simulated)"}.`
          : "No matching record in the national registry.",
      };
      return NextResponse.json({ success: true, sessionId: kycSession.id, mode, capabilities, step, iprs });
    }
  } catch (err) {
    if (err instanceof InvalidImageError) {
      return NextResponse.json({ success: true, sessionId: kycSession.id, mode, step, retake: true, message: err.message });
    }
    console.error("[kyc:console] step failed:", err);
    return NextResponse.json({ success: false, message: "That step could not be completed. Please try again." }, { status: 500 });
  }

  if (step === "finalize") {
    const s = await prisma.kycSession.findUnique({ where: { id: kycSession.id } });
    if (!s) return NextResponse.json({ success: false, message: "Session expired." }, { status: 404 });

    // Rekognition's bands (rekognition.ts): >=92 match, 80-91 human review, <80 refused.
    // A registry that never matched is fatal on its own — an identity the government
    // does not recognise is not an identity, however good the photograph is.
    const flags: string[] = [];
    if ((s.idQualityScore ?? 0) < 70) flags.push("low-id-quality");
    if ((s.faceMatchScore ?? 0) < 80) flags.push("face-mismatch");
    if (s.iprsMatched !== true) flags.push("iprs-unmatched");

    // DEFENCE IN DEPTH — the binding gate, re-enforced from stored state. The id
    // step blocks a mis-bound identity in its RESPONSE, but that is client-side; a
    // crafted client could ignore it and post facematch+finalize directly. So the
    // bind is checked again here, off the session we actually stored: the ID we
    // acted on (session.nationalId = the number read off the card) and the registry
    // name must both belong to the borrower we opened. Same rule, second lock.
    const finalBind = identityBinding({
      borrowerName: `${borrower.firstName ?? ""} ${borrower.otherName ?? ""}`.trim(),
      borrowerNationalId: borrower.nationalId || "",
      cardNationalId: s.nationalId || "",
      registryName: s.iprsName,
    });
    if (!finalBind.passed) flags.push("identity-unbound");

    const faceReview = (s.faceMatchScore ?? 0) >= 80 && (s.faceMatchScore ?? 0) < 92;
    const status = flags.length > 0 ? "FAILED" : faceReview ? "PENDING_REVIEW" : "VERIFIED";

    await prisma.kycSession.update({
      where: { id: s.id },
      data: { status, riskFlags: flags as unknown as Prisma.InputJsonValue, completedAt: new Date() },
    });

    // One completed session = one verification, however many retakes it took.
    void meter(orgId, "kyc", 1, { sessionId: s.id, status, mode, channel: "counter" });

    // The borrower is not searched for — they were named at the top of this request.
    // This is the whole difference between this route and the portal one.
    const attached = await attachKycSession(orgId, borrowerId, phone, s.nationalId);

    // The officer's assertion that this face belongs to this customer, on the record.
    await prisma.auditLog.create({
      data: {
        orgId, actorId: staffId, actorType: "staff", action: "kyc.verify.counter",
        meta: { borrowerId, sessionId: s.id, status, flags, mode, witnessed: true },
        ip: req.headers.get("x-forwarded-for"),
      },
    }).catch(() => {});

    const name = `${borrower.firstName ?? ""} ${borrower.otherName ?? ""}`.trim() || borrower.phone;
    return NextResponse.json({
      success: true, sessionId: s.id, mode, capabilities, step, status, flags,
      borrower: { id: borrowerId, name },
      // If the promotion onto the Borrower row didn't happen, the officer has NOT
      // cleared the gate — say so rather than showing a green tick over a blocked
      // customer. That is precisely the lie the old flow told.
      attached: attached?.status === status,
    });
  }

  return NextResponse.json({ success: false, message: "Unknown step." }, { status: 400 });
}
