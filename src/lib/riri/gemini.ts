// ─────────────────────────────────────────────────────────────────────────────
// Riri's brain — Gemini, server-side only.
//
// ⚠ THE KEY IS NEVER NEXT_PUBLIC. A NEXT_PUBLIC_* variable is inlined into the browser
// bundle at build time, which publishes it: anyone who opens devtools can then bill
// Gemini to our project until the quota dies. Riri only ever runs behind an API route,
// so there is no reason for the key to leave the server. (The Hub currently ships its
// working Gemini key as NEXT_PUBLIC_GEMINI_API_KEY — that key is public. It should be
// rotated and moved server-side.)
//
// ⚠ ONE KEY, NOT A FALLBACK CHAIN. The Hub reads `GOOGLE_AI_API_KEY || NEXT_PUBLIC_
// GEMINI_API_KEY`, and its GOOGLE_AI_API_KEY is present but INVALID — so the broken key
// wins the `||` forever, every enterprise Riri call 400s, and isLlmConfigured() still
// cheerfully reports true because the string is non-empty. A fallback chain over
// credentials does not add resilience; it adds a silent failure that looks like health.
// Riri reads exactly one variable, and "configured" means "answered", not "set".
// ─────────────────────────────────────────────────────────────────────────────
import { GoogleGenerativeAI } from "@google/generative-ai";

/** gemini-2.5-flash: fast and cheap enough to sit in a chat loop. Swap here, once. */
const MODEL = "gemini-2.5-flash";

export function ririKey(): string | null {
  return process.env.RIRI_LLM_KEY?.trim() || null;
}

/** Is a key present? Says nothing about whether it WORKS — see the note above. */
export function isLlmConfigured(): boolean {
  return !!ririKey();
}

export type LlmMode = "live" | "simulation";

/**
 * Is there a brain behind Riri right now?
 *
 * Async and org-aware by signature so a per-lender key (their own Gemini project, their
 * own bill) can land here without touching a caller. Today it is one platform key.
 */
export async function llmMode(_orgId: string): Promise<LlmMode> {
  return isLlmConfigured() ? "live" : "simulation";
}

export type ChatTurn = { role: "user" | "model"; text: string };

/**
 * Ask Riri.
 *
 * `history` is prior turns of THIS conversation; `system` carries the persona, the
 * actor, the customer facts and her memory. Throws on a bad key or a refusal so the
 * caller can degrade honestly rather than print an empty bubble.
 */
export async function generate(
  system: string,
  question: string,
  history: ChatTurn[] = [],
  opts: { temperature?: number; maxOutputTokens?: number } = {},
): Promise<string> {
  const key = ririKey();
  if (!key) throw new Error("Riri has no LLM key (RIRI_LLM_KEY).");

  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({ model: MODEL, systemInstruction: system });

  const res = await model.generateContent({
    contents: [
      ...history.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
      { role: "user" as const, parts: [{ text: question }] },
    ],
    generationConfig: {
      // Warm enough to sound like a person, tight enough not to embroider a balance.
      temperature: opts.temperature ?? 0.7,
      maxOutputTokens: opts.maxOutputTokens ?? 900,
    },
  });

  const text = res.response.text().trim();
  if (!text) throw new Error("Riri returned nothing.");
  return text;
}
