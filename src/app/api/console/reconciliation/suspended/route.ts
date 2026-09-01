// ─────────────────────────────────────────────────────────────────────────────
// THE LENDER'S PARKING BAY.
//
//   GET  ?q=&take=                                        (reconciliation.view)
//   POST { paymentId, transId, billRef, borrowerId, amountShown? }
//                                                      (reconciliation.resolve)
//
// This is NOT /api/console/reconciliation. That one is our own exceptions queue,
// built from our M-Pesa records in Postgres, and for a bridged lender it is
// correctly empty — their money never touches our tables. Meanwhile 6,261 real
// payments worth about KSh 13.9M sit in `Transactions.dbo.payments` with
// isPosted = 2, belonging to people who believe they have paid.
//
// ── WHAT THE POST ACTUALLY DOES ─────────────────────────────────────────────
// It sets a reference on one payment row and puts it back in their queue. THEIR
// posting job applies it to the loan and writes the statement. We never touch a
// balance or a ledger — see lib/lms/servicesuite-reconciliation.ts.
//
// ── AND WHY THIS ROUTE RE-RESOLVES THE REFERENCE ────────────────────────────
// `reconcileSuspendedTxn` deliberately does not re-check the reference: by then
// an officer has been shown a name and confirmed it. But an HTTP route is a
// trust boundary, not a screen. A request arriving here with a hand-written
// billRef would otherwise move somebody's money to a reference nobody ever
// looked at — and, worse, to one in the OTHER book on the same server, which is
// the exact cross-entity hazard findAccountForBillRef exists to close. So the
// reference is resolved again, entity-scoped, and must still point at the
// customer the officer confirmed.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireRight } from "@/lib/rbac/authz";
import { resolveOrg, type ResolvedOrg } from "@/lib/tenancy";
import { writePathState } from "@/lib/enterprise/mssql";
import {
  listSuspendedTxns,
  findAccountForBillRef,
  normaliseBillRef,
  reconcileSuspendedTxn,
} from "@/lib/lms/servicesuite-reconciliation";

export const runtime = "nodejs";

/**
 * The bay belongs to the lender's own system. A NATIVE org has no parking bay
 * because it has no ServiceSuite — that is a state to explain on the screen,
 * not an error to raise.
 */
async function lenderBook(slug: string | null | undefined): Promise<ResolvedOrg | null> {
  if (!slug) return null;
  const org = await resolveOrg(slug);
  if (!org || org.mode !== "BRIDGED" || !org.bridgedReady || !org.registry || !org.entityId) return null;
  return org;
}

const UNAVAILABLE =
  "Suspended payments live in the lender's own system. This organisation's book is native to Micro Eazy, " +
  "or its connection is not configured — so there is no parking bay to read.";

export async function GET(req: NextRequest) {
  const session = await auth();
  const denied = await requireRight(session, "reconciliation.view");
  if (denied) return denied;

  const org = await lenderBook(session!.user!.orgSlug);
  if (!org?.registry) {
    return NextResponse.json({ success: true, available: false, message: UNAVAILABLE });
  }

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const take = Number(req.nextUrl.searchParams.get("take") ?? 100);

  try {
    // The write probe runs alongside the listing, not after it: it is a health
    // check on another host and must never add its latency to the page.
    const [bay, writes] = await Promise.all([
      listSuspendedTxns(org.registry, org.entityId, { q, take: Number.isFinite(take) ? take : 100 }),
      writePathState(org.registry),
    ]);

    return NextResponse.json({
      success: true,
      available: true,
      lender: org.name,
      entityId: org.entityId,
      txns: bay.txns,
      total: bay.total,
      value: bay.value,
      shortCodes: bay.shortCodes,
      writes: { armed: writes.armed, detail: writes.detail },
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        available: true,
        message: `Could not read ${org.name}'s suspended payments: ${err instanceof Error ? err.message : "unknown error"}`,
      },
      { status: 502 },
    );
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const denied = await requireRight(session, "reconciliation.resolve");
  if (denied) return denied;
  const orgId = session!.user!.orgId!;

  const org = await lenderBook(session!.user!.orgSlug);
  if (!org?.registry) return NextResponse.json({ success: false, message: UNAVAILABLE }, { status: 400 });

  let body: { paymentId?: number; transId?: string; billRef?: string; borrowerId?: number; amountShown?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 });
  }

  const paymentId = Number(body.paymentId);
  if (!Number.isInteger(paymentId) || paymentId <= 0) {
    return NextResponse.json({ success: false, message: "Which payment?" }, { status: 400 });
  }
  const transId = String(body.transId ?? "").trim();
  if (!transId) {
    return NextResponse.json({ success: false, message: "That payment has no M-Pesa receipt to reconcile." }, { status: 400 });
  }
  // Their own normalising rule, applied HERE rather than trusted from the
  // client — the value we send is the value their posting job will match on.
  const billRef = normaliseBillRef(String(body.billRef ?? ""));
  if (!billRef) {
    return NextResponse.json({ success: false, message: "Type the account this money belongs to." }, { status: 400 });
  }

  // Who does it belong to — in THIS book?
  let matches;
  try {
    matches = await findAccountForBillRef(org.registry, org.entityId, billRef);
  } catch (err) {
    return NextResponse.json(
      { success: false, message: `Could not check that reference: ${err instanceof Error ? err.message : "unknown error"}` },
      { status: 502 },
    );
  }

  if (matches.length === 0) {
    return NextResponse.json(
      { success: false, message: `"${billRef}" does not match anyone in ${org.name}'s book (entity ${org.entityId}). Nothing was moved.` },
      { status: 409 },
    );
  }

  const confirmed = Number(body.borrowerId);
  const picked = Number.isInteger(confirmed) ? matches.find((m) => m.borrowerId === confirmed) : undefined;
  if (!picked) {
    return NextResponse.json(
      {
        success: false,
        message:
          matches.length > 1
            ? "That reference matches more than one customer. Pick the one this money belongs to."
            : "That reference no longer points at the customer you confirmed. Look it up again before moving the money.",
      },
      { status: 409 },
    );
  }

  // `staffUserId` lands in THEIR payments.UpdatedBy and is a SERVICESUITE user
  // id. We have no mapping from our staff to theirs, so 0 says "reconciled by
  // the integration" rather than naming a user who does not exist over there.
  // Our own audit row below is where the human is recorded.
  const result = await reconcileSuspendedTxn(org.registry, { paymentId, transId, billRef, staffUserId: 0 });

  if (!result.ok) {
    return NextResponse.json({ success: false, message: result.message }, { status: 502 });
  }

  await prisma.auditLog
    .create({
      data: {
        orgId,
        actorId: session!.user!.id,
        actorType: "staff",
        action: "recon.suspended.reconcile",
        entity: "ServiceSuitePayment",
        entityId: String(paymentId),
        meta: {
          source: "servicesuite",
          entityId: org.entityId,
          transId,
          billRef,
          borrowerId: picked.borrowerId,
          borrowerName: picked.name,
          accountNo: picked.accountNo,
          // What the officer was looking at when they decided. Ours to record,
          // theirs to post — we never re-read it to "confirm" an amount we did
          // not move.
          amountShown: Number.isFinite(Number(body.amountShown)) ? Number(body.amountShown) : null,
        },
      },
    })
    .catch(() => {});

  return NextResponse.json({
    success: true,
    matched: { borrowerId: picked.borrowerId, name: picked.name, accountNo: picked.accountNo },
    billRef,
  });
}
