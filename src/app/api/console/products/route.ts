// ─────────────────────────────────────────────────────────────────────────────
// Console products API (staff, own org).
//
//   GET → active + inactive products for the org
//   PUT → shelve or unshelve a product: { id, isActive }
//
// TERMS ARE NOT WRITABLE HERE. Creating a product, and every subsequent change to
// what it costs or how it repays, goes through POST /api/console/products/publish,
// which snapshots an immutable ProductVersion and stamps it on every loan booked
// afterwards. This route used to accept the full field set on POST and PUT; that is
// exactly the shape that makes a product's past unknowable, so it is gone rather
// than merely discouraged — a bypass that exists will eventually be used.
//
// `isActive` stays here on purpose: shelving a product does not change what anyone
// already agreed to, so it is not a new version and should not create one.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "products.view");
  if (denied) return denied;

  const products = await prisma.product.findMany({
    where: { orgId: session.user.orgId },
    orderBy: [{ isActive: "desc" }, { minPrincipal: "asc" }],
    take: 200,
  });
  return NextResponse.json({ success: true, products });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "products.manage");
  if (denied) return denied;

  let body: { id?: string; isActive?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 });
  }
  if (!body.id) return NextResponse.json({ success: false, message: "Product id required." }, { status: 400 });
  if (typeof body.isActive !== "boolean") {
    return NextResponse.json(
      { success: false, message: "Only availability is set here. Publish a new version to change a product's terms." },
      { status: 400 },
    );
  }

  const existing = await prisma.product.findFirst({
    where: { id: body.id, orgId: session.user.orgId },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ success: false, message: "Product not found." }, { status: 404 });

  const product = await prisma.product.update({
    where: { id: existing.id },
    data: { isActive: body.isActive },
  });

  await prisma.auditLog.create({
    data: {
      orgId: session.user.orgId,
      actorId: session.user.id,
      actorType: "staff",
      action: body.isActive ? "product.activate" : "product.deactivate",
      entity: "Product",
      entityId: product.id,
    },
  }).catch(() => {});

  return NextResponse.json({ success: true, product });
}
