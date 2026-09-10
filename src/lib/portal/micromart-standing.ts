// ─────────────────────────────────────────────────────────────────────────────
// THE TWO NUMBERS A CUSTOMER ASKS FOR THAT NOBODY WAS ANSWERING.
//
//   SAVINGS   What is in my account, separate from what I owe.
//   SCORE     Am I getting better or worse at this, on a scale I recognise.
//
// ── WHY NEITHER CAME FROM AccountPreview ────────────────────────────────────
// /api/portal/home reads the customer's position from Micromart's own
// `AccountPreview` endpoint, which returns a loan limit, an outstanding balance
// and a loan count. It returns NO savings figure at all, and its `CreditScore`
// field is a misnomer — that column carries the customer's average daily sales
// in shillings (30,000 for borrower 170497), not a score. See the header of
// micromart-account.ts, which is where that trap is documented.
//
// So Home showed a limit and a balance and then stopped, and the two questions
// a borrower actually opens the app to ask went unanswered on the screen the
// product is judged by.
//
// ── WHERE THEY ACTUALLY LIVE ────────────────────────────────────────────────
//
// SAVINGS: `Transactions.dbo.AccountSavings`, one row per borrower, columns
// `BorrowerId, Amount, DateTransacted, LastAmountTransacted`. `Amount` is the
// RUNNING BALANCE and `LastAmountTransacted` is the most recent movement — a
// distinction worth stating because the column names suggest the opposite and
// getting it backwards puts a single deposit on screen as somebody's whole
// savings.
//
// It is written by `sp_CreateAccountSavings`, which `RepaymentTrigger` calls
// with whatever is left over after a repayment has cleared the loan balance. So
// this figure is not decorative: it is where a customer's overpayment goes, and
// until now they had no way to see that it had arrived.
//
// SCORE: the deployed behavioural model, on a 300–900 scale, via
// scoreBorrowerBehavioral(). Their own `Borrowers.RiskScore` column is NULL for
// this customer and for most of the book, so passing it through would render an
// empty gauge; and their `CreditScore` is the sales figure above. The model is
// the only thing on this system that produces a number on the scale the app's
// Score screen is built around.
//
// ── WHY THE SCORE IS BEST-EFFORT AND THE SAVINGS ARE NOT ────────────────────
// Savings is one indexed-enough single-row read. The score is a SQL read plus a
// call to a model service, and it is the slowest thing Home would depend on.
// Home already refuses to let one weak answer degrade the whole screen; this
// keeps that property by returning null rather than throwing, so a scorer that
// is down costs the customer a gauge and not their balance.
// ─────────────────────────────────────────────────────────────────────────────
import { runReadOnlyQuery, mssql } from "@/lib/enterprise/mssql";
import type { OrgDef } from "@/lib/enterprise/connections";
import { scoreBorrowerBehavioral } from "@/lib/scoring/behavioral";

export type SavingsPosition = {
  /** The running balance, in shillings. */
  balance: number;
  /** The most recent movement, or null if the row has never moved. */
  lastAmount: number | null;
  /** ISO date of that movement. */
  lastAt: string | null;
};

/**
 * The customer's savings pot.
 *
 * Returns a ZERO position rather than null when the borrower simply has no row:
 * a customer who has never overpaid has savings of nothing, and that is a fact,
 * not a failure to read. Null is reserved for "we could not ask" — the same
 * distinction Home draws with `bookSource`, and for the same reason.
 */
export async function micromartSavings(org: OrgDef, borrowerId: number): Promise<SavingsPosition | null> {
  if (!Number.isInteger(borrowerId) || borrowerId <= 0) return null;
  try {
    const { rows } = await runReadOnlyQuery(
      org,
      // TOP 1 with an explicit ORDER BY. The table holds one row per borrower
      // today, but it is a heap being written by a trigger, and "there is only
      // ever one" is the kind of assumption that silently starts showing the
      // wrong number the first time a duplicate appears.
      `SELECT TOP 1 Amount, LastAmountTransacted, DateTransacted
         FROM Transactions.dbo.AccountSavings WITH (NOLOCK)
        WHERE BorrowerId = @bid
        ORDER BY DateTransacted DESC, id DESC`,
      [{ name: "bid", type: mssql.Int, value: borrowerId }],
      { timeoutMs: 12_000, maxRows: 1 },
    );

    const r = rows[0];
    if (!r) return { balance: 0, lastAmount: null, lastAt: null };

    const num = (v: unknown): number => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    return {
      balance: num(r.Amount),
      lastAmount: r.LastAmountTransacted != null ? num(r.LastAmountTransacted) : null,
      lastAt: r.DateTransacted ? new Date(r.DateTransacted as string).toISOString() : null,
    };
  } catch {
    // "We could not ask" — distinct from zero. The caller renders it as absent.
    return null;
  }
}

export type PortalScore = {
  /** 300–900. The scale the Score screen explains. */
  score: number;
  max: 900;
  /** The model's own words for the band — "Major risk", "Low risk". */
  band: string;
  /** Probability of default, 0–1. Not shown to the customer; drives the tone. */
  pd: number;
  /** How the app should colour the gauge. */
  tone: "good" | "warn" | "high" | "bad";
  /**
   * The handful of things that moved it, already in plain language. The customer
   * is entitled to this — every decision on the screen "can be explained to you
   * on request" is a claim the app makes in its own footer.
   */
  drivers: { factor: string; direction: "increases" | "reduces" }[];
};

/**
 * Score one bridged borrower on the 300–900 scale.
 *
 * Never throws. A borrower with no loan history still scores — the feature
 * query LEFT JOINs from `Borrowers`, so a thin file comes back as defaults
 * rather than as no row — but the model service is a network hop and Home must
 * survive it being slow or down.
 */
export async function micromartScore(org: OrgDef, entityId: number, borrowerId: number): Promise<PortalScore | null> {
  if (!Number.isInteger(borrowerId) || borrowerId <= 0) return null;
  try {
    const r = await scoreBorrowerBehavioral(org, entityId, borrowerId);
    if (!Number.isFinite(r.score) || r.score <= 0) return null;
    return {
      score: Math.round(r.score),
      max: 900,
      band: r.riskBand || r.riskLevel,
      pd: r.pd,
      tone: r.tone,
      // Capped at four. The model returns five and they are ranked; a fifth
      // line on a phone screen is one the customer scrolls past rather than
      // reads, and the point of showing any is that they get read.
      drivers: r.factors.slice(0, 4).map((f) => ({ factor: f.factor, direction: f.direction })),
    };
  } catch {
    return null;
  }
}
