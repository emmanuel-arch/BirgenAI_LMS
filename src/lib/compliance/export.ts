// ─────────────────────────────────────────────────────────────────────────────
// EXPORT — the right of access (DPA s.26(a)) and the lender's right to leave.
//
// Two subjects, one principle: the data belongs to the person or the business it
// is about, and they may have a copy in a form a machine can read.
//
//   SUBJECT ACCESS (one borrower). "Send me everything you hold about me." The
//     bundle is complete and it is in their words, not our column names — a data
//     subject is entitled to understand what came back, and a dump of `kycStatus:
//     VERIFIED` explains nothing to a customer in Kawangware.
//
//   ORG EXPORT (the whole book). A lender who wants to leave must be able to. A
//     platform that makes its own data hard to get out is not selling software,
//     it is taking hostages — and a lender evaluating us will ask this question
//     before they sign, not after.
//
// NOTHING IS EVER STORED. The bytes stream to the browser and the register keeps
// only the fact that an export happened, who took it, and how many rows. Writing
// an export to a bucket would mean a fresh, unguarded copy of every customer a
// lender has, sitting somewhere, waiting to leak. The download IS the artifact.
//
// WHAT AN EXPORT MUST NEVER CONTAIN: vault credentials (the org's Daraja keys and
// SMS secrets are OUR encrypted custody, not the lender's plaintext to carry
// around), staff password hashes, or OTP hashes. `ORG_TABLES` is an allowlist for
// exactly this reason — a new sensitive column cannot leak in by being added to a
// model that a `select: *` happened to walk.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";
import { maskPhone } from "./erasure";

/** Decimals and Dates do not survive JSON.stringify usefully. Make them readable. */
function plain(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && value !== null && "toFixed" in value && typeof (value as { toFixed: unknown }).toFixed === "function") {
    return Number(value.toString()); // Prisma.Decimal
  }
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, plain(v)]));
  }
  return value;
}

// ── Subject access: one borrower ─────────────────────────────────────────────

/**
 * Everything held about one person, in plain language.
 *
 * Deliberately assembled field by field rather than `include`-ing the whole
 * object graph: an export is a DISCLOSURE, and every field in it should be there
 * because someone decided it should be. A relation walked automatically is a
 * field nobody chose.
 */
