// Password management.
//   PUT  → change own password { current, next } (session)
//   POST → start reset { email, orgSlug? } — emails a 6-digit code
//   PATCH→ confirm reset { email, orgSlug?, code, next }
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runAsPlatform, runWithOrg } from "@/lib/db/context";
import { issueOtp, verifyOtp } from "@/lib/otp";

export const runtime = "nodejs";

const RESET_PURPOSE = "password:reset";

function validNext(next: string): string | null {
  if ((next ?? "").length < 10) return "Use a password of at least 10 characters.";
  return null;
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });

  let body: { current?: string; next?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const err = validNext(body.next ?? "");
  if (err) return NextResponse.json({ success: false, message: err }, { status: 400 });

  const staff = await prisma.staffUser.findUnique({ where: { id: session.user.id } });
  if (!staff?.passwordHash || !(await bcrypt.compare(body.current ?? "", staff.passwordHash))) {
    return NextResponse.json({ success: false, message: "Current password is incorrect." }, { status: 403 });
  }
  await prisma.staffUser.update({ where: { id: staff.id }, data: { passwordHash: await bcrypt.hash(body.next!, 12) } });
  await prisma.auditLog.create({
    data: { orgId: staff.orgId, actorId: staff.id, actorType: "staff", action: "auth.password-change" },
  }).catch(() => {});
  return NextResponse.json({ success: true });
}

async function findStaff(email: string, orgSlug?: string) {
  return prisma.staffUser.findFirst({
    where: { email: email.trim().toLowerCase(), status: "ACTIVE", ...(orgSlug ? { org: { slug: orgSlug } } : {}) },
    orderBy: { createdAt: "asc" },
  });
}

export async function POST(req: NextRequest) {
  let body: { email?: string; orgSlug?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  // Uniform response — never reveal whether the email exists.
  const ok = NextResponse.json({ success: true, message: "If that email is on a team, a reset code has been sent." });
  if (!body.email?.includes("@")) return ok;
  // No session yet: the email must be matched across orgs (platform read), then
  // the OTP is issued inside that staff member's own tenant fence.
  const staff = await runAsPlatform(() => findStaff(body.email!, body.orgSlug));
  if (staff) await runWithOrg(staff.orgId, () => issueOtp(staff.orgId, staff.id, RESET_PURPOSE));
  return ok;
}

export async function PATCH(req: NextRequest) {
  let body: { email?: string; orgSlug?: string; code?: string; next?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const err = validNext(body.next ?? "");
  if (err) return NextResponse.json({ success: false, message: err }, { status: 400 });

  const bad = () => NextResponse.json({ success: false, message: "Invalid or expired reset code." }, { status: 403 });
  const staff = body.email?.includes("@") ? await runAsPlatform(() => findStaff(body.email!, body.orgSlug)) : null;
  if (!staff) return bad();

  // The code check and the write both happen inside the staff member's tenant.
  return runWithOrg(staff.orgId, async () => {
    if (!(await verifyOtp(staff.orgId, staff.id, RESET_PURPOSE, body.code ?? ""))) return bad();
    await prisma.staffUser.update({ where: { id: staff.id }, data: { passwordHash: await bcrypt.hash(body.next!, 12) } });
    await prisma.auditLog.create({
      data: { orgId: staff.orgId, actorId: staff.id, actorType: "staff", action: "auth.password-reset" },
    }).catch(() => {});
    return NextResponse.json({ success: true, message: "Password updated — sign in with the new one." });
  });
}
