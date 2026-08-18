// ─────────────────────────────────────────────────────────────────────────────
// THE COLLECTIONS VOCABULARY — Micromart's own words, not ours.
//
// Every constant here was read out of the live database on 18 Aug 2026 rather
// than invented. That matters more than it sounds: a collections floor runs on
// shared language, and an agent who has said "Watch 2" every morning for three
// years will not accept a system that calls it "31–60 DPD". The bands, the
// commission rates and the disposition names below are theirs.
//
// They are MIRRORED here rather than read at request time for two reasons. They
// change roughly never — `LoanCategories` has seven rows and `PaymentResponse`
// has ten. And they are needed on the CLIENT (to colour a queue chip, to build a
// disposition picker) where a database round trip is not available. The live
// tables remain the source of truth; `verifyTaxonomy()` re-reads them and reports
// drift, so this file cannot quietly rot.
// ─────────────────────────────────────────────────────────────────────────────

import type { OrgDef } from "@/lib/enterprise/connections";
import { CB, cbQuery, num, str } from "./client";

// ── Collection categories — CollectBox.dbo.LoanCategories ────────────────────

export type CategoryId = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type Category = {
  id: CategoryId;
  /** Their name for it. */
  name: string;
  /** Short form for chips and column headers. */
  short: string;
  /** Days-in-arrears band. */
  from: number;
  to: number;
  /** Agent commission on recovery, as a percentage. */
  commission: number;
  /** The column on CollectionTracker that carries this band's balance. */
  column: "Prepayment1" | "AmountDue" | "Watch1" | "Watch2" | "Watch3" | "Npl";
  /** Escalation weight — how hard this queue is worked. Drives sort order. */
  severity: 0 | 1 | 2 | 3 | 4 | 5;
  accent: string;
  /** Plain-English brief an agent sees before dialling this queue. */
  posture: string;
};

export const CATEGORIES: Record<CategoryId, Category> = {
  1: {
    id: 1, name: "Prepayment", short: "PRE", from: 1, to: 2, commission: 0,
    column: "Prepayment1", severity: 0, accent: "#0d9488",
    posture: "Ahead of schedule. This is a courtesy and retention call, not a collections call — thank them, confirm the next instalment, and look for an upgrade.",
  },
  2: {
    id: 2, name: "Due", short: "DUE", from: 0, to: 0, commission: 0,
    column: "AmountDue", severity: 1, accent: "#2563eb",
    posture: "Falls due today or is due imminently. A reminder before the fact costs one minute and saves the entire Watch ladder.",
  },
  3: {
    id: 3, name: "Watch 1", short: "W1", from: 1, to: 30, commission: 0.25,
    column: "Watch1", severity: 2, accent: "#ca8a04",
    posture: "One to thirty days late. Recovery here is overwhelmingly a matter of contact, not pressure — most of this book pays when reminded.",
  },
  4: {
    id: 4, name: "Watch 2", short: "W2", from: 31, to: 60, commission: 1.2,
    column: "Watch2", severity: 3, accent: "#ea580c",
    posture: "A month past due. Take a dated, specific promise or agree a restructure — a vague 'soon' at this stage becomes Watch 3 within a fortnight.",
  },
  5: {
    id: 5, name: "Watch 3", short: "W3", from: 61, to: 90, commission: 10,
    column: "Watch3", severity: 4, accent: "#dc2626",
    posture: "Two months past due and approaching non-performing. Escalate to a field visit or the guarantor if two calls produce nothing.",
  },
  6: {
    id: 6, name: "NPL", short: "NPL", from: 91, to: 1_000_000, commission: 10,
    column: "Npl", severity: 5, accent: "#7f1d1d",
    posture: "Non-performing. Every conversation here is a negotiation — a partial payment that restarts a relationship is worth more than a promise that does not arrive.",
  },
  7: {
    id: 7, name: "Watch 1 (Matured)", short: "W1M", from: 1, to: 30, commission: 0,
    column: "Watch1", severity: 2, accent: "#a16207",
    posture: "Late on a loan that has run its full term. The schedule is exhausted, so there is no next instalment to lean on — settle the balance or restructure.",
  },
};

export const CATEGORY_LIST: Category[] = Object.values(CATEGORIES).sort((a, b) => a.severity - b.severity);

export function category(id: number | null | undefined): Category | null {
  return (CATEGORIES as Record<number, Category>)[Number(id)] ?? null;
}

