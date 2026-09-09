// POST /api/lms/products — list a lender's active loan products for the borrower
// to pick from. Body: { lenderSlug }.
//   NATIVE orgs  → our Product table (the org's own product builder).
//   BRIDGED orgs → read-only against the lender's ServiceSuite DB.
// Degrades gracefully (products: []) when unconfigured/unreachable so the
// wizard can fall back to a manual amount entry.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveOrg } from "@/lib/tenancy";
import { enterOrg } from "@/lib/db/context";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { listProducts } from "@/lib/lms/servicesuite";
import { readBorrowerSession } from "@/lib/portal/session";
import { micromartProducts, toShelfProduct, isSellable, type ShelfProduct } from "@/lib/portal/micromart-apply";

export const runtime = "nodejs";

// No auth: a lender's product catalogue is public marketing info, and borrowers
// on the white-label subdomains don't have accounts. Throttled anyway — for
// bridged orgs this reaches into the lender's own SQL Server.
export async function POST(req: NextRequest) {
  let body: { lenderSlug?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 });
  }

  const limited = await rateLimit([{ name: "products:ip", subject: clientIp(req), max: 60, windowSec: 3600 }]);
  if (limited) return limited;

  const org = await resolveOrg(body.lenderSlug ?? "");
  // Bind the RLS tenant in OUR async context (enterWith does not escape a callee).
  if (org) enterOrg(org.id);
  if (!org) return NextResponse.json({ success: false, message: "Choose a lender." }, { status: 400 });

  const local = await prisma.product.findMany({
    where: { orgId: org.id, isActive: true },
    orderBy: [{ minPrincipal: "asc" }, { name: "asc" }],
    take: 100,
  });

  // ── THE LIVE SHELF, MERGED ────────────────────────────────────────────────
  // A BRIDGED org's curated local shelf used to WIN outright, which meant the
  // app could only ever sell what somebody had re-typed into our builder — and a
  // product the lender adds tomorrow would need a deploy to reach a customer.
  //
  // So the two are merged, and each side owns what it is actually authoritative
  // for:
  //
  //   THE LENDER'S BOOK decides WHAT IS ON THE SHELF and WHAT IT COSTS. It is
  //   their catalogue and their price list. AvailableLoanProducts returns the
  //   full commercial terms — verified live on 9 Sep 2026: rate, period, method,
  //   principal bounds, minimum credit score — so there is nothing to guess at.
  //
  //   OUR ROW adds what only WE know: the disbursement mode, and the local
  //   Product.id that the wizard and /api/portal/apply key off.
  //
  // A live product with no local row still appears, carrying `id: "ss:<id>"`,
  // and /api/portal/apply resolves that form — so a product Micromart adds to
  // their own shelf is sellable here before anybody creates a row for it.
  const liveShelf = await micromartShelf(org, local);
  if (liveShelf) {
    return NextResponse.json({ success: true, connected: true, lender: org.name, products: liveShelf });
  }

  // Falling through to the previous behaviour: NATIVE orgs always sell from our
  // builder, and a bridged org whose lender we could not reach sells from
  // whatever we hold rather than from an empty shelf.
  if (org.mode === "NATIVE" || local.length > 0) {
    const products = local.map((p) => {
      // Whole-term rates ("term") read better the way the lender quotes them:
      // per repayment period. 82.5% flat over 10 weeks → "8.25%/week".
      const perPeriod = p.interestPeriodUnit === "term" && p.repaymentPeriod > 0
        ? Math.round((Number(p.interestRate) / p.repaymentPeriod) * 100) / 100
        : null;
      return {
        id: p.id, // uuid — the wizard treats ids as opaque strings
        name: p.name,
        description: p.description,
        minPrincipal: Number(p.minPrincipal),
        maxPrincipal: Number(p.maxPrincipal),
        interestRate: perPeriod ?? Number(p.interestRate),
        interestUnit: perPeriod != null ? p.repaymentPeriodUnit : p.interestPeriodUnit,
        // Reducing-balance products reward early settlement; the wizard says so.
        interestMethod: p.interestMethod,
        // TO_THIRD_PARTY (school fees): the wizard asks for the institution's paybill.
        disbursementMode: p.disbursementMode,
        repaymentPeriod: p.repaymentPeriod,
        repaymentUnit: p.repaymentPeriodUnit,
        minCreditScore: p.minCreditScore,
      };
    });
    return NextResponse.json({ success: true, connected: true, lender: org.name, products });
  }

  if (!org.bridgedReady || !org.registry) {
    return NextResponse.json({ success: true, connected: false, lender: org.name, products: [] });
  }

  try {
    const products = await listProducts(org.registry, org.entityId);
    return NextResponse.json({ success: true, connected: true, lender: org.name, products });
  } catch {
    // DB hiccup — let the borrower proceed with a manual amount.
    return NextResponse.json({ success: true, connected: false, lender: org.name, products: [] });
  }
}

