// GET /api/console/borrowers/[id]/limit-check — what this borrower qualifies for,
// per product, BEFORE anyone applies. The affordability-first limit engine
// (lib/lending/limits.ts) run against their most recent crunched statement and their
// history with this lender, so an officer at the counter can answer "how much can I
// give them, and what does that repay?" without keying a speculative application.
//
// The statement SCORE is never trusted from storage as-is: the stored FEATURES are
// re-scored here by the same engine the apply route uses, so the number on this
// screen and the wall at apply cannot disagree.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { prisma } from "@/lib/prisma";
import { resolveScope, canSeeBorrower } from "@/lib/rbac/scope";
import { scoreThinFileAuto } from "@/lib/statement/score-thinfile";
import type { CashflowFeatures } from "@/lib/statement/features";
import { fuseScores } from "@/lib/scoring/fusion";
import { computeApprovedLimit } from "@/lib/lending/limits";

export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const denied = await requireRight(session, "loans.apply");
  if (denied) return denied;
  const orgId = session!.user!.orgId!;
  const { id } = await ctx.params;

  const scope = await resolveScope(session!);
  if (!(await canSeeBorrower(scope, id))) {
    return NextResponse.json({ success: false, message: "Borrower not found." }, { status: 404 });
  }

  const borrower = await prisma.borrower.findFirst({
    where: { id, orgId },
    select: { id: true, graduationCount: true, creditScore: true },
  });
  if (!borrower) return NextResponse.json({ success: false, message: "Borrower not found." }, { status: 404 });

  // The most recent crunch that actually carried cashflow features. Filtering Json
  // NULL in the query is fiddly (Prisma.DbNull vs JsonNull); cheaper to take the last
  // few snapshots and pick the first that has features.
  const recent = await prisma.scoreSnapshot.findMany({
    where: { orgId, borrowerId: id },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: { features: true, createdAt: true, score: true },
  });
  const snapshot = recent.find((s) => s.features != null && typeof s.features === "object") ?? null;

  const [book, products] = await Promise.all([
    prisma.loan.findMany({ where: { orgId, borrowerId: id }, select: { status: true, loanAmount: true } }),
    prisma.product.findMany({
      where: { orgId, isActive: true },
      orderBy: { minPrincipal: "asc" },
      select: {
        id: true, name: true, minPrincipal: true, maxPrincipal: true, interestRate: true,
        interestMethod: true, repaymentPeriod: true, repaymentPeriodUnit: true, minLoanLimit: true,
        guarantorRequired: true, securityRequired: true,
      },
    }),
  ]);

  const cleared = book.filter((l) => l.status === "CLEARED");
  const priorLoanCount = cleared.length;
  const active = book.filter((l) => l.status === "ACTIVE" || l.status === "PENDING_DISBURSEMENT").length;
  const graduated = borrower.graduationCount > 0 || (priorLoanCount >= 5 && active === 0);
  const largestCleared = cleared.reduce((m, l) => Math.max(m, Number(l.loanAmount)), 0) || null;

  // Score the stored features once — a partial payload is a soft "no statement",
  // never a 500 (the /api/lms/limit lesson).
  const features = (snapshot?.features ?? null) as CashflowFeatures | null;
  let pd = 0.15;
  let decision = "REVIEW";
  let avgMonthlyNet: number | null = null;
  let hasStatement = false;
  if (features && typeof features === "object") {
    try {
      const thin = scoreThinFileAuto(features);
      const fused = fuseScores({ thinFilePd: thin.pd, originationPd: null, hasHistory: graduated || priorLoanCount > 0 });
      pd = fused.pd;
      decision = fused.decision;
      avgMonthlyNet = Number((features as { avgMonthlyNet?: number }).avgMonthlyNet) || null;
      hasStatement = true;
    } catch {
      hasStatement = false;
    }
  }

  const rows = products.map((p) => {
    const limit = computeApprovedLimit({
      pd,
      decision,
      avgMonthlyNet,
      priorLoanCount,
      graduated,
      largestCleared,
      productMin: Number(p.minPrincipal),
      productMax: Number(p.maxPrincipal),
      productRate: Number(p.interestRate),
      repaymentPeriod: p.repaymentPeriod,
      repaymentPeriodUnit: p.repaymentPeriodUnit,
      minLoanLimit: p.minLoanLimit != null ? Number(p.minLoanLimit) : null,
    });
    return {
      productId: p.id,
      productName: p.name,
      interestRate: Number(p.interestRate),
      interestMethod: p.interestMethod,
      guarantorRequired: p.guarantorRequired,
      securityRequired: p.securityRequired,
      approvedLimit: limit.approvedLimit,
      affordableInstallment: limit.affordableInstallment,
      installmentCount: limit.installmentCount,
      installmentUnit: limit.installmentUnit,
      borrowerClass: limit.borrowerClass,
      reasons: limit.reasons,
    };
  });

  return NextResponse.json({
    success: true,
    basis: {
      hasStatement,
      avgMonthlyNet,
      pd,
      decision,
      statementScore: snapshot?.score ?? borrower.creditScore ?? null,
      crunchedAt: snapshot?.createdAt ?? null,
      priorLoanCount,
      graduated,
      borrowerClass: rows[0]?.borrowerClass ?? "NEW",
    },
    products: rows,
  });
}
