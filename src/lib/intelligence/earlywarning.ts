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
// explained and defended. The weights are the tuning surface.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";

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
const bandOf = (score: number): RiskBand => (score >= 65 ? "HIGH" : score >= 38 ? "ELEVATED" : "WATCH");

export async function portfolioEarlyWarning(orgId: string): Promise<EarlyWarning> {
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
    if (dpd > 60) { risk += 55; reasons.push(`${dpd} days past due`); }
    else if (dpd >= 31) { risk += 42; reasons.push(`${dpd} days past due`); }
    else if (dpd >= 8) { risk += 28; reasons.push(`${dpd} days past due`); }
    else if (dpd >= 1) { risk += 14; reasons.push(`${dpd} day${dpd === 1 ? "" : "s"} past due`); }
    if (overdueCount >= 3) { risk += 12; reasons.push(`${overdueCount} missed installments`); }
    else if (overdueCount === 2) { risk += 7; reasons.push(`2 missed installments`); }
    if (dueSoFar.length >= 2 && paidRatio < 0.5) { risk += 12; reasons.push(`only ${Math.round(paidRatio * 100)}% of dues paid`); }
    else if (dueSoFar.length >= 2 && paidRatio < 0.75) { risk += 6; reasons.push(`weak repayment trajectory`); }
    // Origination signal (closed ML loop).
    if (pd != null && pd >= 0.25) { risk += 12; reasons.push(`high model PD ${pd.toFixed(2)}`); }
    else if (pd != null && pd >= 0.15) { risk += 6; reasons.push(`elevated model PD ${pd.toFixed(2)}`); }
    if (score != null && score < 500) { risk += 12; reasons.push(`credit score ${score}`); }
    else if (score != null && score < 600) { risk += 6; reasons.push(`credit score ${score}`); }
    // Structural risk.
    if (priorLoans === 0) { risk += 8; reasons.push(`first-cycle borrower`); }
    if (l.borrower.kycStatus !== "VERIFIED") { risk += 8; reasons.push(`KYC not verified`); }
    if (avgBalance > 0 && balance > avgBalance * 1.5) { risk += 6; reasons.push(`large exposure`); }

    const riskScore = Math.min(100, Math.round(risk));
    // Only surface borrowers that actually warrant attention.
    if (riskScore < 20 && dpd === 0) continue;

    const band = bandOf(riskScore);
    // Estimated PD for expected-loss: blend model PD with the behavioural score.
    const pdEstimate = Math.max(pd ?? 0, (riskScore / 100) * 0.6);
    const expectedLoss = balance * pdEstimate;

    let action: RiskAction;
    if (dpd >= 31 && hasGeo) action = { kind: "FIELD_VISIT", label: "Dispatch field agent" };
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
