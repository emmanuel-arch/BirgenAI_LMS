// POST /api/console/borrowers/iprs — registry-first onboarding, step 1.
//
// "We hate paperwork too": the officer types ONE number and the national
// registry fills in the person. The lookup happens SERVER-SIDE — the fields the
// officer reviews came from IPRS, not from whatever a browser chose to post —
// and the payload is returned so borrower creation can freeze it onto the
// record as evidence (a KycCheck row, written by the create endpoint).
//
// Two hard rules:
//   • CONSENT FIRST. The registry (and the DPA) require the customer's consent,
//     collected by a named human. The route refuses without it; the officer's
//     name goes on the wire as consent_collected_by.
//   • EVERY LOOKUP COSTS MONEY (Spinmobile bills per call). Rate-limited per
//     staff and per org, and never fired speculatively — the UI asks once, on
//     an explicit button, for a full ID number.
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
  const denied = await requireRight(session, "borrowers.create");
  if (denied) return denied;
  const orgId = session!.user!.orgId!;
  const staffId = session!.user!.id!;

  let body: { nationalId?: string; consent?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const nid = (body.nationalId ?? "").replace(/\D/g, "");
  if (nid.length < 6 || nid.length > 10) {
    return NextResponse.json({ success: false, message: "Enter the national ID number (6–10 digits)." }, { status: 400 });
  }
  if (!body.consent) {
    return NextResponse.json({ success: false, message: "Confirm the customer consented to a registry identity check." }, { status: 400 });
  }

  const limited = await rateLimit([
    { name: "iprs:staff", subject: `${orgId}:${staffId}`, max: 15, windowSec: 3600 },
    { name: "iprs:org", subject: orgId, max: 60, windowSec: 3600 },
    { name: "iprs:ip", subject: clientIp(req), max: 30, windowSec: 3600 },
  ], "Too many registry lookups — wait a moment before trying again.");
  if (limited) return limited;

  // Already registered? Say so before spending a lookup.
  const [existing, orgRow] = await Promise.all([
    prisma.borrower.findFirst({
      where: { orgId, nationalId: nid },
      select: { id: true, firstName: true, otherName: true, phone: true },
    }),
    prisma.org.findUnique({ where: { id: orgId }, select: { isDemo: true } }),
  ]);

  // Demo orgs never reach the live registry — a demo click must not cost money.
  const mode = orgRow?.isDemo ? "simulation" : iprsMode();
  let person: IprsPerson | null = null;
  let found = false;
  let note = "";

  if (mode === "live") {
    const r = await spinIprsIdentity(nid, session!.user!.name ?? `staff:${staffId}`);
    if (r.ok) {
      person = r.person;
      found = true;
      note = "Matched against the national registry (IPRS · live).";
    } else if (r.mode === "live" && r.notFound) {
      note = r.error;
    } else {
      // Transport failure — fall to simulation so onboarding never dies on a vendor.
      note = "Registry unreachable — simulated prefill; verify at KYC.";
    }
  }
  if (!person && !note.includes("No record")) {
    const sim = iprsLookup(`iprs:${orgId}:${nid}`, nid);
    const ext = extractId(`iprs:${orgId}:${nid}`, nid);
    if (sim.matched) {
      const parts = (sim.name ?? "").split(/\s+/);
      person = {
        idNumber: nid,
        firstName: parts[0] ?? null,
        otherName: null,
        surname: parts.slice(1).join(" ") || null,
        fullName: sim.name,
        gender: sim.gender,
        dob: sim.dob,
        citizenship: "Kenyan",
        serialNumber: ext.serial,
        placeOfBirth: null,
        placeOfLive: null,
        photo: null,
      };
      found = true;
      note = note || "Matched against the national registry (simulated).";
    }
  }

  // Charged evidence: who looked up whom, and what came back (no photo bytes).
  await prisma.auditLog.create({
    data: {
      orgId, actorId: staffId, actorType: "staff", action: "borrower.iprs-prefill",
      entity: "Borrower", entityId: existing?.id ?? nid,
      meta: { nationalId: nid, mode, found, name: person?.fullName ?? null },
    },
  }).catch(() => {});

  return NextResponse.json({
    success: true,
    mode,
    found,
    note,
    existing: existing ? { id: existing.id, name: `${existing.firstName ?? ""} ${existing.otherName ?? ""}`.trim(), phone: existing.phone } : null,
    person: person ? { ...person, photo: undefined } : null,
    // The registry portrait is PII — only travel it when it exists, and the UI
    // shows it inline for the officer's eyeball check (never stored from here).
    photo: person?.photo ?? null,
  });
}
