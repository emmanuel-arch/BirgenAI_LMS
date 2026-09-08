// GET/POST/PATCH/DELETE /api/console/charges — the lender's own fee catalogue.
//
// A charge is DATA, not code: a registration fee is a price, it differs per lender,
// and a lender must be able to change it without a deploy. (Contrast the retention
// policy and the metric catalogue, which are code precisely because they are shared
// definitions and legal positions.)
//
// The whole SHAPE of a fee — the four independent questions, the percentage
// reference, the hybrid bounds, the principal band — lives in lib/products/charges.ts
// so that this route, the charges screen and the product builder's Charges step are
// all pricing the same object. Validation runs there too, which is why this file is
// mostly plumbing: it decides who may act, not what a fee is.
//
// ONE THING IS NOT THE LENDER'S TO SET: a PLATFORM charge is BirgenAI's own fee and
// settles to BirgenAI's Till. A lender's admin may not create one, rename one, or
// switch one off — that would be a lender voting on our invoice.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { prisma } from "@/lib/prisma";
import {
  chargeFromRow, chargeToRow, validateCharge, describeCharge,
  EMPTY_CHARGE, type ChargeShape,
} from "@/lib/products/charges";

export const runtime = "nodejs";

/** Read whatever the client sent into the full shape, defaults filling the gaps. */
function shapeFrom(body: Record<string, unknown>, base: ChargeShape = EMPTY_CHARGE): ChargeShape {
  const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const nullableNum = (v: unknown, d: number | null) =>
    v === null || v === undefined || v === "" ? d : Number.isFinite(Number(v)) ? Number(v) : d;
  const str = (v: unknown, d: string) => (typeof v === "string" ? v : d);

  return {
    id: base.id,
    name: str(body.name, base.name).trim(),
    code: str(body.code, base.code).trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12),
    description: str(body.description, base.description),
    valueType: (["fixed", "percent", "hybrid"] as const).includes(body.valueType as never)
      ? (body.valueType as ChargeShape["valueType"]) : base.valueType,
    value: num(body.value ?? body.amount, base.value),
    percentOf: (["principal", "principal_interest", "instalment", "outstanding_balance"] as const).includes(body.percentOf as never)
      ? (body.percentOf as ChargeShape["percentOf"]) : base.percentOf,
    minValue: nullableNum(body.minValue, base.minValue),
    maxValue: nullableNum(body.maxValue, base.maxValue),
    minPrincipal: nullableNum(body.minPrincipal, base.minPrincipal),
    maxPrincipal: nullableNum(body.maxPrincipal, base.maxPrincipal),
    trigger: (["MANUAL", "ON_REGISTRATION", "ON_APPLICATION"] as const).includes(body.trigger as never)
      ? (body.trigger as ChargeShape["trigger"]) : base.trigger,
    applyAt: (["BEFORE_DISBURSEMENT", "DEDUCT_FROM_PRINCIPAL", "ON_INSTALLMENTS"] as const).includes(body.applyAt as never)
      ? (body.applyAt as ChargeShape["applyAt"]) : base.applyAt,
    isMandatory: typeof body.isMandatory === "boolean" ? body.isMandatory : base.isMandatory,
    glAccount: str(body.glAccount, base.glAccount),
    productId: body.productId === null ? null : typeof body.productId === "string" && body.productId ? body.productId : base.productId,
    isActive: typeof body.isActive === "boolean" ? body.isActive : base.isActive,
  };
}

