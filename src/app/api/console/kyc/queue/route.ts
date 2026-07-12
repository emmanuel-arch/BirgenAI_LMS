// KYC VERIFICATION — the queue of customers who are registered but not yet proven.
//
//   GET    → the unverified, oldest first, scoped to what the caller may see
//   POST   → { borrowerId, action: "send-link" } — text them their verification link
//   DELETE → ?id=  remove a stale unverified borrower (borrowers.manage)
//
// WHY THIS EXISTS AS ITS OWN QUEUE. Registration and verification had drifted apart:
// an officer could register a walk-in, the borrower would sit at kycStatus NONE
// forever, and nothing anywhere said so. Meanwhile the disbursement queue would
// happily pay them. A lender's own question — "who have we onboarded but not
// verified?" — had no screen that answered it.
//
// It is a GATE, not a report. An unverified borrower cannot be disbursed to
// (api/console/disbursements/[id]), so this list is the thing standing between a
// customer and their money. It should be short: a handful per officer, cleared daily.
// Anything ageing at the bottom is either a lead going cold or a person who was never
// real, which is exactly why deletion lives here too — an officer who keys in
// half-finished customers for the sake of it should have to look at them.
//
// SCOPED, like every other book surface: an officer works their OWN customers (they
// registered them), a branch manager the branch's, a validator/admin the lot. That
// falls out of src/lib/rbac/scope.ts rather than being re-invented here.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { prisma } from "@/lib/prisma";
import { resolveScope, borrowerScopeWhere, canSeeBorrower } from "@/lib/rbac/scope";
import { sendSms } from "@/lib/sms/send";

export const runtime = "nodejs";

/** Everything that is not a finished, passed verification. */
const UNVERIFIED = ["NONE", "IN_PROGRESS", "PENDING_REVIEW", "FAILED"] as const;

