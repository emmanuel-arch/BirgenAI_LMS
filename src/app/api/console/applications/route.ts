// GET /api/console/applications — the org's application queue (staff).
// ?scope=live (default: SUBMITTED/AI_PRESCREEN/OFFICER_REVIEW/REFERRED) | all
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { prisma } from "@/lib/prisma";
import { originStamp, resolveScope, applicationScopeWhere } from "@/lib/rbac/scope";
import { autoScheduleVerification } from "@/lib/field/auto";

export const runtime = "nodejs";

const LIVE = ["SUBMITTED", "AI_PRESCREEN", "OFFICER_REVIEW", "REFERRED"] as const;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "applications.view");
  if (denied) return denied;

  const scope = req.nextUrl.searchParams.get("scope") ?? "live";
  // WHOSE applications (src/lib/rbac/scope.ts). `scope` below is the STATUS filter the
  // queue already had ("live" vs all) — a different thing entirely, hence `seen`.
  const seen = await resolveScope(session);

  const apps = await prisma.loanApplication.findMany({
    where: {
      orgId: session.user.orgId,
      ...applicationScopeWhere(seen),
      ...(scope === "live" ? { status: { in: LIVE as unknown as never } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true, createdAt: true, status: true, stageTitle: true, currentStageId: true,
      borrowerName: true, phone: true, amountRequested: true,
      productName: true, productId: true, productRef: true,
      score: true, pd: true, decision: true, reasonCodes: true, graduated: true,
      postedToServiceSuite: true, serviceSuiteLoanId: true, deviceFingerprint: true,
      loan: { select: { id: true, status: true } },
    },
  });

  // Ring-fraud signal: how many OTHER borrowers applied from the same device.
  // One query over the fingerprints on this page, not one per row.
  const prints = [...new Set(apps.map((a) => a.deviceFingerprint).filter((f): f is string => !!f))];
  const shared = new Map<string, Set<string>>();
  if (prints.length > 0) {
    const rows = await prisma.loanApplication.findMany({
      where: { orgId: session.user.orgId, deviceFingerprint: { in: prints } },
      select: { deviceFingerprint: true, borrowerId: true },
    });
    for (const r of rows) {
      if (!r.deviceFingerprint) continue;
      (shared.get(r.deviceFingerprint) ?? shared.set(r.deviceFingerprint, new Set()).get(r.deviceFingerprint)!).add(r.borrowerId);
    }
  }

  return NextResponse.json({
    success: true,
    applications: apps.map(({ deviceFingerprint, ...a }) => ({
      ...a,
      amountRequested: Number(a.amountRequested),
      pd: a.pd != null ? Number(a.pd) : null,
      // 0 = device seen for this borrower only (or no fingerprint at all).
      deviceSharedWith: deviceFingerprint ? Math.max(0, (shared.get(deviceFingerprint)?.size ?? 1) - 1) : 0,
    })),
  });
}

// POST — an officer applies ON A BORROWER'S BEHALF (loans.apply). The assisted
// twin of the funnel: walk-in customer, officer at the counter. The application
// enters the SAME approval chain at stage 1 (a null currentStageId restarts the
// resolved workflow), the same offer-signing gate protects booking (BRANCH
// signatures exist for exactly this), and the audit trail names the officer.
// No score is fabricated — fusionEngine "assisted" says a human took this in.
export async function POST(req: NextRequest) {
  const session = await auth();
  const denied = await requireRight(session, "loans.apply");
  if (denied) return denied;
  const orgId = session!.user!.orgId!;

  let body: {
    borrowerId?: string; productId?: string; amount?: number; note?: string;
    payee?: { name?: string; paybill?: string; account?: string };
  };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const amount = Math.round(Number(body.amount) * 100) / 100;
  if (!body.borrowerId || !body.productId) {
    return NextResponse.json({ success: false, message: "Pick the borrower and the product." }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ success: false, message: "Enter the amount." }, { status: 400 });
  }

  const [borrower, product] = await Promise.all([
    prisma.borrower.findFirst({ where: { id: body.borrowerId, orgId } }),
    prisma.product.findFirst({ where: { id: body.productId, orgId, isActive: true } }),
  ]);
  if (!borrower) return NextResponse.json({ success: false, message: "Borrower not found." }, { status: 404 });
  if (!product) return NextResponse.json({ success: false, message: "Product not found or inactive." }, { status: 404 });

  const min = Number(product.minPrincipal);
  const max = Number(product.maxPrincipal);
  if ((min > 0 && amount < min) || (max > 0 && amount > max)) {
    return NextResponse.json({
      success: false,
      message: `${product.name} lends ${min > 0 ? `from KES ${min.toLocaleString()}` : ""}${max > 0 ? ` up to KES ${max.toLocaleString()}` : ""}.`.trim(),
    }, { status: 400 });
  }

  // Pay-to-institution products (§7): the payee is part of the application —
  // a school-fees loan with no school on it cannot book, so refuse it up front.
  let payee: { name: string | null; paybill: string; account: string | null } | null = null;
  if (product.disbursementMode === "TO_THIRD_PARTY") {
    const paybill = (body.payee?.paybill ?? "").replace(/\D/g, "");
    if (!/^\d{5,8}$/.test(paybill)) {
      return NextResponse.json({ success: false, message: "This product pays the institution directly — enter the school's paybill number (5–8 digits)." }, { status: 400 });
    }
    payee = {
      name: body.payee?.name?.trim().slice(0, 80) || null,
      paybill,
      account: body.payee?.account?.trim().slice(0, 30) || null,
    };
  }

  // One live application per borrower — same rule the funnel enforces.
  const open = await prisma.loanApplication.findFirst({
    where: { orgId, borrowerId: borrower.id, status: { in: [...LIVE] } },
    select: { id: true },
  });
  if (open) {
    return NextResponse.json({ success: false, message: "This borrower already has an application in the queue." }, { status: 409 });
  }

  // Whose application this is. Inherited from the borrower's owning officer where there
  // is one, so an application does not change hands just because a different officer
  // happened to key it in; falls back to the officer keying it in.
  const me = await prisma.staffUser.findFirst({
    where: { id: session!.user!.id, orgId },
    select: { id: true, branchId: true },
  });
  const origin = await originStamp(orgId, me);

  const app = await prisma.loanApplication.create({
    data: {
      orgId,
      officerId: borrower.createdById ?? origin.staffId,
      branchId: borrower.branchId ?? origin.branchId,
      borrowerId: borrower.id,
      productId: product.id,
      productName: product.name,
      phone: borrower.phone,
      nationalId: borrower.nationalId,
      borrowerName: `${borrower.firstName ?? ""}${borrower.otherName ? " " + borrower.otherName : ""}`.trim() || null,
      amountRequested: amount,
      status: "OFFICER_REVIEW",
      stageTitle: "Officer review (assisted)",
      fusionEngine: "assisted",
      lat: borrower.lat,
      lng: borrower.lng,
      locationType: borrower.locationType,
      locationAddress: borrower.locationAddress,
      payeeName: payee?.name ?? null,
      payeePaybill: payee?.paybill ?? null,
      payeeAccount: payee?.account ?? null,
    },
  });

  await prisma.auditLog.create({
    data: {
      orgId, actorId: session!.user!.id, actorType: "staff", action: "application.assisted",
      entity: "LoanApplication", entityId: app.id,
      meta: { borrowerId: borrower.id, product: product.name, amount, note: body.note?.trim() || null },
    },
  }).catch(() => {});

  // A walk-in SME with a captured business location gets the same auto-dispatched
  // verification the funnel schedules (entitlement-gated inside, best-effort).
  if (borrower.locationType === "business" && borrower.lat != null && borrower.lng != null) {
    await autoScheduleVerification({
      orgId, borrowerId: borrower.id, applicationId: app.id,
      lat: borrower.lat, lng: borrower.lng,
      label: `${borrower.firstName ?? borrower.phone} (business verification)`,
      address: borrower.locationAddress,
    });
  }

  return NextResponse.json({ success: true, applicationId: app.id });
}
