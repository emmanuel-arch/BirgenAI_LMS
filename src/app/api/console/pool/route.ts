// The sharing pool, from the console.
//
//   GET  ?q=       → search the GROUP's customers at sibling entities (name /
//                    phone / national ID). Response carries the pool's legal
//                    basis — the screen shows it wherever a pool hit surfaces.
//   POST { sourceBorrowerId } → bring a sibling's customer onto THIS book so an
//                    application can be taken. Idempotent; audited.
//
// Everything cross-tenant happens inside src/lib/pool/pool.ts — the one seam.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { prisma } from "@/lib/prisma";
import { searchPool, importFromPool } from "@/lib/pool/pool";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "borrowers.view");
  if (denied) return denied;

  const q = req.nextUrl.searchParams.get("q") ?? "";
  const result = await searchPool(session.user.orgId, q);
  if (!result) return NextResponse.json({ success: true, inPool: false, customers: [] });
  return NextResponse.json({
    success: true,
    inPool: true,
    pool: { name: result.pool.name, legalBasis: result.pool.legalBasis },
    customers: result.customers,
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "borrowers.create");
  if (denied) return denied;
  const orgId = session.user.orgId;

  let body: { sourceBorrowerId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }
  if (!body.sourceBorrowerId) return NextResponse.json({ success: false, message: "Pick the customer to bring across." }, { status: 400 });

  const result = await importFromPool(orgId, body.sourceBorrowerId);
  if (!result.ok) return NextResponse.json({ success: false, message: result.message }, { status: 404 });

  await prisma.auditLog.create({
    data: {
      orgId, actorId: session.user.id, actorType: "staff",
      action: result.imported ? "pool.import" : "pool.import-existing",
      entity: "Borrower", entityId: result.borrowerId,
      meta: { sourceOrg: result.sourceOrg, sourceBorrowerId: body.sourceBorrowerId },
    },
  }).catch(() => {});

  return NextResponse.json({ success: true, borrowerId: result.borrowerId, imported: result.imported, sourceOrg: result.sourceOrg });
}
