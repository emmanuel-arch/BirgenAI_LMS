// POST /api/orgs — self-onboard a new lending organization (ServiceSuite
// NewEntity parity, self-service). Creates in ONE transaction:
//   Org (status PENDING — platform approves before it can transact)
//   + "Org Admin" role  + "Head Office" branch
//   + the admin StaffUser (ACTIVE so they can sign in and configure the vault
//     while approval is pending; money-moving surfaces stay gated on org status)
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma, orgTx } from "@/lib/prisma";
import { runAsPlatform } from "@/lib/db/context";

export const runtime = "nodejs";

type Body = {
  name?: string;
  slug?: string;
  accent?: string;
  tagline?: string;
  blurb?: string;
  country?: string;
  currency?: string;
  adminName?: string;
  adminEmail?: string;
  adminPhone?: string;
  password?: string;
};

const SLUG_RE = /^[a-z][a-z0-9-]{2,30}$/;
const RESERVED = new Set(["www", "api", "lms", "app", "admin", "console", "hub", "birgenai", "login", "onboard"]);

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 });
  }

  const name = (body.name ?? "").trim();
  const slug = (body.slug ?? "").trim().toLowerCase();
  const adminName = (body.adminName ?? "").trim();
  const adminEmail = (body.adminEmail ?? "").trim().toLowerCase();
  const adminPhone = (body.adminPhone ?? "").replace(/\D/g, "");
  const password = body.password ?? "";

  if (name.length < 3) return NextResponse.json({ success: false, message: "Enter the organization name." }, { status: 400 });
  if (!SLUG_RE.test(slug) || RESERVED.has(slug)) {
    return NextResponse.json({ success: false, message: "Choose a different subdomain (lowercase letters, numbers, dashes)." }, { status: 400 });
  }
  if (!adminName || !adminEmail.includes("@")) {
    return NextResponse.json({ success: false, message: "Enter the admin contact name and a valid email." }, { status: 400 });
  }
  if (password.length < 10) {
    return NextResponse.json({ success: false, message: "Use a password of at least 10 characters." }, { status: 400 });
  }

  const [first, ...rest] = adminName.split(/\s+/);
  const passwordHash = await bcrypt.hash(password, 12);

  // Self-onboarding CREATES the tenant, so there is no tenant to scope to yet.
  // This is one of the few legitimate platform-scoped writes.
  return runAsPlatform(async () => {
    const exists = await prisma.org.findUnique({ where: { slug }, select: { id: true } });
    if (exists) return NextResponse.json({ success: false, message: "That subdomain is taken." }, { status: 409 });

    try {
      const org = await orgTx(async (tx) => {
        const org = await tx.org.create({
          data: {
            slug,
            name,
            mode: "NATIVE",
            status: "PENDING",
            accent: body.accent?.trim() || "#F97316",
            tagline: body.tagline?.trim() || null,
            blurb: body.blurb?.trim() || null,
            country: (body.country ?? "KE").toUpperCase().slice(0, 2),
            currency: (body.currency ?? "KES").toUpperCase().slice(0, 3),
          },
        });
        const role = await tx.role.create({
          data: { orgId: org.id, title: "Org Admin", rights: ["*"], menu: ["*"] },
        });
        const branch = await tx.branch.create({
          data: { orgId: org.id, name: "Head Office", levelName: "Head Office" },
        });
        await tx.staffUser.create({
          data: {
            orgId: org.id,
            email: adminEmail,
            phone: adminPhone ? `254${adminPhone.slice(-9)}` : null,
            firstName: first,
            otherName: rest.join(" ") || null,
            passwordHash,
            roleId: role.id,
            branchId: branch.id,
            isInitiator: true,
            isAuthorizer: true,
            isValidator: true,
            status: "ACTIVE",
          },
        });
        await tx.auditLog.create({
          data: { orgId: org.id, actorType: "system", action: "org.self-onboard", meta: { slug, adminEmail }, ip: req.headers.get("x-forwarded-for") },
        });
        return org;
      }, { timeout: 30000, maxWait: 10000 }); // EU pooler round-trips exceed the 5s default

      return NextResponse.json({
        success: true,
        orgId: org.id,
        slug: org.slug,
        status: org.status,
        message: "Organization created — sign in to configure it. BirgenAI will review and activate it for live lending.",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not create the organization.";
      return NextResponse.json({ success: false, message }, { status: 500 });
    }
  });
}
