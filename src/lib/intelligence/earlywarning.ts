// ─────────────────────────────────────────────────────────────────────────────
// Portfolio Early Warning — "be serious about recovering the money".
//
// A transparent, explainable risk engine that watches the LIVE book and flags
// borrowers before they roll into default. It fuses in-life repayment behaviour
// (days past due, missed installments, payment trajectory) with the closed ML
// loop's origination signal (model PD, credit score) and structural risk (thin
// file, unverified KYC, outsized exposure) into a 0–100 risk score, a band, plain
// reason codes, and a recommended RECOVERY ACTION that maps to a real button
// (request payment via STK, or dispatch the nearest field agent).
//
// Deterministic and rules-based on purpose: every number an officer sees can be
// explained and defended. The weights ARE the tuning surface, and they now live in
// lib/intelligence/tuning.ts as a per-org policy rather than as constants here.
// DEFAULT_CONFIG holds the numbers this file used to hard-code, so an org that has
// never opened the tuning page is scored exactly as it was before — `verify-tuning`
// asserts that, because a silent change to a risk score is a silent change to who
// gets a debt collector at their door.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";
import { tuningFor, type TuningConfig } from "./tuning";

export type RiskBand = "WATCH" | "ELEVATED" | "HIGH";
export type RiskActionKind = "FIELD_VISIT" | "REQUEST_PAYMENT" | "MONITOR";
export type RiskAction = { kind: RiskActionKind; label: string };

export type RiskRow = {
  loanId: string;
  borrowerId: string;
  name: string;
  phone: string;
  product: string;
  balance: number;
  dpd: number; // days past due (oldest overdue installment)
  overdueCount: number;
  riskScore: number; // 0..100 (higher = worse)
  band: RiskBand;
  reasons: string[];
  action: RiskAction;
  hasGeo: boolean;
  lat: number | null;
  lng: number | null;
  expectedLoss: number; // balance × estimated PD
};

export type EarlyWarning = {
  generatedAt: string;
  tiles: { olb: number; atRiskValue: number; watchlist: number; high: number; projectedLoss: number };
  rows: RiskRow[];
};

const num = (d: unknown) => Number(d ?? 0);

/**
 * Score the org's live book.
 *
 * `override` runs the engine against a policy that has NOT been saved — that is how
 * the tuning page shows a Credit Manager what a change would do to their real
 * borrowers before they commit to it. Nothing is written either way; this function
 * only reads.
 */
