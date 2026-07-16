// POST /api/platform/auth/login — the founder's sign-in. { email, password }.
// DELETE — sign out (clears the platform cookie only).
//
// Same throttling posture as staff login: this account oversees every tenant,
// so it gets the tightest limiter in the app.
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { runAsPlatform } from "@/lib/db/context";
import { createPlatformSession, destroyPlatformSession } from "@/lib/platform-auth";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { withDbRetry, isTransientDbError, wakingUpResponse } from "@/lib/db/retry";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  if (!email || !password) {
    return NextResponse.json({ success: false, message: "Email and password are required." }, { status: 400 });
  }

  // Every step below touches the DB. A cold Supabase pooler throws P1001 on the
  // FIRST hit; withDbRetry rides that out, and a blip that survives the retry is a
  // 503 "waking up" — never the 500-turned-"Sign-in failed" that reads as a wrong
  // password. (lib/db/retry.ts)
  try {
    const limited = await withDbRetry(() => rateLimit(
      [
        { name: "platform-login:email", subject: email, max: 6, windowSec: 900 },
        { name: "platform-login:ip", subject: clientIp(req), max: 12, windowSec: 900 },
      ],
      "Too many sign-in attempts. Please wait before trying again.",
    ));
    if (limited) return limited;

    return await runAsPlatform(async () => {
      const admin = await withDbRetry(() => prisma.platformAdmin.findUnique({ where: { email } }));
      const fail = () => NextResponse.json({ success: false, message: "Invalid email or password." }, { status: 401 });
      if (!admin || admin.status !== "ACTIVE") return fail();
      if (!(await bcrypt.compare(password, admin.passwordHash))) return fail();

      await prisma.platformAdmin.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } }).catch(() => {});
      // Platform actions have no home org (orgId null); the actor identifies them.
      await prisma.auditLog.create({
        data: { orgId: null, actorId: admin.id, actorType: "platform", action: "platform.login", ip: req.headers.get("x-forwarded-for") },
      }).catch(() => {});

      await createPlatformSession({ id: admin.id, name: admin.name, email: admin.email });
      return NextResponse.json({ success: true, name: admin.name });
    });
  } catch (err) {
    if (isTransientDbError(err)) return wakingUpResponse();
    throw err;
  }
}

export async function DELETE() {
  await destroyPlatformSession();
  return NextResponse.json({ success: true });
}
