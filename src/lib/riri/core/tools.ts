// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT 4 · TOOLS — the only route to a fact.
//
// Riri Ecosystem AI plan, §05, and Blueprint v2 §6.2:
//
//   A prompt instruction is a suggestion to a language model.
//   A check in the tool is a wall.
//
// Every live number Riri says comes out of a tool call, and a tool is a function
// that validates WHO is asking, WHOSE data it is and WHETHER they consented —
// inside its own body, before it opens a connection. Nothing in the prompt is
// load-bearing for any of those three.
//
// This file holds the shape and the gate, not the tools. The hosts own the
// bodies (providers/lms.ts reads Postgres, portal tools read the customer's own
// record through lib/portal/position.ts, a ServiceSuite host reads over the
// relay). A partner writes a tool against this type and inherits the gate.
//
// NO TOOL IN THE CATALOGUE WRITES. Riri advises; a human presses. The one thing
// on the customer surface that creates a row — an escalation — is not a tool: it
// is an explicit request the customer made, handled by a route with its own
// ownership checks.
// ─────────────────────────────────────────────────────────────────────────────
import type { RiriAudience, RiriContext } from "./context";

export type ToolScope =
  /** No person's data at all — the map, the corpus. Any audience it lists. */
  | "open"
  /** The caller's own record only. The proven session IS the consent. */
  | "self"
  /** Anyone in the tenant's book the actor may see. Needs a staff actor. */
  | "book"
  /** About a person who is not the caller. Refuses without a consent_ref. */
  | "consented";

export type ToolSpec = {
  /** Dotted, stable, logged: "customer.record", "ratiba.status". */
  id: string;
  /** One line, for the catalogue and the triage note ("what I checked"). */
  reads: string;
  audiences: RiriAudience[];
  scope: ToolScope;
};

export type ToolRefusal = { ok: false; tool: string; reason: "audience" | "actor" | "consent" | "tenant" };

/**
 * The wall. Called at the top of every tool body.
 *
 * Returns null when the call may proceed, or the refusal to return instead.
 * Deliberately boring: it is the one function a security reviewer will read
 * first, and every branch should be visible without scrolling.
 */
export function gate(spec: ToolSpec, ctx: RiriContext): ToolRefusal | null {
  if (!ctx.tenant) return { ok: false, tool: spec.id, reason: "tenant" };
  if (!spec.audiences.includes(ctx.audience)) return { ok: false, tool: spec.id, reason: "audience" };
  if (spec.scope === "self" && ctx.actor.kind !== "customer") return { ok: false, tool: spec.id, reason: "actor" };
  if (spec.scope === "book" && ctx.actor.kind !== "staff") return { ok: false, tool: spec.id, reason: "actor" };
  if (spec.scope === "consented" && !ctx.consentRef) return { ok: false, tool: spec.id, reason: "consent" };
  return null;
}

/**
 * The catalogue, as data — plan Table 4. The spec is the contract; each host
 * binds the ids it can serve and refuses the rest.
 */
export const TOOL_CATALOGUE: ToolSpec[] = [
  { id: "book.metric", reads: "A catalogue metric on the live book", audiences: ["staff", "developer"], scope: "book" },
  { id: "book.query", reads: "Guarded text-to-SQL on the live book, SQL shown", audiences: ["staff"], scope: "book" },
  { id: "customer.record", reads: "The customer's account: balance, limit, loan, savings, score", audiences: ["staff", "customer"], scope: "self" },
  { id: "customer.schedule", reads: "Instalments, due dates and arrears on the open loan", audiences: ["staff", "customer"], scope: "self" },
  { id: "customer.application", reads: "Where an application is in the lender's workflow", audiences: ["staff", "customer"], scope: "self" },
  { id: "ratiba.status", reads: "Whether an M-PESA Ratiba standing order is set", audiences: ["staff", "customer"], scope: "self" },
  { id: "interchange.exposure", reads: "Live multi-lender exposure", audiences: ["staff", "developer"], scope: "consented" },
  { id: "interchange.score", reads: "Network score and reason codes", audiences: ["staff", "customer"], scope: "consented" },
  { id: "platform.screen", reads: "The system map — purpose, verbs, traps", audiences: ["staff", "customer", "developer"], scope: "open" },
];

export const toolSpec = (id: string): ToolSpec | undefined => TOOL_CATALOGUE.find((t) => t.id === id);
