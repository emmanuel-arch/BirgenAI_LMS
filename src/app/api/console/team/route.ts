// Team & roles (admin, own org).
//   GET  → staff list + roles + branches
//   POST → invite staff { email, name, phone?, roleId?, branchId?, tiers } —
//          creates ACTIVE with a generated temp password, emailed to them
//   PUT  → update staff { id, roleId?, branchId?, tiers?, status? }
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { auth } from "@/lib/auth";
import { requireRight, invalidateRights, getRights, canGrantRights, rightsSetFrom } from "@/lib/rbac/authz";
import { issueOtp, verifyOtp } from "@/lib/otp";
import { prisma } from "@/lib/prisma";
import { headOfficeId } from "@/lib/rbac/scope";
import { entitlementsFor } from "@/lib/billing/entitlements";
import { allAccessKeys, ACCESS_CATALOG } from "@/lib/rbac/modules";
import { Prisma } from "@prisma/client";
import { PLANS, PLAN_ORDER } from "@/lib/billing/plans";
import { sendTemplatedEmail } from "@/lib/email/send";
import { emailBrandFor } from "@/lib/email/layout";
import { staffInviteEmail } from "@/lib/email/templates";

export const runtime = "nodejs";

/** A role that can manage access is a crown-jewel grant — creating or assigning one is
 *  the action a walked-up console session would abuse. */
const grantsAccessAdmin = (rightsRaw: unknown) => {
  const s = rightsSetFrom(rightsRaw);
  return s.has("roles.manage") || s.has("team.manage");
};

/**
 * STEP-UP RE-AUTH for a privileged change. Demands a fresh single-use code from the
 * ACTOR before the write proceeds — defence-in-depth on top of the anti-escalation
 * guard. Anti-lockout, exactly like login: if no channel can carry the code, it falls
 * open with an audit rather than trapping a mis-configured org. Returns a response to
 * send back (challenge or rejection), or null to proceed.
 */
