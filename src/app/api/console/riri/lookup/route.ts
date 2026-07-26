// ─────────────────────────────────────────────────────────────────────────────
// FIND THE PERSON — ServiceSuite AI's customer lookup.
//
// The demo moment this exists for: an officer opens the dock, types "Emmanuel
// Kipleting", and the assistant either opens on that customer, or says "three
// people on your book answer to that — which one?" and shows them. Then every
// question after is about THEM. Same experience as Ask Riri from a Customer-360
// page, except the customer arrived by name instead of by URL.
//
// THREE THINGS MAKE THIS SAFE, and they are the reason it is a server route and
// not a client filter over a list:
//
//   1. RLS scopes every read to the caller's org. An id from another lender's
//      book resolves to nothing, no matter what is typed.
//   2. THE CALLER'S DATA SCOPE applies on top (src/lib/rbac/scope.ts). An officer
//      on OWN sees only customers they registered; a branch manager sees their
//      branch and its children; only ORG scope searches the whole book. The
//      assistant is not a side door around the visibility model — it IS the
//      visibility model, spoken.
//   3. ERASED PEOPLE ARE NOT FOUND. A borrower who exercised their right to
//      erasure keeps a financial tombstone for the AML floor; they are not a
//      searchable customer, and returning their row here would undo the erasure.
//
// Matching is deliberately ordered by how sure the input makes us: a national ID
// or a phone number is an assertion of identity and matches exactly; a name is a
// guess and matches loosely, ranked.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRights } from "@/lib/rbac/authz";
import { resolveScope, borrowerScopeWhere } from "@/lib/rbac/scope";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";

const MAX_MATCHES = 6;

/** Kenyan MSISDN normalisation — 07…, 7…, +254… and 254… all mean one number. */
function toMsisdn(raw: string): string | null {
  const d = raw.replace(/\D/g, "");
  if (d.length < 9) return null;
  if (d.startsWith("254") && d.length === 12) return d;
  if (d.startsWith("0") && d.length === 10) return `254${d.slice(1)}`;
  if (d.length === 9 && (d.startsWith("7") || d.startsWith("1"))) return `254${d}`;
  return null;
}

/** A bare 6–9 digit run is how a Kenyan national ID arrives. */
function looksLikeNationalId(raw: string): string | null {
  const t = raw.trim();
  return /^\d{6,9}$/.test(t) ? t : null;
}

export type LookupMatch = {
  id: string;
  name: string;
  phoneMasked: string;
  nationalIdMasked: string | null;
  branch: string | null;
  kycStatus: string;
  riskBand: string | null;
  creditScore: number | null;
  openLoans: number;
  arrears: boolean;
};

/** Enough to tell two people with the same name apart — never the full PII. */
const mask = (s: string | null | undefined, keep = 3) =>
  !s ? null : s.length <= keep ? s : `${"•".repeat(Math.max(2, s.length - keep))}${s.slice(-keep)}`;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const orgId = session.user.orgId;

  let body: { query?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const q = (body.query ?? "").trim();
  if (q.length < 2) return NextResponse.json({ success: false, message: "Type at least two characters." }, { status: 400 });
  if (q.length > 80) return NextResponse.json({ success: false, message: "That's too long for a name or a number." }, { status: 400 });

  const rights = await getRights(session);
  if (!rights.has("borrowers.view")) {
    return NextResponse.json({ success: false, message: "You do not have access to customers." }, { status: 403 });
  }

  const scope = await resolveScope(session);
  const visible = borrowerScopeWhere(scope);

  const msisdn = toMsisdn(q);
  const idNo = looksLikeNationalId(q);
  // A name is a guess: split on whitespace so "emmanuel kipleting" matches a row
  // whose firstName and otherName hold the halves, in either order.
  const words = q.split(/\s+/).filter((w) => w.length >= 2).slice(0, 3);

  const or: Prisma.BorrowerWhereInput[] = [];
  if (msisdn) or.push({ phone: msisdn });
  if (idNo) or.push({ nationalId: idNo });
  // Partial phone typed without a country code ("0712" mid-type) still narrows.
  if (!msisdn && /^\d{4,}$/.test(q)) or.push({ phone: { contains: q.replace(/^0/, "") } });
  for (const w of words) {
    or.push({ firstName: { contains: w, mode: "insensitive" } });
    or.push({ otherName: { contains: w, mode: "insensitive" } });
  }
  if (or.length === 0) return NextResponse.json({ success: true, matches: [], query: q });

  const rows = await prisma.borrower.findMany({
    where: {
      orgId,
      // The erasure tombstone is not a customer. See the header.
      erasedAt: null,
      ...visible,
      OR: or,
    },
    select: {
      id: true, firstName: true, otherName: true, phone: true, nationalId: true,
      kycStatus: true, riskBand: true, creditScore: true,
      branchId: true,
      // Arrears is not a loan status in this schema — it is an OVERDUE installment
      // under a live loan, which is the same definition the collections queue uses
      // (src/lib/collections/queue.ts). Two different answers to "are they late?"
      // in two places is how a book stops being believed.
      loans: {
        where: { status: "ACTIVE" },
        select: { id: true, installments: { where: { status: "OVERDUE" }, select: { id: true }, take: 1 } },
      },
    },
    orderBy: [{ updatedAt: "desc" }],
    take: 40,
  });

  // Borrower carries branchId but no `branch` relation, so the names come in one
  // extra keyed read rather than a join — at most a handful of ids, and it keeps
  // the schema honest instead of adding a relation just for a label.
  const branchIds = [...new Set(rows.map((b) => b.branchId).filter((x): x is string => !!x))];
  const branchNames = new Map<string, string>();
  if (branchIds.length) {
    const branches = await prisma.branch.findMany({ where: { orgId, id: { in: branchIds } }, select: { id: true, name: true } });
    for (const br of branches) branchNames.set(br.id, br.name);
  }

  const needle = q.toLowerCase();
  const scored = rows.map((b) => {
    const name = [b.firstName, b.otherName].filter(Boolean).join(" ").trim() || "Unnamed customer";
    const lower = name.toLowerCase();
    // Exactness ranking: an identity assertion beats a full-name hit beats a prefix.
    let rank = 0;
    if (idNo && b.nationalId === idNo) rank = 100;
    else if (msisdn && b.phone === msisdn) rank = 95;
    else if (lower === needle) rank = 80;
    else if (lower.startsWith(needle)) rank = 60;
    else if (words.length > 1 && words.every((w) => lower.includes(w.toLowerCase()))) rank = 50;
    else rank = 20;
    return {
      rank,
      match: {
        id: b.id,
        name,
        phoneMasked: mask(b.phone, 3) ?? "",
        nationalIdMasked: mask(b.nationalId, 3),
        branch: b.branchId ? branchNames.get(b.branchId) ?? null : null,
        kycStatus: b.kycStatus,
        riskBand: b.riskBand,
        creditScore: b.creditScore,
        openLoans: b.loans.length,
        arrears: b.loans.some((l) => l.installments.length > 0),
      } satisfies LookupMatch,
    };
  });

  scored.sort((a, z) => z.rank - a.rank || a.match.name.localeCompare(z.match.name));
  const matches = scored.slice(0, MAX_MATCHES).map((s) => s.match);

  return NextResponse.json({
    success: true,
    query: q,
    matches,
    truncated: scored.length > MAX_MATCHES,
    total: scored.length,
    // What the dock says when nothing came back — phrased for the SCOPE the caller
    // actually has, so "not found" never quietly means "not yours".
    scope: scope.kind,
  });
}
