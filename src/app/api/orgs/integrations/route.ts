// Org integrations vault API (org-admin only, own org only).
//   GET  → masked list: kind, status, lastTestAt — never secrets.
//   PUT  → save one integration config { kind, config } (encrypted at rest).
import { NextRequest, NextResponse } from "next/server";
import { auth, hasAdminAccess } from "@/lib/auth";
import { listIntegrations, setIntegration } from "@/lib/vault/integrations";
import type { IntegrationKind } from "@prisma/client";

export const runtime = "nodejs";

const KINDS: IntegrationKind[] = ["MPESA_STK", "MPESA_B2C", "MPESA_C2B", "SMS", "SMTP", "CRB", "KYC", "SERVICESUITE", "WEBHOOK"];

export async function GET() {
  const session = await auth();
  if (!session?.user?.orgId || !hasAdminAccess(session)) {
    return NextResponse.json({ success: false, message: "Admin sign-in required." }, { status: 401 });
  }
  const integrations = await listIntegrations(session.user.orgId);
  return NextResponse.json({ success: true, integrations });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId || !hasAdminAccess(session)) {
    return NextResponse.json({ success: false, message: "Admin sign-in required." }, { status: 401 });
  }

  let body: { kind?: string; config?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 });
  }

  const kind = (body.kind ?? "") as IntegrationKind;
  if (!KINDS.includes(kind)) {
    return NextResponse.json({ success: false, message: "Unknown integration kind." }, { status: 400 });
  }
  if (!body.config || typeof body.config !== "object" || Object.keys(body.config).length === 0) {
    return NextResponse.json({ success: false, message: "Provide the integration config." }, { status: 400 });
  }

  await setIntegration(session.user.orgId, kind, body.config as never, session.user.id);
  return NextResponse.json({ success: true, kind, status: "CONFIGURED" });
}
