// ─────────────────────────────────────────────────────────────────────────────
// WHAT RIRI IS LOOKING AT — the subject of a conversation.
//
// An officer with a customer's page open should never have to introduce that customer
// to Riri. They press Ask Riri and she already knows: who is asking, what that person
// is allowed to see, and whose account is on the screen.
//
// ⚠ THE RULE THAT MAKES THIS SAFE: the browser names the subject, the SERVER states the
// facts. The client sends `{ kind: "borrower", id }` — an id and nothing more. Every
// number Riri is told (limit, score, arrears, what they owe) is read server-side from
// the org-scoped row. If the page posted a context blob instead, anyone could hand Riri
// a customer that does not exist, or quietly edit a real one's balance before asking
// about it, and her answer would carry our authority.
//
// The ACTOR is never sent at all. Who is asking, and what they may see, comes from the
// session — a client that could name its own role could ask questions as a manager.
// ─────────────────────────────────────────────────────────────────────────────

/** Named by the client, resolved by the server. An id, never a claim. */
export type RiriSubject = {
  kind: "borrower";
  id: string;
  /** Display only — what the button says while it opens. Never reaches the model. */
  label: string;
};

/**
 * Open Riri already pointed at someone.
 *
 * Rides the existing `riri:open` event (RiriDock listens for it), so there is one way
 * to open Riri from anywhere and this is not a second mechanism.
 */
export function askRiriAbout(subject: RiriSubject, model: "analyst" | "copilot" = "copilot") {
  window.dispatchEvent(
    new CustomEvent("riri:open", { detail: { model, subject } }),
  );
}
