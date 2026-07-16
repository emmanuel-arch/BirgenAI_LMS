// ─────────────────────────────────────────────────────────────────────────────
// KYC provider — the identity engine. THREE VENDORS, THREE JOBS, NO SMILE ID.
//
//   1. THE DOCUMENT     Google Cloud Vision reads the ID front (TEXT_DETECTION).
//   2. THE HUMAN EXISTS IPRS confirms that ID number against the national registry,
//                       and THE NAME ON THE CARD MUST BE THE NAME IN THE REGISTRY
//                       (src/lib/kyc/namematch.ts). This is the fraud gate, and it
//                       is where a borrowed or altered ID dies.
//   3. THE HUMAN IS THEM AWS Rekognition compares the selfie to the portrait on the
//                       document. (Vision cannot do this — Google has no face
//                       comparison endpoint, by policy. See rekognition.ts.)
//
// Smile ID is GONE. It was one vendor billed for all three legs, and we now do each
// leg with the provider that is actually best at it — cheaper, and each answer is
// legible rather than a single opaque "verified: true".
//
// LIVENESS IS GONE TOO, deliberately. A blink-and-smile challenge is theatre against
// a printed photo held up to a webcam, and it cost the customer thirty seconds. The
// real anti-spoof signal is Rekognition's face DETECTION on the selfie (is this one
// face, front-on, eyes open, not a photo of a photo) folded into the face-match step.
//
// SIMULATION-FIRST is unchanged, and is per-leg: each vendor that has no credential
// falls back to a deterministic, seeded simulation, and every KycCheck records WHICH
// engine answered — so a session can always say whether it was verified by a
// government registry or by a random number generator.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from "crypto";

export type KycMode = "simulation" | "live";

