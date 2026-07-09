// POST /api/auth/login — staff sign-in. Body: { email, password, orgSlug? }.
// Verifies against StaffUser (bcrypt), issues the httpOnly session JWT.
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { runAsPlatform } from "@/lib/db/context";
import { createSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string; orgSlug?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  if (!email || !password) {
    return NextResponse.json({ success: false, message: "Email and password are required." }, { status: 400 });
  }

  // Sign-in is inherently cross-tenant: the same email may exist in several orgs
  // and we have no tenant identity until the credentials check out. This is one
  // of the few legitimate platform-scoped reads. (orgSlug disambiguates.)
  return runAsPlatform(async () => {
    const staff = await prisma.staffUser.findFirst({
      where: {
        email,
        status: "ACTIVE",
        ...(body.orgSlug ? { org: { slug: body.orgSlug } } : {}),
      },
      include: { role: { select: { title: true } }, org: { select: { id: true, slug: true, status: true } } },
      orderBy: { createdAt: "asc" },
    });

    // Uniform failure message — never reveal which part was wrong.
    const fail = () => NextResponse.json({ success: false, message: "Invalid email or password." }, { status: 401 });
    if (!staff?.passwordHash) return fail();
    if (!(await bcrypt.compare(password, staff.passwordHash))) return fail();
    // PENDING orgs may sign in to configure branding/team/vault — money-moving
    // surfaces gate on Org.status === ACTIVE separately. Only SUSPENDED blocks.
    if (staff.org.status === "SUSPENDED") {
      return NextResponse.json({ success: false, message: "Your organization is suspended. Contact BirgenAI support." }, { status: 403 });
    }

    await prisma.staffUser.update({ where: { id: staff.id }, data: { lastLoginAt: new Date() } });
    await prisma.auditLog.create({
      data: { orgId: staff.orgId, actorId: staff.id, actorType: "staff", action: "auth.login", ip: req.headers.get("x-forwarded-for") },
    }).catch(() => {});

    await createSession({
      id: staff.id,
      name: `${staff.firstName}${staff.otherName ? " " + staff.otherName : ""}`,
      email: staff.email,
      role: staff.role?.title ?? null,
      orgId: staff.orgId,
      orgSlug: staff.org.slug,
      tiers: { initiator: staff.isInitiator, authorizer: staff.isAuthorizer, validator: staff.isValidator },
    });

    return NextResponse.json({ success: true, orgSlug: staff.org.slug });
  });
}
