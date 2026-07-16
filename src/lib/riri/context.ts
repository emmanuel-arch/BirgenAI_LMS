// ─────────────────────────────────────────────────────────────────────────────
// WHO IS ASKING, AND ABOUT WHOM — Riri's context, built server-side.
//
// Two halves, and neither is ever taken from the browser:
//
//   THE ACTOR   — read from the session. Their name, their role, their rights. A client
//                 that could name its own role could ask questions as a manager.
//   THE SUBJECT — the client names an ID; every fact is read here, from the org-scoped
//                 row. A client that could post the customer's numbers could invent a
//                 customer, or shave a balance before asking about it, and Riri's answer
//                 would carry our authority.
//
// RLS scopes the read to the caller's org, so an id from another lender's book resolves
// to nothing rather than to their customer.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";
import { bandForScore } from "@/lib/risk/bands";

export type ActorContext = {
  name: string | null;
  role: string | null;
  branch: string | null;
  /** What they may see — Riri must not describe a screen they cannot open. */
  rights: ReadonlySet<string>;
  /** True when this is BirgenAI's own platform admin acting as the lender. */
  isPlatformAdmin: boolean;
};

/**
 * A platform admin acting as a lender signs in as `platform:<adminId>` (see
 * api/platform/impersonate) — an id that is deliberately NOT a StaffUser, so the
 * banner and the audit trail can tell the founder apart from the lender's own people.
 */
export const PLATFORM_ACTOR_PREFIX = "platform:";
export const isPlatformActor = (id: string | null) => !!id?.startsWith(PLATFORM_ACTOR_PREFIX);

export type SubjectContext = {
  kind: "borrower";
  id: string;
  /** Display + logging only. Never handed to the model as a fact. */
  label: string;
  lines: string[];
  /** True when this person must not be discussed at all (erased under the DPA). */
  restricted?: boolean;
};

/** The person at the keyboard. Session-derived; never client-supplied. */
export async function actorContext(
  orgId: string,
  staffId: string | null,
  rights: ReadonlySet<string>,
  /**
   * Identity from the session, used when the actor is not a row in StaffUser.
   * Without it a platform admin — the person most likely to be demonstrating this —
   * is addressed by Riri as an anonymous "colleague".
   */
  session?: { name?: string | null; role?: string | null },
): Promise<ActorContext> {
  if (isPlatformActor(staffId)) {
    return {
      name: session?.name ?? null,
      role: session?.role ?? "Platform Admin",
      branch: null,
      rights,
      isPlatformAdmin: true,
    };
  }

  if (!staffId) return { name: session?.name ?? null, role: session?.role ?? null, branch: null, rights, isPlatformAdmin: false };

  const staff = await prisma.staffUser.findFirst({
    where: { id: staffId, orgId },
    select: {
      firstName: true, otherName: true,
      role: { select: { title: true } },
      branch: { select: { name: true } },
    },
  });
  if (!staff) return { name: session?.name ?? null, role: session?.role ?? null, branch: null, rights, isPlatformAdmin: false };
  return {
    name: [staff.firstName, staff.otherName].filter(Boolean).join(" ") || null,
    role: staff.role?.title ?? null,
    branch: staff.branch?.name ?? null,
    rights,
    isPlatformAdmin: false,
  };
}

const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;

/**
 * THE BOOK THE ACTOR IS ACCOUNTABLE FOR.
 *
 * An officer asking "who should I chase today?" means THEIR customers, not the lender's
 * whole portfolio — and an assistant that answers with the org's numbers has answered a
 * question nobody asked. So the scope follows the job: an officer or collections agent
 * gets the customers they registered; a manager or admin gets the whole book, because
 * that is what they are actually accountable for.
 *
 * Returns [] when there is nothing to say (a brand-new officer with no customers), so
 * Riri says "you have no customers yet" rather than reciting zeroes.
 */
