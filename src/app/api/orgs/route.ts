// POST /api/orgs — self-onboard a new lending organization (ServiceSuite
// NewEntity parity, self-service). Creates in ONE transaction:
//   Org (status PENDING — platform approves before it can transact)
//   + starter roles ("Org Admin" with everything, plus Loan Officer /
//     Branch Manager / Finance with sensible defaults, so the Roles page is a
//     working example rather than a blank slate)
//   + "Head Office" branch
//   + the admin StaffUser (ACTIVE so they can sign in and configure the vault
//     while approval is pending; money-moving surfaces stay gated on org status)
// The onboarding wizard may attach a logo (base64, size-capped); it uploads
// AFTER the transaction and must never fail the onboarding itself.
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma, orgTx } from "@/lib/prisma";
import { runAsPlatform } from "@/lib/db/context";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { putBrandLogo, InvalidImageError } from "@/lib/storage/provider";
import { isHexColor, accentSoftFrom } from "@/lib/branding/palette";
import { sendTemplatedEmail } from "@/lib/email/send";
import { emailBrandFor } from "@/lib/email/layout";
import { welcomeOrgEmail } from "@/lib/email/templates";

export const runtime = "nodejs";

type Body = {
  name?: string;
  slug?: string;
  accent?: string;
  accent2?: string;
  logoDataUrl?: string;
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
const RESERVED = new Set(["www", "api", "lms", "app", "admin", "console", "hub", "birgenai", "login", "onboard", "platform", "demo"]);

/** Sensible defaults a new lender can rename, reshape or delete on day one. */
const STARTER_ROLES: { title: string; rights: string[] }[] = [
  { title: "Org Admin", rights: ["*"] },
  {
    title: "Loan Officer",
    rights: [
      "borrowers.view", "borrowers.create", "applications.view", "applications.decide", "loans.view", "loans.apply",
      "products.view", "documents.view", "documents.parse", "field.view", "reports.view", "riri.use",
      "collections.view", "collections.manage",
    ],
  },
  {
    title: "Branch Manager",
    rights: [
      "borrowers.view", "borrowers.create", "applications.view", "applications.decide", "loans.view", "loans.apply",
      "products.view", "workflows.view", "documents.view", "documents.parse", "field.view", "field.manage",
      "disbursements.view", "disbursements.manage", "float.view", "repayments.view", "repayments.collect",
      "team.view", "intelligence.view", "reports.view", "riri.use",
      "collections.view", "collections.manage", "sms.view", "sms.manage",
    ],
  },
  {
    title: "Finance",
    rights: [
      "loans.view", "disbursements.view", "disbursements.manage", "float.view", "float.manage",
      "repayments.view", "repayments.collect", "reconciliation.view", "reconciliation.resolve",
      "billing.view", "reports.view", "collections.view",
    ],
  },
];

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 });
  }

  // Unauthenticated tenant creation: throttle hard. Two windows kill both the
  // burst and the slow grind.
  const limited = await rateLimit(
    [
      { name: "org-create:ip", subject: clientIp(req), max: 3, windowSec: 3600 },
      { name: "org-create:ip:day", subject: clientIp(req), max: 8, windowSec: 86400 },
    ],
    "Too many organizations created from this connection. Try again later.",
  );
  if (limited) return limited;

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
  const accent = body.accent?.trim() && isHexColor(body.accent.trim()) ? body.accent.trim() : "#F97316";
  const accent2 = body.accent2?.trim() && isHexColor(body.accent2.trim()) ? body.accent2.trim() : null;

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
            accent,
            accentSoft: accentSoftFrom(accent),
            accent2,
            tagline: body.tagline?.trim() || null,
            blurb: body.blurb?.trim() || null,
            country: (body.country ?? "KE").toUpperCase().slice(0, 2),
            currency: (body.currency ?? "KES").toUpperCase().slice(0, 3),
          },
        });
        let adminRoleId: string | null = null;
        for (const r of STARTER_ROLES) {
          const role = await tx.role.create({ data: { orgId: org.id, title: r.title, rights: r.rights, menu: r.rights } });
          if (r.title === "Org Admin") adminRoleId = role.id;
        }
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
            roleId: adminRoleId,
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

      // Logo AFTER the tx — a failed upload costs the logo, never the org.
      let logoWarning: string | null = null;
      if (body.logoDataUrl) {
        try {
          const logoUrl = await putBrandLogo(org.id, body.logoDataUrl);
          await prisma.org.update({ where: { id: org.id }, data: { logoUrl } });
        } catch (e) {
          logoWarning = e instanceof InvalidImageError ? e.message : "The logo could not be stored — add it later under Organization → Branding.";
        }
      }

      // Welcome the founding admin in their OWN branding — the first proof the
      // white-label is real. Best-effort, like everything mail.
      const brand = await emailBrandFor(org.id);
      await sendTemplatedEmail(org.id, adminEmail, welcomeOrgEmail(brand, { name: first, email: adminEmail }), "welcome").catch(() => {});

      return NextResponse.json({
        success: true,
        orgId: org.id,
        slug: org.slug,
        status: org.status,
        logoWarning,
        message: "Organization created — sign in to configure it. BirgenAI will review and activate it for live lending.",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not create the organization.";
      return NextResponse.json({ success: false, message }, { status: 500 });
    }
  });
}
