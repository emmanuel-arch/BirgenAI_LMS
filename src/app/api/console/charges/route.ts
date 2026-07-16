// GET/POST/PATCH/DELETE /api/console/charges — the lender's own fee catalogue.
//
// A charge is DATA, not code: a registration fee is a price, it differs per lender,
// and a lender must be able to change it without a deploy. (Contrast the retention
// policy and the metric catalogue, which are code precisely because they are shared
// definitions and legal positions.)
//
// ONE THING IS NOT THE LENDER'S TO SET: a PLATFORM charge is BirgenAI's own fee and
// settles to BirgenAI's Till. A lender's admin may not create one, rename one, or
// switch one off — that would be a lender voting on our invoice.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const KINDS = ["MANUAL", "ON_REGISTRATION", "ON_APPLICATION"] as const;

export async function GET() {
  const session = await auth();
  const denied = await requireRight(session, "products.view");
  if (denied) return denied;
  const orgId = session!.user!.orgId!;

  const charges = await prisma.charge.findMany({ where: { orgId }, orderBy: { createdAt: "asc" } });
  return NextResponse.json({
    success: true,
    charges: charges.map((c) => ({
      id: c.id, name: c.name, code: c.code, description: c.description,
      amount: Number(c.amount), isPercent: c.isPercent,
      trigger: c.trigger, beneficiary: c.beneficiary,
      isActive: c.isActive,
      // A platform fee is ours. The screen renders it read-only.
      locked: c.beneficiary === "PLATFORM",
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const denied = await requireRight(session, "products.manage");
  if (denied) return denied;
  const orgId = session!.user!.orgId!;

  let body: { name?: string; code?: string; description?: string; amount?: number; isPercent?: boolean; trigger?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const name = (body.name ?? "").trim();
  const code = (body.code ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  const amount = Number(body.amount);
  const isPercent = !!body.isPercent;

  if (!name) return NextResponse.json({ success: false, message: "Give the charge a name." }, { status: 400 });
  // The code becomes the M-Pesa AccountReference the customer SEES on their phone.
  if (!code) return NextResponse.json({ success: false, message: "Give it a short code — the customer sees it on their M-Pesa prompt." }, { status: 400 });
  if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ success: false, message: "Enter an amount above zero." }, { status: 400 });
  if (isPercent && amount > 100) return NextResponse.json({ success: false, message: "A percentage cannot be more than 100." }, { status: 400 });

  const dup = await prisma.charge.findFirst({ where: { orgId, code } });
  if (dup) return NextResponse.json({ success: false, message: `You already have a charge with the code ${code}.` }, { status: 409 });

  const charge = await prisma.charge.create({
    data: {
      orgId, name, code,
      description: body.description?.trim() || null,
      amount, isPercent,
      trigger: (KINDS as readonly string[]).includes(String(body.trigger)) ? (body.trigger as "MANUAL") : "MANUAL",
      // A lender can only ever create their OWN fee. Ours are seeded by the platform.
      beneficiary: "LENDER",
    },
  });

  await prisma.auditLog.create({
    data: {
      orgId, actorId: session!.user!.id, actorType: "staff", action: "charge.create",
      entity: "Charge", entityId: charge.id,
      meta: { name, code, amount, isPercent, trigger: charge.trigger },
    },
  }).catch(() => {});

  return NextResponse.json({ success: true, id: charge.id });
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  const denied = await requireRight(session, "products.manage");
  if (denied) return denied;
  const orgId = session!.user!.orgId!;

  let body: { id?: string; amount?: number; isActive?: boolean; name?: string; description?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const charge = await prisma.charge.findFirst({ where: { id: String(body.id ?? ""), orgId } });
  if (!charge) return NextResponse.json({ success: false, message: "Charge not found." }, { status: 404 });
  if (charge.beneficiary === "PLATFORM") {
    return NextResponse.json({ success: false, message: "That is a BirgenAI platform fee — it is not yours to change." }, { status: 403 });
  }

  const data: Record<string, unknown> = {};
  const changed: Record<string, { from: unknown; to: unknown }> = {};

  if (typeof body.amount === "number" && Number.isFinite(body.amount) && body.amount > 0) {
    if (charge.isPercent && body.amount > 100) {
      return NextResponse.json({ success: false, message: "A percentage cannot be more than 100." }, { status: 400 });
    }
    changed.amount = { from: Number(charge.amount), to: body.amount };
    data.amount = body.amount;
  }
  if (typeof body.isActive === "boolean") {
    changed.isActive = { from: charge.isActive, to: body.isActive };
    data.isActive = body.isActive;
  }
  if (typeof body.name === "string" && body.name.trim()) {
    changed.name = { from: charge.name, to: body.name.trim() };
    data.name = body.name.trim();
  }
  if (typeof body.description === "string") data.description = body.description.trim() || null;

  if (Object.keys(data).length === 0) return NextResponse.json({ success: false, message: "Nothing to change." }, { status: 400 });

  await prisma.charge.update({ where: { id: charge.id }, data });
  // A price change is money-adjacent: before and after, both on the record.
  await prisma.auditLog.create({
    data: {
      orgId, actorId: session!.user!.id, actorType: "staff", action: "charge.update",
      entity: "Charge", entityId: charge.id, meta: { code: charge.code, changed },
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
