// ─────────────────────────────────────────────────────────────────────────────
// THE SERVICESUITE HOST — Riri for a lender whose book lives in their own SQL Server.
//
// Riri Ecosystem AI plan §02 Contract 1: "Needs two more: servicesuite.ts (over the
// read-only relay) and portal.ts." This is the first, and it closes a correctness
// gap that was live in the console:
//
//   For a BRIDGED lender (Micromart, Axe, Buy Simu, Techcrast) the LMS host read the
//   customer from OUR Postgres. Their loans are not in our Postgres — they are in
//   ServiceSuite. So an officer who opened a Micromart customer and asked Riri about
//   them was handed "No active loans. Nothing overdue." for a borrower with a live
//   balance. That is the confident, plausible, wrong answer the plan's §10 exists to
//   prevent, and it came from the host, not the model.
//
// This host WRAPS the LMS host rather than replacing it. Everything that genuinely
// lives on our side — who the officer is, their memory, the KYC state, the score
// our engine gave — still comes from there. What it replaces is the money: the loan
// lines are removed and the lender's own book is read in their place, keyed by the
// ServiceSuite id we already hold, through the same read-only path Home uses
// (lib/portal/micromart-book.ts — primary-key reads, no scans, nothing that could
// disturb a shared server).
//
// And it says what it could NOT read. Arrears age lives in a schedule table this
// path does not touch, so the facts carry a line forbidding Riri from calling the
// customer up to date. A missing fact that is named is a caveat; a missing fact
// that is silent is a clean bill of health nobody issued.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";
import type { ResolvedOrg } from "@/lib/tenancy";
import { readBookPosition } from "@/lib/portal/micromart-book";
import type { RiriHost, RiriSubjectFacts } from "../host";

const kes = (n: number) => `KES ${Math.round(n).toLocaleString("en-KE")}`;

/** Our local lines that describe money we do not hold for a bridged lender. */
const LOCAL_MONEY_LINE = /^(?:No active loans|\d+ active loan|\d+ loan\(s\) cleared|IN ARREARS|Up to date|Nothing overdue|Loan limit)/;

export function servicesuiteHost(args: { org: ResolvedOrg; base: RiriHost }): RiriHost {
  const { org, base } = args;

  return {
    ...base,

    async subject(kind: string, id: string): Promise<RiriSubjectFacts | null> {
      const local = await base.subject(kind, id);
      if (!local || local.restricted || org.mode !== "BRIDGED" || !org.registry || !org.entityId) return local;

      const row = await prisma.borrower
        .findFirst({ where: { id, orgId: org.id }, select: { serviceSuiteBorrowerId: true } })
        .catch(() => null);
      const ssId = row?.serviceSuiteBorrowerId ?? null;

      const kept = local.lines.filter((l) => !LOCAL_MONEY_LINE.test(l));
      if (!ssId) {
        return {
          ...local,
          lines: [
            ...kept,
            `This customer is not yet linked to a record on ${org.name}'s own book, so their loans and balance are unknown here. Do not say they have no loans — say the book record has not been linked.`,
          ],
        };
      }

      const position = await readBookPosition(org.registry, org.entityId, ssId).catch(() => null);
      if (!position) {
        return {
          ...local,
          lines: [
            ...kept,
            `${org.name}'s book could not be read just now (record ${ssId}). Their balance and loans are unknown — do not state or estimate them.`,
          ],
        };
      }

      const live: string[] = [
        `LIVE FROM ${org.name.toUpperCase()}'S OWN BOOK (read now, ServiceSuite record ${position.borrowerId}):`,
        position.loanLimit != null ? `Loan limit on their book ${kes(position.loanLimit)}.` : "No loan limit recorded on their book.",
        position.openLoans > 0
          ? `${position.openLoans} open loan(s), ${kes(position.outstanding)} outstanding.`
          : "No open loan carrying a balance.",
      ];
      if (position.activeLoan) {
        const l = position.activeLoan;
        live.push(
          `Most recent open loan: ${l.product ?? "loan"} ${kes(l.principal)}${l.borrowedAt ? ` borrowed ${l.borrowedAt.slice(0, 10)}` : ""}, balance ${kes(l.balance)}${l.clearDate ? `, expected to clear ${l.clearDate.slice(0, 10)}` : ""}.`,
        );
      }
      live.push(`${position.clearedLoans} loan(s) cleared of ${position.loansEver} ever approved.`);
      live.push(
        "Arrears ageing (days late, missed instalments) is NOT in these facts. Never describe this customer as up to date or in arrears from them — say it needs the statement.",
      );

      return { ...local, lines: [...kept, ...live] };
    },
  };
}
