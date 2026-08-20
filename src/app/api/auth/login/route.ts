// POST /api/auth/login — staff sign-in. Body: { email, password, orgSlug?, otp? }.
// Two factors, ServiceSuite parity: the password proves knowledge, then a
// 6-digit code emailed in the lender's branding proves the inbox — and that
// code is REUSABLE until midnight Nairobi time, so staff enter one code each
// morning, not one per session. Demo orgs skip the code (frictionless
// showcase); if NO channel can carry a code, sign-in falls open to
// password-only with an audit row — a lockout is worse than parity.
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { runAsPlatform, runWithOrg } from "@/lib/db/context";
import { createSession } from "@/lib/auth";
import { createPlatformSession } from "@/lib/platform-auth";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { issueDailyLoginOtp, verifyDailyLoginOtp } from "@/lib/otp";
import { withDbRetry, isTransientDbError, wakingUpResponse } from "@/lib/db/retry";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string; orgSlug?: string; otp?: string };
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

  // A cold Supabase pooler P1001s on the first hit; ride it out on the reachability-
  // sensitive reads and report a persistent blip as a 503, never a wrong-password 401.
  try {
  // A staff account opens a lender's entire loan book. Throttle per account
  // (credential stuffing) and per IP (spraying one password across many accounts).
  const limited = await withDbRetry(() => rateLimit(
    [
      { name: "login:email", subject: email, max: 10, windowSec: 900 },
      { name: "login:ip", subject: clientIp(req), max: 30, windowSec: 900 },
    ],
    "Too many sign-in attempts. Please wait before trying again.",
  ));
  if (limited) return limited;

  // Sign-in is inherently cross-tenant: the same email may exist in several orgs
  // and we have no tenant identity until the credentials check out. This is one
  // of the few legitimate platform-scoped reads. (orgSlug disambiguates.)
  return await runAsPlatform(async () => {
    // ── ONE DOOR, TWO KINDS OF PERSON ────────────────────────────────────────
    //
    // The platform administrator is checked FIRST, and the check is the
    // PlatformAdmin table rather than a hard-coded address — the table has
    // exactly one row today, and "whoever is in it" is the rule that stays true
    // when that changes. Nobody else can reach /platform however their staff
    // rights are configured, because no staff row grants it.
    //
    // WHY FIRST, given this email is ALSO an Org Admin in six orgs: from the
    // sign-in card the founder wants the estate, not one tenant's console. The
    // way into a specific org is /platform → "Enter console", which is audited
    // impersonation and carries a permanent banner. Landing him straight in
    // Micromart would be the one path that touches a lender's book with no
    // record of why.
    //
    // A wrong password here does NOT short-circuit: it falls through to the
    // staff lookup and fails there with the same uniform message, so this branch
    // reveals nothing about which accounts are platform accounts.
    if (!body.orgSlug) {
      const admin = await withDbRetry(() => prisma.platformAdmin.findUnique({ where: { email } }));
      if (admin && admin.status === "ACTIVE" && (await bcrypt.compare(password, admin.passwordHash))) {
        await prisma.platformAdmin.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } }).catch(() => {});
        await prisma.auditLog.create({
          data: { orgId: null, actorId: admin.id, actorType: "platform", action: "platform.login", ip: req.headers.get("x-forwarded-for") },
        }).catch(() => {});
        await createPlatformSession({ id: admin.id, name: admin.name, email: admin.email });
        return NextResponse.json({ success: true, platform: true, name: admin.name, destination: "/platform" });
      }
    }

    const staff = await withDbRetry(() => prisma.staffUser.findFirst({
      where: {
        email,
        status: "ACTIVE",
        ...(body.orgSlug ? { org: { slug: body.orgSlug } } : {}),
      },
      include: { role: { select: { id: true, title: true } }, org: { select: { id: true, slug: true, status: true, isDemo: true } } },
      orderBy: { createdAt: "asc" },
    }));

    // Uniform failure message — never reveal which part was wrong.
    const fail = () => NextResponse.json({ success: false, message: "Invalid email or password." }, { status: 401 });
    if (!staff?.passwordHash) return fail();
    if (!(await bcrypt.compare(password, staff.passwordHash))) return fail();
    // PENDING orgs may sign in to configure branding/team/vault — money-moving
    // surfaces gate on Org.status === ACTIVE separately. Only SUSPENDED blocks.
    if (staff.org.status === "SUSPENDED") {
      return NextResponse.json({ success: false, message: "Your organization is suspended. Contact BirgenAI support." }, { status: 403 });
    }

    // Second factor: today's sign-in code. Demo orgs skip it — the /demo page's
    // one-click "sign in as" IS the product being shown.
    if (!staff.org.isDemo) {
      if (body.otp) {
        const okCode = await runWithOrg(staff.orgId, () => verifyDailyLoginOtp(staff.orgId, staff.id, body.otp!));
        if (!okCode) {
          return NextResponse.json(
            { success: false, otpRequired: true, message: "That code didn't match. Use today's code from your inbox — it works until midnight." },
            { status: 401 },
          );
        }
        // fall through to session
      } else {
        const issue = await runWithOrg(staff.orgId, () => issueDailyLoginOtp(staff.orgId, staff.id));
        if (issue.delivered || issue.fallbackCode) {
          return NextResponse.json({
            success: false,
            otpRequired: true,
            issued: issue.issued,
            message: issue.issued
              ? "Today's code is on its way to your inbox."
              : "Use today's code from your inbox — it's good until midnight.",
            // Present only when BOTH channels failed outside production; a delivered
            // code is never echoed back to the browser.
            ...(issue.fallbackCode ? { fallbackCode: issue.fallbackCode } : {}),
          });
        }
        // No email, no SMS — locking every officer out is worse than parity.
        await prisma.auditLog.create({
          data: { orgId: staff.orgId, actorId: staff.id, actorType: "staff", action: "auth.otp-skipped", meta: { reason: "no delivery channel" } },
        }).catch(() => {});
      }
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
      roleId: staff.role?.id ?? null,
      orgId: staff.orgId,
      orgSlug: staff.org.slug,
      tiers: { initiator: staff.isInitiator, authorizer: staff.isAuthorizer, validator: staff.isValidator },
    });

    // /suite, not /console. An organisation's people are not all lending
    // officers — the collections supervisor, the accountant and the HR manager
    // each have their own system, and dropping every one of them into the
    // lending console means five of the six systems are reached by knowing a URL.
    // The launcher shows each person exactly the doors they hold rights to.
    return NextResponse.json({ success: true, orgSlug: staff.org.slug, destination: "/suite" });
  });
  } catch (err) {
    if (isTransientDbError(err)) return wakingUpResponse();
    throw err;
  }
}