/** The band a given days-in-arrears figure falls into, when no category is set. */
export function categoryForDays(days: number): Category {
  if (days <= 0) return CATEGORIES[2];
  if (days <= 30) return CATEGORIES[3];
  if (days <= 60) return CATEGORIES[4];
  if (days <= 90) return CATEGORIES[5];
  return CATEGORIES[6];
}

// ── Dispositions — CollectBox.dbo.PaymentResponse ────────────────────────────
//
// `CallStatus` in their schema is a two-value flag: 1 = the call was successful,
// 2 = it was not. "Successful" means CONTACT WAS MADE, not that money was
// promised — "Hang Up" is a success by their definition because a human answered.
// That distinction is the difference between a contact-rate and a promise-rate,
// and conflating the two is the single most common way a collections dashboard
// lies to the people reading it.

export type DispositionId = 1 | 4 | 6 | 8 | 9 | 13 | 18 | 19 | 20 | 21;

export type Disposition = {
  id: DispositionId;
  name: string;
  /** 1 = contact made, 2 = no contact. Their `CallStatus`. */
  callStatus: 1 | 2;
  /** Does this disposition require a promise amount + date? */
  requiresPromise: boolean;
  /** Does it schedule a callback task? */
  schedulesTask: boolean;
  /** Should this number be suppressed from redialling? */
  suppresses: boolean;
  accent: string;
  /** What it means, in the words the floor uses. */
  meaning: string;
};

export const DISPOSITIONS: Record<DispositionId, Disposition> = {
  1: {
    id: 1, name: "Promised to pay", callStatus: 1, requiresPromise: true, schedulesTask: false, suppresses: false,
    accent: "#16a34a", meaning: "The customer committed to an amount on a date. This creates a PTP and the promise is tracked to settlement.",
  },
  13: {
    id: 13, name: "Negotiation in progress", callStatus: 1, requiresPromise: false, schedulesTask: true, suppresses: false,
    accent: "#0891b2", meaning: "Contact made, terms being discussed. Keep the thread warm — schedule the next touch before ending the call.",
  },
  8: {
    id: 8, name: "Call back", callStatus: 1, requiresPromise: false, schedulesTask: true, suppresses: false,
    accent: "#7c3aed", meaning: "Reached, but not now. A callback without a scheduled time is a call that never happens.",
  },
  6: {
    id: 6, name: "Hang up", callStatus: 1, requiresPromise: false, schedulesTask: false, suppresses: false,
    accent: "#f59e0b", meaning: "They answered and ended it. Contact was made — this counts to the contact rate and tells you the number is good.",
  },
  4: {
    id: 4, name: "Ringing, no response", callStatus: 2, requiresPromise: false, schedulesTask: false, suppresses: false,
    accent: "#94a3b8", meaning: "The line is live but unanswered. Retry in a different daypart before concluding anything.",
  },
  9: {
    id: 9, name: "Not reachable", callStatus: 2, requiresPromise: false, schedulesTask: false, suppresses: false,
    accent: "#64748b", meaning: "Off, out of coverage, or barred. Repeated across dayparts, this becomes a trace-and-skip case.",
  },
  21: {
    id: 21, name: "Third party", callStatus: 2, requiresPromise: false, schedulesTask: true, suppresses: false,
    accent: "#a855f7", meaning: "Someone else answered. Leave no debt details — take a better number and move on.",
  },
  18: {
    id: 18, name: "Disputing", callStatus: 2, requiresPromise: false, schedulesTask: true, suppresses: false,
    accent: "#e11d48", meaning: "The customer contests the balance. Stop collecting and raise it — a disputed balance chased anyway is a complaint waiting to happen.",
  },
  19: {
    id: 19, name: "Wrong number", callStatus: 2, requiresPromise: false, schedulesTask: false, suppresses: true,
    accent: "#475569", meaning: "Not this customer's line. Suppress it immediately — continuing to dial it is a data-protection exposure, not just wasted time.",
  },
  20: {
    id: 20, name: "Impounding", callStatus: 2, requiresPromise: false, schedulesTask: true, suppresses: false,
    accent: "#991b1b", meaning: "Security recovery is under way. This leaves the call floor and belongs to the field and legal path.",
  },
};

export const DISPOSITION_LIST: Disposition[] = [
  DISPOSITIONS[1], DISPOSITIONS[13], DISPOSITIONS[8], DISPOSITIONS[6],
  DISPOSITIONS[4], DISPOSITIONS[9], DISPOSITIONS[21], DISPOSITIONS[18],
  DISPOSITIONS[19], DISPOSITIONS[20],
];

export function disposition(id: number | null | undefined): Disposition | null {
  return (DISPOSITIONS as Record<number, Disposition>)[Number(id)] ?? null;
}

