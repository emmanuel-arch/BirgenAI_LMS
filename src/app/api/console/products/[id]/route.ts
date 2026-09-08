// ─────────────────────────────────────────────────────────────────────────────
// GET /api/console/products/[id] — one product, as the builder needs it.
//
// The builder edits a DEFINITION, not a row, so this returns the live definition
// (lifting a legacy column-only product forward on the way) together with the two
// things the builder cannot derive: what the product is currently worth to the book,
// and the fee sheet attached to it.
//
// There is deliberately no PUT here. Terms change through
// POST /api/console/products/publish, which snapshots an immutable version — a
// field-by-field update endpoint is exactly the shape that makes a booked loan
// unable to say what it agreed to.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { prisma } from "@/lib/prisma";
import { currentDefinition, listVersions } from "@/lib/products/versioning";
import { chargeFromRow, describeCharge } from "@/lib/products/charges";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "products.view");
  if (denied) return denied;
  const orgId = session.user.orgId;

  const product = await prisma.product.findFirst({ where: { id, orgId } });
  if (!product) return NextResponse.json({ success: false, message: "Product not found." }, { status: 404 });

  const [definition, versions, charges, loanCount, activeCount, outstanding] = await Promise.all([
    currentDefinition(orgId, id),
    listVersions(orgId, id, 25),
    prisma.charge.findMany({
      where: { orgId, OR: [{ productId: id }, { productId: null }] },
      orderBy: [{ productId: "asc" }, { createdAt: "asc" }],
    }),
    prisma.loan.count({ where: { orgId, productId: id } }),
    prisma.loan.count({ where: { orgId, productId: id, status: "ACTIVE" } }),
    prisma.loan.aggregate({
      where: { orgId, productId: id, status: "ACTIVE" },
      _sum: { principal: true },
    }),
  ]);

  return NextResponse.json({
    success: true,
    product: {
      id: product.id,
      name: product.name,
      isActive: product.isActive,
      version: product.version,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    },
    definition,
    versions,
    charges: charges.map((c) => {
      const shape = chargeFromRow(c);
      return {
        ...shape,
        beneficiary: c.beneficiary,
        summary: describeCharge(shape),
        locked: c.beneficiary === "PLATFORM",
        /** False = it applies here because it applies to every product. */
        ownedByProduct: c.productId === id,
      };
    }),
    // What is riding on this product right now — the figure that decides whether a
    // rate change is an edit or an event.
    book: {
      loanCount,
      activeCount,
      outstanding: Number(outstanding._sum.principal ?? 0),
    },
  });
}