async function requireStepUp(orgId: string, actorId: string, purpose: string, otp?: string): Promise<NextResponse | null> {
  if (otp) {
    if (await verifyOtp(orgId, actorId, purpose, otp)) return null;
    return NextResponse.json({ success: false, otpRequired: true, message: "That code didn't match or has expired — check your inbox and try again." }, { status: 401 });
  }
  const { delivered } = await issueOtp(orgId, actorId, purpose);
  if (!delivered) {
    await prisma.auditLog.create({ data: { orgId, actorId, actorType: "staff", action: "auth.stepup-skipped", entity: "StaffUser", entityId: actorId, meta: { purpose } } }).catch(() => {});
    return null; // no channel — parity beats a lockout
  }
  return NextResponse.json({ success: false, otpRequired: true, message: "This gives someone the ability to manage access — enter the code we just emailed you to confirm it's you." }, { status: 200 });
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "team.view");
  if (denied) return denied;
  const orgId = session.user.orgId;
  const [staff, roleRows, branches, actorRights] = await Promise.all([
    prisma.staffUser.findMany({
      where: { orgId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, email: true, phone: true, firstName: true, otherName: true, status: true,
        isInitiator: true, isAuthorizer: true, isValidator: true, isFieldAgent: true,
        title: true, lat: true, lng: true, lastLoginAt: true, dob: true, access: true,
        role: { select: { id: true, title: true } }, branch: { select: { id: true, name: true } },
      },
    }),
    prisma.role.findMany({ where: { orgId }, select: { id: true, title: true, rights: true } }),
    prisma.branch.findMany({ where: { orgId }, select: { id: true, name: true } }),
    getRights(session),
  ]);
  // `assignable` is the anti-escalation rule made visible: a role that grants more
  // than the caller holds is shown but not offered — you cannot promote above yourself.
  const roles = roleRows.map((r) => ({ id: r.id, title: r.title, assignable: canGrantRights(actorRights, r.rights) }));
  // The catalogue travels with the payload so the access editor renders the same
  // systems and modules the server enforces, rather than a copy that can drift.
  return NextResponse.json({ success: true, staff, roles, branches, catalog: ACCESS_CATALOG });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "team.manage");
  if (denied) return denied;
  let body: { email?: string; name?: string; phone?: string; roleId?: string; branchId?: string; tiers?: { initiator?: boolean; authorizer?: boolean; validator?: boolean }; otp?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const email = (body.email ?? "").trim().toLowerCase();
  const name = (body.name ?? "").trim();
  if (!email.includes("@") || !name) {
    return NextResponse.json({ success: false, message: "Enter the teammate's name and email." }, { status: 400 });
  }
  const orgId = session.user.orgId;
  const exists = await prisma.staffUser.findUnique({ where: { orgId_email: { orgId, email } } });
  if (exists) return NextResponse.json({ success: false, message: "That email is already on the team." }, { status: 409 });

  // Anti-escalation: you cannot invite someone into a role with more access than you hold.
  if (body.roleId) {
    const [actorRights, role] = await Promise.all([getRights(session), prisma.role.findFirst({ where: { id: body.roleId, orgId }, select: { rights: true } })]);
    if (!role) return NextResponse.json({ success: false, message: "Role not found." }, { status: 404 });
    if (!canGrantRights(actorRights, role.rights)) {
      return NextResponse.json({ success: false, message: "You can't assign a role with more access than your own." }, { status: 403 });
    }
    // Step-up: creating an access-managing account demands a fresh code from you.
    if (grantsAccessAdmin(role.rights)) {
      const step = await requireStepUp(orgId, session.user.id!, "team:privileged-invite", body.otp);
      if (step) return step;
    }
  }

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

  // Everyone belongs somewhere. A staff member with no branch cannot be seen by a
  // branch-scoped manager and cannot BE one (resolveScope degrades them to OWN), so an
  // invite that names no branch puts them at the head office rather than nowhere.
  const branchId = body.branchId || (await headOfficeId(orgId));

  const staff = await prisma.staffUser.create({
    data: {
      orgId,
      email,
      phone: body.phone?.replace(/\D/g, "") ? `254${body.phone!.replace(/\D/g, "").slice(-9)}` : null,
      firstName: first,
      otherName: rest.join(" ") || null,
      passwordHash: await bcrypt.hash(tempPassword, 12),
      roleId: body.roleId || null,
      branchId,
      isInitiator: !!t.initiator,
      isAuthorizer: !!t.authorizer,
      isValidator: !!t.validator,
      status: "ACTIVE",
    },
  });

  // Credentials ride the lender's own branding — logo, accent, portal links —
  // and explain the daily sign-in code that will follow (see lib/email/templates).
  const brand = await emailBrandFor(orgId);
  const roleTitle = body.roleId
    ? (await prisma.role.findFirst({ where: { id: body.roleId, orgId }, select: { title: true } }))?.title ?? null
    : null;
  const emailed = await sendTemplatedEmail(
    orgId,
    email,
    staffInviteEmail(brand, { name: first, email, tempPassword, roleTitle }),
    "staff_invite",
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
  let body: {
    id?: string; roleId?: string | null; branchId?: string | null;
    status?: "ACTIVE" | "LOCKED" | "DISABLED";
    tiers?: { initiator?: boolean; authorizer?: boolean; validator?: boolean };
    isFieldAgent?: boolean; title?: string; lat?: number; lng?: number; otp?: string;
    // Identity and contact — the fields an administrator actually has to correct.
    firstName?: string; otherName?: string | null; email?: string; phone?: string | null; dob?: string | null;
    // Per-person system/module visibility. See src/lib/rbac/modules.ts.
    access?: { deny?: string[]; grant?: string[] };
  };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ success: false, message: "Staff id required." }, { status: 400 });

  const target = await prisma.staffUser.findFirst({ where: { id: body.id, orgId: session.user.orgId } });
  if (!target) return NextResponse.json({ success: false, message: "Staff member not found." }, { status: 404 });

  // ── Contact details ────────────────────────────────────────────────────────
  // Email is the sign-in identity AND the address the daily code goes to, so it
  // is validated and uniqueness-checked within the org rather than trusted. The
  // rest are free text an administrator is correcting from a phone call.
  let nextEmail: string | undefined;
  if (body.email !== undefined) {
    const e = body.email.trim().toLowerCase();
    if (!e.includes("@") || e.length < 5) {
      return NextResponse.json({ success: false, message: "That doesn't look like an email address." }, { status: 400 });
    }
    if (e !== target.email) {
      const clash = await prisma.staffUser.findUnique({ where: { orgId_email: { orgId: session.user.orgId, email: e } } });
      if (clash) return NextResponse.json({ success: false, message: "Another teammate already uses that email." }, { status: 409 });
      nextEmail = e;
    }
  }

  let nextDob: Date | null | undefined;
  if (body.dob !== undefined) {
    if (body.dob === null || body.dob === "") nextDob = null;
    else {
      const d = new Date(body.dob);
      if (Number.isNaN(d.getTime())) return NextResponse.json({ success: false, message: "That date of birth isn't valid." }, { status: 400 });
      nextDob = d;
    }
  }

  // ── Access ─────────────────────────────────────────────────────────────────
  // Two rules, both about not letting an administrator hand out more than they
  // hold — the same anti-escalation posture the role assignment already takes:
  //
  //   · Only keys the catalogue defines are stored. An unknown key would sit in
  //     the column forever, matching nothing, and read as "configured" in the UI.
  //   · A per-person GRANT may only give a right the actor themselves holds.
  //     Otherwise the deny-list becomes a back door to the escalation that
  //     canGrantRights() closes on the role.
  let nextAccess: { deny?: string[]; grant?: string[] } | undefined;
  if (body.access !== undefined) {
    const valid = allAccessKeys();
    const deny = (body.access.deny ?? []).filter((k) => valid.has(k));
    const wantGrant = body.access.grant ?? [];
    let grant: string[] = [];
    if (wantGrant.length) {
      const actorRights = await getRights(session);
      const over = wantGrant.filter((r) => !actorRights.has(r));
      if (over.length) {
        return NextResponse.json(
          { success: false, message: `You can't grant access you don't hold yourself: ${over.join(", ")}.` },
          { status: 403 },
        );
      }
      grant = wantGrant;
    }
    nextAccess = { ...(deny.length ? { deny } : {}), ...(grant.length ? { grant } : {}) };
  }
  if (target.id === session.user.id && body.status && body.status !== "ACTIVE") {
    return NextResponse.json({ success: false, message: "You can't lock or disable your own account." }, { status: 400 });
  }

  // Anti-escalation: you cannot move anyone (yourself included) into a role that grants
  // more than you hold. This is the exact hole that let an admin tick "Super Admin".
  if (body.roleId) {
    const [actorRights, role] = await Promise.all([getRights(session), prisma.role.findFirst({ where: { id: body.roleId, orgId: session.user.orgId }, select: { rights: true } })]);
    if (!role) return NextResponse.json({ success: false, message: "Role not found." }, { status: 404 });
    if (!canGrantRights(actorRights, role.rights)) {
      return NextResponse.json({ success: false, message: "You can't assign a role with more access than your own." }, { status: 403 });
    }
    // Step-up: moving someone into an access-managing role demands a fresh code.
    if (grantsAccessAdmin(role.rights)) {
      const step = await requireStepUp(session.user.orgId!, session.user.id!, "team:privileged-role", body.otp);
      if (step) return step;
    }
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
      firstName: body.firstName?.trim() || undefined,
      // otherName and phone are explicitly CLEARABLE — null means "remove this",
      // which `?? undefined` would silently turn into "leave it alone".
      otherName: body.otherName !== undefined ? (body.otherName?.trim() || null) : undefined,
      phone: body.phone !== undefined ? (body.phone?.trim() || null) : undefined,
      email: nextEmail,
      dob: nextDob,
      access: nextAccess as Prisma.InputJsonValue | undefined,
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
