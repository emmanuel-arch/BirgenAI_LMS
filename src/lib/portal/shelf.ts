// ─────────────────────────────────────────────────────────────────────────────
// THE LIVE SHELF, FOR A CUSTOMER WITH NO LENDER TOKEN — and the fee sheet with it.
//
// /api/lms/products reads Micromart's catalogue through their AvailableLoanProducts
// API, which wants the bearer token their Login issues. Only the password door
// has one. A NEW customer — the one who came through the code — has none, so the
// route fell back to our hand-kept mirrors: Micro Eazy and Micro Eazy Monthly,
// both starting at KSh 10,901. The first rung of Micromart's own ladder, Micro
// Chap Chap (KSh 5,000 – 10,900, product 30221), has no mirror, so every new
// customer with a starting limit under 10,901 was shown a shelf with nothing on
// it they could buy.
//
// This reads the same shelf over the read-only SQL road instead: Products for the
// entity, and ProductFees beside it — so a quote finally carries the processing,
// CRB and security fees the customer is actually charged, priced exactly as
// Micromart's own sheet says (a 6% processing fee is clamped to KSh 650–6,000).
//
// Cached for five minutes per entity. A rate the lender changes reaches the app
// within that window; a customer dragging a slider does not cost their server a
// query per movement.
// ─────────────────────────────────────────────────────────────────────────────
import { mssql, runReadOnlyQuery } from "@/lib/enterprise/mssql";
import type { OrgDef } from "@/lib/enterprise/connections";

/** Micromart's ProductFeesTypes: 1 before disbursement · 2 deducted from principal · 3 spread over instalments. */
export type ChargeWhen = "before-disbursement" | "on-disbursement" | "on-repayment";

export type ShelfCharge = {
  code: string;
  name: string;
  when: ChargeWhen;
  percent: boolean;
  /** Flat KES, or the percentage of principal when `percent`. */
  value: number;
  min: number | null;
  max: number | null;
  /** The principal band this fee applies inside. */
  fromPrincipal: number | null;
  toPrincipal: number | null;
  mandatory: boolean;
};

export type SqlShelfProduct = {
  id: string;
  serviceSuiteProductId: number;
  name: string;
  description: string | null;
  minPrincipal: number;
  maxPrincipal: number;
  interestRate: number;
  interestUnit: string;
  interestMethod: "flat" | "reducing";
  repaymentPeriod: number;
  repaymentUnit: string;
  minRepaymentPeriod: number;
  minCreditScore: number | null;
  disbursementMode: string | null;
  liveOnly: boolean;
  charges: ShelfCharge[];
};

const TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; products: SqlShelfProduct[] }>();

const num = (v: unknown, d = 0) => (Number.isFinite(Number(v)) && v != null ? Number(v) : d);
const unit = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/s$/, "") || "week";

