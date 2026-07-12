// The lender's own organisational structure — head office, regions, branches, units.
//
//   GET    → the whole tree, with staff and book counts on every node
//   POST   → add a node under a parent { name, parentId, levelName, code?, disbursementLimit? }
//   PUT    → rename / re-parent / deactivate a node
//   DELETE → remove a node (only when nothing hangs off it)
//
// ONE SELF-REFERENCING TABLE, and the lender names their own levels — exactly as
// ServiceSuite's units tree does. "Head Office → Region → Branch → Sub-branch" is not
// hard-coded anywhere: a lender who works in "Zones" and "Outlets" types those words
// and the system agrees with them. What IS fixed is the shape: exactly one root
// (parentId null), and every other node hangs off something.
//
// The tree is not decoration. It is what `DataScope` reads (src/lib/rbac/scope.ts): a
// regional manager's visibility is literally the subtree beneath the node they sit at.
// So the structural rules below are load-bearing, not tidiness:
//
//   • A node may not be re-parented UNDER ITSELF or under its own descendant. That
//     would create a cycle, and a cycle in the tree is a manager who can see a subtree
//     containing their own ancestor — plus an infinite walk in descendantBranchIds.
//   • The ROOT may not be deleted or re-parented. It is the org.
//   • A node with children, staff, or a book cannot be deleted. Deleting it would
//     orphan rows out of every scope's sight rather than "cleaning up".
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { prisma } from "@/lib/prisma";
import { descendantBranchIds, invalidateBranchTree } from "@/lib/rbac/scope";

export const runtime = "nodejs";

const clean = (s: unknown, max: number) => String(s ?? "").trim().slice(0, max);

