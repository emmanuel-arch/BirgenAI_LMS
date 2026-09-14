// ─────────────────────────────────────────────────────────────────────────────
// THE TRIAGE NOTE — what arrives at the counter when Riri hands a customer over.
//
// Riri Ecosystem AI plan, §07 step 4: "An escalation arrives with the triage
// already done. She writes the first message on the thread, in her own voice,
// addressed to the officer: what the customer asked, in their words; what she
// checked and what it said; which KB packs she matched and what she did not find;
// and the one thing she needs a human to decide."
//
// ── WHY THE SERVER WRITES THIS, NOT THE APP ──────────────────────────────────
// The app sends the customer's own questions — their words, which are theirs to
// send — and nothing else. What Riri CHECKED is re-derived here from the record at
// the moment of hand-off. A note assembled in the browser could say "balance KSh 0,
// customer is clear" about somebody in arrears, and an officer would read it with
// Riri's authority. The officer's queue only ever carries what the server read.
//
// ── ADDRESSED TO THE OFFICER, READABLE BY THE CUSTOMER ───────────────────────
// It lands in the same thread the customer sees. That is deliberate — "her working
// shown" is shown to both sides — so it is written to be fair to read from either
// chair: plain facts, no judgement of the customer, no internal jargon.
// ─────────────────────────────────────────────────────────────────────────────
import type { FirstResponse } from "./first-response";
import type { RiriScreen } from "../core/context";

export type TriageInput = {
  /** The customer's questions in this conversation, oldest first, as they typed them. */
  questions: string[];
  /** Riri's answer to the question that led to the hand-off. */
  response: FirstResponse;
  screen: RiriScreen | null;
  /** Anything the customer added for the officer on the hand-off sheet. */
  note?: string | null;
  lender: string;
};

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

/** The plain-text body of Riri's first message on the thread. */
export function triageNote(t: TriageInput): string {
  const asked = t.questions.filter((q) => q.trim()).slice(-4);
  const r = t.response;
  const lines: string[] = [];

  lines.push("Riri · first response — handed over to the team");
  lines.push("");
  if (asked.length) {
    lines.push("What the customer asked:");
    for (const q of asked) lines.push(`• “${clip(q.trim(), 300)}”`);
  } else {
    lines.push("The customer asked for a person before asking anything specific.");
  }

  lines.push("");
  lines.push("What I checked:");
  for (const c of r.checked) lines.push(`• ${c.said}`);
  if (t.screen) lines.push(`• They were on the ${t.screen.title} screen`);

  lines.push("");
  if (r.sources.length) {
    lines.push("What I answered from:");
    for (const s of r.sources) lines.push(`• ${s.label} (${s.id})${s.starter ? " — starter pack, not yet reviewed by the lender" : ""}`);
  } else {
    lines.push("No knowledge entry covered this.");
  }

  lines.push("");
  lines.push("What I told them:");
  lines.push(clip(r.answer.replace(/\*\*/g, "").replace(/\n+/g, " "), 600));

  if (t.note && t.note.trim()) {
    lines.push("");
    lines.push("What they added for you:");
    lines.push(`“${clip(t.note.trim(), 1200)}”`);
  }

  lines.push("");
  lines.push("What needs a person:");
  lines.push(r.needsHuman ?? "The customer asked to take this further with the team.");

  return lines.join("\n");
}

/** A short reference a customer can quote. Derived from the thread id so it is stable. */
export const caseRef = (threadId: string) => `ME-${threadId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