export async function bookContext(
  orgId: string,
  staffId: string | null,
  scope: "own" | "all",
): Promise<string[]> {
  const mine = scope === "own" && staffId ? { createdById: staffId } : {};
  const where = { orgId, erasedAt: null, ...mine };

  const customers = await prisma.borrower.count({ where });
  if (customers === 0) {
    return scope === "own"
      ? ["They have no customers on their book yet — they are starting from zero."]
      : ["This lender has no customers on the book yet."];
  }

  const loans = await prisma.loan.findMany({
    where: { orgId, status: "ACTIVE", borrower: { erasedAt: null, ...mine } },
    select: {
      balance: true,
      borrower: { select: { firstName: true, otherName: true } },
      installments: { select: { status: true, dueDate: true, amountDue: true, amountPaid: true } },
    },
  });

  const now = Date.now();
  const outstanding = loans.reduce((s, l) => s + Number(l.balance), 0);
  const late = loans
    .map((l) => {
      const overdue = l.installments.filter((i) => i.status !== "PAID" && i.dueDate.getTime() < now);
      const owed = overdue.reduce((s, i) => s + (Number(i.amountDue) - Number(i.amountPaid)), 0);
      const days = overdue.reduce((d, i) => Math.max(d, Math.floor((now - i.dueDate.getTime()) / 86_400_000)), 0);
      return { name: [l.borrower.firstName, l.borrower.otherName].filter(Boolean).join(" "), owed, days };
    })
    .filter((x) => x.owed > 0)
    .sort((a, b) => b.days - a.days);

  const arrears = late.reduce((s, x) => s + x.owed, 0);
  const whose = scope === "own" ? "Their book" : "This lender's book";

  const lines = [
    `${whose}: ${customers} customer(s), ${loans.length} active loan(s), ${kes(outstanding)} outstanding.`,
  ];

  if (late.length === 0) {
    lines.push(loans.length ? "Nothing in arrears — the whole book is current." : "No active loans right now.");
  } else {
    // PAR is the number a lender is actually judged on; give it, and give the names
    // behind it, because "chase these three" is advice and "PAR is 14%" is a statistic.
    const par = outstanding > 0 ? (late.reduce((s, x) => s + Number(x.owed), 0) / outstanding) * 100 : 0;
    lines.push(`In arrears: ${late.length} loan(s), ${kes(arrears)} overdue (~${par.toFixed(1)}% of the book).`);
    lines.push(
      `Worst first: ${late.slice(0, 5).map((x) => `${x.name} (${kes(x.owed)}, ${x.days}d late)`).join("; ")}.`,
    );
  }
  return lines;
}

/**
 * The customer on the officer's screen, read from our own rows.
 *
 * Deliberately facts, not prose: what they owe, how they have paid, what the engine
 * thinks. Riri writes the sentences; this decides what is true.
 */