/** Deterministic 0..1 from a seed — stable per (person, facet). */
function seeded(seed: string, facet: string): number {
  const h = createHash("sha256").update(`${seed}:${facet}`).digest();
  // First 4 bytes → [0,1)
  return (((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0) / 0xffffffff;
}

/**
 * What the pipeline can actually do right now, leg by leg. The console shows this
 * verbatim rather than a single "DEMO MODE" badge, because "the registry is live
 * but face matching is not" is a true and useful thing to know, and a single flag
 * cannot say it.
 */
export type KycCapabilities = {
  ocr: "live" | "simulation";
  registry: "live" | "simulation";
  face: "live" | "simulation";
};

export async function kycCapabilities(orgId: string, opts?: { forceSimulation?: boolean }): Promise<KycCapabilities> {
  if (opts?.forceSimulation) return { ocr: "simulation", registry: "simulation", face: "simulation" };
  const [{ ocrMode }, { iprsMode }, { faceMode }] = await Promise.all([
    import("./vision"),
    import("./iprs"),
    import("./rekognition"),
  ]);
  return { ocr: ocrMode(), registry: iprsMode(), face: faceMode() };
}

/**
 * The headline mode. LIVE only when the identity is settled against real sources —
 * the document is genuinely read and the human is genuinely confirmed to exist.
 * Face matching is a strengthener, not the thing that makes an identity real, so it
 * does not veto the badge; `kycCapabilities()` is what tells the whole truth.
 */
export async function kycMode(orgId: string, opts?: { forceSimulation?: boolean }): Promise<KycMode> {
  const cap = await kycCapabilities(orgId, opts);
  return cap.ocr === "live" && cap.registry === "live" ? "live" : "simulation";
}

// ── Types ─────────────────────────────────────────────────────────────────────
export type IdQualityResult = {
  score: number; // 0..100
  passed: boolean;
  issues: string[]; // e.g. ["glare-detected"]
};
export type IdOcrResult = {
  fullName: string | null;
  idNumber: string | null;
  dob: string | null; // YYYY-MM-DD
  serial: string | null;
  confidence: number; // 0..100
};
export type LivenessResult = { score: number; passed: boolean; challenge: string };
export type FaceMatchResult = { score: number; passed: boolean; band: "match" | "review" | "no-match" };
export type IprsResult = { matched: boolean; name: string | null; dob: string | null; gender: string | null; note: string };

// Kenyan-name pools for believable simulated OCR/IPRS output.
const FIRST = ["Wanjiku", "Otieno", "Kamau", "Achieng", "Mwangi", "Njeri", "Kiplagat", "Adhiambo", "Mutua", "Chebet", "Omondi", "Wairimu"];
const LAST = ["Kariuki", "Ochieng", "Njoroge", "Wafula", "Chelimo", "Barasa", "Mbugua", "Owino", "Kimani", "Ruto", "Auma", "Gitau"];

function nameFor(seed: string): string {
  const f = FIRST[Math.floor(seeded(seed, "first") * FIRST.length)];
  const l = LAST[Math.floor(seeded(seed, "last") * LAST.length)];
  return `${f} ${l}`;
}

// ── ID image quality ──────────────────────────────────────────────────────────
/**
 * In simulation we derive quality from lightweight image signals the client
 * sends (byteLength as a proxy for resolution + optional client heuristics),
 * plus a seeded jitter — so retakes vary and very small images fail, exactly
 * like a real gate. `signals` are best-effort hints from the browser.
 */
export function assessIdQuality(
  seed: string,
  bytes: number,
  signals?: { brightness?: number; blurVar?: number },
): IdQualityResult {
  const issues: string[] = [];
  let score = 78 + Math.round(seeded(seed, "idq") * 18); // 78..96 baseline

  if (bytes < 40_000) { score -= 45; issues.push("resolution-too-low"); }
  else if (bytes < 90_000) { score -= 12; issues.push("low-resolution"); }
  if (signals?.brightness != null) {
    if (signals.brightness > 235) { score -= 30; issues.push("glare-detected"); }
    if (signals.brightness < 40) { score -= 25; issues.push("too-dark"); }
  }
  if (signals?.blurVar != null && signals.blurVar < 80) { score -= 30; issues.push("image-blurry"); }

  score = Math.max(5, Math.min(99, score));
  return { score, passed: score >= 70 && issues.every((i) => i !== "resolution-too-low"), issues };
}

// ── ID OCR ────────────────────────────────────────────────────────────────────

/**
 * The OCR seam. With a Google Cloud Vision key configured (GOOGLE_CLOUD_API_KEY /
 * OCR_API_KEY), the captured ID front is read for REAL and the Kenyan-ID fields
 * parsed out of it; anything less — no key, Vision down, an unreadable card —
 * falls back to the seeded simulation so the pipeline never dies on a vendor.
 * The returned `engine` is recorded on the ID_OCR check, so a session can always
 * say whether its fields came from the document or from the simulator.
 */
export async function performIdOcr(
  seed: string,
  nationalId?: string | null,
  imageDataUrl?: string | null,
): Promise<IdOcrResult & { engine: "google-vision" | "simulation" }> {
  if (imageDataUrl) {
    const { visionIdOcr, ocrMode } = await import("./vision");
    if (ocrMode() === "live") {
      const live = await visionIdOcr(imageDataUrl);
      // A live read that found the essentials wins; a partial read that found
      // NEITHER a name nor an ID number is a failed read, not a worse answer.
      if (live && (live.idNumber || live.fullName)) return { ...live, engine: "google-vision" };
    }
  }
  return { ...extractId(seed, nationalId ?? undefined), engine: "simulation" };
}

export function extractId(seed: string, nationalId?: string): IdOcrResult {
  const id = (nationalId || "").replace(/\D/g, "");
  const year = 1970 + Math.floor(seeded(seed, "yr") * 30);
  const month = 1 + Math.floor(seeded(seed, "mo") * 12);
  const day = 1 + Math.floor(seeded(seed, "dy") * 27);
  return {
    fullName: nameFor(seed),
    idNumber: id || String(20000000 + Math.floor(seeded(seed, "idn") * 9000000)),
    dob: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    serial: String(100000000 + Math.floor(seeded(seed, "srl") * 800000000)),
    confidence: 88 + Math.round(seeded(seed, "ocrc") * 11),
  };
}

// ── Liveness ──────────────────────────────────────────────────────────────────
const CHALLENGES = ["blink twice", "turn your head left", "smile", "look up"];
export function assessLiveness(seed: string, bytes: number): LivenessResult {
  const challenge = CHALLENGES[Math.floor(seeded(seed, "chl") * CHALLENGES.length)];
  let score = 82 + Math.round(seeded(seed, "live") * 16); // 82..98
  if (bytes < 25_000) score -= 40; // a near-empty selfie fails
  score = Math.max(8, Math.min(99, score));
  return { score, passed: score >= 70, challenge };
}

// ── Active liveness (challenge–response) ─────────────────────────────────────
// Passive liveness asks "is this a live face?"; ACTIVE liveness asks the person
// to DO something a photo can't. Challenges derive deterministically from the
// session seed, so the server re-derives what it asked without storing state —
// a client cannot pick its own easier challenges.

export type ActiveLivenessResult = {
  passed: boolean;
  score: number;
  frames: { challenge: string; score: number; passed: boolean }[];
};

export function activeLivenessChallenges(seed: string): string[] {
  const a = Math.floor(seeded(seed, "achl1") * CHALLENGES.length);
  let b = Math.floor(seeded(seed, "achl2") * CHALLENGES.length);
  if (b === a) b = (b + 1) % CHALLENGES.length;
  return [CHALLENGES[a], CHALLENGES[b]];
}

export function assessActiveLiveness(seed: string, frames: { challenge: string; bytes: number }[]): ActiveLivenessResult {
  const expected = activeLivenessChallenges(seed);
  const per = expected.map((challenge, i) => {
    const f = frames[i];
    let score: number;
    if (!f || f.challenge !== challenge) {
      score = 10; // missing, or answering a different challenge than was asked
    } else {
      score = 80 + Math.round(seeded(seed, `alive${i}`) * 18);
      if (f.bytes < 25_000) score -= 45; // a near-empty frame is not a face
    }
    score = Math.max(5, Math.min(99, score));
    return { challenge, score, passed: score >= 70 };
  });
  const score = Math.round(per.reduce((s, p) => s + p.score, 0) / per.length);
  return { passed: per.every((p) => p.passed), score, frames: per };
}

// ── Face match (the portrait ON the ID vs the selfie AT the counter) ──────────

export type FaceVerification = FaceMatchResult & {
  engine: "aws-rekognition" | "simulation";
  /** Capture quality of the selfie, from Rekognition's face detection. */
  capture?: { faces: number; issues: string[]; passed: boolean };
  /** The ID photograph had no readable face — a bad capture, NOT a mismatch. */
  noFaceInSource?: boolean;
  /** One sentence for the officer. */
  summary: string;
};

/**
 * The face seam.
 *
 * Two Rekognition calls, in this order and for a reason:
 *   1. DetectFaces on the SELFIE — is this even a usable photograph of one live,
 *      front-facing human? A second face in frame, closed eyes or a heavy blur is a
 *      RETAKE, and it must be caught before we accuse anyone of anything.
 *   2. CompareFaces(ID portrait → selfie) — the actual question.
 *
 * The order matters because the failure messages are completely different. "Your
 * face does not match your ID" is an accusation; "we could not see your face, try
 * again facing the window" is an instruction. Getting those two the wrong way round
 * at a counter, in front of a customer, is the kind of thing people remember.
 */
export async function verifyFace(
  seed: string,
  idImageDataUrl?: string | null,
  selfieDataUrl?: string | null,
  opts?: { forceSimulation?: boolean },
): Promise<FaceVerification> {
  const { faceMode, detectFace, compareFaces } = await import("./rekognition");

  if (!opts?.forceSimulation && faceMode() === "live" && idImageDataUrl && selfieDataUrl) {
    const capture = await detectFace(selfieDataUrl);

    if (capture && !capture.passed) {
      return {
        score: 0, passed: false, band: "no-match", engine: "aws-rekognition",
        capture: { faces: capture.faces, issues: capture.issues, passed: false },
        summary: captureAdvice(capture.issues),
      };
    }

    const cmp = await compareFaces(idImageDataUrl, selfieDataUrl);
    if (cmp) {
      if (cmp.noFaceInSource) {
        return {
          score: 0, passed: false, band: "no-match", engine: "aws-rekognition", noFaceInSource: true,
          summary: "No face could be found on the ID photograph itself — retake the ID, straight on and without glare. This is not a mismatch.",
        };
      }
      return {
        score: cmp.score,
        passed: cmp.passed,
        band: cmp.band,
        engine: "aws-rekognition",
        capture: capture ? { faces: capture.faces, issues: capture.issues, passed: capture.passed } : undefined,
        summary:
          cmp.band === "match"
            ? `The face at the counter is the face on the ID (${cmp.score}% similar).`
            : cmp.band === "review"
              ? `A partial face match (${cmp.score}%). Close, but not close enough to pass on its own — a supervisor should look.`
              : `The face does not match the portrait on the ID (${cmp.score}% similar).`,
      };
    }
    // Rekognition unreachable — fall through to the simulation rather than sink a
    // verification on a vendor outage. The engine field will say so.
  }

  const score = 84 + Math.round(seeded(seed, "face") * 14); // 84..98 — a real person
  const band = score >= 85 ? "match" : score >= 70 ? "review" : "no-match";
  return {
    score, passed: band !== "no-match", band, engine: "simulation",
    summary: `Simulated face match (${score}%) — no face-matching provider is connected.`,
  };
}

function captureAdvice(issues: string[]): string {
  if (issues.includes("no-face")) return "No face in the photo. Look straight at the camera and take it again.";
  if (issues.includes("multiple-faces")) return "More than one face is in the picture. Only the customer should be in frame.";
  if (issues.includes("eyes-closed")) return "Their eyes were closed. Take it again.";
  if (issues.includes("blurred")) return "The photo is blurred. Hold still and take it again.";
  if (issues.includes("too-dark")) return "Too dark to see their face. Move towards the light and take it again.";
  if (issues.includes("not-facing-camera")) return "They were turned away from the camera. Face it straight on and take it again.";
  return "That photo cannot be used. Take it again.";
}

/** @deprecated The seeded simulator. Use verifyFace, which prefers the real provider. */
export function faceMatch(seed: string): FaceMatchResult {
  const score = 84 + Math.round(seeded(seed, "face") * 14);
  const band = score >= 85 ? "match" : score >= 70 ? "review" : "no-match";
  return { score, passed: band !== "no-match", band };
}

// ── IPRS (government registry) ─────────────────────────────────────────────────

/**
 * The IPRS seam. With Spinmobile credentials in the env (IPRS_*), the national
 * registry is queried for REAL; a transport failure falls back to the seeded
 * simulation so the pipeline never dies on a vendor — but a live "no record
 * found" is an ANSWER, not a failure, and is returned as unmatched rather than
 * papered over with a simulated match. `engine` is recorded on the check so a
 * session can always say which registry answered.
 */
export async function performIprs(
  seed: string,
  nationalId: string,
  ocrName: string | null | undefined,
  consentCollectedBy: string,
  /** Demo orgs stay simulated — every live lookup is a real, billed registry call. */
  opts?: { forceSimulation?: boolean },
): Promise<IprsResult & { engine: "spinmobile" | "simulation"; person?: import("./iprs").IprsPerson }> {
  const { iprsMode, spinIprsIdentity } = await import("./iprs");
  if (!opts?.forceSimulation && iprsMode() === "live") {
    const r = await spinIprsIdentity(nationalId, consentCollectedBy);
    if (r.ok) {
      return {
        matched: true,
        name: r.person.fullName,
        dob: r.person.dob,
        gender: r.person.gender,
        note: "Matched against the national registry (IPRS · live).",
        engine: "spinmobile",
        person: r.person,
      };
    }
    if (r.mode === "live" && r.notFound) {
      return { matched: false, name: null, dob: null, gender: null, note: r.error, engine: "spinmobile" };
    }
    // Transport/auth failure → simulation below, and the engine field says so.
  }
  return { ...iprsLookup(seed, nationalId, ocrName), engine: "simulation" };
}

export function iprsLookup(seed: string, nationalId: string, ocrName?: string | null): IprsResult {
  const id = (nationalId || "").replace(/\D/g, "");
  if (id.length < 6) return { matched: false, name: null, dob: null, gender: null, note: "ID number too short for a registry lookup." };
  const name = ocrName || nameFor(seed);
  const gender = seeded(seed, "gen") > 0.5 ? "Male" : "Female";
  return {
    matched: true,
    name,
    dob: extractId(seed, id).dob,
    gender,
    note: "Matched against the national registry (simulated).",
  };
}

// ── Portrait standardisation ──────────────────────────────────────────────────
/**
 * Whether the canonical portrait has actually had its background removed.
 *
 * The blueprint's step 7 turns the selfie into "one clean passport photo on a
 * universal white background". Removing the background needs the same provider
 * that does liveness and face match, so until a KYC key exists the stored
 * portrait IS the selfie — real bytes, real key, but the white background is not
 * yet true. The KycCheck payload records which of the two it is, so nobody later
 * mistakes an unprocessed selfie for a standardised portrait.
 */
export function portraitIsStandardized(mode: KycMode): boolean {
  return mode === "live";
}