export async function GET(req: NextRequest) {
  const session = await auth();
  const denied = await requireRight(session, "products.view");
  if (denied) return denied;
  const orgId = session!.user!.orgId!;

  // ?productId=… narrows to one product's sheet. `scope=product` excludes the
  // shelf-wide fees, so the builder's Charges step can show "this product's own"
  // separately from "everything that also applies here".
  const productId = req.nextUrl.searchParams.get("productId");
  const scope = req.nextUrl.searchParams.get("scope");

  const where = productId
    ? scope === "product"
      ? { orgId, productId }
      : { orgId, OR: [{ productId }, { productId: null }] }
    : { orgId };

  const charges = await prisma.charge.findMany({ where, orderBy: [{ productId: "asc" }, { createdAt: "asc" }] });

  return NextResponse.json({
    success: true,
    charges: charges.map((c) => {
      const shape = chargeFromRow(c);
      return {
        ...shape,
        // Kept for callers written before the shared shape existed.
        amount: shape.value,
        isPercent: shape.valueType !== "fixed",
        beneficiary: c.beneficiary,
        summary: describeCharge(shape),
        // A platform fee is ours. The screen renders it read-only.
        locked: c.beneficiary === "PLATFORM",
      };
    }),
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const denied = await requireRight(session, "products.manage");
  if (denied) return denied;
  const orgId = session!.user!.orgId!;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const shape = shapeFrom(body);
  const issues = validateCharge(shape);
  if (issues.length) {
    return NextResponse.json({ success: false, message: issues[0].message, issues }, { status: 422 });
  }

  if (shape.productId) {
    const owned = await prisma.product.findFirst({ where: { id: shape.productId, orgId }, select: { id: true } });
    if (!owned) return NextResponse.json({ success: false, message: "Product not found." }, { status: 404 });
  }

  const dup = await prisma.charge.findFirst({ where: { orgId, code: shape.code } });
  if (dup) return NextResponse.json({ success: false, message: `You already have a charge with the code ${shape.code}.` }, { status: 409 });

  const charge = await prisma.charge.create({
    // A lender can only ever create their OWN fee. Ours are seeded by the platform.
    data: { orgId, ...chargeToRow(shape), beneficiary: "LENDER" },
  });

  await prisma.auditLog.create({
    data: {
      orgId, actorId: session!.user!.id, actorType: "staff", action: "charge.create",
      entity: "Charge", entityId: charge.id,
      meta: { name: shape.name, code: shape.code, price: describeCharge(shape), productId: shape.productId },
    },
  }).catch(() => {});

  return NextResponse.json({ success: true, id: charge.id });
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  const denied = await requireRight(session, "products.manage");
  if (denied) return denied;
  const orgId = session!.user!.orgId!;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const existing = await prisma.charge.findFirst({ where: { id: String(body.id ?? ""), orgId } });
  if (!existing) return NextResponse.json({ success: false, message: "Charge not found." }, { status: 404 });
  if (existing.beneficiary === "PLATFORM") {
    return NextResponse.json({ success: false, message: "That is a BirgenAI platform fee — it is not yours to change." }, { status: 403 });
  }

  const before = chargeFromRow(existing);
  const after = shapeFrom(body, before);
  const issues = validateCharge(after);
  if (issues.length) {
    return NextResponse.json({ success: false, message: issues[0].message, issues }, { status: 422 });
  }

  // A code is the customer's M-Pesa reference and other people's receipts point at
  // it, so it may not be edited into somebody else's.
  if (after.code !== before.code) {
    const clash = await prisma.charge.findFirst({ where: { orgId, code: after.code, NOT: { id: existing.id } } });
    if (clash) return NextResponse.json({ success: false, message: `You already have a charge with the code ${after.code}.` }, { status: 409 });
  }

  const row = chargeToRow(after);
  await prisma.charge.update({ where: { id: existing.id }, data: row });

  // A price change is money-adjacent: before and after, both on the record.
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of Object.keys(row) as (keyof typeof row)[]) {
    const from = (chargeToRow(before) as Record<string, unknown>)[k];
    const to = (row as Record<string, unknown>)[k];
    if (JSON.stringify(from) !== JSON.stringify(to)) changed[k] = { from, to };
  }
  await prisma.auditLog.create({
    data: {
      orgId, actorId: session!.user!.id, actorType: "staff", action: "charge.update",
      entity: "Charge", entityId: existing.id,
      meta: { code: existing.code, changed, price: describeCharge(after) },
    },
  }).catch(() => {});

  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  const denied = await requireRight(session, "products.manage");
  if (denied) return denied;
  const orgId = session!.user!.orgId!;

  const id = req.nextUrl.searchParams.get("id") ?? "";
  const charge = await prisma.charge.findFirst({ where: { id, orgId } });
  if (!charge) return NextResponse.json({ success: false, message: "Charge not found." }, { status: 404 });
  if (charge.beneficiary === "PLATFORM") {
    return NextResponse.json({ success: false, message: "That is a BirgenAI platform fee — it is not yours to delete." }, { status: 403 });
  }

  // A charge that customers have PAID is a financial record. Switch it off; never
  // delete it, or the receipts point at nothing.
  const paid = await prisma.paymentIntent.count({ where: { orgId, chargeId: id, state: "SUCCESS" } });
  if (paid > 0) {
    await prisma.charge.update({ where: { id }, data: { isActive: false } });
    await prisma.auditLog.create({
      data: { orgId, actorId: session!.user!.id, actorType: "staff", action: "charge.deactivate", entity: "Charge", entityId: id, meta: { code: charge.code, paidCount: paid } },
    }).catch(() => {});
    return NextResponse.json({ success: true, deactivated: true, message: `${paid} customer${paid === 1 ? " has" : "s have"} already paid this fee, so it has been switched off rather than deleted — their receipts still need it to exist.` });
  }

  await prisma.charge.delete({ where: { id } });
  await prisma.auditLog.create({
    data: { orgId, actorId: session!.user!.id, actorType: "staff", action: "charge.delete", entity: "Charge", entityId: id, meta: { code: charge.code } },
  }).catch(() => {});
  return NextResponse.json({ success: true });
}