/**
 * Micromart's own catalogue, merged over whatever we hold locally.
 *
 * Returns null — meaning "use the local shelf" — in every case where the live
 * read is not both possible and useful:
 *
 *   · the org is not bridged to Micromart's public API
 *   · there is no borrower session, so no bearer token to call with
 *   · Micromart could not be reached, or refused
 *   · they answered with an empty catalogue
 *
 * That last one matters. An empty array from a lender's API is far more often a
 * bad token or a wrong entity than a lender who has stopped lending, and
 * REPLACING a working shelf with nothing would take the app's whole product
 * range off the screen on a transient fault. Degrading to what we already hold
 * is always the better failure.
 */
async function micromartShelf(
  org: { id: string; slug: string; mode: string; entityId: number },
  local: Awaited<ReturnType<typeof prisma.product.findMany>>,
): Promise<ShelfProduct[] | null> {
  if (org.mode !== "BRIDGED") return null;

  // The token is minted by Micromart's Login and rides on the borrower session
  // (lib/portal/session.ts). No session — a browser on the marketing page, say —
  // means no token, and this endpoint is deliberately public, so the local shelf
  // answers instead. Signed-in customers get the live one.
  const session = await readBorrowerSession();
  const usable = session?.orgId === org.id && session.ssEntityId && session.ssToken;
  if (!usable) return null;

  const res = await micromartProducts({
    entityId: session.ssEntityId!,
    phoneNumber: session.ssAccount ?? session.phone,
    token: session.ssToken,
  });
  // Retired products come back from this endpoint too, carrying IsActive: 0.
  // Filtering is not cosmetic — offering one leads a customer through a whole
  // application their lender's own workflow will then refuse.
  const sellable = res.ok ? res.products.filter(isSellable) : [];
  if (!res.ok || sellable.length === 0) return null;

  // Local rows, indexed by the lender's own product id — the only key the two
  // sides share.
  const byServiceSuiteId = new Map(
    local.filter((p) => p.serviceSuiteProductId != null).map((p) => [p.serviceSuiteProductId!, p]),
  );

  return sellable.map((row) => {
    const live = toShelfProduct(row);
    const ours = byServiceSuiteId.get(row.ID);
    if (!ours) return live;

    // ── THE LENDER'S PRICE WINS ─────────────────────────────────────────────
    // An earlier draft let OUR row override the rate, term and method on the
    // reasoning that the live feed might not carry them. It does — verified —
    // and the override was the wrong way round: our rows are a copy, taken by
    // hand at some past date, and a rate Micromart changed this morning would
    // have been silently overwritten with last month's on the very screen a
    // customer accepts terms from.
    //
    // The local row is now additive only: the id the rest of the app keys off,
    // and the disbursement mode, which is a fact about how WE pay out and has no
    // counterpart on their side. If the two disagree on price, the lender is
    // right by definition — it is their money.
    return {
      ...live,
      id: ours.id,
      liveOnly: false,
      // Our name where we have curated one — theirs are occasionally internal
      // ("MEM") — but never our price.
      name: ours.name || live.name,
      description: ours.description ?? live.description,
      disbursementMode: ours.disbursementMode,
      minCreditScore: live.minCreditScore ?? ours.minCreditScore,
    };
  });
}
