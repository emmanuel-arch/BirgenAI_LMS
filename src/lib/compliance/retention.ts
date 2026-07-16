// ─────────────────────────────────────────────────────────────────────────────
// RETENTION — how long each class of data lives, and why.
//
// Blueprint §12: "retention windows per data class". This file is that list. It
// is CODE, not configuration, for the same reason the price book and the metric
// catalogue are: a retention window is a legal position, and a legal position
// changes deliberately, under review, in a diff someone signs off — not from a
// settings form at 2am.
//
// TWO LAWS PULL IN OPPOSITE DIRECTIONS, AND BOTH ARE RIGHT.
//
//   The Data Protection Act 2019 (Kenya) says: do not keep personal data longer
//   than you need it (s.25(e)), and delete it when the person asks (s.40).
//
//   POCAMLA s.46 says: keep records of every transaction and every customer due
//   diligence file for SEVEN YEARS after the relationship ends — and the DPA's
//   own s.40(2) yields to exactly this kind of legal obligation.
//
// So the policy is not one number. Every class below declares which side it sits
// on: an `expires` class is data we must eventually delete, and a `floor` class
// is data we are not allowed to delete yet. A borrower's selfie is the former. The
// loan we gave them is the latter. Conflating the two is how a lender ends up
// either fined by the ODPC or unable to answer the FRC — and the reason this table
// names a `basis` for every row is that one day someone will have to defend it.
//
// WHAT THE SWEEP DELETES vs REDACTS:
//   delete — the row is gone (a spent OTP is nobody's evidence).
//   redact — the row survives, its sensitive payload does not. A KycCheck at 400
//            days keeps "IPRS passed, score 0.97" (that IS the CDD evidence the
//            AML floor demands) and drops the registry's copy of the person.
//   purge-objects — the DB row survives, the BYTES in the private bucket do not.
//            A liveness selfie is a biometric; it has done its job the moment the
//            face matched, and keeping it for seven years is a breach waiting to
//            happen. The verification RESULT is the record, not the photograph.
// ─────────────────────────────────────────────────────────────────────────────
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { deleteObjects, KYC_BUCKET, DOCS_BUCKET } from "@/lib/storage/provider";

/** POCAMLA s.46 — seven years. The floor under every financial record we hold. */
export const AML_FLOOR_DAYS = 7 * 365;

const DAY_MS = 86_400_000;

export type RetentionDisposal = "delete" | "redact" | "purge-objects";

export type RetentionClass = {
  key: string;
  /** What this is, in the words a lender's compliance officer would use. */
  label: string;
  /** The one-line statement of what we hold. */
  what: string;
  /**
   * How long we keep it, in days — or `null` when the class is a FLOOR: data the
   * law forbids us to delete on a schedule. A floor class is never swept.
   */
  days: number | null;
  /** Which law or operational need sets the window. Shown on screen, verbatim. */
  basis: string;
  disposal: RetentionDisposal;
  /** Floor classes are the ones an erasure request must refuse to destroy. */
  floor: boolean;
};

/**
 * THE POLICY. Ordered as a compliance officer reads it: the personal data we
 * shed first, then the operational exhaust, then the records we may not touch.
 */
