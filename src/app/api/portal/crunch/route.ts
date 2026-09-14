// ─────────────────────────────────────────────────────────────────────────────
// POST /api/portal/crunch — the customer's own Statement Cruncher.
// multipart/form-data: lenderSlug, file (PDF), password?
//
// The same engine the console's /crunch page and the enterprise cruncher run —
// decrypt, parse, classify, audit, score — with three differences that are the
// whole reason this route exists rather than the portal calling the other one:
//
//   1. THE IDENTITY GUARD HAS NO OVERRIDE. At the counter an officer may accept a
//      near-miss holder name, under their own name. A customer cannot vouch for
//      themselves, so a mismatch stops here and the app offers a support case —
//      a person decides, not the uploader.
//
//   2. THE LIMIT IS ALLOCATED ON THE SERVER, FROM THE LENDER'S OWN POLICY.
//      The console page echoes the qualification the client received back to the
//      server to be saved. Here nothing the handset holds is trusted: the
//      starting limit comes from decide() over the lender's published credit
//      policy (Settings → Credit policy — ceilings, stops, haircuts, capacity)
//      and their live catalogue, capped by the maximum limit in Borrower
//      settings. The customer sees the arithmetic; they never supply it.
//
//   3. IT IS THE TRAINING ROW. Every crunch freezes the raw cashflow vector, the
//      exact model vector the scorer consumed, and the decision it produced onto
//      a ScoreSnapshot — the X of a supervised example whose y the outcome
//      backfill writes months later. The console counter and the customer app
//      now feed the SAME store, which is how the closed loop reaches its 300
//      labelled outcomes from both doors at once.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { resolveOrg } from "@/lib/tenancy";
import { enterOrg } from "@/lib/db/context";
import { borrowerFor, otpRequired } from "@/lib/portal/session";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { requireFeature } from "@/lib/billing/entitlements";
import { meter } from "@/lib/billing/meter";
import { extractPdfText, PdfPasswordRequiredError, PdfPasswordIncorrectError } from "@/lib/statement/extract-pdf";
import { parseMpesaStatement, extractStatementName, namesMatch } from "@/lib/statement/mpesa-parser";
import { crunch } from "@/lib/statement/features";
import { analyzeStatement } from "@/lib/statement/analyze";
import { scoreThinFileAuto } from "@/lib/statement/score-thinfile";
import { toFeatureMap } from "@/lib/statement/model-features";
import { decide } from "@/lib/decision/engine";
import { candidatesFor, collapseByProduct } from "@/lib/decision/candidates";
import { readCreditPolicy, readBorrowerConfig } from "@/lib/config/store";
import { bandForScore } from "@/lib/risk/bands";
import { portalBorrowerId } from "@/lib/portal/borrower";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 15 * 1024 * 1024;

