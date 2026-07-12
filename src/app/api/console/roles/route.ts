// Roles & rights (own org).
//   GET    → roles with their rights + how many staff hold each
//   POST   → create role { title, rights[] }
//   PUT    → update role { id, title?, rights? } — cannot orphan the org's last
//            admin capability (see the lockout guard below)
//   DELETE → delete role { id } — only when no staff member holds it
//
// Rights arrays are validated against the vocabulary (src/lib/rbac/rights); the
// role editor UI renders its checkbox tree from the SAME nav registry the
// sidebar uses, so what an admin ticks is exactly what the staff member sees.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireRight, invalidateRights, rightsSetFrom } from "@/lib/rbac/authz";
import { ALL_RIGHTS_SET, WILDCARD } from "@/lib/rbac/rights";

export const runtime = "nodejs";

/**
 * A role's DATA SCOPE — how much of the book it sees. Orthogonal to its rights, and
 * validated the same way: an unrecognised value falls back to ORG, which is what every
 * role had before scopes existed. Never silently narrow someone on a typo.
 */
const SCOPES = ["OWN", "BRANCH", "BRANCH_TREE", "ORG"] as const;
type ScopeValue = (typeof SCOPES)[number];
const cleanScope = (v: unknown): ScopeValue | null =>
  (SCOPES as readonly string[]).includes(String(v)) ? (String(v) as ScopeValue) : null;

/** Normalize + validate a submitted rights array. Null = invalid. */
function cleanRights(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: string[] = [];
  for (const r of raw) {
    if (typeof r !== "string") return null;
    if (r === WILDCARD) return [WILDCARD]; // everything — nothing else matters
    if (!ALL_RIGHTS_SET.has(r)) return null; // unknown key: reject loudly, don't silently drop
    if (!out.includes(r)) out.push(r);
  }
  return out;
}

const grantsAdmin = (rights: unknown) => {
  const set = rightsSetFrom(rights);
  return set.has("roles.manage");
};

/**
 * The lockout guard: would the org still have someone who can manage roles if
 * this role stopped granting that? Staff with no role resolve to the legacy set,
 * which does NOT include roles.manage — so the answer must come from other roles
 * with active holders.
 */
async function orgKeepsAnAdmin(orgId: string, excludingRoleId: string): Promise<boolean> {
  const others = await prisma.role.findMany({
    where: { orgId, id: { not: excludingRoleId } },
    select: { rights: true, staff: { where: { status: "ACTIVE" }, select: { id: true }, take: 1 } },
  });
  return others.some((r) => r.staff.length > 0 && grantsAdmin(r.rights));
}

