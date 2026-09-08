// ─────────────────────────────────────────────────────────────────────────────
// GET /api/console/onboarding/contract?channel=console|portal|ussd
//
// One answer to "what does this lender ask for, and how?", built on the server from
// three config namespaces and the connected rails, and rendered identically by the
// counter, the customer app and a field officer's phone.
//
// The alternative — each surface reading the raw documents and deciding for itself —
// drifts, and drifts silently: the app asks for an occupation the console does not,
// or the console saves a record the app's rules would have refused. Deriving once
// makes a faithful client correct by construction.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { prisma } from "@/lib/prisma";
import { readBorrowerConfig, readAttachmentConfig, readDetailsConfig } from "@/lib/config/store";
import { buildOnboardingContract } from "@/lib/config/onboarding-contract";
import type { DetailChannel } from "@/lib/config/details";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  // Anyone who may register a borrower may ask what registering one requires.
  const denied = await requireRight(session, "borrowers.create");
  if (denied) return denied;
  const orgId = session.user.orgId;

  const raw = req.nextUrl.searchParams.get("channel");
  const channel: DetailChannel = raw === "portal" || raw === "ussd" ? raw : "console";

  const [borrower, attachments, details, integrations] = await Promise.all([
    readBorrowerConfig(orgId),
    readAttachmentConfig(orgId),
    readDetailsConfig(orgId),
    prisma.orgIntegration.findMany({
      where: { orgId },
      select: { kind: true, status: true },
    }),
  ]);

  const connectedVaults = integrations
    .filter((i) => i.status !== "UNCONFIGURED" && i.status !== "DISABLED")
    .map((i) => String(i.kind));

  const contract = buildOnboardingContract(
    borrower.value, attachments.value, details.value, channel, { connectedVaults },
  );

  return NextResponse.json({
    success: true,
    contract,
    // The versions the contract was derived from, so a client can cache it and know
    // when to re-read rather than re-fetching on every keystroke.
    version: {
      borrower: borrower.version,
      attachments: attachments.version,
      details: details.version,
    },
  });
}
