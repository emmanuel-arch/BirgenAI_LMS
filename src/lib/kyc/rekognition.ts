// ─────────────────────────────────────────────────────────────────────────────
// FACE MATCH + LIVENESS via AWS Rekognition.
//
// WHY NOT GOOGLE, when everything else here is Google. Because Google Cloud Vision
// does not compare faces — deliberately. It will OCR a document and DETECT a face
// (present, front-facing, eyes open, blurred, underexposed) but it has no
// face-recognition/comparison endpoint at all; that is a policy decision on
// Google's side, not a gap in our integration. Comparing the selfie to the
// portrait printed on the ID is the entire point of the step, so the step needs a
// provider that can do it. Rekognition's CompareFaces can, for about a dollar per
// thousand.
//
// So the KYC pipeline is deliberately split across two vendors, each doing the one
// thing it is best at:
//   Google Vision  → reads the document (TEXT_DETECTION)
//   IPRS           → confirms the human exists, in the government's own record
//   Rekognition    → confirms the human at the counter is the human on the document
//
// SIMULATION-FIRST, like every other provider here: with no AWS keys, `faceMode()`
// is "simulation" and callers fall back to the seeded simulator. Nothing silently
// half-works.
//
// Implemented over the REST API with hand-rolled SigV4 rather than @aws-sdk/*,
// which is a very large dependency to carry for two calls — the same judgement the
// storage layer made about @supabase/supabase-js.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash, createHmac } from "node:crypto";

export type FaceMode = "live" | "simulation";

const REGION = () => process.env.AWS_REGION?.trim() || "eu-west-1";
const SERVICE = "rekognition";

function creds(): { id: string; secret: string } | null {
  const id = process.env.AWS_ACCESS_KEY_ID?.trim();
  const secret = process.env.AWS_SECRET_ACCESS_KEY?.trim();
  return id && secret ? { id, secret } : null;
}

export function faceMode(): FaceMode {
  return creds() ? "live" : "simulation";
}

// ── SigV4 ─────────────────────────────────────────────────────────────────────

const sha256 = (s: Buffer | string) => createHash("sha256").update(s).digest("hex");
const hmac = (key: Buffer | string, s: string) => createHmac("sha256", key).update(s).digest();

/** Sign and send one Rekognition action. Throws on a non-2xx so callers can fall back. */
async function callRekognition(action: string, body: unknown): Promise<unknown> {
  const c = creds();
  if (!c) throw new Error("AWS credentials are not configured.");

  const region = REGION();
  const host = `${SERVICE}.${region}.amazonaws.com`;
  const payload = JSON.stringify(body);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // 20260714T101530Z
  const dateStamp = amzDate.slice(0, 8);
  const target = `RekognitionService.${action}`;

  // Canonical request. The signed-header list and the canonical headers must agree
  // exactly — a mismatch is the classic SigV4 403 and says nothing useful.
  const signedHeaders = "content-type;host;x-amz-date;x-amz-target";
  const canonicalHeaders =
    `content-type:application/x-amz-json-1.1\n` +
    `host:${host}\n` +
    `x-amz-date:${amzDate}\n` +
    `x-amz-target:${target}\n`;
  const canonicalRequest = ["POST", "/", "", canonicalHeaders, signedHeaders, sha256(payload)].join("\n");

  const scope = `${dateStamp}/${region}/${SERVICE}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");

  const kDate = hmac(`AWS4${c.secret}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, SERVICE);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(toSign).digest("hex");

  const res = await fetch(`https://${host}/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Date": amzDate,
      "X-Amz-Target": target,
      Authorization:
        `AWS4-HMAC-SHA256 Credential=${c.id}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body: payload,
    signal: AbortSignal.timeout(15_000),
  });

  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 200);
    try { msg = (JSON.parse(text) as { message?: string; __type?: string }).message ?? msg; } catch { /* raw */ }
    throw new Error(`Rekognition ${action} failed (${res.status}): ${msg}`);
  }
  return JSON.parse(text);
}

const bytesOf = (dataUrl: string) => dataUrl.replace(/^data:image\/\w+;base64,/, "");

