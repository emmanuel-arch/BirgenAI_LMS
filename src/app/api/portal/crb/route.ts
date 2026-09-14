// ─────────────────────────────────────────────────────────────────────────────
// POST /api/portal/crb — the customer's own credit-reference check, at application.
//
// Body: { lenderSlug, consent: true, loanAmount? }
//
// Micromart's "Micro Eazy" workflow opens on a Risk stage that cannot be actioned
// without a bureau file no older than 30 days (lib/crb/stage-gate.ts), and they
// charge every applicant a KSh 100 CRB fee for exactly that pull. Asking an
// officer to run it after the customer applies puts the application in a queue
// it cannot leave. So the customer consents and the file is pulled as they apply
// — the same Metropol plan, the same stored KycCheck, the same gate satisfied.
//
// ── WHY THIS IS NOT THE DENIAL-OF-WALLET /exposure REFUSES TO BE ────────────
// /api/portal/exposure never pulls, because an endpoint a customer can hit on
// every screen open is a surprise invoice. This one is bounded four ways:
//
//   · only after the identity check, for the person that check proved;
//   · only with consent given on the screen, recorded as a Consent row;
//   · a stored file inside the stage gate's own 30-day window is RE-SERVED,
//     never re-bought — so the second visit costs nothing;
//   · two pulls a day per customer, whatever happens.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveOrg } from "@/lib/tenancy";
import { enterOrg } from "@/lib/db/context";
import { borrowerFor, otpRequired } from "@/lib/portal/session";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { requireFeature } from "@/lib/billing/entitlements";
import { meter } from "@/lib/billing/meter";
import { MERGED_CRB_ONLY } from "@/lib/crb/rows";
import { CRB_FRESH_DAYS } from "@/lib/crb/stage-gate";
import { runCrbCheck, MetropolError, type CrbReport } from "@/lib/crb/provider";
import { REPORT_REASON } from "@/lib/crb/metropol";
import { portalBorrowerId } from "@/lib/portal/borrower";

export const runtime = "nodejs";
export const maxDuration = 60;

const CONSENT_VERSION = "portal-crb-2026-09-13";

/** What a handset may see: the file, never the full bureau detail or what it cost the lender. */
function safe(raw: unknown) {
  if (!raw || typeof raw !== "object") return null;
  const { metropol: _m, cost: _c, ...rest } = raw as CrbReport;
  return rest;
}

export async function POST(req: NextRequest) {
  let body: { lenderSlug?: string; consent?: boolean; loanAmount?: number };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const org = await resolveOrg(body.lenderSlug ?? "");
  if (!org) return NextResponse.json({ success: false, message: "Choose a lender." }, { status: 400 });
  enterOrg(org.id);

  const session = await borrowerFor(org.id);
  if (!session) return otpRequired();

  const borrowerId = await portalBorrowerId(org, session);
  const borrower = borrowerId
    ? await prisma.borrower.findUnique({
        where: { id: borrowerId },
        select: { id: true, phone: true, nationalId: true, firstName: true, otherName: true, kycStatus: true, loanLimit: true, serviceSuiteBorrowerId: true },
      })
    : null;
  if (!borrower?.nationalId) {
    return NextResponse.json({ success: false, reason: "kyc", message: "Verify your identity first — the bureau looks you up by your national ID." }, { status: 409 });
  }
  // A customer resolved from the lender's own book was identified by the lender.
  const lenderCustomer = org.mode !== "NATIVE" && borrower.serviceSuiteBorrowerId != null;
  if (!lenderCustomer && borrower.kycStatus !== "VERIFIED" && borrower.kycStatus !== "PENDING_REVIEW") {
    return NextResponse.json({ success: false, reason: "kyc", message: "Finish your identity check before the credit check." }, { status: 409 });
  }

  // ── A fresh file already on record is served, not bought again ─────────────
  const fresh = await prisma.kycCheck.findFirst({
    where: {
      orgId: org.id, borrowerId: borrower.id, kind: "CRB", ...MERGED_CRB_ONLY,
      createdAt: { gte: new Date(Date.now() - CRB_FRESH_DAYS * 86_400_000) },
    },
    orderBy: { createdAt: "desc" },
    select: { payload: true, createdAt: true },
  });
  if (fresh?.payload) {
    return NextResponse.json({ success: true, reused: true, checkedAt: fresh.createdAt, report: safe(fresh.payload) });
  }

  if (body.consent !== true) {
    return NextResponse.json({ success: false, field: "consent", message: "Give your permission for the credit reference check first." }, { status: 400 });
  }

  const limited = await rateLimit(
    [{ name: "portal-crb:borrower", subject: `${org.id}:${borrower.id}`, max: 2, windowSec: 86_400 }],
    "Your credit check has already been run today. If it did not complete, message us and we will run it for you.",
  );
  if (limited) return limited;

  const gated = await requireFeature(org.id, "crb");
  if (gated) return gated;

  await prisma.consent.create({
    data: {
      orgId: org.id, borrowerId: borrower.id, version: CONSENT_VERSION,
      grants: { crbCheck: true, crbShare: true } as Prisma.InputJsonValue, ip: clientIp(req),
    },
  }).catch(() => {});

  const amount = Number(body.loanAmount);
  let report: CrbReport;
  try {
    report = await runCrbCheck(
      org.id,
      {
        nationalId: borrower.nationalId,
        phone: borrower.phone,
        name: [borrower.firstName, borrower.otherName].filter(Boolean).join(" "),
      },
      {
        loanAmount: Number.isFinite(amount) && amount > 0 ? amount : borrower.loanLimit != null ? Number(borrower.loanLimit) : undefined,
        reason: REPORT_REASON.NEW_APPLICATION,
      },
    );
  } catch (err) {
    const message =
      err instanceof MetropolError
        ? "The credit bureau did not answer just now. Nothing has been charged — try again in a few minutes."
        : "We could not complete the credit check. Nothing has been charged — try again shortly.";
    return NextResponse.json({ success: false, reachable: false, message }, { status: 502 });
  }

  await prisma.kycCheck.create({
    data: {
      orgId: org.id, borrowerId: borrower.id, kind: "CRB",
      passed: report.verdict !== "ADVERSE", score: report.score,
      provider: report.mode === "live" ? report.bureau : "simulation",
      payload: report as unknown as Prisma.InputJsonValue,
    },
  });
  void meter(org.id, "crb", 1, { via: "portal", bureau: report.bureau, verdict: report.verdict, mode: report.mode, tier: report.cost?.tier ?? null }, report.cost?.cost);

  await prisma.auditLog.create({
    data: {
      orgId: org.id, actorId: borrower.id, actorType: "borrower", action: "crb.pull",
      entity: "Borrower", entityId: borrower.id, ip: clientIp(req),
      meta: { via: "portal", verdict: report.verdict, mode: report.mode, sandbox: report.sandbox ?? false },
    },
  }).catch(() => {});

  return NextResponse.json({ success: true, reused: false, checkedAt: report.checkedAt, report: safe(report) });
}
