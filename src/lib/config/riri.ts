// ─────────────────────────────────────────────────────────────────────────────
// RIRI SETTINGS — a lender's own knowledge, versioned in the config store.
//
// Riri Ecosystem AI plan, Sprint 4: "The tenant training console: upload a pack,
// validate it, see what it will answer, version it, roll it back." This is the
// document that console publishes, and it deliberately needs NO new table:
// OrgConfig already gives one live document per org per namespace, every publish
// already writes an immutable OrgConfigRevision, and "roll back to v3" is
// therefore "publish what v3 was". The versioning, the author and the date come
// from machinery that has been auditing credit policy changes since it shipped.
//
// ── WHAT A LENDER STATES, AND WHAT THEY CANNOT ───────────────────────────────
//   member.kraPin  — who owns these facts. `KE/LENDER/<KRA PIN>`, the key the
//                    Interchange keys members on, never an EntityId (which names
//                    two different lenders on two servers). Every tenant pack
//                    published here must carry exactly that owner.
//   packs          — tenant or document authority only. `platform` authority is
//                    refused on upload: it is the one authority that may produce
//                    a navigation action, and it lives in our code.
//
// And the rule from pack.ts holds at this door too, because validatePack runs on
// every pack in every publish: a pack may state facts about the lender, never
// about the software.
// ─────────────────────────────────────────────────────────────────────────────
import { validatePack, type Pack } from "@/lib/riri/pack";
import type { ConfigIssue } from "./borrower";

export type RiriConfig = {
  member: {
    /** The lender's KRA PIN. Null until they state it; tenant packs cannot publish without it. */
    kraPin: string | null;
    /** White-label name for the assistant on this lender's surfaces. Null ⇒ "Riri". */
    assistantName: string | null;
  };
  customer: {
    /** Riri answers customers first. Off ⇒ the dock is hidden and Messages writes straight to the team. */
    firstResponse: boolean;
  };
  /** Published packs, by pack id. Re-publishing a pack id replaces it. */
  packs: Pack[];
};

export const RIRI_DEFAULTS: RiriConfig = {
  member: { kraPin: null, assistantName: null },
  customer: { firstResponse: true },
  packs: [],
};

const PIN_RE = /^[A-Z][0-9]{9}[A-Z]$/;

export const ownerFor = (kraPin: string) => `KE/LENDER/${kraPin}`;

export function mergeRiriConfig(stored: unknown): RiriConfig {
  const s = (typeof stored === "object" && stored ? stored : {}) as Record<string, unknown>;
  const m = (typeof s.member === "object" && s.member ? s.member : {}) as Record<string, unknown>;
  const c = (typeof s.customer === "object" && s.customer ? s.customer : {}) as Record<string, unknown>;
  const pin = typeof m.kraPin === "string" ? m.kraPin.trim().toUpperCase() : "";
  const name = typeof m.assistantName === "string" ? m.assistantName.trim().slice(0, 32) : "";
  return {
    member: { kraPin: pin || null, assistantName: name || null },
    customer: { firstResponse: typeof c.firstResponse === "boolean" ? c.firstResponse : RIRI_DEFAULTS.customer.firstResponse },
    packs: Array.isArray(s.packs) ? (s.packs as Pack[]) : [],
  };
}

export function validateRiriConfig(c: RiriConfig): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const bad = (path: string, message: string) => issues.push({ path, message });

  if (c.member.kraPin && !PIN_RE.test(c.member.kraPin)) {
    bad("member.kraPin", "A KRA PIN is a letter, nine digits and a letter — for example P051234567X.");
  }

  const seen = new Set<string>();
  c.packs.forEach((p, i) => {
    const at = `packs[${i}]`;
    const r = validatePack(p);
    if (!r.ok) {
      for (const issue of r.issues.filter((x) => x.level === "error")) bad(`${at}.${issue.at}`, issue.message);
      return;
    }
    if (r.pack.authority === "platform") {
      bad(`${at}.authority`, "Platform authority lives in code and cannot be uploaded.");
    }
    if (!c.member.kraPin) {
      bad(`${at}.owner`, "State your KRA PIN first — it is who owns these facts, and every answer names it.");
    } else if (r.pack.owner !== ownerFor(c.member.kraPin)) {
      bad(`${at}.owner`, `This pack says it belongs to ${r.pack.owner}, but your organisation is ${ownerFor(c.member.kraPin)}.`);
    }
    if (seen.has(r.pack.pack)) bad(`${at}.pack`, `Two packs are called “${r.pack.pack}”. Publishing a pack id replaces it — merge them.`);
    seen.add(r.pack.pack);
  });
  return issues;
}
