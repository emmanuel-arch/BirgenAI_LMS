// Float ledger API.
//   GET  → balance + recent entries (staff)
//   POST → top-up { amount, ref?, note? } (admin only)
import { NextRequest, NextResponse } from "next/server";
import { auth, hasAdminAccess } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { addFloatEntry, floatBalance } from "@/lib/lending/float";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const [balance, entries] = await Promise.all([
    floatBalance(session.user.orgId),
    prisma.floatLedger.findMany({
      where: { orgId: session.user.orgId },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);
  return NextResponse.json({
    success: true,
    balance,
    entries: entries.map((e) => ({
      id: e.id, kind: e.kind, amount: Number(e.amount), balanceAfter: Number(e.balanceAfter),
      ref: e.ref, note: e.note, createdAt: e.createdAt,
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId || !hasAdminAccess(session)) {
    return NextResponse.json({ success: false, message: "Admin sign-in required." }, { status: 401 });
  }
  let body: { amount?: number; ref?: string; note?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ success: false, message: "Enter a valid top-up amount." }, { status: 400 });
  }
  const entry = await addFloatEntry(session.user.orgId, "TOPUP", amount, {
    ref: body.ref?.trim() || undefined,
    note: body.note?.trim() || undefined,
    createdBy: session.user.id,
  });
  await prisma.auditLog.create({
    data: { orgId: session.user.orgId, actorId: session.user.id, actorType: "staff", action: "float.topup", entity: "FloatLedger", entityId: entry.id, meta: { amount } },
  }).catch(() => {});
  return NextResponse.json({ success: true, balance: Number(entry.balanceAfter) });
}
