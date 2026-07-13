// PATCH /api/console/borrowers/[id] — the borrower management verbs behind the
// Customer-360 kebab menu. One endpoint, explicit actions, every one audited:
//
//   { action: "info",        name?, phone?, email?, nationalId?, locationType?, locationAddress? }
//   { action: "next-of-kin", name, relationship, phone }
//   { action: "limit",       loanLimit: number|null, note }        (note mandatory)
//   { action: "score",       creditScore: number|null, riskBand?, note }  (note mandatory)
//   { action: "assign",      officerId?, branchId? }
//
// TWO RULES:
//   • MONEY-ADJACENT EDITS EXPLAIN THEMSELVES. A loan limit or a credit score
//     changed by hand is a decision someone must be able to defend later — the
//     note is mandatory and lands in the audit row beside before/after values.
//     The score row also records itself as a MANUAL entry in the score history,
//     because a hand-set number hiding among model outputs would poison the
//     closed ML loop's honesty.
//   • THE SCOPE FENCE HOLDS HERE TOO. An officer who cannot SEE a borrower
//     cannot edit them — same rule as the page, the API, and the counter.
import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { prisma } from "@/lib/prisma";
import { resolveScope, canSeeBorrower } from "@/lib/rbac/scope";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const denied = await requireRight(session, "borrowers.manage");
  if (denied) return denied;
  const orgId = session!.user!.orgId!;
  const { id } = await ctx.params;

  const scope = await resolveScope(session!);
  if (!(await canSeeBorrower(scope, id))) {
    return NextResponse.json({ success: false, message: "Borrower not found." }, { status: 404 });
  }
  const borrower = await prisma.borrower.findFirst({ where: { id, orgId } });
  if (!borrower) return NextResponse.json({ success: false, message: "Borrower not found." }, { status: 404 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }
  const action = String(body.action ?? "");

  const audit = (meta: Prisma.InputJsonValue) =>
    prisma.auditLog.create({
      data: {
        orgId, actorId: session!.user!.id, actorType: "staff",
        action: `borrower.${action}`, entity: "Borrower", entityId: id, meta,
      },
    }).catch(() => {});

  // ── Update the identity & contact details ───────────────────────────────────
  if (action === "info") {
    const data: Prisma.BorrowerUpdateInput = {};
    const changed: Record<string, { from: unknown; to: unknown }> = {};

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name) {
      if (name.length < 3) return NextResponse.json({ success: false, message: "Enter the full name." }, { status: 400 });
      const [first, ...rest] = name.split(/\s+/);
      data.firstName = first;
      data.otherName = rest.join(" ") || null;
      changed.name = { from: `${borrower.firstName ?? ""} ${borrower.otherName ?? ""}`.trim(), to: name };
    }
    if (typeof body.phone === "string" && body.phone.trim()) {
      const digits = body.phone.replace(/\D/g, "");
      if (digits.length < 9) return NextResponse.json({ success: false, message: "Enter a valid phone number." }, { status: 400 });
      const phone = `254${digits.slice(-9)}`;
      if (phone !== borrower.phone) {
        // The phone is the identity key — a change must not collide with another book entry.
        const dup = await prisma.borrower.findFirst({ where: { orgId, phone, NOT: { id } }, select: { id: true } });
        if (dup) return NextResponse.json({ success: false, message: "Another borrower already has that phone." }, { status: 409 });
        data.phone = phone;
        changed.phone = { from: borrower.phone, to: phone };
      }
    }
    if (typeof body.email === "string") {
      data.email = body.email.trim() || null;
      changed.email = { from: borrower.email, to: data.email };
    }
    if (typeof body.nationalId === "string" && body.nationalId.trim()) {
      const nid = body.nationalId.replace(/\D/g, "");
      data.nationalId = nid || null;
      changed.nationalId = { from: borrower.nationalId, to: nid };
    }
    if (body.locationType === "business" || body.locationType === "home") {
      data.locationType = body.locationType;
      changed.locationType = { from: borrower.locationType, to: body.locationType };
    }
    if (typeof body.locationAddress === "string") {
      data.locationAddress = body.locationAddress.trim() || null;
      changed.locationAddress = { from: borrower.locationAddress, to: data.locationAddress };
    }
    if (Object.keys(changed).length === 0) return NextResponse.json({ success: false, message: "Nothing to change." }, { status: 400 });

    await prisma.borrower.update({ where: { id }, data });
    await audit({ changed } as Prisma.InputJsonValue);
    return NextResponse.json({ success: true });
  }

  // ── Next of kin ──────────────────────────────────────────────────────────────
  if (action === "next-of-kin") {
    const name = String(body.name ?? "").trim();
    const relationship = String(body.relationship ?? "").trim();
    const digits = String(body.phone ?? "").replace(/\D/g, "");
    if (name.length < 3 || !relationship || digits.length < 9) {
      return NextResponse.json({ success: false, message: "Enter their name, relationship and phone." }, { status: 400 });
    }
    const nextOfKin = { name, relationship, phone: `254${digits.slice(-9)}` };
    await prisma.borrower.update({ where: { id }, data: { nextOfKin } });
    await audit({ nextOfKin });
    return NextResponse.json({ success: true });
  }

  // ── Loan limit override ──────────────────────────────────────────────────────
  if (action === "limit") {
    const note = String(body.note ?? "").trim();
    if (note.length < 10) return NextResponse.json({ success: false, message: "Say why (at least 10 characters) — a limit change must explain itself." }, { status: 400 });
    const raw = body.loanLimit;
    const loanLimit = raw == null || raw === "" ? null : Math.round(Number(raw));
    if (loanLimit != null && (!Number.isFinite(loanLimit) || loanLimit < 0 || loanLimit > 100_000_000)) {
      return NextResponse.json({ success: false, message: "Enter a valid limit amount." }, { status: 400 });
    }
    await prisma.borrower.update({
      where: { id },
      data: { previousLoanLimit: borrower.loanLimit, loanLimit },
    });
    await audit({ from: borrower.loanLimit != null ? Number(borrower.loanLimit) : null, to: loanLimit, note });
    return NextResponse.json({ success: true });
  }

  // ── Manual credit score ──────────────────────────────────────────────────────
  if (action === "score") {
    const note = String(body.note ?? "").trim();
    if (note.length < 10) return NextResponse.json({ success: false, message: "Say why (at least 10 characters) — a hand-set score must explain itself." }, { status: 400 });
    const raw = body.creditScore;
    const creditScore = raw == null || raw === "" ? null : Math.round(Number(raw));
    if (creditScore != null && (!Number.isFinite(creditScore) || creditScore < 300 || creditScore > 900)) {
      return NextResponse.json({ success: false, message: "Scores run 300–900." }, { status: 400 });
    }
    const riskBand = typeof body.riskBand === "string" && body.riskBand.trim() ? body.riskBand.trim().slice(0, 30) : borrower.riskBand;

    await prisma.borrower.update({ where: { id }, data: { creditScore, riskBand } });
    // A hand-set score enters the history WEARING ITS ORIGIN — the outcome
    // backfill and drift monitors read modelKind, and "MANUAL" is how this row
    // never masquerades as a model output.
    if (creditScore != null) {
      await prisma.scoreSnapshot.create({
        data: {
          orgId, borrowerId: id, modelKind: "MANUAL", modelVersion: "officer-override",
          score: creditScore, features: { note, by: session!.user!.name ?? session!.user!.id },
        },
      }).catch(() => {});
    }
    await audit({ from: borrower.creditScore, to: creditScore, riskBand, note });
    return NextResponse.json({ success: true });
  }

  // ── Reassign officer / branch ────────────────────────────────────────────────
  if (action === "assign") {
    const officerId = typeof body.officerId === "string" && body.officerId ? body.officerId : null;
    const branchId = typeof body.branchId === "string" && body.branchId ? body.branchId : null;
    if (!officerId && !branchId) return NextResponse.json({ success: false, message: "Pick an officer or a branch." }, { status: 400 });

    if (officerId) {
      const staff = await prisma.staffUser.findFirst({ where: { id: officerId, orgId, status: "ACTIVE" }, select: { id: true, branchId: true } });
      if (!staff) return NextResponse.json({ success: false, message: "That staff member is not active here." }, { status: 404 });
    }
    if (branchId) {
      const branch = await prisma.branch.findFirst({ where: { id: branchId, orgId }, select: { id: true } });
      if (!branch) return NextResponse.json({ success: false, message: "Branch not found." }, { status: 404 });
    }
    await prisma.borrower.update({
      where: { id },
      data: { ...(officerId ? { createdById: officerId } : {}), ...(branchId ? { branchId } : {}) },
    });
    await audit({ from: { officerId: borrower.createdById, branchId: borrower.branchId }, to: { officerId: officerId ?? borrower.createdById, branchId: branchId ?? borrower.branchId } });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ success: false, message: "Unknown action." }, { status: 400 });
}