// ── Face detection: is this a usable photograph of a real, present face? ──────

export type FaceQuality = {
  faces: number;
  /** 0..100 — Rekognition's own confidence that this is a face at all. */
  confidence: number;
  /** Fails the capture, not the person: no face, several faces, eyes shut, too blurred. */
  issues: string[];
  passed: boolean;
};

export async function detectFace(imageDataUrl: string): Promise<FaceQuality | null> {
  try {
    const out = (await callRekognition("DetectFaces", {
      Image: { Bytes: bytesOf(imageDataUrl) },
      Attributes: ["DEFAULT"],
    })) as {
      FaceDetails?: {
        Confidence?: number;
        EyesOpen?: { Value?: boolean; Confidence?: number };
        Quality?: { Brightness?: number; Sharpness?: number };
        Pose?: { Yaw?: number; Pitch?: number };
      }[];
    };

    const details = out.FaceDetails ?? [];
    const issues: string[] = [];

    if (details.length === 0) {
      return { faces: 0, confidence: 0, issues: ["no-face"], passed: false };
    }
    // Two faces in a KYC selfie means somebody is holding up a photograph, or a
    // second person is in frame. Either way it is not a clean capture.
    if (details.length > 1) issues.push("multiple-faces");

    const f = details[0];
    const confidence = Math.round(f.Confidence ?? 0);
    if (f.EyesOpen?.Value === false && (f.EyesOpen.Confidence ?? 0) > 80) issues.push("eyes-closed");
    if ((f.Quality?.Sharpness ?? 100) < 20) issues.push("blurred");
    if ((f.Quality?.Brightness ?? 50) < 20) issues.push("too-dark");
    if (Math.abs(f.Pose?.Yaw ?? 0) > 35 || Math.abs(f.Pose?.Pitch ?? 0) > 35) issues.push("not-facing-camera");

    return { faces: details.length, confidence, issues, passed: issues.length === 0 && confidence >= 90 };
  } catch {
    return null; // caller falls back
  }
}

// ── Face comparison: is the person at the counter the person on the card? ────

export type FaceCompare = {
  /** 0..100 similarity. */
  score: number;
  band: "match" | "review" | "no-match";
  passed: boolean;
  /** True when the ID portrait itself had no detectable face — a bad ID capture, not a mismatch. */
  noFaceInSource?: boolean;
};

/**
 * THE BANDS ARE THE POLICY, and they are set where a human takes over rather than
 * where the vendor's default sits:
 *   ≥ 92  match     — proceed
 *   80–91 review    — a person looks at it (PENDING_REVIEW), never an auto-pass
 *   < 80  no-match  — refused
 *
 * We ask Rekognition for a 0% threshold and band it OURSELVES, because a provider
 * that returns "no match" and a provider that returns "match at 61%" are telling us
 * very different things and only one of them is worth a human's time.
 */
export async function compareFaces(idPortraitDataUrl: string, selfieDataUrl: string): Promise<FaceCompare | null> {
  try {
    const out = (await callRekognition("CompareFaces", {
      SourceImage: { Bytes: bytesOf(idPortraitDataUrl) }, // the face ON the document
      TargetImage: { Bytes: bytesOf(selfieDataUrl) },     // the face AT the counter
      SimilarityThreshold: 0,
      QualityFilter: "AUTO",
    })) as {
      FaceMatches?: { Similarity?: number }[];
      UnmatchedFaces?: unknown[];
      SourceImageFace?: { Confidence?: number };
    };

    const best = Math.max(0, ...(out.FaceMatches ?? []).map((m) => m.Similarity ?? 0));
    const score = Math.round(best);
    const band = score >= 92 ? "match" : score >= 80 ? "review" : "no-match";
    return { score, band, passed: band !== "no-match" };
  } catch (err) {
    // Rekognition raises this when the SOURCE image has no face — which means the
    // ID photograph was captured badly, and telling the customer "your face does
    // not match" would be both wrong and insulting.
    if (err instanceof Error && /InvalidParameterException|no faces in the image/i.test(err.message)) {
      return { score: 0, band: "no-match", passed: false, noFaceInSource: true };
    }
    return null; // caller falls back
  }
}
