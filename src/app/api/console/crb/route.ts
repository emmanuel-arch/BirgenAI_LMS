// POST /api/console/crb — run a credit-bureau check on a borrower.
// Body: { borrowerId, loanAmount?, reason?, force? }.
//
// Live-first when Metropol is configured (src/lib/crb/metropol.ts), otherwise a
// labelled simulation. A recent pull is REUSED (default 6h) so we never pay for a
// second bureau hit — and never trip Metropol's E409 "duplicate within 60s" —
// unless `force:true`. Every pull is stored as an auditable KycCheck(kind=CRB)
// and meters one `crb` usage event.
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { prisma } from "@/lib/prisma";
import { MERGED_CRB_ONLY } from "@/lib/crb/rows";
import { requireFeature } from "@/lib/billing/entitlements";
import { meter } from "@/lib/billing/meter";
import { runCrbCheck, MetropolError, type CrbReport } from "@/lib/crb/provider";
import { REPORT_REASON } from "@/lib/crb/metropol";
import { getIntegration } from "@/lib/vault/integrations";
import type { ScrutinyTierKey } from "@/lib/crb/catalogue";

export const runtime = "nodejs";

/**
 * How long a stored bureau file stays fresh, when the lender has not said.
 *
 * Six hours is the default rather than a longer window because the reuse cache
 * is a COST control, not a correctness one: the longer the window, the more of a
 * borrower's recent borrowing it hides. On a mobile book a week-old file has
 * already missed two new lenders. Lenders who value the saving over the
 * freshness widen it themselves in Settings → Bureau scrutiny.
 */
