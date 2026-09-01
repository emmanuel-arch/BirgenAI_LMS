// ─────────────────────────────────────────────────────────────────────────────
// SUSPENDED PAYMENTS, AND PUTTING THEM WHERE THEY BELONG.
//
// Money arrives at the paybill with a reference the customer typed. When that
// reference does not match an account, the payment is not lost — it is parked.
// `Transactions.dbo.payments.isPosted = 2` is that parking bay, and on this
// server it currently holds 6,261 payments worth about KSh 13.9M belonging to
// real people who believe they have paid.
//
// Reconciling one is the act of saying "this money is HERS", and their pipeline
// does the rest.
//
// ── WHAT RECONCILING ACTUALLY IS ────────────────────────────────────────────
// sp_ReconcileSuspendedTxns is four columns on one row:
//
//     UPDATE Transactions.dbo.payments
//     SET isposted = 0, billrefnumber = @BillRefNumber, MethodUsed = 3,
//         UpdatedBy = @UserId, UpdateDatedDate = GETDATE()
//     WHERE id = @id
//
// It does NOT write the customer's statement. It sets the reference and puts the
// payment back in the queue (isPosted 0), and THEIR posting job picks it up,
// applies it to the loan and writes the CustomerStatement row. That division is
// the whole safety of this feature: we never touch a balance or a ledger, we
// correct a reference on a payment and let the system of record do its own
// arithmetic. MethodUsed = 3 marks it as reconciled rather than arriving
// straight from Safaricom (1) or re-uploaded (2).
//
// ── WHY IT IS STILL A WRITE TO TREAT CAREFULLY ──────────────────────────────
// Re-running it with the SAME reference is harmless — the row ends up in the
// state it is already in. Re-running it with a DIFFERENT one moves somebody's
// money to another customer. So it goes through callStoredProc, which never
// fails over between roads, and the relay must be armed for writes
// (SQL_RELAY_ALLOW_WRITES=true) or it is refused at the socket, which is the
// correct default for a demo posture.
//
// ── ONE PLACE WE DELIBERATELY DIVERGE FROM THEIRS ───────────────────────────
// Their `CheckIfBillRefNumberExists` is:
//
//     SELECT COUNT(*) FROM Borrowers WHERE phoneNumber = @ref OR NationalId = @ref
//
// with NO ENTITY FILTER. On this server 3002 and 3005 hold different people, and
// 185 national IDs appear in both. So that check can green-light a reference
// that matches a borrower in the WRONG BOOK, and the payment would be posted
// against a stranger. `findAccountForBillRef` below is scoped to the entity, and
// returns WHO matched rather than a boolean — an officer about to move somebody
// else's money should see the name they are moving it to.
// ─────────────────────────────────────────────────────────────────────────────
import { runReadOnlyQuery, callStoredProc, mssql, type QueryParam } from "@/lib/enterprise/mssql";
import { type OrgDef } from "@/lib/enterprise/connections";

const PAYMENTS = "Transactions.dbo.payments";

/** isPosted = 2. The parking bay. */
export const SUSPENDED = 2;
/** MethodUsed = 3. Set by reconciliation, so the audit trail shows a human did it. */
export const METHOD_RECONCILED = 3;

export type SuspendedTxn = {
  /** payments.ID — the key the reconcile procedure takes. */
  id: number;
  /** The M-Pesa receipt. What the customer quotes. */
  transId: string;
  /** Parsed from their yyyyMMddHHmmss varchar. */
  at: string | null;
  amount: number;
  shortCode: number | null;
  /** The reference the customer typed — usually the reason it is suspended. */
  billRef: string | null;
  payerName: string | null;
  /** 1 = direct from Safaricom, 2 = re-uploaded, 3 = reconciled by hand. */
  methodUsed: number | null;
};

/** "20260901125604" → ISO. Their column is a varchar, not a datetime. */
function parseTransTime(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!/^\d{14}$/.test(s)) return null;
  const [y, mo, d, h, mi, sec] = [
    s.slice(0, 4), s.slice(4, 6), s.slice(6, 8), s.slice(8, 10), s.slice(10, 12), s.slice(12, 14),
  ].map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d, h, mi, sec));
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

