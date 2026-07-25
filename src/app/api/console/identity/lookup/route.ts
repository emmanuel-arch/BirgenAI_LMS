// POST /api/console/identity/lookup — registry-first autofill for the OTHER people
// on a file: a guarantor, a next-of-kin. Same national registry (IPRS), same
// consent + cost discipline as borrower onboarding, but it does not create anything
// and it does not care whether the person is already a borrower — a guarantor often is.
//
// Body: { nationalId, consent, role? }  →  { success, mode, found, note, person, alreadyBorrower }
//
// Two rules, unchanged: CONSENT FIRST (a named human collected it) and EVERY LOOKUP
// COSTS MONEY (rate-limited, never speculative, simulated for demo orgs).
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { prisma } from "@/lib/prisma";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { iprsMode, spinIprsIdentity, type IprsPerson } from "@/lib/kyc/iprs";
import { iprsLookup, extractId } from "@/lib/kyc/provider";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const session = await auth();
  // A basic read right — anyone who can see customers can attach a guarantor or a
  // next-of-kin to one, and both flows live behind borrowers.view already.
  const denied = await requireRight(session, "borrowers.view");
  if (denied) return denied;
  const orgId = session!.user!.orgId!;
  const staffId = session!.user!.id!;

  let body: { nationalId?: string; consent?: boolean; role?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const nid = (body.nationalId ?? "").replace(/\D/g, "");
  const role = (body.role ?? "person").slice(0, 24);
  if (nid.length < 6 || nid.length > 10) {
    return NextResponse.json({ success: false, message: "Enter the national ID number (6–10 digits)." }, { status: 400 });
  }
  if (!body.consent) {
    return NextResponse.json({ success: false, message: `Confirm the ${role} consented to a registry identity check.` }, { status: 400 });
  }

  const limited = await rateLimit([
    { name: "iprs:staff", subject: `${orgId}:${staffId}`, max: 20, windowSec: 3600 },
    { name: "iprs:org", subject: orgId, max: 80, windowSec: 3600 },
    { name: "iprs:ip", subject: clientIp(req), max: 40, windowSec: 3600 },
  ], "Too many registry lookups — wait a moment before trying again.");
  if (limited) return limited;

  const orgRow = await prisma.org.findUnique({ where: { id: orgId }, select: { isDemo: true } });
  // Informational only — a guarantor who is also a customer is fine, even useful.
  const alreadyBorrower = await prisma.borrower.findFirst({
    where: { orgId, nationalId: nid }, select: { id: true, firstName: true, otherName: true },
  });

  const mode = orgRow?.isDemo ? "simulation" : iprsMode();
  let person: IprsPerson | null = null;
  let found = false;
  let note = "";

  if (mode === "live") {
    const r = await spinIprsIdentity(nid, session!.user!.name ?? `staff:${staffId}`);
    if (r.ok) { person = r.person; found = true; note = "Matched against the national registry (IPRS · live)."; }
    else if (r.mode === "live" && r.notFound) { note = r.error; }
    else { note = "Registry unreachable — simulated prefill; verify separately."; }
  }
  if (!person && !note.includes("No record")) {
    const sim = iprsLookup(`iprs:${orgId}:${nid}`, nid);
    const ext = extractId(`iprs:${orgId}:${nid}`, nid);
    if (sim.matched) {
      const parts = (sim.name ?? "").split(/\s+/);
      person = {
        idNumber: nid, firstName: parts[0] ?? null, otherName: null, surname: parts.slice(1).join(" ") || null,
        fullName: sim.name, gender: sim.gender, dob: sim.dob, citizenship: "Kenyan",
        serialNumber: ext.serial, placeOfBirth: null, placeOfLive: null, phone: null, email: null, photo: null,
      };
      found = true;
      note = note || "Matched against the national registry (simulated).";
    }
  }

  await prisma.auditLog.create({
    data: {
      orgId, actorId: staffId, actorType: "staff", action: "identity.iprs-lookup",
      entity: "Identity", entityId: nid,
      meta: { nationalId: nid, role, mode, found, name: person?.fullName ?? null },
    },
  }).catch(() => {});

  return NextResponse.json({
    success: true, mode, found, note,
    alreadyBorrower: alreadyBorrower ? { id: alreadyBorrower.id, name: `${alreadyBorrower.firstName ?? ""} ${alreadyBorrower.otherName ?? ""}`.trim() } : null,
    // The registry portrait is PII — the guarantor/NOK flows don't need it, so drop it.
    person: person ? { ...person, photo: undefined } : null,
  });
}
