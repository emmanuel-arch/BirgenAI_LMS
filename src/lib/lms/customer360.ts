// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMER 360, READ FROM THE BOOK THE CUSTOMER IS ACTUALLY IN.
//
// The page had a split personality. The BORROWER LIST reads a bridged lender's
// ServiceSuite live — 17,021 people, their photos, their limits, their loan
// counts — and then opening one of them landed on a screen built entirely from
// our Postgres, where that customer is a row created seconds ago by the resolve
// step and has never borrowed anything. Micromart's own Borrower 360 showed
// Moses 14 loans, KSh 125,642 disbursed and KSh 10,465 outstanding; ours showed
// the same man with "OLB KES 0 · Loans 0/0" and no face. Both were rendering
// correctly. Only one was rendering the customer.
//
// This module is the join. Given the Postgres borrower an officer opened, it
// finds them in the lender's own book and returns what that book knows, in the
// vocabulary the console already speaks:
//
//   · WHO — the photo, the account number, the officer, the office trail.
//   · WHAT THEY OWE — every approved loan with the lender's OWN arrears figure.
//   · WHAT THEY HAVE DONE — the ledger, and the totals across all of it.
//   · WHAT THEY ARE — a band computed from their repayment record by OUR engine
//     under THIS lender's credit policy, not copied from a column.
//
// ── THE BAND IS EARNED, NOT INHERITED ────────────────────────────────────────
// This is the correctness fix, and it matters more than the layout. The old page
// banded people off `Borrower.creditScore`, which the resolve step had filled
// from ServiceSuite's `Borrowers.CreditScore` — a column carrying values like
// 4,500 on a field our ladder reads as 300–900. Everything above 750 is PRIME,
// so essentially the whole book rendered as "pays on time, every time", and the
// tile helpfully offered "STATEMENT SCORE 4500 / 900" without anyone noticing
// the arithmetic was impossible.
//
// Here the score is COMPUTED: liveLoanFacts() reads their real instalments and
// scoreBehaviour() scores them, which is the same path a native lender's
// customer takes. A customer with no repayment record gets NO band rather than a
// flattering one — `banded: false` — because "we have not seen them pay
// anything" is a true and useful thing to tell an officer, and "Prime" is not.
//
// Every read is best-effort and independently degradable: the lender's database
// is not ours, and a slow arrears table must not take the customer's name off
// the screen with it. Each block reports its own failure by being absent, and
// the page says which.
// ─────────────────────────────────────────────────────────────────────────────
import type { OrgDef } from "@/lib/enterprise/connections";
import { getCustomer360ById, getCustomer360, type Customer360 } from "./servicesuite";
import { getCustomerStatementLive, type LiveStatement } from "./servicesuite-statement";
import { liveLoanFacts } from "./servicesuite-scoring";
import { readCreditPolicy } from "@/lib/config/store";
import { mergeCreditPolicy } from "@/lib/decision/policy";
import { assessLadder, type BehaviourResult, type LadderAssessment } from "@/lib/scoring/behaviour";

/** The Postgres borrower an officer opened, reduced to what the join needs. */
export type BorrowerKey = {
  /** Set once this customer has been resolved from the lender's book. */
  serviceSuiteBorrowerId: number | null;
  /** The fallback key, and the only one a never-resolved borrower has. */
  phone: string | null;
};

export type LiveCustomer360 = {
  /** The lender's own record of this person: photo, officer, office, limit. */
  profile: Customer360;
  /** Their whole money relationship — loans with arrears, ledger, totals. */
  statement: LiveStatement | null;
  /**
   * What their repayment record says, scored by our engine under this lender's
   * policy. Null when they have never had an instalment fall due — which is a
   * fact worth showing, not a gap to paper over.
   */
  behaviour: BehaviourResult | null;
  /** Where the graduation ladder would put their limit, on this evidence. */
  ladder: LadderAssessment | null;
  /** Blocks that could not be read, named. The page says so rather than showing zero. */
  degraded: string[];
  /**
   * Which key found them.
   *
   * "phone" means the stored ServiceSuite id did not resolve in this entity and
   * we matched on the handset instead — which is right far more often than not,
   * but is the one case where the wrong person could be shown, so the surface is
   * told rather than left to assume.
   */
  matchedBy: "id" | "phone";
};