const days = (from: Date) => Math.floor((Date.now() - from.getTime()) / 86_400_000);

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "borrowers.view");
  if (denied) return denied;
  const orgId = session.user.orgId;

  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  const scope = await resolveScope(session);

  // Phones are stored 2547…; a person searching types 07…. Match the last 9 either way.
  const digits = q.replace(/\D/g, "");
  const phoneNeedle = digits.length >= 9 ? digits.slice(-9) : digits;

  const rows = await prisma.borrower.findMany({
    where: {
      orgId,
      ...borrowerScopeWhere(scope),
      kycStatus: { in: UNVERIFIED as unknown as never },
      ...(q
        ? {
            OR: [
              { firstName: { contains: q, mode: "insensitive" as const } },
              { otherName: { contains: q, mode: "insensitive" as const } },
              ...(phoneNeedle ? [{ phone: { endsWith: phoneNeedle } }] : []),
              ...(digits ? [{ nationalId: { contains: digits } }] : []),
            ],
          }
        : {}),
    },
    orderBy: { createdAt: "asc" }, // oldest first: the stale ones are the point
    take: 200,
    select: {
      id: true, firstName: true, otherName: true, phone: true, nationalId: true,
      kycStatus: true, createdAt: true, createdById: true, branchId: true,
      _count: { select: { applications: true, loans: true } },
    },
  });

  // Borrower carries branchId as a scalar (no relation), so the names are looked up in
  // one extra query rather than a join.
  const [officers, branches] = await Promise.all([
    prisma.staffUser.findMany({
      where: { orgId, id: { in: [...new Set(rows.map((r) => r.createdById).filter(Boolean))] as string[] } },
      select: { id: true, firstName: true, otherName: true },
    }),
    prisma.branch.findMany({
      where: { orgId, id: { in: [...new Set(rows.map((r) => r.branchId).filter(Boolean))] as string[] } },
      select: { id: true, name: true },
    }),
  ]);
  const officerOf = new Map(officers.map((o) => [o.id, `${o.firstName} ${o.otherName ?? ""}`.trim()]));
  const branchOf = new Map(branches.map((b) => [b.id, b.name]));

  // What the lender is actually paying for this queue not being empty: customers who
  // have already asked for money and cannot legally be given it.
  const blocked = rows.filter((r) => r._count.applications > 0 || r._count.loans > 0).length;

  return NextResponse.json({
    success: true,
    canVerify: !(await requireRight(session, "kyc.verify")),
    canDelete: !(await requireRight(session, "borrowers.manage")),
    scope: scope.kind,
    blocked,
    borrowers: rows.map((r) => ({
      id: r.id,
      name: `${r.firstName ?? ""} ${r.otherName ?? ""}`.trim() || "Unnamed",
      phone: r.phone,
      nationalId: r.nationalId,
      kycStatus: r.kycStatus,
      branch: r.branchId ? branchOf.get(r.branchId) ?? null : null,
      officer: r.createdById ? officerOf.get(r.createdById) ?? null : null,
      // The portal's own walk-ins have no officer. Say so rather than showing a blank.
      selfRegistered: !r.createdById,
      waitingDays: days(r.createdAt),
      applications: r._count.applications,
      loans: r._count.loans,
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "kyc.verify");
  if (denied) return denied;
  const orgId = session.user.orgId;

  let body: { borrowerId?: string; action?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const scope = await resolveScope(session);
  const borrowerId = String(body.borrowerId ?? "");
  if (!(await canSeeBorrower(scope, borrowerId))) {
    return NextResponse.json({ success: false, message: "That borrower isn't yours to verify." }, { status: 403 });
  }

  const borrower = await prisma.borrower.findFirst({
    where: { id: borrowerId, orgId },
    select: { id: true, phone: true, firstName: true, kycStatus: true },
  });
  if (!borrower) return NextResponse.json({ success: false, message: "Borrower not found." }, { status: 404 });
  if (borrower.kycStatus === "VERIFIED") {
    return NextResponse.json({ success: false, message: "They're already verified." }, { status: 409 });
  }

  if (body.action !== "send-link") {
    return NextResponse.json({ success: false, message: "Unknown action." }, { status: 400 });
  }

  const org = await prisma.org.findUnique({ where: { id: orgId }, select: { slug: true, name: true } });
  const base = (process.env.PUBLIC_BASE_URL ?? "https://lms.birgenai.com").replace(/\/$/, "");
  const link = `${base}/verify?lender=${org?.slug ?? ""}`;

  // Deliberately not a "critical" template: verification is important but it is not a
  // signature or an OTP, so it must not overdraw a lender's SMS wallet.
  await sendSms(orgId, borrower.phone, "kyc_link", {
    org: org?.name ?? "Your lender",
    name: borrower.firstName ?? "there",
    link,
  });

  await prisma.auditLog.create({
    data: { orgId, actorId: session.user.id, actorType: "staff", action: "kyc.link-sent", entity: "Borrower", entityId: borrower.id },
  }).catch(() => {});

  return NextResponse.json({ success: true, message: `Verification link sent to ${borrower.phone}.` });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "borrowers.manage");
  if (denied) return denied;
  const orgId = session.user.orgId;

  const id = String(new URL(req.url).searchParams.get("id") ?? "");
  const scope = await resolveScope(session);
  if (!(await canSeeBorrower(scope, id))) {
    return NextResponse.json({ success: false, message: "That borrower isn't yours to delete." }, { status: 403 });
  }

  const borrower = await prisma.borrower.findFirst({
    where: { id, orgId },
    select: {
      id: true, firstName: true, otherName: true, kycStatus: true,
      _count: { select: { applications: true, loans: true } },
    },
  });
  if (!borrower) return NextResponse.json({ success: false, message: "Borrower not found." }, { status: 404 });

  // TWO REFUSALS, and they are different refusals.
  //
  // A VERIFIED borrower is a person whose identity this lender has attested to. Deleting
  // that record deletes the evidence, so it does not happen from a cleanup screen.
  if (borrower.kycStatus === "VERIFIED") {
    return NextResponse.json({
      success: false,
      message: "This borrower is verified — their identity record can't be deleted from here.",
    }, { status: 409 });
  }
  // And anyone who has ASKED for money has a history worth keeping, verified or not: a
  // declined application is a training label, and a loan is a loan.
  if (borrower._count.applications > 0 || borrower._count.loans > 0) {
    return NextResponse.json({
      success: false,
      message: "They've already applied for a loan, so their record has to stay. Verify them instead.",
    }, { status: 409 });
  }

  const name = `${borrower.firstName ?? ""} ${borrower.otherName ?? ""}`.trim() || "Unnamed";

  // Their unfinished KYC trail goes with them — leaving orphaned identity artefacts
  // (a photo of a national ID) behind a deleted person is the worst of both worlds.
  await prisma.kycCheck.deleteMany({ where: { orgId, borrowerId: id } });
  await prisma.consent.deleteMany({ where: { orgId, borrowerId: id } });
  await prisma.borrower.delete({ where: { id } });

  await prisma.auditLog.create({
    data: { orgId, actorId: session.user.id, actorType: "staff", action: "borrower.delete", entity: "Borrower", entityId: id, meta: { name, reason: "unverified, never applied" } },
  }).catch(() => {});

  return NextResponse.json({ success: true, message: `${name} removed.` });
}
