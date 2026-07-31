// ─────────────────────────────────────────────────────────────────────────────
// PUBLISH a product definition as its next version.
//
//   POST { productId?, definition, note?, isActive? }
//     → 200 { productId, version, definition }
//     → 422 { issues: [{ path, message }] }  when the definition would not hold
//
// `productId` omitted creates the product at v1. This is the ONLY way a product's
// terms change: there is no partial update endpoint, because a product that can be
// edited field-by-field is a product whose past loans cannot say what they agreed to.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { prisma } from "@/lib/prisma";
import { publishVersion } from "@/lib/products/versioning";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "products.manage");
  if (denied) return denied;

  let body: { productId?: string; definition?: unknown; note?: string; isActive?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 });
  }
  if (!body.definition || typeof body.definition !== "object") {
    return NextResponse.json({ success: false, message: "Provide the product definition." }, { status: 400 });
  }

  const result = await publishVersion(session.user.orgId, body.productId ?? null, body.definition, {
    authorId: session.user.id,
    note: body.note ?? null,
    isActive: body.isActive,
  });

  if (!result.ok) {
    // 422, not 400: the request parsed fine, the PRODUCT would not hold together.
    // The client needs the paths to point at the offending controls.
    return NextResponse.json(
      { success: false, message: "This product would not hold together.", issues: result.issues },
      { status: 422 },
    );
  }

  await prisma.auditLog.create({
    data: {
      orgId: session.user.orgId,
      actorId: session.user.id,
      actorType: "staff",
      action: body.productId ? "product.publish" : "product.create",
      entity: "Product",
      entityId: result.productId,
      meta: { version: result.version, note: body.note ?? null },
    },
  }).catch(() => {});

  return NextResponse.json({
    success: true,
    productId: result.productId,
    version: result.version,
    definition: result.definition,
  });
}
