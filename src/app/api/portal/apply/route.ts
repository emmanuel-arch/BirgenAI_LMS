// ─────────────────────────────────────────────────────────────────────────────
// POST /api/portal/apply — the customer applies, from the app.
//
// Body: { lenderSlug, productId, amount, nationalId?, lat?, lng? }
//
// The gap this closes: the onboarding wizard assembled a complete draft in React
// state and then rendered "Onboarding complete." It never posted anything. A
// customer could walk the whole funnel — ID, statement, product, schedule,
// agreement, Ratiba — and no application existed anywhere at the end of it.
//
// ── TWO WRITES, IN A DELIBERATE ORDER ───────────────────────────────────────
//   1. OUR row.       A LoanApplication here is what the tracker screen reads,
//                     what the officer queue lists, and what the training
//                     pipeline learns from. It is written FIRST and
//                     unconditionally.
//   2. THEIR row.     The insert into Micromart's own workflow, over their
//                     public API (lib/portal/micromart-apply.ts), gated by
//                     MICROMART_APPLY_ENABLED.
//
// That order is the whole recovery story. If step 2 fails or is shadowed, the
// customer still has an application they can see and ask about, and the failure
// is recorded on the row as `postError` for somebody to retry deliberately. The
// reverse order — post to the lender, then record it here — loses the loan id on
// any local failure, and a loan in a lender's book that our side has no record
// of is the one outcome nobody can clean up.
//
// ── WHY THE AMOUNT IS RE-VALIDATED HERE ─────────────────────────────────────
// The app computes a quote and shows a schedule, and none of that is evidence.
// The ceiling is recomputed server-side against the borrower's own limit and the
// product's bounds, because a client that posts `amount: 500000` must be refused
// by something that was never on the handset.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveOrg } from "@/lib/tenancy";
import { enterOrg } from "@/lib/db/context";
import { borrowerFor, otpRequired } from "@/lib/portal/session";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { findOrOpenThread, postMessage } from "@/lib/conversation/threads";
import { micromartApply, isMicromartApplyArmed, micromartProducts, toShelfProduct, isSellable } from "@/lib/portal/micromart-apply";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: {
    lenderSlug?: string;
    productId?: string;
    amount?: number;
    nationalId?: string;
    lat?: number;
    lng?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 });
  }

  const org = await resolveOrg(body.lenderSlug ?? "");
  if (!org) return NextResponse.json({ success: false, message: "Choose a lender." }, { status: 400 });
  enterOrg(org.id);

  const session = await borrowerFor(org.id);
  if (!session) return otpRequired();

  // Tight. Every accepted call creates a real application, and — once armed —
  // a real loan row in a lender's production book.
  const limited = await rateLimit(
    [
      { name: "apply:phone", subject: `${org.id}:${session.phone}`, max: 5, windowSec: 3600 },
      { name: "apply:phone:day", subject: `${org.id}:${session.phone}`, max: 10, windowSec: 86400 },
      { name: "apply:ip", subject: clientIp(req), max: 20, windowSec: 3600 },
    ],
    "You have applied several times just now. Give us a moment to process those first.",
  );
  if (limited) return limited;

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ success: false, message: "Enter how much you would like to borrow." }, { status: 400 });
  }

  const borrower = await prisma.borrower.findFirst({
    where: {
      orgId: org.id,
      phone: { endsWith: session.phone.slice(-9) },
      ...(body.nationalId?.trim() ? { nationalId: body.nationalId.trim() } : {}),
    },
    select: {
      id: true, firstName: true, otherName: true, nationalId: true, phone: true,
      kycStatus: true, loanLimit: true, erasedAt: true, graduationCount: true,
    },
    orderBy: { createdAt: "desc" },
  });
  if (!borrower || borrower.erasedAt) {
    return NextResponse.json(
      { success: false, message: "We could not find your account. Please finish signing up first." },
      { status: 404 },
    );
  }

  // ── THE IDENTITY GATE ─────────────────────────────────────────────────────
  // Not a formality and not configurable away. Lending to somebody whose ID has
  // not been proven is a licensing problem before it is a credit one, and the
  // app must not be the door that walks around the check the console enforces.
  if (borrower.kycStatus !== "VERIFIED") {
    return NextResponse.json(
      {
        success: false,
        reason: "kyc",
        kycStatus: borrower.kycStatus,
        message:
          borrower.kycStatus === "PENDING_REVIEW"
            ? "Your ID is with our team for a quick look. We will message you as soon as it clears — you can apply right after."
            : "We need to finish verifying your ID before you can apply.",
      },
      { status: 409 },
    );
  }

  // ── TWO KINDS OF PRODUCT ID ───────────────────────────────────────────────
  // A uuid is one of OUR Product rows. "ss:<n>" is a product that exists only on
  // the lender's own shelf and has no row here — which is how Micro Chap Chap
  // (30221) can be sold before anybody creates one. /api/lms/products emits both
  // forms; see micromartShelf() there.
  //
  // The live form is re-read from the lender rather than trusted from the body:
  // "ss:30221" arriving in a request is a CLAIM that such a product exists at
  // that price, and accepting it unchecked would let a caller name any product
  // id in Micromart's book — including one belonging to a different entity.
  const rawProductId = (body.productId ?? "").trim();
  const product = await resolveProduct(org, rawProductId, session);
  if (!product) {
    return NextResponse.json({ success: false, message: "That product is not available." }, { status: 400 });
  }

  // Server-side bounds. The handset's own quote is a rendering, not a right.
  const min = product.minPrincipal;
  const max = product.maxPrincipal > 0 ? product.maxPrincipal : Number.MAX_SAFE_INTEGER;
  const limit = borrower.loanLimit != null ? Number(borrower.loanLimit) : null;
  const ceiling = limit != null ? Math.min(max, limit) : max;

  if (amount < min) {
    return NextResponse.json(
      { success: false, message: `The smallest ${product.name} loan is ${min.toLocaleString("en-KE")}.` },
      { status: 400 },
    );
  }
  if (amount > ceiling) {
    return NextResponse.json(
      {
        success: false,
        reason: "limit",
        ceiling,
        message: `You can borrow up to ${ceiling.toLocaleString("en-KE")} right now. Your limit grows each time you clear a loan.`,
      },
      { status: 400 },
    );
  }

  // ── 1. OUR ROW ────────────────────────────────────────────────────────────
  const app = await prisma.loanApplication.create({
    data: {
      orgId: org.id,
      borrowerId: borrower.id,
      // A live-only product has no local row to point at, so it is recorded the
      // way the schema already models a bridged product: `productRef` carries
      // the lender's own id and `productName` carries what the customer saw.
      // Writing a fabricated `productId` would break the FK; leaving the name
      // off would leave an application nobody can identify.
      ...(product.localId ? { productId: product.localId } : { productRef: String(product.serviceSuiteProductId) }),
      productName: product.name,
      phone: borrower.phone,
      nationalId: borrower.nationalId,
      borrowerName: [borrower.firstName, borrower.otherName].filter(Boolean).join(" ").trim() || null,
      amountRequested: new Prisma.Decimal(amount),
      approvedLimit: limit != null ? new Prisma.Decimal(limit) : null,
      status: "SUBMITTED",
      stageTitle: "Submitted",
      priorLoanCount: borrower.graduationCount,
      serviceSuiteBorrowerId:
        typeof session.ssBorrowerId === "number"
          ? session.ssBorrowerId
          : Number.isFinite(Number(session.ssBorrowerId))
            ? Number(session.ssBorrowerId)
            : null,
      // Consented one-time geo, when the app offered it and the customer agreed.
      ...(Number.isFinite(body.lat) && Number.isFinite(body.lng)
        ? { lat: Number(body.lat), lng: Number(body.lng) }
        : {}),
    },
    select: { id: true, createdAt: true },
  });

  await prisma.auditLog.create({
    data: {
      orgId: org.id,
      actorId: borrower.id,
      actorType: "borrower",
      action: "application.submitted",
      entity: "LoanApplication",
      entityId: app.id,
      ip: clientIp(req),
      // Both ids, because a live-only product has no local one and an audit row
      // that cannot name the product is an audit row that cannot be read back.
      meta: {
        amount,
        productId: product.localId,
        serviceSuiteProductId: product.serviceSuiteProductId,
        productName: product.name,
        via: "portal",
      },
    },
  }).catch(() => {});

  // The conversation opens WITH the application, carrying one system message.
  // So the moment anything happens to this loan there is already a thread for it
  // to be announced into — and the customer has somewhere to ask before the
  // first stage even moves.
  const thread = await findOrOpenThread({
    orgId: org.id,
    borrowerId: borrower.id,
    kind: "APPLICATION",
    subject: `${product.name} — ${amount.toLocaleString("en-KE")}`,
    applicationId: app.id,
    stageTitle: "Submitted",
  }).catch(() => null);

  if (thread) {
    await postMessage({
      orgId: org.id,
      threadId: thread.id,
      authorType: "system",
      authorName: "Micro Eazy",
      body: `Your application for ${amount.toLocaleString("en-KE")} on ${product.name} has been received.`,
      event: "application.submitted",
      eventData: { amount, product: product.name },
    }).catch(() => {});
  }

  // ── 2. THEIR ROW ──────────────────────────────────────────────────────────
  // Only attempted when we hold a ServiceSuite identity for this person AND the
  // product is mapped to one of theirs. A Micro Eazy application with no
  // `serviceSuiteProductId` is ours alone, which is a valid configuration and
  // not an error.
  const posted: { loanId?: string; shadowed?: boolean; error?: string } = {};
  const ssProductId = product.serviceSuiteProductId;

  if (ssProductId && session.ssBorrowerId != null && session.ssEntityId) {
    const result = await micromartApply({
      borrowerAccount: session.ssAccount ?? session.phone,
      borrowedAmount: amount,
      borrowerId: session.ssBorrowerId,
      entityId: session.ssEntityId,
      productId: ssProductId,
      // Their vocabulary: 1 is an individual borrower. Their own app hard-codes
      // this too; a group loan is a different flow entirely.
      borrowerType: 1,
    });

    if (result.kind === "posted") {
      posted.loanId = result.loanId;
      await prisma.loanApplication.update({
        where: { id: app.id },
        data: { postedToServiceSuite: true, serviceSuiteLoanId: result.loanId, postError: null },
      });
    } else if (result.kind === "shadowed") {
      posted.shadowed = true;
      await prisma.loanApplication.update({
        where: { id: app.id },
        // Not an error — a deliberate hold. Recorded on the row so an officer
        // opening it can see the application never left this building, rather
        // than wondering why it is absent from their own book.
        data: { postError: "SHADOWED — MICROMART_APPLY_ENABLED is not set. Nothing was sent to the lender." },
      });
    } else {
      const message =
        result.kind === "refused" ? result.message : "We could not reach Micromart to file this.";
      posted.error = message;
      await prisma.loanApplication.update({ where: { id: app.id }, data: { postError: message } });
    }
  }

  return NextResponse.json({
    success: true,
    applicationId: app.id,
    threadId: thread?.id ?? null,
    amount,
    product: product.name,
    submittedAt: app.createdAt,
    // The app renders the same confirmation either way — a customer must never
    // be shown the difference between a shadowed and a live application, because
    // it is not a fact about their loan. It is here for staff and for the demo
    // badge, and it is why the flag's state is reported rather than inferred.
    lender: {
      armed: isMicromartApplyArmed(),
      posted: Boolean(posted.loanId),
      loanId: posted.loanId ?? null,
      shadowed: Boolean(posted.shadowed),
      error: posted.error ?? null,
    },
  });
}

