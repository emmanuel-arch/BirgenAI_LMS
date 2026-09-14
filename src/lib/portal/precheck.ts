// ─────────────────────────────────────────────────────────────────────────────
// THE FRONT-DOOR PRE-CHECK — "which of Micromart's books is this number on?"
//
// The create-account door used to send a code to any number and find out who
// the person was afterwards. For Micromart that is the wrong order, because the
// answer changes which APP the customer belongs in:
//
//   on 3005 (Fintech)                 they already have an account HERE → sign in
//   on 3002 (Africa), balance open    their loan lives on Micromart's field book,
//                                     served by the other portal → hand them there
//   on 3002, settled, not yet moved   the dormancy service moves them to Fintech
//                                     60 days after their last loan hit zero →
//                                     tell them the day, not "no"
//   on 3002, never borrowed / held    their record is on the field book → the
//                                     other portal
//   on BOTH                           a data fault only a person can fix → a case
//   on neither                        a genuinely new borrower → the code, then
//                                     the lender's onboarding rules
//
// ── WHAT THIS DELIBERATELY NEVER DOES ───────────────────────────────────────
// It never scans CustomerStatement. The true settlement date lives only there
// (Loans.DateCleared is NULL on every row in the book), and it is a 3.5M-row
// heap with no index on Micromart's SHARED production server — one scan per
// welcome-page submit is a load their other systems pay for. So the date comes
// from dbo.MicroEazyFintechPipeline, which the nightly dormancy job refreshes
// in the one scan it already performs (fintech-migration/15). Until that table
// exists the customer is told they are in the pipeline without a day count,
// which is true, rather than a count derived from maturity, which is the exact
// clock script 13 had to remove.
//
// Every read is keyed: Borrowers by phone (the same predicate the enrolment
// check already runs) and Loans by the BorrowerId index.
//
// ── WHAT IT SAYS, AND WHAT IT DOES NOT ──────────────────────────────────────
// A route and nothing else. Never a name, a balance, or a settlement amount.
// "Your account is on Micromart's other portal" is enough to send somebody to
// the right door without telling a stranger who typed the number that its
// owner owes money.
// ─────────────────────────────────────────────────────────────────────────────
import { mssql, runReadOnlyQuery, type QueryParam } from "@/lib/enterprise/mssql";
import type { OrgDef } from "@/lib/enterprise/connections";

/** Micromart Africa — the field book the other portal serves. */
export const AFRICA_ENTITY = 3002;
/** Micromart Fintech — the book this app lends from. */
export const FINTECH_ENTITY = 3005;
/** Micromart's rule: dormancy runs from settlement, and moves the customer at 60 days. */
export const DORMANT_DAYS = 60;

export type PrecheckRoute =
  | { route: "new" }
  | { route: "fintech" }
  | { route: "africa-active" }
  | { route: "africa-pipeline"; eligibleOn: string | null; daysRemaining: number | null }
  | { route: "africa-portal" }
  | { route: "both"; borrowerIds: number[] }
  | { route: "unreachable" };

