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

/** A synthetic "white background portrait" key — in live mode this is produced
 *  by the background-removal service; in sim we just tag the selfie key. */
export function portraitKeyFrom(selfieKey: string | null): string | null {
  return selfieKey ? `portrait/${selfieKey.replace(/^selfie\//, "")}` : null;
}