/**
 * The lender's paybills — THE LENDER'S, not one entity's.
 *
 * `payments` carries a BusinessShortCode and no entity, so the paybill is the
 * only way to tell this lender's parked money from anybody else's on the same
 * server. Their own sp_GetsuspendedTxns does not scope it at all: it returns
 * every suspended payment on the box, which is fine inside their app where the
 * session already fixes the entity, and is not fine here.
 *
 * ── AND IT IS NOT PER-ENTITY, WHICH IS WORTH BEING PLAIN ABOUT ──────────────
 * OrganizationUnits has OrganizationId and PaybillNumber — there is no EntityId
 * on it. (Assuming otherwise is what produced "Invalid column name 'EntityId'"
 * against the live server.) A live read on 1 Sep 2026 found four paybills —
 * 4037989, 4038015, 4038021, 4038023 — and ALL FOUR carry posted payments for
 * entity 3005 borrowers. They are shared across the lender's books.
 *
 * So the parking bay is scoped to the lender and may include a payment that
 * ultimately belongs to 3002. That is safe, because the ENTITY BOUNDARY IS
 * ENFORCED WHERE IT MATTERS: findAccountForBillRef only ever resolves a
 * reference to a borrower in the requested entity, so money can only be
 * reconciled to a customer in the book the officer is actually working.
 */
export async function lenderPaybills(org: OrgDef): Promise<number[]> {
  const { rows } = await runReadOnlyQuery(
    org,
    `SELECT DISTINCT o.PaybillNumber
     FROM OrganizationUnits o
     WHERE o.PaybillNumber IS NOT NULL AND o.PaybillNumber <> ''`,
    [],
    { timeoutMs: 30000, maxRows: 200 },
  );
  return rows
    .map((r) => Number(String(r.PaybillNumber).replace(/\D/g, "")))
    .filter((n) => Number.isInteger(n) && n > 0);
}

/**
 * The parking bay for this entity, newest first.
 *
 * When no paybill is configured on any organisation unit, this returns nothing
 * rather than everything. Showing another lender's suspended money because we
 * could not work out which paybill was ours is the one outcome worth failing
 * closed for.
 *
 * `entityId` is taken but not used for the LISTING — see lenderPaybills. It is
 * kept in the signature because every caller has it and because resolving a
 * reference, which is the next thing they will do, absolutely does need it.
 */
export async function listSuspendedTxns(
  org: OrgDef,
  entityId: number,
  opts: { take?: number; q?: string } = {},
): Promise<{ txns: SuspendedTxn[]; total: number; shortCodes: number[] }> {
  const take = Math.min(Math.max(opts.take ?? 100, 1), 500);
  const q = (opts.q ?? "").trim();
  const shortCodes = await lenderPaybills(org);
  if (shortCodes.length === 0) return { txns: [], total: 0, shortCodes };

  // The codes come from our own query of OrganizationUnits and are re-validated
  // as integers; they are not user input and cannot carry SQL.
  const codeList = shortCodes.join(",");
  const params: QueryParam[] = [
    { name: "suspended", type: mssql.Int, value: SUSPENDED },
    { name: "q", type: mssql.VarChar(60), value: q },
  ];
  const filter = `p.isPosted = @suspended AND p.BusinessShortCode IN (${codeList})
     AND (@q = '' OR p.TransID LIKE '%' + @q + '%' OR p.BillRefNumber LIKE '%' + @q + '%'
          OR p.FirstName LIKE '%' + @q + '%')`;

  const [page, counted] = await Promise.all([
    runReadOnlyQuery(
      org,
      `SELECT TOP (${take}) p.ID, p.TransID, p.TransTime, p.TransAmount, p.BusinessShortCode,
              p.BillRefNumber, p.FirstName, p.MethodUsed
       FROM ${PAYMENTS} p WITH (NOLOCK)
       WHERE ${filter}
       ORDER BY p.ID DESC`,
      params,
      { timeoutMs: 45000, maxRows: take },
    ),
    runReadOnlyQuery(org, `SELECT COUNT(*) AS total FROM ${PAYMENTS} p WITH (NOLOCK) WHERE ${filter}`, params, {
      timeoutMs: 45000,
      maxRows: 1,
    }),
  ]);

  const n = (v: unknown): number => {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
  };
  const str = (v: unknown): string | null => (v == null ? null : String(v).trim() || null);

  return {
    txns: page.rows.map((r) => ({
      id: n(r.ID),
      transId: String(r.TransID ?? "").trim(),
      at: parseTransTime(r.TransTime),
      amount: n(r.TransAmount),
      shortCode: r.BusinessShortCode == null ? null : n(r.BusinessShortCode),
      billRef: str(r.BillRefNumber),
      payerName: str(r.FirstName),
      methodUsed: r.MethodUsed == null ? null : n(r.MethodUsed),
    })),
    total: n(counted.rows[0]?.total),
    shortCodes,
  };
}

/**
 * Their reference-normalising rule, reproduced exactly.
 *
 * Anything nine characters or longer is treated as a phone number: take the LAST
 * NINE DIGITS and put the entity's dialling code in front. That is what turns
 * "0729522220", "+254729522220" and "254729522220" into one key. Shorter values
 * are left alone, because they are account numbers rather than phones.
 */
