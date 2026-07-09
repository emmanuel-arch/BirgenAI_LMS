// Platform administration — BirgenAI-side org activation (cross-tenant, the
// ONLY surface that crosses orgs). Gated by PLATFORM_ADMIN_SECRET bearer —
// never by an org session.
//   GET  → all orgs with status + counts
//   POST → { orgId, action: "activate" | "suspend" | "pend" }
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runAsPlatform } from "@/lib/db/context";

export const runtime = "nodejs";

function authorized(req: NextRequest): boolean {
  const secret = process.env.PLATFORM_ADMIN_SECRET?.trim();
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  return !!token && token === secret;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });
  // The one surface that legitimately crosses tenants — gated by the platform secret.
  const orgs = await runAsPlatform(() =>
    prisma.org.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true, slug: true, name: true, mode: true, status: true, plan: true, createdAt: true,
        _count: { select: { staff: true, borrowers: true, loans: true, applications: true } },
      },
    }),
  );
  return NextResponse.json({ success: true, orgs });
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });

  let body: { orgId?: string; action?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const status = body.action === "activate" ? "ACTIVE" : body.action === "suspend" ? "SUSPENDED" : body.action === "pend" ? "PENDING" : null;
  if (!body.orgId || !status) return NextResponse.json({ success: false, message: "orgId and a valid action are required." }, { status: 400 });

  return runAsPlatform(async () => {
    const org = await prisma.org.update({ where: { id: body.orgId! }, data: { status } }).catch(() => null);
    if (!org) return NextResponse.json({ success: false, message: "Org not found." }, { status: 404 });

    await prisma.auditLog.create({
      data: { orgId: org.id, actorType: "platform", action: `org.${body.action}`, entity: "Org", entityId: org.id },
    }).catch(() => {});

    return NextResponse.json({ success: true, slug: org.slug, status: org.status });
  });
}
