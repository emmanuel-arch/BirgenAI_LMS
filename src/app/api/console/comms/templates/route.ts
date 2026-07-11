// SMS template editor (own org).
//   GET → the built-in catalogue merged with this org's overrides (sms.view)
//   PUT { key, body?, active? } (sms.manage) — override a template, or clear
//       the override (body: null) to fall back to the built-in copy.
// Placeholders ({name}, {amount}, {code}, …) must survive an override — a
// template that drops {code} sends borrowers a code-less code SMS.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireRight } from "@/lib/rbac/authz";
import { defaultSmsTemplates } from "@/lib/sms/send";

export const runtime = "nodejs";

const placeholdersOf = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);

export async function GET() {
  const session = await auth();
  const denied = await requireRight(session, "sms.view");
  if (denied) return denied;
  const orgId = session!.user!.orgId!;

  const overrides = await prisma.smsTemplate.findMany({ where: { orgId } });
  const byKey = new Map(overrides.map((o) => [o.key, o]));
  return NextResponse.json({
    success: true,
    templates: defaultSmsTemplates().map((t) => {
      const o = byKey.get(t.key);
      return {
        key: t.key,
        defaultBody: t.body,
        placeholders: placeholdersOf(t.body),
        override: o ? { body: o.body, active: o.active, updatedAt: o.updatedAt } : null,
      };
    }),
  });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  const denied = await requireRight(session, "sms.manage");
  if (denied) return denied;
  const orgId = session!.user!.orgId!;

  let body: { key?: string; body?: string | null; active?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const def = defaultSmsTemplates().find((t) => t.key === body.key);
  if (!def) return NextResponse.json({ success: false, message: "Unknown template." }, { status: 400 });

  // Clearing an override restores the built-in copy.
  if (body.body === null) {
    await prisma.smsTemplate.deleteMany({ where: { orgId, key: def.key } });
    await prisma.auditLog.create({
      data: { orgId, actorId: session!.user!.id, actorType: "staff", action: "comms.template.reset", meta: { key: def.key } },
    }).catch(() => {});
    return NextResponse.json({ success: true, reset: true });
  }

  const text = (body.body ?? "").trim();
  if (text.length < 10 || text.length > 480) {
    return NextResponse.json({ success: false, message: "Templates are 10–480 characters." }, { status: 400 });
  }
  // Every placeholder the built-in relies on must survive.
  const required = placeholdersOf(def.body);
  const provided = new Set(placeholdersOf(text));
  const missing = required.filter((p) => !provided.has(p));
  if (missing.length > 0) {
    return NextResponse.json({
      success: false,
      message: `Keep the placeholder${missing.length > 1 ? "s" : ""} ${missing.map((m) => `{${m}}`).join(", ")} — without ${missing.length > 1 ? "them" : "it"} the message loses its meaning.`,
    }, { status: 400 });
  }

  await prisma.smsTemplate.upsert({
    where: { orgId_key: { orgId, key: def.key } },
    create: { orgId, key: def.key, title: def.key, body: text, active: body.active ?? true },
    update: { body: text, active: body.active ?? true },
  });
  await prisma.auditLog.create({
    data: { orgId, actorId: session!.user!.id, actorType: "staff", action: "comms.template.update", meta: { key: def.key } },
  }).catch(() => {});

  return NextResponse.json({ success: true });
}