export function normaliseBillRef(raw: string, phoneCode = "254"): string {
  const v = (raw ?? "").trim();
  if (v.length < 9) return v;
  const digits = v.replace(/\D/g, "");
  if (digits.length < 9) return v;
  return `${phoneCode}${digits.slice(-9)}`;
}

export type BillRefMatch = {
  borrowerId: number;
  name: string | null;
  accountNo: string | null;
  phone: string | null;
  nationalId: string | null;
  /** Their running loan balance, so the officer can sanity-check the amount. */
  openBalance: number;
};

/**
 * Who does this reference belong to — IN THIS ENTITY?
 *
 * Returns the matches rather than a boolean, and more than one when the
 * reference is ambiguous. An officer moving money needs to see the name they are
 * moving it to; "yes, that exists somewhere" is not enough information to act on
 * and is exactly what their own check returns.
 */
export async function findAccountForBillRef(
  org: OrgDef,
  entityId: number,
  billRef: string,
): Promise<BillRefMatch[]> {
  const ref = (billRef ?? "").trim();
  if (!ref) return [];
  const tail = ref.replace(/\D/g, "").slice(-9);

  const { rows } = await runReadOnlyQuery(
    org,
    `SELECT TOP 10 b.ID, b.firstName, b.otherName, b.AccountNo, b.PhoneNumber, b.NationalID,
            ISNULL((SELECT SUM(l.LoanBalance) FROM Loans l
                    WHERE l.BorrowerId = b.ID AND l.LoanCleared = 0 AND l.isApproved = 1), 0) AS OpenBalance
     FROM Borrowers b
     WHERE b.EntityId = @entityId
       AND (
         b.NationalID = @ref
         OR b.AccountNo = @ref
         OR (@tail <> '' AND RIGHT(REPLACE(b.PhoneNumber,' ',''), 9) = @tail)
       )
     ORDER BY b.ID DESC`,
    [
      { name: "entityId", type: mssql.Int, value: entityId },
      { name: "ref", type: mssql.VarChar(60), value: ref },
      { name: "tail", type: mssql.VarChar(16), value: tail },
    ],
    { timeoutMs: 30000, maxRows: 10 },
  );

  const n = (v: unknown): number => {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
  };
  const str = (v: unknown): string | null => (v == null ? null : String(v).trim() || null);

  return rows.map((r) => ({
    borrowerId: n(r.ID),
    name: `${String(r.firstName ?? "").trim()} ${String(r.otherName ?? "").trim()}`.trim() || null,
    accountNo: str(r.AccountNo),
    phone: str(r.PhoneNumber),
    nationalId: str(r.NationalID),
    openBalance: n(r.OpenBalance),
  }));
}

export type ReconcileResult = { ok: true } | { ok: false; message: string };

/**
 * Point a suspended payment at an account.
 *
 * WRITES, through callStoredProc, which does not fail over between roads — and
 * needs the relay armed (SQL_RELAY_ALLOW_WRITES=true) or it is refused at the
 * socket. That refusal is the correct default: a deployment that can read the
 * lender's book should not be able to move their money by accident.
 *
 * The caller MUST have checked `findAccountForBillRef` first. This does not
 * re-check, for the same reason their controller does not: the officer has been
 * shown the name and has confirmed it, and a second lookup here would be a
 * different query at a different moment giving false assurance.
 *
 * `staffUserId` lands in payments.UpdatedBy. It is a SERVICESUITE user id, not
 * one of ours — pass 0 when there is no mapping rather than inventing one, so
 * their audit trail says "reconciled by the integration" instead of naming a
 * user who does not exist in their system.
 */
export async function reconcileSuspendedTxn(
  org: OrgDef,
  input: { paymentId: number; transId: string; billRef: string; staffUserId: number },
): Promise<ReconcileResult> {
  if (!Number.isInteger(input.paymentId) || input.paymentId <= 0) {
    return { ok: false, message: "That payment id is not valid." };
  }
  if (!input.billRef.trim()) {
    return { ok: false, message: "A bill reference is required." };
  }

  try {
    await callStoredProc(
      org,
      "sp_ReconcileSuspendedTxns",
      [
        { name: "BillRefNumber", type: mssql.VarChar(50), value: input.billRef },
        { name: "TransID", type: mssql.VarChar(20), value: input.transId },
        { name: "id", type: mssql.Int, value: input.paymentId },
        { name: "UserId", type: mssql.Int, value: input.staffUserId },
      ],
      { timeoutMs: 30000 },
    );
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "The lender's system refused the reconciliation.";
    return { ok: false, message };
  }
}