export async function POST(req: NextRequest) {
  let form: FormData;
  try { form = await req.formData(); } catch {
    return NextResponse.json({ success: false, message: "Upload your M-PESA statement." }, { status: 400 });
  }

  const org = await resolveOrg(String(form.get("lenderSlug") ?? ""));
  if (!org) return NextResponse.json({ success: false, message: "Choose a lender." }, { status: 400 });
  enterOrg(org.id);

  const session = await borrowerFor(org.id);
  if (!session) return otpRequired();

  const limited = await rateLimit(
    [
      { name: "portal-crunch:phone", subject: `${org.id}:${session.phone}`, max: 8, windowSec: 3600 },
      { name: "portal-crunch:ip", subject: clientIp(req), max: 30, windowSec: 3600 },
    ],
    "You have read several statements in the last hour. Give it a little while before the next one.",
  );
  if (limited) return limited;

  const gated = await requireFeature(org.id, "statement-cruncher");
  if (gated) return gated;

  const borrowerId = await portalBorrowerId(org, session);
  if (!borrowerId) {
    return NextResponse.json(
      { success: false, reason: "kyc", message: "Verify your identity first — the statement is read against the person you proved you are." },
      { status: 409 },
    );
  }

  const file = form.get("file") as File | null;
  const password = String(form.get("password") ?? "").trim() || undefined;
  if (!file) return NextResponse.json({ success: false, field: "file", message: "Choose the statement PDF Safaricom emailed you." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ success: false, field: "file", message: "That file is over 15 MB — it is not an M-PESA statement." }, { status: 400 });
  if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
    return NextResponse.json({ success: false, field: "file", message: "That is not a PDF. Use the statement file Safaricom emailed you." }, { status: 400 });
  }

  const borrower = await prisma.borrower.findUnique({
    where: { id: borrowerId },
    select: { id: true, firstName: true, otherName: true, creditScore: true, loanLimit: true, dob: true },
  });
  const kyc = await prisma.kycSession.findFirst({
    where: { orgId: org.id, phone: { endsWith: session.phone.slice(-9) } },
    orderBy: { createdAt: "desc" },
    select: { iprsName: true, idOcrName: true },
  });

  try {
    const text = await extractPdfText(Buffer.from(await file.arrayBuffer()), password);
    const txns = parseMpesaStatement(text);
    if (txns.length === 0) {
      return NextResponse.json({
        success: false,
        reason: "not-a-statement",
        message: "We could not find M-PESA transactions in that PDF. Request the FULL statement from *334# — the one with the detailed transaction table.",
      });
    }

    // ── WHOSE STATEMENT IS THIS? ───────────────────────────────────────────
    const expectedName =
      [borrower?.firstName, borrower?.otherName].filter(Boolean).join(" ").trim() ||
      kyc?.iprsName || kyc?.idOcrName || null;
    const statementName = extractStatementName(text);
    let nameCheck: { statementName: string | null; expectedName: string | null; matched: boolean; unreadable: boolean } = {
      statementName, expectedName, matched: false, unreadable: !statementName,
    };
    if (expectedName && statementName) {
      const { match } = namesMatch(expectedName, statementName);
      nameCheck = { statementName, expectedName, matched: match, unreadable: false };
      if (!match) {
        await prisma.auditLog.create({
          data: {
            orgId: org.id, actorId: borrowerId, actorType: "borrower", action: "crunch.name-mismatch",
            entity: "Borrower", entityId: borrowerId, ip: clientIp(req),
            meta: { statementName, expectedName, via: "portal" },
          },
        }).catch(() => {});
        return NextResponse.json({
          success: false,
          nameMismatch: true,
          statementName,
          expectedName,
          message: `This statement is registered to “${statementName}”, not ${expectedName}. A statement can only score the person named on it.`,
        });
      }
    }

    const result = crunch(txns);
    const creditScore = scoreThinFileAuto(result.features);
    const report = analyzeStatement(txns);

    // ── THE STARTING LIMIT, FROM THE LENDER'S POLICY ───────────────────────
    const [policyDoc, borrowerCfg, products, cleared] = await Promise.all([
      readCreditPolicy(org.id),
      readBorrowerConfig(org.id),
      candidatesFor(org.id),
      prisma.loan.count({ where: { orgId: org.id, borrowerId, status: "CLEARED" } }),
    ]);
    const age = borrower?.dob ? Math.floor((Date.now() - borrower.dob.getTime()) / (365.25 * 86_400_000)) : undefined;
    const decision = decide({
      report,
      policy: policyDoc.value,
      products,
      history: { clearedLoans: cleared, hasActiveLoan: false, age },
    });

    const cfg = borrowerCfg.value;
    const ceiling = cfg.limit.maxLimit > 0 ? cfg.limit.maxLimit : Number.MAX_SAFE_INTEGER;
    const belowFloor = cfg.scoring.source !== "none" && creditScore.score < cfg.scoring.minToBorrow;
    const eligible = decision.eligible && !belowFloor;
    const startingLimit = eligible ? Math.min(decision.startingLimit, ceiling) : 0;
    const declineReasons = [
      ...decision.declineReasons,
      ...(belowFloor ? [`Your statement score of ${creditScore.score} is below the ${cfg.scoring.minToBorrow} ${org.name} lends from.`] : []),
    ];

    const qualification = {
      eligible,
      startingLimit,
      internalScore: decision.internalScore,
      scoreBand: decision.scoreBand,
      tier: decision.tier,
      ceilings: decision.ceilings,
      cappedByLender: eligible && decision.startingLimit > ceiling,
      monthlyCapacity: decision.monthlyCapacity,
      reasonCodes: decision.reasonCodes,
      declineReasons,
      products: collapseByProduct(decision.products).map((p) => ({
        productId: p.productId, name: p.name, termCount: p.termCount, termUnit: p.termUnit,
        interestPct: p.interestPct, principal: p.principal, installment: p.installment,
        totalRepayable: p.totalRepayable, affordable: p.affordable, recommended: p.recommended,
      })),
      policyVersion: policyDoc.version,
    };

    // ── THE TRAINING ROW ───────────────────────────────────────────────────
    const snapshot = await prisma.scoreSnapshot.create({
      data: {
        orgId: org.id,
        borrowerId,
        modelKind: "thin-file",
        modelVersion: creditScore.modelVersion,
        score: creditScore.score,
        pd: creditScore.pd,
        riskBand: creditScore.band,
        features: {
          ...(result.features as unknown as Record<string, unknown>),
          _model: toFeatureMap(result.features),
          _qualification: qualification,
          _nameCheck: nameCheck,
        } as Prisma.InputJsonValue,
        reasons: creditScore.reasonCodes as unknown as Prisma.InputJsonValue,
        loanContextAmount: startingLimit || null,
        capturedBy: "portal-crunch",
      },
      select: { id: true },
    });

    const day = new Date().toISOString().slice(0, 10);
    const reportDoc = {
      kind: "mpesa-statement-crunch",
      crunchedAt: new Date().toISOString(),
      crunchedBy: "customer (portal)",
      creditScore, features: result.features, affordability: result.affordability, monthly: result.monthly,
      transactionCount: txns.length, nameCheck, qualification, scoreSnapshotId: snapshot.id,
    };
    await prisma.document.create({
      data: {
        orgId: org.id, borrowerId, kind: "BANK_STATEMENT",
        filename: `mpesa-crunch-report-${day}.json`, contentType: "application/json",
        bytes: Buffer.byteLength(JSON.stringify(reportDoc)),
        storageKey: `sim/crunch/${snapshot.id}.json`, status: "PARSED", confidence: 1,
        fields: reportDoc as unknown as Prisma.InputJsonValue,
        note: `M-Pesa statement crunch (customer) — score ${creditScore.score} (${creditScore.band}), ${txns.length} transactions, starting limit ${startingLimit.toLocaleString("en-KE")}.`,
        parserMode: "cruncher",
        uploadedBy: borrowerId,
      },
    }).catch(() => {});

    // ── ALLOCATION ─────────────────────────────────────────────────────────
    // The headline score is filled only when empty — a crunch never quietly
    // overwrites a deliberate one. The LIMIT is allocated only for somebody the
    // ladder has nothing to say about yet (no cleared loans), and only when the
    // lender derives limits from the score: a repeat borrower's limit is earned
    // by repayment, and a statement must not undo that.
    let limitAllocated: number | null = null;
    const updates: Prisma.BorrowerUpdateInput = { lastScoredAt: new Date() };
    if (borrower?.creditScore == null) {
      updates.creditScore = creditScore.score;
      updates.riskBand = bandForScore(creditScore.score)?.key ?? null;
    }
    if (cfg.limit.source === "scored" && cleared === 0) {
      updates.loanLimit = startingLimit;
      updates.previousLoanLimit = borrower?.loanLimit ?? null;
      limitAllocated = startingLimit;
    }
    await prisma.borrower.update({ where: { id: borrowerId }, data: updates });

    await prisma.auditLog.create({
      data: {
        orgId: org.id, actorId: borrowerId, actorType: "borrower", action: "borrower.crunch-report",
        entity: "Borrower", entityId: borrowerId, ip: clientIp(req),
        meta: {
          via: "portal", score: creditScore.score, band: creditScore.band, startingLimit, limitAllocated,
          policyVersion: policyDoc.version, declineReasons: declineReasons.slice(0, 4),
        },
      },
    }).catch(() => {});

    void meter(org.id, "statement", 1, { via: "portal", transactions: txns.length, months: result.features.monthsCovered });

    const buckets = new Map<string, { count: number; amount: number; inAmt: number; outAmt: number }>();
    let paidIn = 0, paidOut = 0;
    for (const t of txns) {
      const b = buckets.get(t.category) ?? { count: 0, amount: 0, inAmt: 0, outAmt: 0 };
      b.count++; b.amount += t.amount;
      if (t.direction === "in") { b.inAmt += t.amount; paidIn += t.amount; } else { b.outAmt += t.amount; paidOut += t.amount; }
      buckets.set(t.category, b);
    }

    return NextResponse.json({
      success: true,
      nameCheck,
      transactionCount: txns.length,
      paidIn: Math.round(paidIn),
      paidOut: Math.round(paidOut),
      creditScore,
      features: result.features,
      monthly: result.monthly,
      affordability: result.affordability,
      report,
      categories: [...buckets.entries()]
        .map(([category, v]) => ({ category, count: v.count, amount: Math.round(v.amount), inAmt: Math.round(v.inAmt), outAmt: Math.round(v.outAmt) }))
        .sort((a, b) => b.count - a.count),
      sample: txns.slice(0, 40).map((t) => ({ date: t.date, details: t.details.slice(0, 48), direction: t.direction, amount: t.amount, category: t.category })),
      qualification,
      saved: { snapshotId: snapshot.id, limitAllocated },
    });
  } catch (err) {
    if (err instanceof PdfPasswordRequiredError || err instanceof PdfPasswordIncorrectError) {
      return NextResponse.json({ success: false, needPassword: true, field: "password", message: err.message });
    }
    return NextResponse.json({ success: false, message: err instanceof Error ? err.message : "We could not read that statement." });
  }
}
