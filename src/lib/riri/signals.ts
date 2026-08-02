// ─────────────────────────────────────────────────────────────────────────────
// SIGNALS — what the assistant would tell you if you hadn't asked.
//
// This is the Alerts app's engine, and the single most important sentence about it
// is this: EVERY SIGNAL IS A COUNTED ROW, NOT A MODEL'S OPINION.
//
// A notification tray is the one surface where a lender does not get to check the
// working before they act. They see "3 promises break today" on a badge and they
// pick up the phone. So nothing here is generated, inferred, or phrased by a model.
// Each signal is a query with a threshold and a destination: the number is real, the
// title says what the number is, and tapping it lands on the screen where the work
// is done. The assistant's contribution is the PRIORITISATION and the sentence —
// which is genuinely useful and is also the only part that cannot be wrong about a
// fact.
//
// SCOPED LIKE EVERYTHING ELSE. An officer on OWN scope is told about their own
// arrears, not the lender's. A tray that shows a branch manager's problems to a
// field officer is not a feature, it is noise that trains people to ignore the tray.
//
// CHEAP BY CONSTRUCTION. It runs on every open of the dock, so it is counts and
// small takes — no scans, no joins the database has to think about, and a hard cap
// on rows. Anything that needs real work belongs on a screen, and the signal's job
// is to point at that screen.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";
import { runWithOrg } from "@/lib/db/context";
import { borrowerScopeWhere, loanScopeWhere, applicationScopeWhere, type ResolvedScope } from "@/lib/rbac/scope";
import { setupState } from "./support";

export type SignalSeverity = "critical" | "attention" | "opportunity" | "info";

export type Signal = {
  /** Stable per kind+bucket, so "seen" survives a refresh. */
  id: string;
  kind: string;
  severity: SignalSeverity;
  title: string;
  /** One sentence. What it is, and what it means. Never two. */
  body: string;
  /** The number the signal is about, when there is one. */
  count?: number;
  /** Money, already formatted — the client should not be doing currency maths. */
  amount?: string;
  /** Where the work is done. */
  href: string;
  actionLabel: string;
  /** Sort key within a severity — bigger is more urgent. */
  weight: number;
};

const SEVERITY_ORDER: Record<SignalSeverity, number> = { critical: 0, attention: 1, opportunity: 2, info: 3 };

const kes = (n: number) =>
  `KES ${Math.round(n).toLocaleString("en-KE")}`;

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const endOfToday = () => { const d = new Date(); d.setHours(23, 59, 59, 999); return d; };
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const daysAhead = (n: number) => new Date(Date.now() + n * 86_400_000);

/**
 * Every probe is wrapped.
 *
 * A tray that fails to render because one count threw is worse than a tray missing
 * one row — and some of these read tables that a given deployment may not have
 * migrated yet (StandingOrder is the live example). One bad probe costs its own
 * signal and nothing else.
 */
async function probe<T>(what: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch (e) {
    console.info(`[riri:signals] ${what} skipped — ${(e instanceof Error ? e.message : String(e)).split("\n")[0]}`);
    return fallback;
  }
}

export type SignalContext = {
  orgId: string;
  scope: ResolvedScope;
  rights: ReadonlySet<string>;
  features: ReadonlySet<string>;
};

const can = (rights: ReadonlySet<string>, r: string) => rights.has("*") || rights.has(r);

/**
 * Read the book and say what is worth knowing.
 *
 * Ordered by severity then weight, capped. The cap matters: a tray with forty
 * entries is a screen, and a screen nobody opens.
 */