export async function GET() {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "branches.view");
  if (denied) return denied;
  const orgId = session.user.orgId;

  const branches = await prisma.branch.findMany({
    where: { orgId },
    orderBy: [{ createdAt: "asc" }],
    select: {
      id: true, name: true, parentId: true, levelName: true, code: true,
      disbursementLimit: true, active: true, lat: true, lng: true,
      _count: { select: { staff: true } },
    },
  });

  // How much book each node carries. A structure page that shows only names tells a
  // regional manager nothing; the reason to look at the tree is to see where the money
  // and the people actually are.
  const [borrowerCounts, loanSums] = await Promise.all([
    prisma.borrower.groupBy({ by: ["branchId"], where: { orgId }, _count: true }),
    prisma.loan.groupBy({ by: ["branchId"], where: { orgId, status: "ACTIVE" }, _sum: { balance: true }, _count: true }),
  ]);
  const borrowersOf = new Map(borrowerCounts.map((r) => [r.branchId, r._count]));
  const bookOf = new Map(loanSums.map((r) => [r.branchId, { olb: Number(r._sum.balance ?? 0), loans: r._count }]));

  return NextResponse.json({
    success: true,
    canManage: !(await requireRight(session, "branches.manage")),
    branches: branches.map((b) => ({
      id: b.id,
      name: b.name,
      parentId: b.parentId,
      levelName: b.levelName,
      code: b.code,
      active: b.active,
      disbursementLimit: b.disbursementLimit == null ? null : Number(b.disbursementLimit),
      staff: b._count.staff,
      borrowers: borrowersOf.get(b.id) ?? 0,
      olb: bookOf.get(b.id)?.olb ?? 0,
      loans: bookOf.get(b.id)?.loans ?? 0,
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "branches.manage");
  if (denied) return denied;
  const orgId = session.user.orgId;

  let body: { name?: string; parentId?: string; levelName?: string; code?: string; disbursementLimit?: number | null };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const name = clean(body.name, 80);
  if (!name) return NextResponse.json({ success: false, message: "Give the office a name." }, { status: 400 });

  const root = await prisma.branch.findFirst({ where: { orgId, parentId: null }, select: { id: true } });

  // The first node is the head office and needs no parent. Every node after it does —
  // a second root would be a second organisation.
  let parentId: string | null = null;
  if (root) {
    parentId = clean(body.parentId, 64) || null;
    if (!parentId) {
      return NextResponse.json({ success: false, message: "Choose which office this one reports to." }, { status: 400 });
    }
    const parent = await prisma.branch.findFirst({ where: { id: parentId, orgId }, select: { id: true } });
    if (!parent) return NextResponse.json({ success: false, message: "That parent office doesn't exist." }, { status: 404 });
  }

  const branch = await prisma.branch.create({
    data: {
      orgId,
      name,
      parentId,
      levelName: clean(body.levelName, 40) || (parentId ? "Branch" : "Head Office"),
      code: clean(body.code, 20) || null,
      disbursementLimit: body.disbursementLimit == null ? null : Number(body.disbursementLimit),
    },
    select: { id: true },
  });

  invalidateBranchTree(orgId);
  await prisma.auditLog.create({
    data: { orgId, actorId: session.user.id, actorType: "staff", action: "branch.create", entity: "Branch", entityId: branch.id, meta: { name, parentId } },
  }).catch(() => {});

  return NextResponse.json({ success: true, id: branch.id });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "branches.manage");
  if (denied) return denied;
  const orgId = session.user.orgId;

  let body: { id?: string; name?: string; levelName?: string; code?: string | null; parentId?: string | null; active?: boolean; disbursementLimit?: number | null };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const id = clean(body.id, 64);
  if (!id) return NextResponse.json({ success: false, message: "Which office?" }, { status: 400 });

  const branch = await prisma.branch.findFirst({ where: { id, orgId }, select: { id: true, parentId: true } });
  if (!branch) return NextResponse.json({ success: false, message: "That office doesn't exist." }, { status: 404 });
  const isRoot = branch.parentId === null;

  const data: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = clean(body.name, 80);
    if (!name) return NextResponse.json({ success: false, message: "An office needs a name." }, { status: 400 });
    data.name = name;
  }
  if (body.levelName !== undefined) data.levelName = clean(body.levelName, 40) || "Branch";
  if (body.code !== undefined) data.code = clean(body.code, 20) || null;
  if (body.disbursementLimit !== undefined) data.disbursementLimit = body.disbursementLimit == null ? null : Number(body.disbursementLimit);

  if (body.active !== undefined) {
    if (isRoot && !body.active) {
      return NextResponse.json({ success: false, message: "The head office can't be switched off." }, { status: 400 });
    }
    data.active = Boolean(body.active);
  }

  if (body.parentId !== undefined) {
    if (isRoot) {
      return NextResponse.json({ success: false, message: "The head office is the top of the structure — it can't report to anyone." }, { status: 400 });
    }
    const parentId = clean(body.parentId, 64);
    if (!parentId) return NextResponse.json({ success: false, message: "Choose which office this one reports to." }, { status: 400 });

    // THE CYCLE GUARD. Re-parenting a node under its own descendant makes a loop, and a
    // loop in this tree is not a cosmetic problem: descendantBranchIds walks it to
    // decide what a regional manager can see.
    if (parentId === id) {
      return NextResponse.json({ success: false, message: "An office can't report to itself." }, { status: 400 });
    }
    const subtree = await descendantBranchIds(orgId, id);
    if (subtree.includes(parentId)) {
      return NextResponse.json({ success: false, message: "That office already sits underneath this one — moving it there would make a loop." }, { status: 400 });
    }
    const parent = await prisma.branch.findFirst({ where: { id: parentId, orgId }, select: { id: true } });
    if (!parent) return NextResponse.json({ success: false, message: "That parent office doesn't exist." }, { status: 404 });
    data.parentId = parentId;
  }

  await prisma.branch.update({ where: { id }, data });
  invalidateBranchTree(orgId);
  await prisma.auditLog.create({
    data: { orgId, actorId: session.user.id, actorType: "staff", action: "branch.update", entity: "Branch", entityId: id, meta: data as object },
  }).catch(() => {});

  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "branches.manage");
  if (denied) return denied;
  const orgId = session.user.orgId;

  const id = clean(new URL(req.url).searchParams.get("id"), 64);
  const branch = await prisma.branch.findFirst({ where: { id, orgId }, select: { id: true, parentId: true, name: true } });
  if (!branch) return NextResponse.json({ success: false, message: "That office doesn't exist." }, { status: 404 });
  if (branch.parentId === null) {
    return NextResponse.json({ success: false, message: "The head office can't be deleted — it is the organisation." }, { status: 400 });
  }

  // Nothing may be orphaned. A deleted branch whose borrowers still point at it would
  // put them outside every scope's sight — which looks exactly like data loss.
  const [children, staff, borrowers, loans] = await Promise.all([
    prisma.branch.count({ where: { orgId, parentId: id } }),
    prisma.staffUser.count({ where: { orgId, branchId: id } }),
    prisma.borrower.count({ where: { orgId, branchId: id } }),
    prisma.loan.count({ where: { orgId, branchId: id } }),
  ]);
  const blockers = [
    children && `${children} office${children === 1 ? "" : "s"} reporting to it`,
    staff && `${staff} staff member${staff === 1 ? "" : "s"}`,
    borrowers && `${borrowers} borrower${borrowers === 1 ? "" : "s"}`,
    loans && `${loans} loan${loans === 1 ? "" : "s"}`,
  ].filter(Boolean) as string[];

  if (blockers.length) {
    return NextResponse.json({
      success: false,
      message: `"${branch.name}" still has ${blockers.join(", ")}. Move them first, or switch the office off instead of deleting it.`,
    }, { status: 409 });
  }

  await prisma.branch.delete({ where: { id } });
  invalidateBranchTree(orgId);
  await prisma.auditLog.create({
    data: { orgId, actorId: session.user.id, actorType: "staff", action: "branch.delete", entity: "Branch", entityId: id, meta: { name: branch.name } },
  }).catch(() => {});

  return NextResponse.json({ success: true });
}
