// ─────────────────────────────────────────────────────────────────────────────
// Which Interchange members does this deployment run the node for?
//
// Blueprint v2 §1: "nodes are hosted by you on your hardware; members get an
// endpoint, not a server." So one process speaks for several members, and this
// table is the mapping from a member code to the book it is entitled to read.
//
// ── A MEMBER IS AN ENTITY, NOT A COMPANY ─────────────────────────────────────
// Axe is two members because Axe runs two books: Boresha (3003, 43k borrowers,
// 14k open loans) and Stawi (3004, 417 borrowers). Micromart is two more: the
// main book (3002) and Fintech (3005). Each has its own borrower population,
// and on the shared .198 server ten unrelated companies are separated by nothing
// but EntityId. Merging any two of them would merge two lenders' exposure into
// one answer.
//
// ── WHY AXE'S CODES CARRY A PREFIX ───────────────────────────────────────────
// EntityIds are unique WITHIN a ServiceSuite server and nowhere else. Entity
// 3003 is "Micromart Check off" on Micromart's server and "Axe - Boresha" on
// Axe's. A bare KE/LENDER/3003 would therefore name two different lenders, and
// the first one registered would silently own the other's exposure. The prefix
// is an interim fix; the durable answer is to key member codes on something
// globally unique — the KRA PIN in BsEntity.EntityTaxRef is the obvious
// candidate, and is what X-Road member identifiers are meant to be.
// ─────────────────────────────────────────────────────────────────────────────
import type { OrgSlug } from "@/lib/enterprise/connections";

export type NodeMember = {
  /** X-Road-style member code, as registered in the Interchange Registry. */
  code: string;
  name: string;
  /** Which connection string reaches this member's server. */
  org: OrgSlug;
  /** THE SCOPE. Every read on this member's behalf is filtered to this EntityId. */
  entityId: number;
  /** The tailnet host the book physically lives on — recorded as provenance. */
  sourceHost: string;
  sourceDatabase: string;
};

export const NODE_MEMBERS: NodeMember[] = [
  {
    code: "KE/LENDER/3005",
    name: "Micromart Fintech",
    org: "micromart-fintech",
    entityId: 3005,
    sourceHost: "100.72.35.56,4230",
    sourceDatabase: "Serviceconnect",
  },
  {
    code: "KE/LENDER/3002",
    name: "Micromart Africa",
    org: "micromart-fintech", // same server; the entity is what scopes the read
    entityId: 3002,
    sourceHost: "100.72.35.56,4230",
    sourceDatabase: "Serviceconnect",
  },
  {
    code: "KE/LENDER/AXE-3003",
    name: "Axe - Boresha",
    org: "axe",
    entityId: 3003,
    sourceHost: "100.103.154.73,4420",
    sourceDatabase: "Serviceconnect",
  },
  {
    code: "KE/LENDER/AXE-3004",
    name: "Axe - Stawi",
    org: "axe",
    entityId: 3004,
    sourceHost: "100.103.154.73,4420",
    sourceDatabase: "Serviceconnect",
  },
];

export function nodeMember(code: string): NodeMember | null {
  return NODE_MEMBERS.find((m) => m.code === code) ?? null;
}

/**
 * The member code a portal lender queries the Interchange AS.
 *
 * The customer-facing portal serves one lender at a time, and that lender is the
 * one whose consent, quota and reciprocity the query is charged against. It is
 * resolved from the org slug, never from anything the browser sends.
 */
export function memberCodeForOrgSlug(slug: string): string | null {
  // The Micro Eazy pilot books into Fintech (3005) and that is the entity whose
  // membership the portal query belongs to.
  if (slug === "micromart" || slug === "micromart-fintech") return "KE/LENDER/3005";
  if (slug === "axe") return "KE/LENDER/AXE-3003";
  return null;
}
