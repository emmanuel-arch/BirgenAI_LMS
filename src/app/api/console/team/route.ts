// Team & roles (admin, own org).
//   GET  → staff list + roles + branches
//   POST → invite staff { email, name, phone?, roleId?, branchId?, tiers } —
//          creates ACTIVE with a generated temp password, emailed to them
//   PUT  → update staff { id, roleId?, branchId?, tiers?, status? }
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { auth } from "@/lib/auth";
import { requireRight, invalidateRights } from "@/lib/rbac/authz";
import { prisma } from "@/lib/prisma";
import { entitlementsFor } from "@/lib/billing/entitlements";
import { PLANS, PLAN_ORDER } from "@/lib/billing/plans";
import { sendEmail } from "@/lib/email/send";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "team.view");
  if (denied) return denied;
  const orgId = session.user.orgId;
  const [staff, roles, branches] = await Promise.all([
    prisma.staffUser.findMany({
      where: { orgId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, email: true, phone: true, firstName: true, otherName: true, status: true,
        isInitiator: true, isAuthorizer: true, isValidator: true, isFieldAgent: true,
        title: true, lat: true, lng: true, lastLoginAt: true,
        role: { select: { id: true, title: true } }, branch: { select: { id: true, name: true } },
      },
    }),
    prisma.role.findMany({ where: { orgId }, select: { id: true, title: true } }),
    prisma.branch.findMany({ where: { orgId }, select: { id: true, name: true } }),
  ]);
  return NextResponse.json({ success: true, staff, roles, branches });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "team.manage");
  if (denied) return denied;
  let body: { email?: string; name?: string; phone?: string; roleId?: string; branchId?: string; tiers?: { initiator?: boolean; authorizer?: boolean; validator?: boolean } };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const email = (body.email ?? "").trim().toLowerCase();
  const name = (body.name ?? "").trim();
  if (!email.includes("@") || !name) {
    return NextResponse.json({ success: false, message: "Enter the teammate's name and email." }, { status: 400 });
  }
  const orgId = session.user.orgId;
  const exists = await prisma.staffUser.findUnique({ where: { orgId_email: { orgId, email } } });
  if (exists) return NextResponse.json({ success: false, message: "That email is already on the team." }, { status: 409 });

  // Seats are counted on ACTIVE staff, so disabling a leaver frees their seat.
  const ent = await entitlementsFor(orgId);
  if (ent.seats != null) {
    const active = await prisma.staffUser.count({ where: { orgId, status: "ACTIVE" } });
    if (active >= ent.seats) {
      const next = PLAN_ORDER.map((p) => PLANS[p]).find((p) => p.seats === null || p.seats > ent.seats!);
      return NextResponse.json({
        success: false,
        upgradeRequired: true,
        upgradeTo: next?.key ?? null,
        message: `${ent.plan.name} includes ${ent.seats} seats and all of them are in use.${next ? ` ${next.name} (KES ${next.monthlyKes.toLocaleString()}/mo) raises that to ${next.seats ?? "unlimited"}.` : ""}`,
      }, { status: 402 });
    }
  }

  const [first, ...rest] = name.split(/\s+/);
  const tempPassword = randomBytes(6).toString("base64url"); // ~8 chars, emailed once
  const t = body.tiers ?? {};

  const staff = await prisma.staffUser.create({
    data: {
      orgId,
      email,
      phone: body.phone?.replace(/\D/g, "") ? `254${body.phone!.replace(/\D/g, "").slice(-9)}` : null,
      firstName: first,
      otherName: rest.join(" ") || null,
      passwordHash: await bcrypt.hash(tempPassword, 12),
      roleId: body.roleId || null,
      branchId: body.branchId || null,
      isInitiator: !!t.initiator,
      isAuthorizer: !!t.authorizer,
      isValidator: !!t.validator,
      status: "ACTIVE",
    },
  });

  const org = await prisma.org.findUnique({ where: { id: orgId }, select: { name: true, slug: true } });
  const emailed = await sendEmail(
    orgId,
    email,
    `You've been added to ${org?.name} on BirgenAI LMS`,
    `Hi ${first},\n\nYou now have staff access to ${org?.name}.\n\nSign in at https://lms.birgenai.com/login\nEmail: ${email}\nTemporary password: ${tempPassword}\n\nPlease change it after your first sign-in.`,
  );

  await prisma.auditLog.create({
    data: { orgId, actorId: session.user.id, actorType: "staff", action: "staff.invite", entity: "StaffUser", entityId: staff.id, meta: { email, emailed } },
  }).catch(() => {});

  return NextResponse.json({ success: true, staffId: staff.id, emailed });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "team.manage");
  if (denied) return denied;
  let body: { id?: string; roleId?: string | null; branchId?: string | null; status?: "ACTIVE" | "LOCKED" | "DISABLED"; tiers?: { initiator?: boolean; authorizer?: boolean; validator?: boolean }; isFieldAgent?: boolean; title?: string; lat?: number; lng?: number };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ success: false, message: "Staff id required." }, { status: 400 });

  const target = await prisma.staffUser.findFirst({ where: { id: body.id, orgId: session.user.orgId } });
  if (!target) return NextResponse.json({ success: false, message: "Staff member not found." }, { status: 404 });
  if (target.id === session.user.id && body.status && body.status !== "ACTIVE") {
    return NextResponse.json({ success: false, message: "You can't lock or disable your own account." }, { status: 400 });
  }

  const t = body.tiers;
  const hasGeo = Number.isFinite(Number(body.lat)) && Number.isFinite(Number(body.lng));
  const staff = await prisma.staffUser.update({
    where: { id: target.id },
    data: {
      roleId: body.roleId !== undefined ? body.roleId : undefined,
      branchId: body.branchId !== undefined ? body.branchId : undefined,
      status: body.status ?? undefined,
      isInitiator: t?.initiator ?? undefined,
      isAuthorizer: t?.authorizer ?? undefined,
      isValidator: t?.validator ?? undefined,
      isFieldAgent: body.isFieldAgent ?? undefined,
      title: body.title ?? undefined,
      lat: hasGeo ? Number(body.lat) : undefined,
      lng: hasGeo ? Number(body.lng) : undefined,
      lastLocationAt: hasGeo ? new Date() : undefined,
    },
  });
  // Role reassignment or a status flip changes what this person may do — the
  // rights resolver caches by staff id, so drop it and the change lands ≤30s.
  invalidateRights();
  await prisma.auditLog.create({
    data: { orgId: session.user.orgId, actorId: session.user.id, actorType: "staff", action: "staff.update", entity: "StaffUser", entityId: staff.id },
  }).catch(() => {});
  return NextResponse.json({ success: true });
}