export async function GET() {
  const session = await auth();
  const denied = await requireRight(session, "roles.view");
  if (denied) return denied;

  const roles = await prisma.role.findMany({
    where: { orgId: session!.user!.orgId },
    orderBy: { createdAt: "asc" },
    select: { id: true, title: true, rights: true, dataScope: true, createdAt: true, _count: { select: { staff: true } } },
  });
  return NextResponse.json({
    success: true,
    roles: roles.map((r) => ({ id: r.id, title: r.title, rights: r.rights, dataScope: r.dataScope, staffCount: r._count.staff, createdAt: r.createdAt })),
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const denied = await requireRight(session, "roles.manage");
  if (denied) return denied;
  const orgId = session!.user!.orgId!;

  let body: { title?: string; rights?: unknown; dataScope?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const title = (body.title ?? "").trim();
  if (title.length < 2 || title.length > 60) {
    return NextResponse.json({ success: false, message: "Give the role a name (2–60 characters)." }, { status: 400 });
  }
  const rights = cleanRights(body.rights);
  if (!rights) {
    return NextResponse.json({ success: false, message: "Pick at least one permission for this role." }, { status: 400 });
  }

  const exists = await prisma.role.findUnique({ where: { orgId_title: { orgId, title } } });
  if (exists) return NextResponse.json({ success: false, message: "A role with that name already exists." }, { status: 409 });

  // Role.menu is ServiceSuite-era denormalization — mirrored, never read.
  const role = await prisma.role.create({
    data: { orgId, title, rights, menu: rights, dataScope: cleanScope(body.dataScope) ?? "ORG" },
  });
  invalidateRights();
  await prisma.auditLog.create({
    data: { orgId, actorId: session!.user!.id, actorType: "staff", action: "role.create", entity: "Role", entityId: role.id, meta: { title, rights } },
  }).catch(() => {});

  return NextResponse.json({ success: true, roleId: role.id });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  const denied = await requireRight(session, "roles.manage");
  if (denied) return denied;
  const orgId = session!.user!.orgId!;

  let body: { id?: string; title?: string; rights?: unknown; dataScope?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ success: false, message: "Role id required." }, { status: 400 });

  const role = await prisma.role.findFirst({ where: { id: body.id, orgId } });
  if (!role) return NextResponse.json({ success: false, message: "Role not found." }, { status: 404 });

  let rights: string[] | undefined;
  if (body.rights !== undefined) {
    const cleaned = cleanRights(body.rights);
    if (!cleaned) return NextResponse.json({ success: false, message: "Pick at least one valid permission." }, { status: 400 });
    rights = cleaned;
    // Lockout guard: stripping the org's only staffed role-managing role would
    // leave nobody able to fix it — the support call this feature exists to avoid.
    if (grantsAdmin(role.rights) && !grantsAdmin(rights) && !(await orgKeepsAnAdmin(orgId, role.id))) {
      return NextResponse.json({
        success: false,
        message: "This is the only role that can manage roles. Give another active staff member that ability first.",
      }, { status: 400 });
    }
  }

  let title: string | undefined;
  if (body.title !== undefined) {
    title = (body.title ?? "").trim();
    if (title.length < 2 || title.length > 60) {
      return NextResponse.json({ success: false, message: "Role names are 2–60 characters." }, { status: 400 });
    }
    const clash = await prisma.role.findUnique({ where: { orgId_title: { orgId, title } } });
    if (clash && clash.id !== role.id) {
      return NextResponse.json({ success: false, message: "A role with that name already exists." }, { status: 409 });
    }
  }

  await prisma.role.update({
    where: { id: role.id },
    data: {
      title, rights, menu: rights,
      // Absent ⇒ leave it alone. A client that only sends rights must not silently
      // reset a lender's carefully-narrowed visibility back to "the whole book".
      ...(body.dataScope === undefined ? {} : { dataScope: cleanScope(body.dataScope) ?? "ORG" }),
    },
  });
  invalidateRights();
  await prisma.auditLog.create({
    data: { orgId, actorId: session!.user!.id, actorType: "staff", action: "role.update", entity: "Role", entityId: role.id, meta: { title: title ?? role.title, rights: rights ?? undefined } },
  }).catch(() => {});

  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  const denied = await requireRight(session, "roles.manage");
  if (denied) return denied;
  const orgId = session!.user!.orgId!;

  let body: { id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ success: false, message: "Role id required." }, { status: 400 });

  const role = await prisma.role.findFirst({
    where: { id: body.id, orgId },
    select: { id: true, title: true, rights: true, _count: { select: { staff: true } } },
  });
  if (!role) return NextResponse.json({ success: false, message: "Role not found." }, { status: 404 });
  if (role._count.staff > 0) {
    return NextResponse.json({
      success: false,
      message: `${role._count.staff} staff member${role._count.staff === 1 ? " holds" : "s hold"} this role. Reassign them first.`,
    }, { status: 409 });
  }

  await prisma.role.delete({ where: { id: role.id } });
  invalidateRights();
  await prisma.auditLog.create({
    data: { orgId, actorId: session!.user!.id, actorType: "staff", action: "role.delete", entity: "Role", entityId: role.id, meta: { title: role.title } },
  }).catch(() => {});

  return NextResponse.json({ success: true });
}