const DEFAULT_REUSE_HOURS = 6;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "borrowers.view");
  if (denied) return denied;
  const orgId = session.user.orgId;

  let body: { borrowerId?: string; loanAmount?: number; reason?: number; force?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }
  if (!body.borrowerId) return NextResponse.json({ success: false, message: "A borrower is required." }, { status: 400 });

  const borrower = await prisma.borrower.findFirst({
    where: { id: body.borrowerId, orgId },
    select: { id: true, phone: true, nationalId: true, firstName: true, otherName: true },
  });
  if (!borrower) return NextResponse.json({ success: false, message: "Borrower not found." }, { status: 404 });

  // The lender's own scrutiny plan decides both how long a file stays fresh and
  // what the next pull would cost. Read once, used for the reuse window, the
  // budget guard and the metered unit cost.
  const cfg = await getIntegration(orgId, "CRB").catch(() => null);
  const reuseMs = Math.max(0, (cfg?.reuseHours ?? DEFAULT_REUSE_HOURS)) * 3_600_000;

  // Reuse a recent pull unless explicitly forced — cheaper, and dodges E409.
  if (!body.force && reuseMs > 0) {
    const recent = await prisma.kycCheck.findFirst({
      where: { orgId, borrowerId: borrower.id, kind: "CRB", ...MERGED_CRB_ONLY, createdAt: { gte: new Date(Date.now() - reuseMs) } },
      orderBy: { createdAt: "desc" },
      select: { payload: true, createdAt: true },
    });
    if (recent?.payload) {
      return NextResponse.json({ success: true, report: recent.payload, reused: true, checkedAt: recent.createdAt });
    }
  }

  // A live bureau pull bills us. Gate BEFORE the call, never after.
  const gated = await requireFeature(orgId, "crb");
  if (gated) return gated;

  const reason = Object.values(REPORT_REASON).includes(body.reason as never)
    ? (body.reason as (typeof REPORT_REASON)[keyof typeof REPORT_REASON])
    : REPORT_REASON.VERIFY_DETAILS; // an on-demand 360 pull is "verify details"

  // ── THE BUDGET GUARD ────────────────────────────────────────────────────────
  //
  // Checked here and not inside the provider, because the answer depends on what
  // has already been SPENT this month — a billing fact, not a bureau one.
  //
  // "warn" is the default and does nothing but annotate: blocking bureau access
  // to save money does not save money, it moves the cost onto the loan book. One
  // bad KES 200,000 decision made blind costs more than a year of reports. A
  // lender who wants the harder behaviour has to choose it explicitly.
  let tierOverride: ScrutinyTierKey | undefined;
  let budgetNote: string | undefined;
  if (cfg?.monthlyBudget && cfg.monthlyBudget > 0 && cfg.budgetAction !== "warn") {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const spent = await prisma.usageEvent.aggregate({
      where: { orgId, kind: "crb", createdAt: { gte: monthStart } },
      _sum: { unitCost: true },
    });
    if (Number(spent._sum.unitCost ?? 0) >= cfg.monthlyBudget) {
      if (cfg.budgetAction === "block") {
        return NextResponse.json(
          {
            success: false,
            message: `This month's bureau budget (KES ${cfg.monthlyBudget.toLocaleString()}) is spent, and this org is set to stop live pulls when it runs out. Raise the budget in Settings → Bureau scrutiny, or pull with force after approval.`,
            budgetExhausted: true,
          },
          { status: 402 },
        );
      }
      // "downgrade": buy the cheapest file that still says something.
      tierOverride = "screen";
      budgetNote = "Monthly bureau budget exhausted — this check ran at Screen depth rather than the configured tier.";
    }
  }

  let report: CrbReport;
  try {
    report = await runCrbCheck(orgId, {
      nationalId: borrower.nationalId, phone: borrower.phone,
      name: `${borrower.firstName ?? ""} ${borrower.otherName ?? ""}`.trim(),
    }, { loanAmount: body.loanAmount, reason, tier: tierOverride });
  } catch (err) {
    if (err instanceof MetropolError) {
      // A duplicate/transient live failure: fall back to the most recent stored
      // pull if we have one, so the officer still sees a file.
      const last = await prisma.kycCheck.findFirst({
        where: { orgId, borrowerId: borrower.id, kind: "CRB", ...MERGED_CRB_ONLY },
        orderBy: { createdAt: "desc" }, select: { payload: true, createdAt: true },
      });
      if (last?.payload) return NextResponse.json({ success: true, report: last.payload, reused: true, checkedAt: last.createdAt, note: err.message });
      return NextResponse.json({ success: false, message: err.message, apiCode: err.apiCode }, { status: err.retryable ? 429 : 502 });
    }
    return NextResponse.json({ success: false, message: "Could not complete the bureau check." }, { status: 502 });
  }

  await prisma.kycCheck.create({
    data: {
      orgId, borrowerId: borrower.id, kind: "CRB",
      passed: report.verdict !== "ADVERSE", score: report.score,
      provider: report.mode === "live" ? report.bureau : "simulation",
      payload: report as unknown as Prisma.InputJsonValue,
    },
  });
  // Meter at what this pull ACTUALLY cost, not at a flat catalogue rate.
  //
  // The CRB line has always been described as a pass-through — the bureau bills
  // us, we bill the lender. Under a single fixed report set a flat KES 35 was a
  // fair approximation of that. Under per-lender scrutiny it is not: a Screen
  // pull and a Forensic pull differ by a factor of five, and charging both at 35
  // means the lender who chose the cheap tier subsidises the one who did not.
  //
  // So a LIVE pull is metered at the price of the report set that actually ran
  // (report.cost, stamped at pull time). Anything without a cost line — a
  // simulation, or a bureau other than Metropol — keeps the catalogue rate, so
  // this change moves only the figure it was meant to move.
  void meter(
    orgId,
    "crb",
    1,
    {
      bureau: report.bureau,
      verdict: report.verdict,
      mode: report.mode,
      tier: report.cost?.tier ?? null,
      reports: report.cost?.reports ?? [],
      tariffSource: report.cost?.tariffSource ?? null,
      scrutiny: report.cost?.scrutiny ?? null,
      ...(budgetNote ? { budgetDowngraded: true } : {}),
    },
    report.cost?.cost,
  );

  return NextResponse.json({ success: true, report, ...(budgetNote ? { note: budgetNote } : {}) });
}
