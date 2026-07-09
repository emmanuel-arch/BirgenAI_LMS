// Console products API (staff, own org).
//   GET  → active + inactive products for the org
//   POST → create a product (admin only)
//   PUT  → update a product by id (admin only)
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth, hasAdminAccess } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type Body = {
  id?: string;
  name?: string;
  description?: string;
  minPrincipal?: number;
  maxPrincipal?: number;
  interestRate?: number;
  interestMethod?: "flat" | "reducing";
  interestPeriodUnit?: string;
  repaymentPeriod?: number;
  repaymentPeriodUnit?: string;
  gracePeriodDays?: number;
  penaltyRate?: number;
  minCreditScore?: number;
  disbursementMode?: "B2C_MPESA" | "MANUAL" | "TO_THIRD_PARTY" | "LENDER_SIDE";
  isActive?: boolean;
  newWorkflowId?: string | null;
  repeatWorkflowId?: string | null;
};

export async function GET() {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const products = await prisma.product.findMany({
    where: { orgId: session.user.orgId },
    orderBy: [{ isActive: "desc" }, { minPrincipal: "asc" }],
    take: 200,
  });
  return NextResponse.json({ success: true, products });
}

function validate(b: Body): string | null {
  if (!b.name || b.name.trim().length < 3) return "Enter the product name.";
  const min = Number(b.minPrincipal), max = Number(b.maxPrincipal), rate = Number(b.interestRate);
  if (!Number.isFinite(min) || min < 0) return "Enter a valid minimum principal.";
  if (!Number.isFinite(max) || max < min) return "Maximum principal must be ≥ the minimum.";
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) return "Enter a valid interest rate (0–100%).";
  const n = Number(b.repaymentPeriod);
  if (!Number.isInteger(n) || n < 1 || n > 120) return "Repayment period must be 1–120 installments.";
  return null;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId || !hasAdminAccess(session)) {
    return NextResponse.json({ success: false, message: "Admin sign-in required." }, { status: 401 });
  }
  let body: Body;
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const err = validate(body);
  if (err) return NextResponse.json({ success: false, message: err }, { status: 400 });

  const product = await prisma.product.create({
    data: {
      orgId: session.user.orgId,
      name: body.name!.trim(),
      description: body.description?.trim() || null,
      minPrincipal: new Prisma.Decimal(Number(body.minPrincipal)),
      maxPrincipal: new Prisma.Decimal(Number(body.maxPrincipal)),
      interestRate: new Prisma.Decimal(Number(body.interestRate)),
      interestMethod: body.interestMethod === "reducing" ? "reducing" : "flat",
      interestPeriodUnit: body.interestPeriodUnit || "term",
      repaymentPeriod: Number(body.repaymentPeriod),
      repaymentPeriodUnit: body.repaymentPeriodUnit || "week",
      gracePeriodDays: Number.isInteger(body.gracePeriodDays) ? body.gracePeriodDays! : 0,
      penaltyRate: Number.isFinite(Number(body.penaltyRate)) ? new Prisma.Decimal(Number(body.penaltyRate)) : null,
      minCreditScore: Number.isInteger(body.minCreditScore) ? body.minCreditScore! : null,
      disbursementMode: body.disbursementMode ?? "B2C_MPESA",
      isActive: body.isActive ?? true,
      newWorkflowId: body.newWorkflowId || null,
      repeatWorkflowId: body.repeatWorkflowId || null,
    },
  });
  await prisma.auditLog.create({
    data: { orgId: session.user.orgId, actorId: session.user.id, actorType: "staff", action: "product.create", entity: "Product", entityId: product.id },
  }).catch(() => {});
  return NextResponse.json({ success: true, product });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId || !hasAdminAccess(session)) {
    return NextResponse.json({ success: false, message: "Admin sign-in required." }, { status: 401 });
  }
  let body: Body;
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ success: false, message: "Product id required." }, { status: 400 });

  const existing = await prisma.product.findFirst({ where: { id: body.id, orgId: session.user.orgId } });
  if (!existing) return NextResponse.json({ success: false, message: "Product not found." }, { status: 404 });

  const err = validate({ ...existing, ...body, minPrincipal: Number(body.minPrincipal ?? existing.minPrincipal), maxPrincipal: Number(body.maxPrincipal ?? existing.maxPrincipal), interestRate: Number(body.interestRate ?? existing.interestRate), repaymentPeriod: body.repaymentPeriod ?? existing.repaymentPeriod, name: body.name ?? existing.name } as Body);
  if (err) return NextResponse.json({ success: false, message: err }, { status: 400 });

  const product = await prisma.product.update({
    where: { id: existing.id },
    data: {
      name: body.name?.trim() ?? undefined,
      description: body.description !== undefined ? body.description?.trim() || null : undefined,
      minPrincipal: body.minPrincipal !== undefined ? new Prisma.Decimal(Number(body.minPrincipal)) : undefined,
      maxPrincipal: body.maxPrincipal !== undefined ? new Prisma.Decimal(Number(body.maxPrincipal)) : undefined,
      interestRate: body.interestRate !== undefined ? new Prisma.Decimal(Number(body.interestRate)) : undefined,
      interestMethod: body.interestMethod ?? undefined,
      repaymentPeriod: body.repaymentPeriod ?? undefined,
      repaymentPeriodUnit: body.repaymentPeriodUnit ?? undefined,
      gracePeriodDays: body.gracePeriodDays ?? undefined,
      penaltyRate: body.penaltyRate !== undefined ? new Prisma.Decimal(Number(body.penaltyRate)) : undefined,
      minCreditScore: body.minCreditScore !== undefined ? body.minCreditScore : undefined,
      disbursementMode: body.disbursementMode ?? undefined,
      isActive: body.isActive ?? undefined,
      newWorkflowId: body.newWorkflowId !== undefined ? body.newWorkflowId || null : undefined,
      repeatWorkflowId: body.repeatWorkflowId !== undefined ? body.repeatWorkflowId || null : undefined,
    },
  });
  await prisma.auditLog.create({
    data: { orgId: session.user.orgId, actorId: session.user.id, actorType: "staff", action: "product.update", entity: "Product", entityId: product.id },
  }).catch(() => {});
  return NextResponse.json({ success: true, product });
}
