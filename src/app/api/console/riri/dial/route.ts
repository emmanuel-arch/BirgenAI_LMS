// ─────────────────────────────────────────────────────────────────────────────
// THE DIALLER'S BRAIN — who is this number, and what should I know before it rings.
//
// A dialler that only dials is a keypad. What makes this one worth having in a
// lending console is the half-second between the last digit and the call: the
// number resolves to a customer on YOUR book, with their live position — what they
// owe, how late they are, what was said to them last, and whether they have already
// promised to pay. An officer who opens a call knowing "twelve days late, promised
// Tuesday, didn't pay" has a different conversation from one who opens it blind.
//
// THREE THINGS KEEP IT HONEST:
//
//   1. IT DOES NOT PLACE CALLS. It hands back a `tel:` URI and the facts. The
//      handset, the softphone or the desk phone does the dialling. We are not in
//      the path of somebody's voice call, and we do not want to be.
//   2. SCOPE IS THE SAME SCOPE. An officer on OWN scope who dials a number belonging
//      to the branch next door is told it is not on their book — not shown a
//      stranger's arrears because they happened to know the digits.
//   3. UNKNOWN IS A REAL ANSWER. A number that matches nobody comes back as nobody.
//      A dialler that guesses "probably this customer" would put an officer on the
//      phone discussing a loan with a person who does not have one.
//
// Logging what happened afterwards is deliberately NOT here: it goes through the
// existing `PATCH /api/console/borrowers/[id]` with `action: "interaction"`, which
// already writes the audited disposition the Customer Timeline and Oversight read.
// A second write path for the same event is how two screens start disagreeing.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRights } from "@/lib/rbac/authz";
import { resolveScope, borrowerScopeWhere } from "@/lib/rbac/scope";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/** Kenyan MSISDN normalisation — 07…, 7…, +254… and 254… all mean one number. */
function toMsisdn(raw: string): string | null {
  const d = raw.replace(/\D/g, "");
  if (d.startsWith("254") && d.length === 12) return d;
  if (d.startsWith("0") && d.length === 10) return `254${d.slice(1)}`;
  if (d.length === 9 && (d.startsWith("7") || d.startsWith("1"))) return `254${d}`;
  return null;
}

export type DialMatch = {
  borrowerId: string;
  name: string;
  phone: string;
  /** +254… — what the handset is handed. */
  tel: string;
  kycStatus: string;
  riskBand: string | null;
  creditScore: number | null;
  branch: string | null;
  activeLoans: number;
  balance: string | null;
  /** Days past due on the worst overdue installment. Null when nothing is late. */
  daysLate: number | null;
  overdue: string | null;
  /** A promise already on file that has not resolved. */
  promise: { amount: string; dueDate: string } | null;
  /** The last thing anyone recorded about talking to them. */
  lastContact: { at: string; what: string } | null;
};