/** Dispositions that mean a human was reached. Drives the contact rate. */
export const CONTACT_MADE: number[] = DISPOSITION_LIST.filter((d) => d.callStatus === 1).map((d) => d.id);

// ── Tasks — CollectBox.dbo.TaskAction ────────────────────────────────────────

export const TASK_ACTIONS: Record<number, { id: number; name: string; accent: string }> = {
  1: { id: 1, name: "Call debtor", accent: "#2563eb" },
  2: { id: 2, name: "Meet debtor", accent: "#7c3aed" },
  3: { id: 3, name: "Field visit", accent: "#ea580c" },
};

// ── PTP settlement states — CollectBox.dbo.PromisedToPay.PaymentStatus ───────

export const PTP_STATUS: Record<number, { id: number; name: string; accent: string }> = {
  0: { id: 0, name: "Open", accent: "#2563eb" },
  1: { id: 1, name: "Kept", accent: "#16a34a" },
  2: { id: 2, name: "Broken", accent: "#dc2626" },
  3: { id: 3, name: "Partial", accent: "#ca8a04" },
};

/**
 * A promise's real state, derived rather than trusted.
 *
 * `PaymentStatus` is written by their app and is not always updated when a
 * promise simply lapses — a PTP whose date passed with nothing paid often sits
 * at 0 forever. So the state shown to an agent is computed from the money and
 * the calendar, which is the only version an agent can act on.
 */
export function ptpState(promised: number, paid: number, due: Date | null, now = new Date()):
  { key: "kept" | "partial" | "broken" | "open" | "due-today"; label: string; accent: string } {
  if (paid >= promised && promised > 0) return { key: "kept", label: "Kept", accent: "#16a34a" };
  if (!due) return { key: "open", label: "Open", accent: "#2563eb" };
  const endOfDue = new Date(due); endOfDue.setHours(23, 59, 59, 999);
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const dueDay = new Date(due); dueDay.setHours(0, 0, 0, 0);
  if (now > endOfDue) {
    return paid > 0
      ? { key: "partial", label: "Part paid, lapsed", accent: "#ca8a04" }
      : { key: "broken", label: "Broken", accent: "#dc2626" };
  }
  if (dueDay.getTime() === today.getTime()) return { key: "due-today", label: "Due today", accent: "#ea580c" };
  return { key: "open", label: "Open", accent: "#2563eb" };
}

// ── Drift check ──────────────────────────────────────────────────────────────

export type TaxonomyDrift = { kind: "category" | "disposition"; id: number; ours: string | null; theirs: string | null };

/**
 * Re-read the live lookup tables and report anything this file has wrong.
 *
 * Called by the ConnectDesk settings screen and by `npm run test:collectbox`.
 * It is deliberately a REPORT rather than a correction: if Micromart add a
 * disposition, the right response is a considered change to the posture text and
 * the workflow it triggers, not a silently-appended row with no meaning attached.
 */
export async function verifyTaxonomy(org: OrgDef): Promise<TaxonomyDrift[]> {
  const drift: TaxonomyDrift[] = [];

  const cats = await cbQuery<{ ID: number; CategotyName: string }>(
    org, `SELECT ID, CategotyName FROM ${CB}.LoanCategories`,
  );
  const seenCat = new Set<number>();
  for (const row of cats) {
    const id = num(row.ID); seenCat.add(id);
    const ours = category(id);
    if (!ours) drift.push({ kind: "category", id, ours: null, theirs: str(row.CategotyName) });
    else if (ours.name.toLowerCase() !== str(row.CategotyName).toLowerCase()) {
      drift.push({ kind: "category", id, ours: ours.name, theirs: str(row.CategotyName) });
    }
  }
  for (const c of CATEGORY_LIST) if (!seenCat.has(c.id)) drift.push({ kind: "category", id: c.id, ours: c.name, theirs: null });

  const disps = await cbQuery<{ ID: number; ClientResponse: string }>(
    org, `SELECT ID, ClientResponse FROM ${CB}.PaymentResponse`,
  );
  const seenDisp = new Set<number>();
  for (const row of disps) {
    const id = num(row.ID); seenDisp.add(id);
    const ours = disposition(id);
    if (!ours) drift.push({ kind: "disposition", id, ours: null, theirs: str(row.ClientResponse) });
  }
  for (const d of DISPOSITION_LIST) if (!seenDisp.has(d.id)) drift.push({ kind: "disposition", id: d.id, ours: d.name, theirs: null });

  return drift;
}