/**
 * Find and read one customer in the lender's live book.
 *
 * Returns null when they are not in it at all — a native customer of a bridged
 * lender (registered here, never pushed across), which is a normal state and not
 * an error.
 */
export async function readLiveCustomer360(
  org: OrgDef,
  entityId: number,
  key: BorrowerKey,
  orgId: string,
): Promise<LiveCustomer360 | null> {
  const degraded: string[] = [];

  // ── THE ID FIRST, THEN THE PHONE ────────────────────────────────────────────
  // The stored id is the better key and is tried first. But it is NOT the last
  // word, and finding that out cost a null page: this lender's books are two
  // entities (3002 and 3005) holding different people, ids are written by several
  // different flows, and a customer can be registered in both. An id that does
  // not resolve IN THE BOOK WE ARE STANDING IN means "not that row here" — it does
  // not mean "not this person here", and returning null on it hid a customer with
  // a full loan history behind an empty page.
  //
  // The phone fallback is entity-scoped like everything else, so at worst it
  // finds somebody else in THIS book sharing a handset — the same exposure every
  // unresolved borrower already carries, and far better than showing an officer
  // nothing. Which key answered is reported, so the page can say so.
  let matchedBy: "id" | "phone" = "id";
  let profile = key.serviceSuiteBorrowerId
    ? await getCustomer360ById(org, entityId, key.serviceSuiteBorrowerId).catch(() => null)
    : null;
  if (!profile && key.phone) {
    profile = await getCustomer360(org, entityId, key.phone).catch(() => null);
    matchedBy = "phone";
  }
  if (!profile) return null;

  const ssId = profile.borrowerId;

  // The policy decides how far back to look, so the READ matches what the engine
  // will actually score. Asking for four loans and scoring two is a query nobody
  // needed; asking for two and scoring four is a score that quietly ignores half
  // the evidence.
  //
  // read() fills forward from the platform defaults, so a lender who has never
  // opened the credit-policy screen still gets a complete, valid document — the
  // catch is for the store being unreachable, and even then the defaults are a
  // better answer than refusing to band anybody.
  const policy = await readCreditPolicy(orgId)
    .then((d) => d.value)
    .catch(() => {
      degraded.push("credit policy");
      return mergeCreditPolicy(undefined);
    });

  const [statement, facts] = await Promise.all([
    getCustomerStatementLive(org, entityId, ssId).catch(() => {
      degraded.push("statement");
      return null;
    }),
    liveLoanFacts(org, entityId, ssId, {
      lookback: policy.behaviour.window.lookbackLoans,
      includeActive: policy.behaviour.window.includeActive,
    }).catch(() => {
      degraded.push("repayment history");
      return [];
    }),
  ]);

  // No facts is not a degradation — it is a customer who has genuinely never had
  // an instalment fall due, and they get no band. See the header: a borrower we
  // have not watched pay anything must not be rendered as one we have.
  let behaviour: BehaviourResult | null = null;
  let ladder: LadderAssessment | null = null;
  if (facts.length > 0) {
    // ONE call, not two. assessLadder scores the behaviour itself and hands the
    // result back, so scoring separately would run the engine twice over the same
    // instalments and — the day the policy is edited between the two calls —
    // return a band and a limit computed under different rules.
    ladder = assessLadder(
      { loans: facts, currentLimit: profile.loanLimit ?? 0 },
      policy.behaviour,
      policy.graduation,
    );
    behaviour = ladder.behaviour;
  }

  return { profile, statement, behaviour, ladder, degraded, matchedBy };
}

/**
 * The portrait a lender already holds for this customer.
 *
 * Micromart's photos live in Google Drive with link-visible sharing and the
 * Borrowers row carries only the file id, so the thumbnail endpoint serves them
 * without credentials. This is the same derivation the BORROWER LIST uses, which
 * is exactly why the list showed faces and the detail page did not: the list read
 * the live book and the page read our own storage, where a resolved customer has
 * no portrait because nobody has ever run KYC on them here.
 *
 * Exported rather than inlined so both surfaces provably share one rule.
 */
export function livePortraitUrl(photoId: string | null | undefined): string | null {
  const id = String(photoId ?? "").trim();
  if (!id) return null;
  return `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w480`;
}