export async function exportBorrower(orgId: string, borrowerId: string) {
  const borrower = await prisma.borrower.findFirst({ where: { id: borrowerId, orgId } });
  if (!borrower) return null;

  const [org, consents, kycChecks, applications, loans, offers, documents, scores, geoPins] = await Promise.all([
    prisma.org.findUnique({ where: { id: orgId }, select: { name: true, slug: true } }),
    prisma.consent.findMany({ where: { orgId, borrowerId }, orderBy: { createdAt: "asc" } }),
    prisma.kycCheck.findMany({ where: { orgId, borrowerId }, orderBy: { createdAt: "asc" } }),
    prisma.loanApplication.findMany({ where: { orgId, borrowerId }, orderBy: { createdAt: "asc" } }),
    prisma.loan.findMany({ where: { orgId, borrowerId }, orderBy: { createdAt: "asc" }, include: { installments: { orderBy: { seq: "asc" } } } }),
    prisma.loanOffer.findMany({ where: { orgId, borrowerId }, orderBy: { createdAt: "asc" } }),
    prisma.document.findMany({ where: { orgId, borrowerId }, orderBy: { createdAt: "asc" } }),
    prisma.scoreSnapshot.findMany({ where: { orgId, borrowerId }, orderBy: { createdAt: "asc" } }),
    prisma.geoPin.findMany({ where: { orgId, borrowerId }, orderBy: { createdAt: "asc" } }),
  ]);

  const loanIds = loans.map((l) => l.id);
  const receipts = loanIds.length
    ? await prisma.c2BReceipt.findMany({ where: { orgId, allocatedLoanId: { in: loanIds } }, orderBy: { createdAt: "asc" } })
    : [];

  return {
    _about: {
      what: "Everything this lender holds about you, as at the date below.",
      lender: org?.name ?? "",
      generatedAt: new Date().toISOString(),
      yourRights:
        "Under the Data Protection Act 2019 you may ask for this copy, ask us to correct anything wrong in it, and ask us to delete it. Where you have taken a loan, anti-money-laundering law requires the financial record to be kept for seven years after it closes — in that case we remove everything that identifies you and keep the loan as an anonymous account.",
    },
    /** Counts, so the register can record the SIZE of a disclosure without a copy of it. */
    _counts: {
      loans: loans.length,
      applications: applications.length,
      repayments: receipts.length,
      documents: documents.length,
      consents: consents.length,
    },
    whoYouAre: plain({
      name: [borrower.firstName, borrower.otherName].filter(Boolean).join(" ") || null,
      phone: borrower.phone,
      nationalId: borrower.nationalId,
      email: borrower.email,
      dateOfBirth: borrower.dob,
      gender: borrower.gender,
      language: borrower.language,
      nextOfKin: borrower.nextOfKin,
      registeredOn: borrower.createdAt,
    }),
    identityChecks: plain({
      status: borrower.kycStatus,
      verifiedOn: borrower.kycVerifiedAt,
      faceMatchScore: borrower.faceMatchScore,
      livenessPassed: borrower.livenessPassed,
      governmentRegistryMatched: borrower.iprsVerified,
      checksRun: kycChecks.map((c) => ({ check: c.kind, passed: c.passed, score: c.score, provider: c.provider, on: c.createdAt })),
    }),
    whereYouAre: plain({
      note: "Captured once, with your consent, when you registered or applied. We do not track your location.",
      consentGivenOn: borrower.geoConsentAt,
      pins: [
        borrower.lat != null ? { type: borrower.locationType ?? "business", lat: borrower.lat, lng: borrower.lng, address: borrower.locationAddress } : null,
        borrower.homeLat != null ? { type: "home", lat: borrower.homeLat, lng: borrower.homeLng, address: borrower.homeAddress } : null,
        ...geoPins.map((p) => ({ type: p.locationType ?? p.label, lat: p.lat, lng: p.lng, address: p.address })),
      ].filter(Boolean),
    }),
    whatYouAgreedTo: plain(consents.map((c) => ({ version: c.version, grants: c.grants, on: c.createdAt }))),
    creditAssessment: plain({
      note: "How we scored you, and why. Every automated decision here was open to human review.",
      currentScore: borrower.creditScore,
      riskBand: borrower.riskBand,
      loanLimit: borrower.loanLimit,
      history: scores.map((s) => ({ model: s.modelKind, version: s.modelVersion, score: s.score, band: s.riskBand, reasons: s.reasons, on: s.createdAt })),
    }),
    applications: plain(applications.map((a) => ({ id: a.id, amountRequested: a.amountRequested, status: a.status, decision: a.decision, on: a.createdAt }))),
    offers: plain(offers.map((o) => ({ principal: o.principal, totalRepayable: o.totalRepayable, status: o.status, channel: o.channel, on: o.createdAt }))),
    loans: plain(
      loans.map((l) => ({
        id: l.id,
        principal: l.principal,
        interest: l.interest,
        total: l.loanAmount,
        balance: l.balance,
        status: l.status,
        takenOn: l.borrowDate,
        disbursedOn: l.disbursedAt,
        clearedOn: l.clearedAt,
        schedule: l.installments.map((i) => ({ number: i.seq, due: i.dueDate, amountDue: i.amountDue, amountPaid: i.amountPaid, status: i.status })),
      })),
    ),
    repayments: plain(receipts.map((r) => ({ mpesaRef: r.transId, amount: r.amount, on: r.createdAt }))),
    documentsYouGaveUs: plain(documents.map((d) => ({ kind: d.kind, filename: d.filename, uploadedOn: d.createdAt }))),
  };
}

// ── Org export: the lender's whole book ──────────────────────────────────────

/**
 * The tables a lender may take with them, and the columns of each.
 *
 * AN ALLOWLIST, NOT A DENYLIST. Nothing is exported that is not named here, so a
 * sensitive column added to a model six months from now cannot silently join the
 * download. OrgIntegration (the credential vault), StaffUser.passwordHash and
 * OtpChallenge.codeHash are absent by construction, not by filtering.
 */
export const ORG_TABLES = ["borrowers", "applications", "loans", "installments", "repayments", "disbursements", "products", "staff", "branches"] as const;
export type OrgTable = (typeof ORG_TABLES)[number];