export const RETENTION_POLICY: RetentionClass[] = [
  {
    key: "kyc-biometrics",
    label: "Liveness selfies",
    what: "The selfie and liveness frames captured during identity verification.",
    days: 180,
    basis:
      "Biometric data under DPA s.2 — sensitive personal data. The face MATCH is the record we need; the photograph is not. Kept six months so a disputed verification can still be reviewed, then the bytes are destroyed.",
    disposal: "purge-objects",
    floor: false,
  },
  {
    key: "kyc-sessions",
    label: "Abandoned KYC sessions",
    what: "Verification attempts that never became a customer — someone who started and walked away.",
    days: 90,
    basis:
      "DPA s.25(e) — data minimisation. A stranger who abandoned the funnel is not a customer and we have no basis to hold their ID photographs. Completed sessions that DID become a borrower are excluded here; their CDD evidence sits under the AML floor.",
    disposal: "delete",
    floor: false,
  },
  {
    key: "otp",
    label: "One-time codes",
    what: "Spent and expired OTP challenges (only the bcrypt hash was ever stored).",
    days: 90,
    basis: "Security ephemera. Kept long enough to investigate a disputed approval or a suspected account takeover, no longer.",
    disposal: "delete",
    floor: false,
  },
  {
    key: "rate-limits",
    label: "Rate-limit counters",
    what: "Request counters keyed by phone, IP or email.",
    days: 7,
    basis: "Operational. Expired windows are dead weight.",
    disposal: "delete",
    floor: false,
  },
  {
    key: "kyc-check-payloads",
    label: "Registry lookup payloads",
    what: "The raw IPRS/CRB response body — the government's own copy of the person.",
    days: 400,
    basis:
      "DPA s.25(e). The CDD evidence we must retain is the OUTCOME (checked, passed, score, provider, when) and that is kept under the AML floor. The registry's full record of the person is a copy we no longer need, so it is redacted out of the row and the row remains.",
    disposal: "redact",
    floor: false,
  },
  {
    key: "geo-pins",
    label: "Location snapshots",
    what: "The consented business/home pins captured at onboarding and on field visits.",
    days: 400,
    basis:
      "Consent-based (DPA s.30) and one-time by design — we snapshot, we never track. Consent for a snapshot does not justify holding it indefinitely.",
    disposal: "delete",
    floor: false,
  },
  {
    key: "riri-queries",
    label: "Riri question log",
    what: "Every question staff asked the console AI and the SQL that answered it.",
    days: 400,
    basis:
      "Kept so a lender can audit what was asked of their book and a regulator can see on what basis a number was reported. Beyond a year it is telemetry, not evidence.",
    disposal: "delete",
    floor: false,
  },
  {
    key: "portfolio-runs",
    label: "Nightly risk scans",
    what: "The batch portfolio-scoring snapshots behind the early-warning trend.",
    days: 400,
    basis: "A year-plus of nightly points makes a trend; beyond that a run is archaeology.",
    disposal: "delete",
    floor: false,
  },
  {
    key: "sms",
    label: "Sent messages",
    what: "SMS and email delivery records.",
    days: 400,
    basis:
      "Delivery evidence — a borrower who says 'you never told me' is answered by this. A year of it is enough; the money record that the message was about lives under the AML floor.",
    disposal: "delete",
    floor: false,
  },
  {
    key: "statement-files",
    label: "Uploaded statements",
    what: "The source PDF of a bank or M-Pesa statement a customer gave us.",
    days: 400,
    basis:
      "The FEATURES we scored (income, volatility, gambling ratio) are the lending record and they survive on the score snapshot. The customer's raw transaction history is theirs, not ours, and there is no reason to hold the file once it has been read.",
    disposal: "purge-objects",
    floor: false,
  },

  // ── The floor. Nothing below this line is ever swept. ──────────────────────
  {
    key: "cdd",
    label: "Customer due diligence file",
    what: "Identity, ID number, verification outcome, consent record, ID document images.",
    days: null,
    basis:
      "POCAMLA s.46 — retained SEVEN YEARS after the business relationship ends. This is the file the FRC asks for. It is also why a borrower who has taken a loan cannot be hard-deleted on request: the DPA's right to erasure (s.40) yields to a legal obligation, so we anonymise instead.",
    disposal: "delete",
    floor: true,
  },
  {
    key: "money",
    label: "Loans, repayments and disbursements",
    what: "Every loan, installment, receipt, disbursement, float movement and invoice.",
    days: null,
    basis: "POCAMLA s.46 — seven years from the transaction. Financial records are never deleted on a schedule, and never by a subject request.",
    disposal: "delete",
    floor: true,
  },
  {
    key: "audit",
    label: "Audit trail",
    what: "Who did what, when, from where — every money movement and every approval.",
    days: null,
    basis:
      "The record of last resort. An audit trail with a retention window is an audit trail with a hole in it; it is kept for the life of the tenant, including the rows that record an erasure.",
    disposal: "delete",
    floor: true,
  },
];