/** One product, from whichever side of the bridge actually holds it. */
type ResolvedProduct = {
  /** Our Product.id where we have a row. Null for a live-only product. */
  localId: string | null;
  serviceSuiteProductId: number | null;
  name: string;
  minPrincipal: number;
  maxPrincipal: number;
};

/**
 * Turn the wizard's product id into something that can be lent against.
 *
 * Two forms, because /api/lms/products emits two (see micromartShelf there):
 *
 *   <uuid>    one of our own Product rows. The ordinary case.
 *   ss:<n>    a product that exists only on the lender's shelf. This is how a
 *             product we hold no row for — Micro Chap Chap, 30221 — can be sold
 *             without somebody first re-typing its terms into our builder.
 *
 * ── THE LIVE FORM IS RE-READ, NEVER TRUSTED ─────────────────────────────────
 * "ss:30221" in a request body is a CLAIM. Accepting it as given would let a
 * caller name any product id in Micromart's book, including one belonging to a
 * different entity or one their own shelf has retired, and would take the
 * PRINCIPAL BOUNDS from the attacker as well — which is the whole server-side
 * validation this route exists to perform. So the shelf is fetched and the id
 * must appear on it.
 */
async function resolveProduct(
  org: { id: string; mode: string },
  productId: string,
  session: { ssEntityId?: number; ssToken?: string; ssAccount?: string; phone: string },
): Promise<ResolvedProduct | null> {
  if (!productId) return null;

  if (!productId.startsWith("ss:")) {
    const p = await prisma.product.findFirst({
      where: { id: productId, orgId: org.id, isActive: true },
      select: { id: true, name: true, minPrincipal: true, maxPrincipal: true, serviceSuiteProductId: true },
    });
    if (!p) return null;
    return {
      localId: p.id,
      serviceSuiteProductId: p.serviceSuiteProductId,
      name: p.name,
      minPrincipal: p.minPrincipal != null ? Number(p.minPrincipal) : 0,
      maxPrincipal: p.maxPrincipal != null ? Number(p.maxPrincipal) : 0,
    };
  }

  const ssId = Number(productId.slice(3));
  if (!Number.isInteger(ssId) || ssId <= 0) return null;
  if (org.mode !== "BRIDGED" || !session.ssEntityId || !session.ssToken) return null;

  const shelf = await micromartProducts({
    entityId: session.ssEntityId,
    phoneNumber: session.ssAccount ?? session.phone,
    token: session.ssToken,
  });
  if (!shelf.ok) return null;

  // `isSellable` as well as a matching id: a retired product is not on the shelf,
  // and an id that only resolves because their endpoint still returns the row is
  // an application the lender's own workflow will refuse after the customer has
  // done all the work.
  const row = shelf.products.find((p) => Number(p.ID) === ssId && isSellable(p));
  if (!row) return null;

  const live = toShelfProduct(row);
  return {
    localId: null,
    serviceSuiteProductId: ssId,
    name: live.name,
    minPrincipal: live.minPrincipal,
    maxPrincipal: live.maxPrincipal,
  };
}
