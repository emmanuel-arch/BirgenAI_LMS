// ─────────────────────────────────────────────────────────────────────────────
// RIRI ASSISTANT — the product.
//
// Replaces the old `copilot`, which was a keyword-matched corpus wearing an LLM's name:
// it could not know who was asking, could not see a customer, and answered "how do I
// bring down PAR 30?" with the same paragraph for a branch manager in Nakuru and a new
// officer on their first day.
//
// This file deliberately imports NO database. Everything about the world arrives through
// RiriHost (host.ts), so the same assistant runs on our Postgres today and inside
// ServiceSuite tomorrow without a line changing here. That seam is the product.
//
// The order of assembly matters and is not arbitrary:
//   1. WHO SHE IS + WHO SHE IS TALKING TO   (persona, role-aware)
//   2. WHAT SHE REMEMBERS about them        (continuity — the thing people call magic)
//   3. THE FACTS she has been handed        (the only truth she is allowed)
//   4. THE QUESTION
// Facts sit closest to the question because a model that reads its instructions first
// and its data last is a model that argues with its data.
// ─────────────────────────────────────────────────────────────────────────────
import { generate, isLlmConfigured, type ChatTurn } from "./gemini";
import { ririSystemPrompt } from "./persona";
import type { RiriHost, RiriSubjectFacts, RiriMemoryNote } from "./host";

/**
 * Prior turns of THIS conversation, as the client kept them.
 *
 * History is conversational text and earns exactly the trust of the question itself —
 * no more (it goes to the model, not the database) and no less (refusing it would make
 * every follow-up an amnesiac's first question). What IS enforced is shape and size:
 * roles must be user/model, and a "history" of a hundred megabyte turns is a cost
 * attack, not a conversation.
 */
export function sanitizeHistory(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatTurn[] = [];
  for (const t of raw.slice(-8)) {
    if (!t || typeof t !== "object") continue;
    const role = (t as { role?: unknown }).role;
    const text = (t as { text?: unknown }).text;
    if ((role !== "user" && role !== "model") || typeof text !== "string") continue;
    const trimmed = text.trim().slice(0, 2000);
    if (trimmed) out.push({ role, text: trimmed });
  }
  // Gemini requires the first content to be a user turn; a history that starts with
  // the model (because the opener was Riri's briefing) is trimmed to the first user turn.
  while (out.length && out[0].role === "model") out.shift();
  return out;
}

export type AssistantResult = {
  answer: string;
  /** live = a model answered. simulation = no key; we said so rather than pretending. */
  mode: "live" | "simulation";
  /** Who she was told she was looking at, for the log. */
  subjectId: string | null;
};

/** How many past notes are worth carrying. Enough for continuity, not a filibuster. */
const RECALL_LIMIT = 8;

function memoryBlock(notes: RiriMemoryNote[]): string {
  if (notes.length === 0) return "";
  const day = (d: Date) => {
    const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
    if (days <= 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 7) return `${days} days ago`;
    if (days < 14) return "last week";
    return `${Math.floor(days / 7)} weeks ago`;
  };
  return [
    "",
    "WHAT YOU ALREADY KNOW ABOUT THIS PERSON (your own notes from past conversations — refer to them naturally, the way a colleague would remember):",
    ...notes.map((n) => `- (${day(n.createdAt)}, ${n.kind}) ${n.body}`),
  ].join("\n");
}

function bookBlock(lines: string[]): string {
  if (lines.length === 0) return "";
  return [
    "",
    "THEIR BOOK RIGHT NOW (live, scoped to what this person is accountable for — use it when they ask about their work, their arrears, or who to chase):",
    ...lines.map((l) => `- ${l}`),
  ].join("\n");
}

function factsBlock(subject: RiriSubjectFacts | null): string {
  if (!subject) {
    return [
      "",
      "FACTS: none — they have not opened a specific customer. Answer generally, and if the question is about one particular person, ask them to open that customer's page so you can see the real numbers.",
    ].join("\n");
  }
  if (subject.restricted) {
    return [
      "",
      `FACTS: this customer's record is restricted (${subject.lines.join(" ")}). Do not discuss their details. Say plainly that you cannot.`,
    ].join("\n");
  }
  return [
    "",
    `FACTS — they have ${subject.label}'s page open. These are the ONLY facts you have about this customer. Anything not listed here, you do not know:`,
    ...subject.lines.map((l) => `- ${l}`),
  ].join("\n");
}