export async function portfolioEarlyWarning(orgId: string, override?: TuningConfig): Promise<EarlyWarning> {
  const { weights: w, thresholds: t } = override ?? (await tuningFor(orgId));
  const bandOf = (score: number): RiskBand =>
    score >= t.highBand ? "HIGH" : score >= t.elevatedBand ? "ELEVATED" : "WATCH";

  const loans = await prisma.loan.findMany({
    where: { orgId, status: "ACTIVE" },
    include: {
      borrower: { select: { id: true, firstName: true, otherName: true, phone: true, creditScore: true, graduationCount: true, kycStatus: true, lat: true, lng: true } },
      product: { select: { name: true } },
      installments: { select: { seq: true, dueDate: true, status: true, amountDue: true, amountPaid: true, penalty: true } },
      application: { select: { pd: true, priorLoanCount: true } },
    },
  });

  const now = Date.now();
  const olb = loans.reduce((s, l) => s + num(l.balance), 0);
  const avgBalance = loans.length ? olb / loans.length : 0;

  const rows: RiskRow[] = [];
  for (const l of loans) {
    const balance = num(l.balance);
    const insts = l.installments;
    const overdue = insts.filter(
      (i) => i.status === "OVERDUE" || (i.dueDate.getTime() < now && i.status !== "PAID" && num(i.amountPaid) < num(i.amountDue)),
    );
    const dueSoFar = insts.filter((i) => i.dueDate.getTime() <= now);
    const paidSoFar = dueSoFar.filter((i) => i.status === "PAID").length;
    const paidRatio = dueSoFar.length > 0 ? paidSoFar / dueSoFar.length : 1;
    const oldestDue = overdue.length ? Math.min(...overdue.map((i) => i.dueDate.getTime())) : 0;
    const dpd = oldestDue ? Math.floor((now - oldestDue) / 86400000) : 0;
    const overdueCount = overdue.length;

    const pd = l.application?.pd != null ? Number(l.application.pd) : null;
    const score = l.borrower.creditScore;
    const priorLoans = l.application?.priorLoanCount ?? l.borrower.graduationCount ?? 0;
    const hasGeo = l.borrower.lat != null && l.borrower.lng != null;

    let risk = 0;
    const reasons: string[] = [];
    // In-life arrears — the dominant signal.
    if (dpd > 60) { risk += w.dpdOver60; reasons.push(`${dpd} days past due`); }
    else if (dpd >= 31) { risk += w.dpd31to60; reasons.push(`${dpd} days past due`); }
    else if (dpd >= 8) { risk += w.dpd8to30; reasons.push(`${dpd} days past due`); }
    else if (dpd >= 1) { risk += w.dpd1to7; reasons.push(`${dpd} day${dpd === 1 ? "" : "s"} past due`); }
    if (overdueCount >= 3) { risk += w.missed3Plus; reasons.push(`${overdueCount} missed installments`); }
    else if (overdueCount === 2) { risk += w.missed2; reasons.push(`2 missed installments`); }
    if (dueSoFar.length >= 2 && paidRatio < 0.5) { risk += w.paidRatioUnder50; reasons.push(`only ${Math.round(paidRatio * 100)}% of dues paid`); }
    else if (dueSoFar.length >= 2 && paidRatio < 0.75) { risk += w.paidRatioUnder75; reasons.push(`weak repayment trajectory`); }
    // Origination signal (closed ML loop).
    if (pd != null && pd >= t.pdHighAt) { risk += w.modelPdHigh; reasons.push(`high model PD ${pd.toFixed(2)}`); }
    else if (pd != null && pd >= t.pdElevatedAt) { risk += w.modelPdElevated; reasons.push(`elevated model PD ${pd.toFixed(2)}`); }
    if (score != null && score < 500) { risk += w.creditScoreUnder500; reasons.push(`credit score ${score}`); }
    else if (score != null && score < 600) { risk += w.creditScoreUnder600; reasons.push(`credit score ${score}`); }
    // Structural risk.
    if (priorLoans === 0) { risk += w.firstCycle; reasons.push(`first-cycle borrower`); }
    if (l.borrower.kycStatus !== "VERIFIED") { risk += w.kycUnverified; reasons.push(`KYC not verified`); }
    if (avgBalance > 0 && balance > avgBalance * t.largeExposureMultiple) { risk += w.largeExposure; reasons.push(`large exposure`); }

    const riskScore = Math.min(100, Math.round(risk));
    // Only surface borrowers that actually warrant attention.
    if (riskScore < t.surfaceAt && dpd === 0) continue;

    const band = bandOf(riskScore);
    // Estimated PD for expected-loss: blend model PD with the behavioural score.
    const pdEstimate = Math.max(pd ?? 0, (riskScore / 100) * 0.6);
    const expectedLoss = balance * pdEstimate;

    let action: RiskAction;
    if (dpd >= t.fieldVisitAtDpd && hasGeo) action = { kind: "FIELD_VISIT", label: "Dispatch field agent" };
    else if (dpd >= 1) action = { kind: "REQUEST_PAYMENT", label: "Request payment" };
    else action = { kind: "MONITOR", label: "Proactive check-in" };

    rows.push({
      loanId: l.id, borrowerId: l.borrower.id,
      name: `${l.borrower.firstName ?? "Borrower"}${l.borrower.otherName ? " " + l.borrower.otherName : ""}`.trim(),
      phone: l.borrower.phone, product: l.product.name,
      balance, dpd, overdueCount, riskScore, band, reasons, action,
      hasGeo, lat: l.borrower.lat, lng: l.borrower.lng, expectedLoss,
    });
  }

  rows.sort((a, b) => b.riskScore - a.riskScore || b.dpd - a.dpd || b.balance - a.balance);

  const atRiskValue = rows.filter((r) => r.band !== "WATCH").reduce((s, r) => s + r.balance, 0);
  const projectedLoss = rows.reduce((s, r) => s + r.expectedLoss, 0);

  return {
    generatedAt: new Date().toISOString(),
    tiles: { olb, atRiskValue, watchlist: rows.length, high: rows.filter((r) => r.band === "HIGH").length, projectedLoss },
    rows,
  };
}