const kes = (n: number) => `KES ${Math.round(n).toLocaleString("en-KE")}`;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const orgId = session.user.orgId;

  let body: { number?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  const raw = (body.number ?? "").trim();
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 6) return NextResponse.json({ success: true, match: null, state: "typing" });

  const rights = await getRights(session);
  if (!rights.has("borrowers.view") && !rights.has("*")) {
    return NextResponse.json({ success: false, message: "You do not have access to customers." }, { status: 403 });
  }

  const scope = await resolveScope(session);
  const visible = borrowerScopeWhere(scope);
  const msisdn = toMsisdn(raw);

  // A complete number matches exactly; a partial one narrows on the trailing digits,
  // which is how a person reads a number back to you.
  const where = msisdn
    ? { phone: msisdn }
    : { phone: { contains: digits.replace(/^0/, "") } };

  const b = await prisma.borrower.findFirst({
    where: { orgId, erasedAt: null, ...visible, ...where },
    select: {
      id: true, firstName: true, otherName: true, phone: true, nationalId: true,
      kycStatus: true, riskBand: true, creditScore: true, branchId: true,
      loans: {
        where: { status: "ACTIVE" },
        select: {
          id: true, balance: true,
          installments: {
            where: { status: "OVERDUE" },
            orderBy: { dueDate: "asc" },
            take: 1,
            select: { dueDate: true, amountDue: true, amountPaid: true },
          },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  if (!b) {
    return NextResponse.json({
      success: true,
      match: null,
      state: msisdn ? "unknown" : "typing",
      // The scope note is not decoration: "nobody" and "nobody you can see" are
      // different facts, and an officer who is not told which one they got will
      // treat a colleague's customer as a stranger to their face.
      scope: scope.kind,
      tel: msisdn ? `tel:+${msisdn}` : null,
    });
  }

  const name = [b.firstName, b.otherName].filter(Boolean).join(" ").trim() || b.phone;
  const balance = b.loans.reduce((s, l) => s + Number(l.balance), 0);
  const worst = b.loans.flatMap((l) => l.installments)[0] ?? null;
  const daysLate = worst ? Math.max(0, Math.floor((Date.now() - worst.dueDate.getTime()) / 86_400_000)) : null;
  const overdue = worst ? Number(worst.amountDue) - Number(worst.amountPaid) : null;

  const [branch, promise, lastCall, lastNote] = await Promise.all([
    b.branchId ? prisma.branch.findFirst({ where: { orgId, id: b.branchId }, select: { name: true } }) : null,
    prisma.promiseToPay.findFirst({
      where: { orgId, borrowerId: b.id, status: "PENDING" },
      orderBy: { dueDate: "asc" },
      select: { amount: true, dueDate: true },
    }),
    prisma.collectionCall.findFirst({
      where: { orgId, borrowerId: b.id },
      orderBy: { createdAt: "desc" },
      select: { outcome: true, createdAt: true },
    }),
    prisma.auditLog.findFirst({
      where: { orgId, entity: "borrower", entityId: b.id, action: "borrower.interaction" },
      orderBy: { createdAt: "desc" },
      select: { meta: true, createdAt: true },
    }),
  ]);

  // Whichever record of "we spoke to them" is newer. Two half-answers is worse
  // than one, and the call-centre note and the collections call are the same event
  // recorded by different teams.
  let lastContact: DialMatch["lastContact"] = null;
  const noteAt = lastNote?.createdAt ?? null;
  const callAt = lastCall?.createdAt ?? null;
  if (noteAt && (!callAt || noteAt > callAt)) {
    const meta = (lastNote?.meta ?? {}) as { disposition?: string; channel?: string };
    lastContact = { at: noteAt.toISOString(), what: meta.disposition || meta.channel || "Contacted" };
  } else if (callAt) {
    lastContact = { at: callAt.toISOString(), what: String(lastCall!.outcome).replace(/_/g, " ").toLowerCase() };
  }

  const match: DialMatch = {
    borrowerId: b.id,
    name,
    phone: b.phone,
    tel: `tel:+${b.phone}`,
    kycStatus: b.kycStatus,
    riskBand: b.riskBand,
    creditScore: b.creditScore,
    branch: branch?.name ?? null,
    activeLoans: b.loans.length,
    balance: balance > 0 ? kes(balance) : null,
    daysLate,
    overdue: overdue && overdue > 0 ? kes(overdue) : null,
    promise: promise ? { amount: kes(Number(promise.amount)), dueDate: promise.dueDate.toISOString() } : null,
    lastContact,
  };

  return NextResponse.json({ success: true, match, state: "known", scope: scope.kind });
}

/** Recent conversations, so the Calls app opens on something instead of an empty keypad. */
export async function GET() {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const orgId = session.user.orgId;

  const rights = await getRights(session);
  if (!rights.has("borrowers.view") && !rights.has("*")) {
    return NextResponse.json({ success: true, recents: [] });
  }

  const scope = await resolveScope(session);
  const visible = borrowerScopeWhere(scope);

  // Read the calls first, then resolve the people — the other order would need a
  // join through a relation CollectionCall deliberately does not carry.
  const calls = await prisma.collectionCall.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { borrowerId: true, outcome: true, createdAt: true },
  });

  const ids = [...new Set(calls.map((c) => c.borrowerId))].slice(0, 12);
  if (!ids.length) return NextResponse.json({ success: true, recents: [] });

  const people = await prisma.borrower.findMany({
    where: { orgId, erasedAt: null, ...visible, id: { in: ids } },
    select: { id: true, firstName: true, otherName: true, phone: true },
  });
  const byId = new Map(people.map((p) => [p.id, p]));

  const seen = new Set<string>();
  const recents = calls
    .filter((c) => byId.has(c.borrowerId) && !seen.has(c.borrowerId) && seen.add(c.borrowerId) !== undefined)
    .slice(0, 8)
    .map((c) => {
      const p = byId.get(c.borrowerId)!;
      return {
        borrowerId: p.id,
        name: [p.firstName, p.otherName].filter(Boolean).join(" ").trim() || p.phone,
        phone: p.phone,
        tel: `tel:+${p.phone}`,
        outcome: String(c.outcome).replace(/_/g, " ").toLowerCase(),
        at: c.createdAt.toISOString(),
      };
    });

  return NextResponse.json({ success: true, recents });
}