export async function sqlShelf(org: OrgDef, entityId: number): Promise<SqlShelfProduct[]> {
  const key = `${org.slug}:${entityId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.products;

  const { rows } = await runReadOnlyQuery(
    org,
    `SELECT P.ID AS id, P.ProductName AS name, P.ProductDesc AS description,
            P.MinPrincipal AS minPrincipal, P.MaxPrincipal AS maxPrincipal,
            P.InterestRate AS interestRate, DIT.duratioName AS interestUnit,
            P.RepaymentPeriod AS repaymentPeriod, DRT.duratioName AS repaymentUnit,
            P.InterestMethod AS interestMethod, P.MinCreditScore AS minCreditScore
       FROM Products P
       LEFT JOIN DurationOptions DRT ON DRT.ID = P.RepaymentPeriodType
       LEFT JOIN DurationOptions DIT ON DIT.ID = P.InterestPeriodType
      WHERE P.EntityId = @entityId AND P.IsActive = 1
      ORDER BY P.MinPrincipal ASC`,
    [{ name: "entityId", type: mssql.Int, value: entityId }],
    { timeoutMs: 15_000, maxRows: 60 },
  );

  const { rows: fees } = await runReadOnlyQuery(
    org,
    `SELECT F.ProductId AS productId, F.FeeName AS name, F.FeeDesc AS code, F.FeeType AS feeType,
            F.FeeValueType AS valueType, F.FeeValue AS value, F.MinValue AS minValue, F.MaxValue AS maxValue,
            F.MinPrincipal AS fromPrincipal, F.MaxPrincipal AS toPrincipal, F.IsMandatory AS mandatory
       FROM ProductFees F
      WHERE F.EntityId = @entityId AND F.IsActive = 1`,
    [{ name: "entityId", type: mssql.Int, value: entityId }],
    { timeoutMs: 15_000, maxRows: 400 },
  ).catch(() => ({ rows: [] as Record<string, unknown>[] }));

  const products: SqlShelfProduct[] = rows.map((r) => {
    const id = Number(r.id);
    // Their method column: 1 is flat. Anything else is a reducing product and
    // must not be fanned out into shorter terms (lib/decision/candidates.ts).
    const method = num(r.interestMethod, 1) === 1 ? "flat" : "reducing";
    return {
      id: `ss:${id}`,
      serviceSuiteProductId: id,
      name: String(r.name ?? `Product ${id}`).trim(),
      description: String(r.description ?? "").trim().length > 12 ? String(r.description).trim() : null,
      minPrincipal: num(r.minPrincipal),
      maxPrincipal: num(r.maxPrincipal),
      interestRate: num(r.interestRate),
      interestUnit: unit(r.interestUnit ?? r.repaymentUnit),
      interestMethod: method,
      repaymentPeriod: Math.max(1, num(r.repaymentPeriod, 1)),
      repaymentUnit: unit(r.repaymentUnit ?? r.interestUnit),
      minRepaymentPeriod: method === "flat" ? 1 : Math.max(1, num(r.repaymentPeriod, 1)),
      minCreditScore: r.minCreditScore != null ? num(r.minCreditScore) : null,
      disbursementMode: null,
      liveOnly: true,
      charges: fees
        .filter((f) => Number(f.productId) === id)
        .map((f) => ({
          code: String(f.code ?? "").trim() || String(f.name ?? "FEE").trim().slice(0, 6).toUpperCase(),
          name: titleCase(String(f.name ?? "Fee")),
          when: (num(f.feeType, 1) === 3 ? "on-repayment" : num(f.feeType, 1) === 2 ? "on-disbursement" : "before-disbursement") as ChargeWhen,
          percent: num(f.valueType, 2) === 1,
          value: num(f.value),
          min: f.minValue != null ? num(f.minValue) : null,
          max: f.maxValue != null ? num(f.maxValue) : null,
          fromPrincipal: f.fromPrincipal != null ? num(f.fromPrincipal) : null,
          toPrincipal: f.toPrincipal != null ? num(f.toPrincipal) : null,
          mandatory: num(f.mandatory, 1) === 1,
        })),
    };
  });

  cache.set(key, { at: Date.now(), products });
  return products;
}

/** "PROCESSING FEE" → "Processing fee". Their fee names are typed in capitals. */
function titleCase(s: string): string {
  const t = s.trim().toLowerCase();
  return t ? t.charAt(0).toUpperCase() + t.slice(1).replace(/\bcrb\b/g, "CRB") : s;
}

/** What one fee costs at a principal — the same clamp the lender's own sheet applies. */
export function priceShelfCharge(c: ShelfCharge, principal: number): number {
  if (!c.percent) return Math.round(c.value);
  let v = (principal * c.value) / 100;
  if (c.min != null && c.min > 0) v = Math.max(v, c.min);
  if (c.max != null && c.max > 0) v = Math.min(v, c.max);
  return Math.round(v);
}

/** The fees that apply at this principal (a fee sheet can be banded by loan size). */
export function chargesAt(charges: ShelfCharge[], principal: number): ShelfCharge[] {
  return charges.filter(
    (c) => (c.fromPrincipal == null || principal >= c.fromPrincipal) && (c.toPrincipal == null || c.toPrincipal <= 0 || principal <= c.toPrincipal),
  );
}
