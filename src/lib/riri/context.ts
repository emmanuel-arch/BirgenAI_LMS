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
};

export type SubjectContext = {
  kind: "borrower";
  id: string;
  lines: string[];
};

/** The person at the keyboard. Session-derived; never client-supplied. */
export async function actorContext(
  orgId: string,
  staffId: string | null,
  rights: ReadonlySet<string>,
): Promise<ActorContext> {
  if (!staffId) return { name: null, role: null, branch: null, rights };
  const staff = await prisma.staffUser.findFirst({
    where: { id: staffId, orgId },
    select: {
      firstName: true, otherName: true,
      role: { select: { title: true } },
      branch: { select: { name: true } },
    },
  });
  if (!staff) return { name: null, role: null, branch: null, rights };
  return {
    name: [staff.firstName, staff.otherName].filter(Boolean).join(" ") || null,
    role: staff.role?.title ?? null,
    branch: staff.branch?.name ?? null,
    rights,
  };
}

const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;

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

  // An erased customer is a tombstone. Riri must not narrate a person we were
  // legally required to forget, however much of the row technically survives.
  if (b.erasedAt) {
    return { kind: "borrower", id: b.id, lines: ["This customer's data has been erased under a data-protection request. Do not discuss their details."] };
  }

  const name = [b.firstName, b.otherName].filter(Boolean).join(" ");
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

  return { kind: "borrower", id: b.id, lines };
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