export async function borrowerContext(orgId: string, borrowerId: string): Promise<SubjectContext | null> {
  const b = await prisma.borrower.findFirst({
    where: { id: borrowerId, orgId },
    select: {
      id: true, firstName: true, otherName: true, phone: true, nationalId: true,
      kycStatus: true, loanLimit: true, creditScore: true, riskBand: true,
      behaviouralScore: true, graduationCount: true, erasedAt: true,
      locationAddress: true, locationType: true, lat: true, homeLat: true,
      createdAt: true, branchId: true, createdById: true,
      loans: {
        select: {
          id: true, status: true, principal: true, balance: true,
          product: { select: { name: true } },
          installments: { select: { status: true, dueDate: true, amountDue: true, amountPaid: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      },
    },
  });
  if (!b) return null;

  // Branch and officer hang off plain id columns, not relations — same two lookups
  // the profile route does.
  const [branch, officer] = await Promise.all([
    b.branchId ? prisma.branch.findFirst({ where: { id: b.branchId, orgId }, select: { name: true } }) : null,
    b.createdById ? prisma.staffUser.findFirst({ where: { id: b.createdById, orgId }, select: { firstName: true, otherName: true } }) : null,
  ]);

  const name = [b.firstName, b.otherName].filter(Boolean).join(" ");

  // An erased customer is a tombstone. Riri must not narrate a person we were
  // legally required to forget, however much of the row technically survives.
  if (b.erasedAt) {
    return {
      kind: "borrower", id: b.id, label: "this customer", restricted: true,
      lines: ["Their data was erased under a data-protection request."],
    };
  }
  const active = b.loans.filter((l) => l.status === "ACTIVE");
  const cleared = b.loans.filter((l) => l.status === "CLEARED");
  const now = Date.now();
  const overdue = active.flatMap((l) =>
    l.installments.filter((i) => i.status !== "PAID" && i.dueDate.getTime() < now),
  );
  const arrears = overdue.reduce((s, i) => s + (Number(i.amountDue) - Number(i.amountPaid)), 0);
  const worstDays = overdue.reduce(
    (d, i) => Math.max(d, Math.floor((now - i.dueDate.getTime()) / 86_400_000)),
    0,
  );

  const lines: string[] = [
    `Customer: ${name} (${b.phone})${b.nationalId ? `, national ID ${b.nationalId}` : ""}.`,
    `KYC: ${b.kycStatus}.`,
    `With us since ${b.createdAt.toISOString().slice(0, 10)}${branch ? `, ${branch.name} branch` : ""}${
      officer ? `, officer ${[officer.firstName, officer.otherName].filter(Boolean).join(" ")}` : ""
    }.`,
  ];

  if (b.creditScore != null) {
    const band = b.riskBand ?? bandForScore(b.creditScore)?.label ?? null;
    lines.push(`Internal score ${b.creditScore}/900${band ? ` (${band} risk band)` : ""}.`);
  } else {
    lines.push("No internal credit score yet.");
  }
  if (b.behaviouralScore != null) lines.push(`Behavioural score ${b.behaviouralScore}/100.`);
  if (b.loanLimit != null) lines.push(`Loan limit ${kes(Number(b.loanLimit))}.`);
  if (b.graduationCount > 0) lines.push(`Graduated ${b.graduationCount} time(s) — their ceiling has been raised for repaying well.`);

  lines.push(
    active.length
      ? `${active.length} active loan(s), ${kes(active.reduce((s, l) => s + Number(l.balance), 0))} outstanding: ${active
          .map((l) => `${l.product?.name ?? "loan"} ${kes(Number(l.principal))} (balance ${kes(Number(l.balance))})`)
          .join("; ")}.`
      : "No active loans.",
  );
  lines.push(`${cleared.length} loan(s) cleared to date.`);
  lines.push(
    arrears > 0
      ? `IN ARREARS: ${kes(arrears)} across ${overdue.length} missed installment(s), worst ${worstDays} days late.`
      : active.length
        ? "Up to date — nothing overdue."
        : "Nothing overdue.",
  );

  const pinned = b.lat != null || b.homeLat != null;
  lines.push(
    pinned
      ? `Location on file${b.locationAddress ? `: ${b.locationAddress}` : ""}${b.locationType ? ` (${b.locationType})` : ""}.`
      : "No location pin on file — they cannot be routed to, and geo-gated disbursement will refuse.",
  );

  return { kind: "borrower", id: b.id, label: name, lines };
}

/**
 * The preamble handed to the model.
 *
 * Written as instructions rather than data because a model that is merely SHOWN a
 * balance will happily invent the next one; told plainly that these are the only facts
 * it has, it asks instead.
 */
export function contextPreamble(actor: ActorContext, subject: SubjectContext | null): string {
  const who = [
    `You are speaking to ${actor.name ?? "a member of staff"}${actor.role ? `, ${actor.role}` : ""}${
      actor.branch ? ` at ${actor.branch}` : ""
    }.`,
    "Answer at their level and never describe a screen or action their rights do not cover.",
  ];
  if (!subject) return who.join(" ");

  return [
    ...who,
    "",
    "They have this customer's page open. These are the facts on file — treat them as the only ones you have, and say you would need to check rather than estimating anything not listed:",
    ...subject.lines.map((l) => `- ${l}`),
  ].join("\n");
}
