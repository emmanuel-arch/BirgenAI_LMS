// ─────────────────────────────────────────────────────────────────────────────
// KYC provider — the identity + liveness + face-match + IPRS engine.
//
// SIMULATION-FIRST: with no KYC credentials in the org vault, every check runs
// in a high-fidelity SIMULATION that returns realistic, deterministic results
// (seeded off the national ID so the same person always scores the same). The
// moment a Smile ID key is saved in Settings → Vault, `mode` becomes "live" and
// the same call sites hit the real provider — no UI or flow change.
//
// This is deliberately structured so a demo looks and behaves exactly like
// production: quality gates reject blurry/glare images, liveness has a passive
// score, face-match returns a similarity %, and IPRS echoes a matched record.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from "crypto";
import { getIntegration, type KycConfig } from "@/lib/vault/integrations";

export type KycMode = "simulation" | "live";

/** Deterministic 0..1 from a seed — stable per (person, facet). */
function seeded(seed: string, facet: string): number {
  const h = createHash("sha256").update(`${seed}:${facet}`).digest();
  // First 4 bytes → [0,1)
  return (((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0) / 0xffffffff;
}

export async function kycMode(orgId: string): Promise<KycMode> {
  const cfg = await getIntegration(orgId, "KYC").catch(() => null);
  return cfg?.apiKey ? "live" : "simulation";
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

// ── Face match (ID portrait vs selfie) ────────────────────────────────────────
export function faceMatch(seed: string): FaceMatchResult {
  const score = 84 + Math.round(seeded(seed, "face") * 14); // 84..98 in sim (a real person)
  const band = score >= 85 ? "match" : score >= 70 ? "review" : "no-match";
  return { score, passed: band !== "no-match", band };
}

// ── IPRS (government registry) ─────────────────────────────────────────────────
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