/**
 * What Riri says when she has no brain.
 *
 * She says so. The alternative — a canned paragraph in her voice — is worse than
 * silence: an officer who is told something confident and generic by a system that
 * looks like it read the file will act on it.
 */
function unconfigured(): AssistantResult {
  return {
    mode: "simulation",
    subjectId: null,
    answer:
      "My brain isn't connected on this install yet — an admin needs to set Riri's LLM key. " +
      "Until then, Riri Analyst still answers questions about your live book, and Riri Support " +
      "can walk you through anything in the console.",
  };
}

export async function askAssistant(
  host: RiriHost,
  question: string,
  opts: { subject?: { kind: string; id: string } | null; history?: ChatTurn[] } = {},
): Promise<AssistantResult> {
  if (!isLlmConfigured()) return unconfigured();

  const actor = await host.actor();

  // The client names a subject; the HOST states the facts. A client that could post the
  // facts could invent a customer, or shave a balance before asking about them, and the
  // answer would carry our authority.
  const [subject, book, notes] = await Promise.all([
    opts.subject ? host.subject(opts.subject.kind, opts.subject.id) : Promise.resolve(null),
    host.book(actor),
    actor.id ? host.recall(actor.id, RECALL_LIMIT) : Promise.resolve([]),
  ]);

  const system = [
    ririSystemPrompt({
      lenderName: host.lenderName,
      actorName: actor.name,
      roleTitle: actor.roleTitle,
      branch: actor.branch,
      isPlatformAdmin: actor.isPlatformAdmin,
    }),
    memoryBlock(notes),
    bookBlock(book),
    factsBlock(subject),
  ].join("\n");

  const answer = await generate(system, question, opts.history ?? []);
  return { answer, mode: "live", subjectId: subject?.id ?? null };
}

// ── Remembering ──────────────────────────────────────────────────────────────
//
// Riri decides what was worth writing down, in a second, cheap call — not the officer,
// and not a heuristic over keywords. A recommendation she actually made is the thing she
// must be able to follow up on ("the three loans I flagged last week"), and only she
// knows whether she made one.
//
// It runs AFTER the answer is already on screen (never awaited in the request path), so
// a slow or failed memory write costs the officer nothing.

const REMEMBER_SYSTEM = `You are Riri's memory. You are shown one exchange between Riri and a member of staff at a lender.

Decide whether anything in it is worth Riri remembering NEXT WEEK. Reply with ONE line of JSON and nothing else:

{"keep": false}
{"keep": true, "kind": "recommendation" | "pattern" | "preference", "body": "<one sentence, third person, from Riri's point of view>"}

Rules:
- "recommendation" = Riri advised a specific action she should follow up on. This is the most valuable kind.
- "pattern" = something about how this person works, or their book, that will still be true next week.
- "preference" = how they like to be helped (language, brevity, detail).
- Keep NOTHING for greetings, small talk, or a plain factual lookup they could repeat any time.
- NEVER include a phone number, national ID, or full account number in the body. Refer to a customer by first name only.
- Be specific. "Advised on collections" is useless; "Told them to chase the 3 WATCH-band loans in Nairobi CBD before month-end" is a memory.`;

type Decision = { keep: boolean; kind?: RiriMemoryNote["kind"]; body?: string };

/** How long each kind of note stays true. Advice ages; a preference does not. */
const TTL_DAYS: Record<string, number | undefined> = {
  recommendation: 30,
  pattern: 90,
  preference: undefined,
  summary: undefined,
};

export async function rememberExchange(
  host: RiriHost,
  staffId: string,
  question: string,
  answer: string,
  subjectId: string | null,
): Promise<void> {
  if (!isLlmConfigured()) return;
  try {
    const raw = await generate(
      REMEMBER_SYSTEM,
      `Staff asked: ${question}\n\nRiri answered: ${answer}`,
      [],
      { temperature: 0, maxOutputTokens: 200 },
    );
    // The model is asked for bare JSON but will sometimes fence it anyway.
    const json = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const d = JSON.parse(json) as Decision;
    if (!d.keep || !d.body || !d.kind) return;
    if (!["recommendation", "pattern", "preference"].includes(d.kind)) return;

    await host.remember(
      staffId,
      { kind: d.kind, body: d.body.slice(0, 500), subjectId },
      TTL_DAYS[d.kind],
    );
  } catch {
    // A memory that fails to write is a worse assistant, not a broken one.
  }
}
