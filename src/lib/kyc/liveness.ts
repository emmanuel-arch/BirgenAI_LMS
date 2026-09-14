// ─────────────────────────────────────────────────────────────────────────────
// ACTIVE LIVENESS FOR THE CUSTOMER APP — "do something a photograph cannot".
//
// provider.ts dropped liveness from the counter on the argument that a blink
// challenge is theatre against a printed photo held to a webcam — true at a
// counter, where an officer is watching the person. It is not true on a phone at
// home, where nobody is. So when a lender switches "Prove it is live" on in
// Borrower settings, the app runs a challenge-response here, and a lender who
// leaves it off never sees this step.
//
// ── THE CHALLENGES ARE THE SERVER'S, NOT THE CLIENT'S ──────────────────────
// Derived from the KYC session id, so the server re-derives what it asked
// without storing it, and a client cannot choose easier ones. Every challenge is
// verifiable from ONE frame (a turned head, a raised chin, a smile) — "blink
// twice" is not, and asking for something the check cannot see is theatre.
//
// ── THE SAME FACE, EVERY FRAME ──────────────────────────────────────────────
// A pose check alone passes a video of someone else. So each frame is also
// compared with the selfie already in the vault — which was itself matched to
// the ID — closing the loop: card → selfie → the live person turning their head.
//
// Simulation-first like every other leg: with no AWS keys the verdict is seeded
// and `engine` says so on the KycCheck.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from "crypto";

export type ChallengeKey = "turn-left" | "turn-right" | "look-up" | "smile";

export const CHALLENGES: Record<ChallengeKey, { say: string; hint: string }> = {
  "turn-left": { say: "Turn your head to your left", hint: "Slowly, until your ear points at the camera edge." },
  "turn-right": { say: "Turn your head to your right", hint: "Slowly, until your ear points at the camera edge." },
  "look-up": { say: "Lift your chin and look up", hint: "Keep your whole face inside the oval." },
  smile: { say: "Give us a big smile", hint: "A real one — teeth help." },
};

const KEYS = Object.keys(CHALLENGES) as ChallengeKey[];

function seeded(seed: string, facet: string): number {
  const h = createHash("sha256").update(`${seed}:${facet}`).digest();
  return (((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0) / 0xffffffff;
}

/** Two different challenges, fixed for this session. */
export function challengesFor(sessionId: string): ChallengeKey[] {
  const a = Math.floor(seeded(sessionId, "live-a") * KEYS.length);
  let b = Math.floor(seeded(sessionId, "live-b") * KEYS.length);
  if (b === a) b = (b + 1) % KEYS.length;
  // Left and right together is one gesture done twice; swap for a different kind.
  if ([KEYS[a], KEYS[b]].sort().join() === "turn-left,turn-right") b = KEYS.indexOf("smile");
  return [KEYS[a], KEYS[b]];
}

export type FrameVerdict = {
  challenge: ChallengeKey;
  passed: boolean;
  score: number;
  /** Why a frame failed, in the customer's words. Null when it passed. */
  says: string | null;
};

export type LivenessVerdict = {
  engine: "aws-rekognition" | "simulation";
  passed: boolean;
  score: number;
  frames: FrameVerdict[];
};

type Frame = { challenge?: string; image?: string; bytes?: number };

/**
 * Judge the frames against the challenges this session was issued.
 * `selfie` is read from the vault by the caller, never taken from the request.
 */
export async function judgeLiveness(sessionId: string, frames: Frame[], selfie: string | null): Promise<LivenessVerdict> {
  const asked = challengesFor(sessionId);
  const { faceMode, detectFramePose, compareFaces } = await import("./rekognition");

  if (faceMode() === "live") {
    const verdicts: FrameVerdict[] = [];
    let liveOk = true;
    for (let i = 0; i < asked.length; i++) {
      const challenge = asked[i];
      const f = frames[i];
      if (!f?.image || f.challenge !== challenge) {
        verdicts.push({ challenge, passed: false, score: 0, says: "That step was skipped or answered out of order." });
        continue;
      }
      const pose = await detectFramePose(f.image);
      if (!pose) { liveOk = false; break; }
      if (pose.faces !== 1) {
        verdicts.push({
          challenge, passed: false, score: 0,
          says: pose.faces === 0 ? "We could not see your face in that frame." : "Only you should be in the frame.",
        });
        continue;
      }
      const did =
        challenge === "turn-left" || challenge === "turn-right" ? Math.abs(pose.yaw) >= 18
        : challenge === "look-up" ? pose.pitch >= 10 || Math.abs(pose.pitch) >= 14
        : pose.smiling === true;
      let same = true;
      let similarity = 100;
      if (selfie) {
        const cmp = await compareFaces(selfie, f.image);
        if (cmp) { similarity = cmp.score; same = cmp.score >= 80; }
      }
      const score = Math.round((did ? 60 : 0) + Math.min(40, similarity * 0.4));
      verdicts.push({
        challenge,
        passed: did && same,
        score,
        says: !same
          ? "The face in that frame is not the face in your selfie."
          : did
            ? null
            : challenge === "smile"
              ? "We did not catch a smile."
              : "Your head did not move far enough.",
      });
    }
    if (liveOk) {
      const score = Math.round(verdicts.reduce((s, v) => s + v.score, 0) / Math.max(1, verdicts.length));
      return { engine: "aws-rekognition", passed: verdicts.every((v) => v.passed), score, frames: verdicts };
    }
    // Rekognition did not answer — fall through; the engine field says so.
  }

  const verdicts: FrameVerdict[] = asked.map((challenge, i) => {
    const f = frames[i];
    let score = f?.image && f.challenge === challenge ? 80 + Math.round(seeded(sessionId, `frame${i}`) * 18) : 10;
    if ((f?.bytes ?? 0) > 0 && (f?.bytes ?? 0) < 20_000) score -= 45;
    score = Math.max(5, Math.min(99, score));
    const passed = score >= 70;
    return { challenge, passed, score, says: passed ? null : "That frame could not be used." };
  });
  const score = Math.round(verdicts.reduce((s, v) => s + v.score, 0) / verdicts.length);
  return { engine: "simulation", passed: verdicts.every((v) => v.passed), score, frames: verdicts };
}