export async function signalsFor(ctx: SignalContext, limit = 12): Promise<Signal[]> {
  const { orgId, scope, rights } = ctx;
  const out: Signal[] = [];

  const borrowerWhere = borrowerScopeWhere(scope);
  const loanWhere = loanScopeWhere(scope);
  const appWhere = applicationScopeWhere(scope);

  await runWithOrg(orgId, async () => {
    // ── ARREARS ──────────────────────────────────────────────────────────────
    // The freshest bucket is separated from the rest on purpose: a loan one to
    // seven days late is the most recoverable money on the book, and burying it
    // under a total is how a collections team spends its morning on the oldest
    // and least collectable accounts.
    if (can(rights, "collections.view") || can(rights, "loans.view")) {
      const [freshCount, deepCount, deepSum] = await probe("arrears", () => Promise.all([
        prisma.installment.count({
          where: { orgId, status: "OVERDUE", dueDate: { gte: daysAgo(7) }, loan: { ...loanWhere, status: "ACTIVE" } },
        }),
        prisma.installment.count({
          where: { orgId, status: "OVERDUE", dueDate: { lt: daysAgo(30) }, loan: { ...loanWhere, status: "ACTIVE" } },
        }),
        prisma.installment.aggregate({
          _sum: { amountDue: true },
          where: { orgId, status: "OVERDUE", dueDate: { lt: daysAgo(30) }, loan: { ...loanWhere, status: "ACTIVE" } },
        }),
      ]), [0, 0, { _sum: { amountDue: null } }] as const);

      if (freshCount > 0) {
        out.push({
          id: `arrears-fresh`, kind: "arrears", severity: "attention",
          title: `${freshCount} account${freshCount === 1 ? "" : "s"} just went late`,
          body: "Under a week past due — this is the most recoverable money on your book. Call these first.",
          count: freshCount,
          href: "/console/collections", actionLabel: "Work the queue", weight: 90,
        });
      }
      const deepAmount = Number(deepSum._sum.amountDue ?? 0);
      if (deepCount > 0) {
        out.push({
          id: `arrears-deep`, kind: "arrears", severity: "critical",
          title: `${deepCount} account${deepCount === 1 ? "" : "s"} past 30 days`,
          body: "Beyond thirty days these stop curing on their own. Each one needs a decision, not another reminder.",
          count: deepCount,
          ...(deepAmount > 0 ? { amount: kes(deepAmount) } : {}),
          href: "/console/collections", actionLabel: "Open collections", weight: 100,
        });
      }
    }

    // ── PROMISES DUE TODAY ───────────────────────────────────────────────────
    //
    // PromiseToPay carries a borrowerId but no relation to walk, so scope cannot be
    // expressed as a nested filter the way it can for installments. Rather than
    // quietly counting the whole lender's promises for an officer on OWN scope —
    // which is the kind of leak that only shows up as "why does my tray say twelve
    // when I have three?" — the visible ids are resolved first, capped, and the
    // count is fenced to them.
    if (can(rights, "collections.view")) {
      const due = await probe("promises", async () => {
        const window = { gte: startOfToday(), lte: endOfToday() };
        if (scope.unrestricted) {
          return prisma.promiseToPay.count({ where: { orgId, status: "PENDING", dueDate: window } });
        }
        const mine = await prisma.borrower.findMany({
          where: { orgId, ...borrowerWhere, erasedAt: null },
          select: { id: true },
          take: 2000,
        });
        if (!mine.length) return 0;
        return prisma.promiseToPay.count({
          where: { orgId, status: "PENDING", dueDate: window, borrowerId: { in: mine.map((b) => b.id) } },
        });
      }, 0);
      if (due > 0) {
        out.push({
          id: "ptp-today", kind: "promise", severity: "attention",
          title: `${due} promise${due === 1 ? "" : "s"} fall${due === 1 ? "s" : ""} due today`,
          body: "A promise you don't follow up on is a promise the customer learns they can break.",
          count: due,
          href: "/console/collections?tab=ptp", actionLabel: "See promises", weight: 88,
        });
      }
    }

    // ── APPLICATIONS AGEING IN THE QUEUE ─────────────────────────────────────
    // Turnaround time is the wedge this product is sold on. An application sitting
    // three days at a stage is the thing a competitor beats us with.
    if (can(rights, "applications.view")) {
      const stale = await probe("stale applications", () =>
        prisma.loanApplication.count({
          where: { orgId, ...appWhere, status: { in: ["SUBMITTED", "AI_PRESCREEN", "OFFICER_REVIEW", "REFERRED"] }, updatedAt: { lt: daysAgo(2) } },
        }), 0);
      if (stale > 0) {
        out.push({
          id: "apps-stale", kind: "pipeline", severity: "attention",
          title: `${stale} application${stale === 1 ? "" : "s"} waiting more than 2 days`,
          body: "Every day here is turnaround time the customer is counting, and a reason to try the lender down the road.",
          count: stale,
          href: "/console/pipeline", actionLabel: "Open the pipeline", weight: 82,
        });
      }
    }

    // ── KYC BACKLOG ──────────────────────────────────────────────────────────
    if (can(rights, "borrowers.view")) {
      const pending = await probe("kyc backlog", () =>
        prisma.borrower.count({ where: { orgId, ...borrowerWhere, erasedAt: null, kycStatus: { in: ["NONE", "IN_PROGRESS", "PENDING_REVIEW"] } } }), 0);
      if (pending > 0) {
        out.push({
          id: "kyc-backlog", kind: "kyc", severity: pending > 5 ? "attention" : "info",
          title: `${pending} customer${pending === 1 ? "" : "s"} waiting on verification`,
          body: "Nobody gets paid out unverified — this queue is the gate between a registered customer and their money.",
          count: pending,
          href: "/console/kyc", actionLabel: "Work the KYC queue", weight: 70,
        });
      }
    }

    // ── RECONCILIATION ───────────────────────────────────────────────────────
    if (can(rights, "reconciliation.view")) {
      const open = await probe("exceptions", () =>
        prisma.reconciliationException.count({ where: { orgId, resolvedAt: null } }), 0);
      if (open > 0) {
        out.push({
          id: "recon-open", kind: "reconciliation", severity: open > 10 ? "critical" : "attention",
          title: `${open} payment${open === 1 ? "" : "s"} haven't matched a loan`,
          body: "Real money that arrived and hasn't landed anywhere. Until it does, someone's balance is wrong.",
          count: open,
          href: "/console/reconciliation", actionLabel: "Reconcile them", weight: 95,
        });
      }
    }

    // ── FLOAT ────────────────────────────────────────────────────────────────
    // Not a threshold we invented: the float is compared to what is actually
    // approved and waiting to go out, because "low" only means anything relative
    // to what you have promised.
    if (can(rights, "float.view")) {
      const [last, queued] = await probe("float", () => Promise.all([
        prisma.floatLedger.findFirst({ where: { orgId }, orderBy: { createdAt: "desc" }, select: { balanceAfter: true } }),
        prisma.loanApplication.aggregate({
          _sum: { amountRequested: true },
          where: { orgId, status: "APPROVED" },
        }),
      ]), [null, { _sum: { amountRequested: null } }] as const);

      const balance = Number(last?.balanceAfter ?? 0);
      const committed = Number(queued._sum.amountRequested ?? 0);
      if (last && committed > 0 && balance < committed) {
        out.push({
          id: "float-short", kind: "float", severity: "critical",
          title: "Your float won't cover what's approved",
          body: `${kes(balance)} on hand against ${kes(committed)} approved and waiting. Top up before the first payout fails.`,
          amount: kes(committed - balance),
          href: "/console/disbursements", actionLabel: "Top up float", weight: 99,
        });
      } else if (last && balance <= 0) {
        out.push({
          id: "float-empty", kind: "float", severity: "critical",
          title: "Your float is empty",
          body: "No money can leave until it is topped up. Approvals will queue and disbursements will fail.",
          href: "/console/disbursements", actionLabel: "Top up float", weight: 98,
        });
      }
    }

    // ── DISBURSEMENTS WAITING ON A SECOND PAIR OF EYES ───────────────────────
    if (can(rights, "disbursements.view")) {
      const waiting = await probe("disbursement queue", () =>
        prisma.disbursement.count({ where: { orgId, state: "PENDING_CHECKER" } }), 0);
      if (waiting > 0) {
        out.push({
          id: "disb-waiting", kind: "disbursement", severity: "attention",
          title: `${waiting} payout${waiting === 1 ? "" : "s"} waiting to be confirmed`,
          body: "Initiated and unconfirmed. Maker-checker means somebody other than the initiator has to release these.",
          count: waiting,
          href: "/console/disbursements", actionLabel: "Review payouts", weight: 86,
        });
      }
    }

    // ── CUSTOMERS WITH NO PIN ────────────────────────────────────────────────
    if (can(rights, "field.view") && ctx.features.has("route-planner")) {
      // Same definition the Needs Location screen uses: no business pin AND no home
      // pin. Two places answering "unpinned" differently is how a worklist stops
      // being believed, so this reads the borrower's own columns, not the GeoPin log.
      const unpinned = await probe("unpinned", () =>
        prisma.borrower.count({
          where: { orgId, ...borrowerWhere, erasedAt: null, lat: null, homeLat: null },
        }), 0);
      if (unpinned > 0) {
        out.push({
          id: "no-location", kind: "field", severity: "info",
          title: `${unpinned} customer${unpinned === 1 ? "" : "s"} have no location`,
          body: "Invisible to route planning and to dispatch. Capture the pin on the next visit.",
          count: unpinned,
          href: "/console/field/needs-location", actionLabel: "See the list", weight: 40,
        });
      }
    }

    // ── GUARANTEES ABOUT TO LAPSE ────────────────────────────────────────────
    if (can(rights, "applications.view")) {
      const lapsing = await probe("guarantees", () =>
        prisma.guarantor.count({
          where: { orgId, status: "INVITED", expiresAt: { gte: new Date(), lte: daysAhead(3) } },
        }), 0);
      if (lapsing > 0) {
        out.push({
          id: "surety-lapsing", kind: "surety", severity: "attention",
          title: `${lapsing} guarantee${lapsing === 1 ? "" : "s"} expire${lapsing === 1 ? "s" : ""} within 3 days`,
          body: "An unsigned guarantee past its window is coverage you don't actually have. Chase the signature.",
          count: lapsing,
          href: "/console/sureties", actionLabel: "Chase signatures", weight: 78,
        });
      }
    }

    // ── THE OPPORTUNITY SIDE ─────────────────────────────────────────────────
    // A tray that only ever brings bad news gets closed. This is the one that
    // makes money rather than saving it, and it is just as much a counted row.
    if (can(rights, "loans.apply")) {
      const ready = await probe("ready to lend", () =>
        prisma.borrower.count({
          where: {
            orgId, ...borrowerWhere, erasedAt: null, kycStatus: "VERIFIED",
            loanLimit: { gt: 0 },
            loans: { none: { status: { in: ["ACTIVE", "PENDING_DISBURSEMENT"] } } },
          },
        }), 0);
      if (ready > 0) {
        out.push({
          id: "ready-to-lend", kind: "growth", severity: "opportunity",
          title: `${ready} verified customer${ready === 1 ? "" : "s"} carry a limit and no loan`,
          body: "Already scored, already verified, nothing running. This is the cheapest lending you will do all month.",
          count: ready,
          href: "/console/borrowers", actionLabel: "See who", weight: 60,
        });
      }

      const unscored = await probe("unscored", () =>
        prisma.borrower.count({
          where: { orgId, ...borrowerWhere, erasedAt: null, kycStatus: "VERIFIED", creditScore: null },
        }), 0);
      if (unscored > 0 && ctx.features.has("statement-cruncher")) {
        out.push({
          id: "unscored", kind: "growth", severity: "opportunity",
          title: `${unscored} verified customer${unscored === 1 ? "" : "s"} have never been scored`,
          body: "Verified but no statement crunched, so nothing can be offered to them yet.",
          count: unscored,
          href: "/console/crunch", actionLabel: "Crunch a statement", weight: 55,
        });
      }
    }
  });

  // ── SETUP ──────────────────────────────────────────────────────────────────
  // Outside the scope block because it is about the lender, not the book. A lender
  // still being configured has exactly one thing worth being told, and it outranks
  // everything: nothing else on this list matters if they cannot lend yet.
  if (can(rights, "settings.view") || can(rights, "products.view")) {
    const setup = await probe("setup", () => setupState(orgId), null);
    if (setup?.next) {
      out.unshift({
        id: `setup-${setup.next.href}`, kind: "setup", severity: "critical",
        title: setup.next.title,
        body: setup.next.why,
        href: setup.next.href, actionLabel: setup.next.title, weight: 120,
      });
    }
  }

  out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.weight - a.weight);
  return out.slice(0, limit);
}

/** What the badge on the app icon says. Critical and attention only — an opportunity is not a debt. */
export const badgeCount = (signals: Signal[]): number =>
  signals.filter((s) => s.severity === "critical" || s.severity === "attention").length;