export const POLICY_BY_KEY: ReadonlyMap<string, RetentionClass> = new Map(RETENTION_POLICY.map((c) => [c.key, c]));

/** The classes the nightly sweep acts on. A floor class is not one of them. */
export function sweepableClasses(): RetentionClass[] {
  return RETENTION_POLICY.filter((c) => !c.floor && c.days !== null);
}

export function cutoffFor(c: RetentionClass, now = new Date()): Date {
  if (c.days === null) throw new Error(`"${c.key}" is a retention floor and has no cutoff.`);
  return new Date(now.getTime() - c.days * DAY_MS);
}

export type SweepResult = { key: string; disposal: RetentionDisposal; affected: number; error?: string };

/**
 * The nightly sweep. Platform-scoped — retention is a promise we make to every
 * borrower of every lender, so it runs across the whole database rather than
 * once per tenant. Each class is independent: one failing (a storage outage on
 * an object purge) must not stop the others.
 *
 * Everything here is idempotent — it deletes what is already past its window, so
 * a second run the same night finds nothing left to do.
 */
export async function sweepRetention(now = new Date()): Promise<SweepResult[]> {
  const out: SweepResult[] = [];
  for (const c of sweepableClasses()) {
    try {
      out.push({ key: c.key, disposal: c.disposal, affected: await sweepClass(c, now) });
    } catch (err) {
      out.push({ key: c.key, disposal: c.disposal, affected: 0, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}

/** How much each class WOULD sweep right now — the console's "due" column. Reads only. */
export async function retentionDue(now = new Date()): Promise<Record<string, number>> {
  const due: Record<string, number> = {};
  for (const c of sweepableClasses()) {
    try {
      due[c.key] = await countClass(c, now);
    } catch {
      due[c.key] = 0;
    }
  }
  return due;
}

// ── Per-class mechanics ───────────────────────────────────────────────────────
//
// Kept as one switch rather than a method on each policy row: the policy is a
// document a compliance officer reads, and it should stay readable prose. The
// machinery that enforces it belongs below, out of the way.

async function countClass(c: RetentionClass, now: Date): Promise<number> {
  const before = cutoffFor(c, now);
  switch (c.key) {
    case "kyc-biometrics":
      return prisma.kycSession.count({ where: { createdAt: { lt: before }, selfieKey: { not: null } } });
    case "kyc-sessions":
      return prisma.kycSession.count({ where: { createdAt: { lt: before }, borrowerId: null } });
    case "otp":
      return prisma.otpChallenge.count({ where: { createdAt: { lt: before } } });
    case "rate-limits":
      return prisma.rateLimit.count({ where: { expiresAt: { lt: before } } });
    case "kyc-check-payloads":
      return prisma.kycCheck.count({ where: { createdAt: { lt: before }, kind: { in: ["IPRS", "CRB"] }, payload: { not: Prisma.DbNull } } });
    case "geo-pins":
      return prisma.geoPin.count({ where: { createdAt: { lt: before } } });
    case "riri-queries":
      return prisma.ririQueryLog.count({ where: { createdAt: { lt: before } } });
    case "portfolio-runs":
      return prisma.portfolioRun.count({ where: { ranAt: { lt: before } } });
    case "sms":
      return (
        (await prisma.smsMessage.count({ where: { createdAt: { lt: before } } })) +
        (await prisma.emailMessage.count({ where: { createdAt: { lt: before } } }))
      );
    case "statement-files":
      return prisma.document.count({ where: { createdAt: { lt: before }, kind: "BANK_STATEMENT", storageKey: { not: "" } } });
    default:
      return 0;
  }
}

async function sweepClass(c: RetentionClass, now: Date): Promise<number> {
  const before = cutoffFor(c, now);

  switch (c.key) {
    // The bytes go, the verification result stays. We null the keys in the same
    // breath so a screen never offers a signed URL for an object we just deleted.
    case "kyc-biometrics": {
      const sessions = await prisma.kycSession.findMany({
        where: { createdAt: { lt: before }, selfieKey: { not: null } },
        select: { id: true, selfieKey: true },
        take: 500,
      });
      if (sessions.length === 0) return 0;
      await deleteObjects(sessions.map((s) => s.selfieKey!).filter(Boolean), KYC_BUCKET);
      await prisma.kycSession.updateMany({ where: { id: { in: sessions.map((s) => s.id) } }, data: { selfieKey: null } });
      // The borrower's own selfie copy goes with it; the white-background portrait
      // (their profile face, not a biometric capture) stays.
      const borrowers = await prisma.borrower.findMany({
        where: { selfieKey: { not: null }, kycVerifiedAt: { lt: before } },
        select: { id: true, selfieKey: true },
        take: 500,
      });
      if (borrowers.length) {
        await deleteObjects(borrowers.map((b) => b.selfieKey!).filter(Boolean), KYC_BUCKET);
        await prisma.borrower.updateMany({ where: { id: { in: borrowers.map((b) => b.id) } }, data: { selfieKey: null } });
      }
      return sessions.length + borrowers.length;
    }

    // Never became a customer. Take the images with the row, or the bytes outlive
    // the only pointer we had to them.
    case "kyc-sessions": {
      const rows = await prisma.kycSession.findMany({
        where: { createdAt: { lt: before }, borrowerId: null },
        select: { id: true, idFrontKey: true, idBackKey: true, selfieKey: true, portraitKey: true },
        take: 500,
      });
      if (rows.length === 0) return 0;
      const keys = rows.flatMap((r) => [r.idFrontKey, r.idBackKey, r.selfieKey, r.portraitKey].filter((k): k is string => !!k));
      await deleteObjects(keys, KYC_BUCKET);
      await prisma.kycCheck.deleteMany({ where: { sessionId: { in: rows.map((r) => r.id) } } });
      const res = await prisma.kycSession.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
      return res.count;
    }

    case "otp":
      return (await prisma.otpChallenge.deleteMany({ where: { createdAt: { lt: before } } })).count;

    case "rate-limits":
      return (await prisma.rateLimit.deleteMany({ where: { expiresAt: { lt: before } } })).count;

    // Redact, not delete: passed/score/provider/when is the CDD evidence and must
    // survive; the registry's copy of the human being is what we drop.
    case "kyc-check-payloads":
      return (
        await prisma.kycCheck.updateMany({
          where: { createdAt: { lt: before }, kind: { in: ["IPRS", "CRB"] }, payload: { not: Prisma.DbNull } },
          data: { payload: Prisma.DbNull },
        })
      ).count;

    case "geo-pins":
      return (await prisma.geoPin.deleteMany({ where: { createdAt: { lt: before } } })).count;

    case "riri-queries":
      return (await prisma.ririQueryLog.deleteMany({ where: { createdAt: { lt: before } } })).count;

    case "portfolio-runs":
      return (await prisma.portfolioRun.deleteMany({ where: { ranAt: { lt: before } } })).count;

    case "sms": {
      const a = await prisma.smsMessage.deleteMany({ where: { createdAt: { lt: before } } });
      const b = await prisma.emailMessage.deleteMany({ where: { createdAt: { lt: before } } });
      return a.count + b.count;
    }

    // The parsed fields are the lending record and they stay on the row. The
    // customer's raw transaction history goes.
    case "statement-files": {
      const docs = await prisma.document.findMany({
        where: { createdAt: { lt: before }, kind: "BANK_STATEMENT", storageKey: { not: "" } },
        select: { id: true, storageKey: true },
        take: 500,
      });
      if (docs.length === 0) return 0;
      await deleteObjects(docs.map((d) => d.storageKey), DOCS_BUCKET);
      await prisma.document.updateMany({
        where: { id: { in: docs.map((d) => d.id) } },
        data: { storageKey: "", note: "Source file destroyed under the retention policy; the parsed figures remain." },
      });
      return docs.length;
    }

    default:
      return 0;
  }
}