/** The ServiceSuite answer for one phone, across both books. Throws when the book cannot be read. */
export async function precheckBooks(org: OrgDef, msisdn: string): Promise<PrecheckRoute> {
  const phone = msisdn.replace(/\D/g, "");

  const { rows: people } = await runReadOnlyQuery(
    org,
    `SELECT b.ID AS id, b.EntityId AS entityId
       FROM Borrowers b
      WHERE b.EntityId IN (@africa, @fintech)
        AND ISNULL(b.AccountStatus, 1) <> 0
        AND (b.PhoneNumber = @phone OR RIGHT(REPLACE(b.PhoneNumber, ' ', ''), 9) = RIGHT(@phone, 9))`,
    [
      { name: "africa", type: mssql.Int, value: AFRICA_ENTITY },
      { name: "fintech", type: mssql.Int, value: FINTECH_ENTITY },
      { name: "phone", type: mssql.VarChar(32), value: phone },
    ],
    { timeoutMs: 15_000, maxRows: 25 },
  );

  const onAfrica = people.filter((r) => Number(r.entityId) === AFRICA_ENTITY).map((r) => Number(r.id));
  const onFintech = people.filter((r) => Number(r.entityId) === FINTECH_ENTITY).map((r) => Number(r.id));

  if (onAfrica.length === 0 && onFintech.length === 0) return { route: "new" };
  if (onAfrica.length > 0 && onFintech.length > 0) {
    return { route: "both", borrowerIds: [...onAfrica, ...onFintech] };
  }
  if (onFintech.length > 0) return { route: "fintech" };

  // ── On the field book only. Where do they stand? ─────────────────────────
  const ids = onAfrica.slice(0, 10);
  const params = ids.map((id, i) => ({ name: `b${i}`, type: mssql.Int, value: id }));
  const inList = ids.map((_, i) => `@b${i}`).join(", ");

  // The dormancy job's own definition of "settled", so this screen and the job
  // that actually moves people can never disagree: flagged cleared AND the
  // balance genuinely gone. Anything else is still open.
  const { rows: loans } = await runReadOnlyQuery(
    org,
    `SELECT COUNT(*) AS loans,
            SUM(CASE WHEN ISNULL(l.LoanCleared, 0) = 1 AND ISNULL(l.LoanBalance, 0) <= 0 THEN 0 ELSE 1 END) AS openLoans
       FROM Loans l
      WHERE l.BorrowerId IN (${inList}) AND l.EntityId = @africa`,
    [...params, { name: "africa", type: mssql.Int, value: AFRICA_ENTITY }],
    { timeoutMs: 15_000, maxRows: 1 },
  );

  // An aggregate that cannot return zero rows came back empty: the relay's way of
  // saying the query did not run. That is not "no loans".
  if (loans.length === 0) throw new Error("Loan aggregate returned no row.");
  const total = Number(loans[0].loans ?? 0);
  const open = Number(loans[0].openLoans ?? 0);

  if (open > 0) return { route: "africa-active" };
  // Never borrowed: the dormancy service does not move them, so their account
  // stays on the field book and the other portal is where it is served.
  if (total === 0) return { route: "africa-portal" };

  // Settled. When do they cross?
  const eligible = await pipelineDate(org, params, inList).catch(() => null);
  if (!eligible) return { route: "africa-pipeline", eligibleOn: null, daysRemaining: null };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.ceil((eligible.getTime() - today.getTime()) / 86_400_000));
  return { route: "africa-pipeline", eligibleOn: eligible.toISOString().slice(0, 10), daysRemaining: days };
}

/**
 * The day the nightly job will move this customer, from the table it maintains.
 * Null when the table has not been installed, or has no row for them (held —
 * the ledger never shows a zero, which the job refuses to guess about).
 */
async function pipelineDate(
  org: OrgDef,
  params: QueryParam[],
  inList: string,
): Promise<Date | null> {
  const { rows: probe } = await runReadOnlyQuery(
    org,
    `SELECT CASE WHEN OBJECT_ID('dbo.MicroEazyFintechPipeline') IS NULL THEN 0 ELSE 1 END AS present`,
    [],
    { timeoutMs: 10_000, maxRows: 1 },
  );
  if (Number(probe[0]?.present ?? 0) !== 1) return null;

  const { rows } = await runReadOnlyQuery(
    org,
    `SELECT MAX(p.EligibleOn) AS eligibleOn
       FROM dbo.MicroEazyFintechPipeline p
      WHERE p.BorrowerId IN (${inList}) AND p.Held = 0`,
    params,
    { timeoutMs: 10_000, maxRows: 1 },
  );
  const raw = rows[0]?.eligibleOn as unknown;
  if (!raw) return null;
  const d = raw instanceof Date ? raw : new Date(String(raw));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "254712345678" → "0712 ••• 678", for the audit trail. */
export const maskPhone = (msisdn: string) => {
  const local = `0${msisdn.replace(/\D/g, "").slice(-9)}`;
  return `${local.slice(0, 4)} ••• ${local.slice(-3)}`;
};