export async function exportOrgTable(orgId: string, table: OrgTable): Promise<Record<string, unknown>[]> {
  switch (table) {
    case "borrowers": {
      const rows = await prisma.borrower.findMany({ where: { orgId }, orderBy: { createdAt: "asc" } });
      return rows.map((b) => ({
        id: b.id,
        name: [b.firstName, b.otherName].filter(Boolean).join(" "),
        phone: b.phone,
        nationalId: b.nationalId,
        email: b.email,
        kycStatus: b.kycStatus,
        creditScore: b.creditScore,
        riskBand: b.riskBand,
        loanLimit: plain(b.loanLimit),
        branchId: b.branchId,
        officerId: b.createdById,
        erased: !!b.erasedAt,
        registeredOn: plain(b.createdAt),
      }));
    }
    case "applications": {
      const rows = await prisma.loanApplication.findMany({ where: { orgId }, orderBy: { createdAt: "asc" } });
      return rows.map((a) => ({
        id: a.id, borrowerId: a.borrowerId, productId: a.productId, amountRequested: plain(a.amountRequested),
        status: a.status, decision: a.decision, score: a.score, approvedLimit: plain(a.approvedLimit),
        officerId: a.officerId, branchId: a.branchId, createdOn: plain(a.createdAt),
      }));
    }
    case "loans": {
      const rows = await prisma.loan.findMany({ where: { orgId }, orderBy: { createdAt: "asc" } });
      return rows.map((l) => ({
        id: l.id, borrowerId: l.borrowerId, productId: l.productId,
        principal: plain(l.principal), interest: plain(l.interest), total: plain(l.loanAmount), balance: plain(l.balance),
        status: l.status, borrowedOn: plain(l.borrowDate), disbursedOn: plain(l.disbursedAt), clearedOn: plain(l.clearedAt),
        branchId: l.branchId, officerId: l.createdBy,
      }));
    }
    case "installments": {
      const rows = await prisma.installment.findMany({ where: { orgId }, orderBy: [{ loanId: "asc" }, { seq: "asc" }] });
      return rows.map((i) => ({
        loanId: i.loanId, number: i.seq, dueDate: plain(i.dueDate),
        amountDue: plain(i.amountDue), principalDue: plain(i.principalDue), interestDue: plain(i.interestDue),
        amountPaid: plain(i.amountPaid), penalty: plain(i.penalty), status: i.status, paidOn: plain(i.paidAt),
      }));
    }
    case "repayments": {
      const rows = await prisma.c2BReceipt.findMany({ where: { orgId }, orderBy: { createdAt: "asc" } });
      return rows.map((r) => ({
        mpesaRef: r.transId, amount: plain(r.amount), phone: r.phone, accountRef: r.billRef,
        loanId: r.allocatedLoanId, allocatedOn: plain(r.allocatedAt), receivedOn: plain(r.createdAt),
      }));
    }
    case "disbursements": {
      const rows = await prisma.disbursement.findMany({ where: { orgId }, orderBy: { createdAt: "asc" } });
      return rows.map((d) => ({
        loanId: d.loanId, amount: plain(d.amount), state: d.state, phone: d.phone,
        reference: d.b2cRef ?? d.receiptRef, makerId: d.makerId, checkerId: d.checkerId,
        on: plain(d.createdAt),
      }));
    }
    case "products": {
      const rows = await prisma.product.findMany({ where: { orgId }, orderBy: { createdAt: "asc" } });
      return rows.map((p) => ({
        id: p.id, name: p.name, minPrincipal: plain(p.minPrincipal), maxPrincipal: plain(p.maxPrincipal),
        interestRate: plain(p.interestRate), interestMethod: p.interestMethod,
        repaymentPeriod: p.repaymentPeriod, repaymentPeriodUnit: p.repaymentPeriodUnit,
        active: p.isActive,
      }));
    }
    case "staff": {
      // Names, emails and roles — never passwordHash, never otpSecret.
      const rows = await prisma.staffUser.findMany({ where: { orgId }, orderBy: { createdAt: "asc" } });
      return rows.map((s) => ({
        id: s.id, name: [s.firstName, s.otherName].filter(Boolean).join(" "), email: s.email, phone: s.phone,
        title: s.title, status: s.status, roleId: s.roleId, branchId: s.branchId,
        joinedOn: plain(s.createdAt),
      }));
    }
    case "branches": {
      const rows = await prisma.branch.findMany({ where: { orgId }, orderBy: { createdAt: "asc" } });
      return rows.map((b) => ({
        id: b.id, name: b.name, level: b.levelName, parentId: b.parentId, code: b.code,
        disbursementLimit: plain(b.disbursementLimit), active: b.active,
      }));
    }
  }
}

/** The whole book, every table. Used by the JSON download. */
export async function exportOrg(orgId: string) {
  const org = await prisma.org.findUnique({
    where: { id: orgId },
    select: { name: true, slug: true, country: true, currency: true, createdAt: true },
  });
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const t of ORG_TABLES) tables[t] = await exportOrgTable(orgId, t);

  return {
    _about: {
      what: "A complete, machine-readable copy of this lender's book.",
      lender: org?.name ?? "",
      generatedAt: new Date().toISOString(),
      excluded:
        "Integration credentials (M-Pesa, SMS, CRB keys) and staff password hashes are deliberately absent — they are secrets held in encrypted custody, not data to be carried around in a download.",
      counts: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])),
    },
    org: plain(org),
    ...tables,
  };
}

// ── CSV ──────────────────────────────────────────────────────────────────────

/**
 * RFC 4180. Hand-rolled rather than pulling in a dependency for thirty lines —
 * and the leading-character guard below is not paranoia: a cell beginning `=`,
 * `+`, `-` or `@` is executed as a FORMULA when the file is opened in Excel, so a
 * borrower who names themselves `=cmd|...` would be running code on the machine
 * of whoever opens the export. Prefix it with a quote and it is text again.
 */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];

  const cell = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /["\n,\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  return [columns.join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join("\r\n");
}

/** The register's coarse handle for a subject, so it survives their erasure. */
export async function subjectLabel(orgId: string, borrowerId: string): Promise<string> {
  const b = await prisma.borrower.findFirst({ where: { id: borrowerId, orgId }, select: { phone: true } });
  return maskPhone(b?.phone);
}
