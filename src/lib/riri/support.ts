// ─────────────────────────────────────────────────────────────────────────────
// RIRI SUPPORT — the answer, and the offer to act on it.
//
// The difference between this and a chatbot bolted onto a help centre is that Riri
// knows THREE things at once when she answers:
//
//   WHO IS ASKING   — their rights, so she never explains a screen they cannot open.
//                     A loan officer who asks "how do I change the interest rate" gets
//                     told who to ask, not a walkthrough he will fail halfway through.
//   WHAT THEY BOUGHT — their plan, so a feature they do not have is named honestly as
//                     an upgrade rather than sending them into a paywall they did not
//                     see coming.
//   WHERE THEY ARE  — how far their lender is through setup, so "what do I do now"
//                     has a real answer on day one instead of a menu.
//
// AND SHE OFFERS TO ACT. An answer ends in a destination, not in "navigate to Products".
// The consent model is deliberate and it is the founder's: Riri PROPOSES, a human
// ACCEPTS. She will take you somewhere; she will not do the thing for you. Nothing here
// moves money, changes a permission or touches a borrower — an assistant that can act
// unasked in a lending system is not a feature, it is an incident waiting for a
// misheard sentence. (The voice path makes that risk concrete: speech recognition
// mishears, and "delete" and "default" are two syllables apart.)
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "@/lib/prisma";
import { runWithOrg } from "@/lib/db/context";
import { cheapestPlanWith } from "@/lib/billing/plans";
import { search, articlesFor, type Article } from "./knowledge";

/** Something Riri offers to do. She never does it herself — the user taps. */
export type SupportAction = {
  kind: "navigate";
  label: string;
  href: string;
};

export type SupportAnswer = {
  answer: string;
  /** What she is offering to do about it. */
  actions: SupportAction[];
  /** Which article answered — for the query log, and for "was this useful". */
  articleId?: string;
  /** Follow-ups worth asking, drawn from the same article's neighbours. */
  suggestions: string[];
};

/**
 * How far this lender is through setting themselves up. Read live, because "what do I
 * do next" is a question about the present, and a checklist that lies is worse than no
 * checklist.
 */
export type SetupState = {
  hasStructure: boolean;
  hasProduct: boolean;
  hasWorkflow: boolean;
  hasTeam: boolean;
  hasVault: boolean;
  isActive: boolean;
  /** The next thing worth doing, in the order that actually works. */
  next: { title: string; why: string; href: string } | null;
};

export async function setupState(orgId: string): Promise<SetupState> {
  const [org, branches, products, workflows, staff, vault] = await runWithOrg(orgId, () =>
    Promise.all([
      prisma.org.findUnique({ where: { id: orgId }, select: { status: true } }),
      prisma.branch.count({ where: { orgId } }),
      prisma.product.count({ where: { orgId, isActive: true } }),
      prisma.workflow.count({ where: { orgId } }),
      prisma.staffUser.count({ where: { orgId, status: "ACTIVE" } }),
      prisma.orgIntegration.count({ where: { orgId, status: { in: ["CONFIGURED", "TESTED", "LIVE"] } } }),
    ]),
  );

  const state = {
    hasStructure: branches > 0,
    hasProduct: products > 0,
    hasWorkflow: workflows > 0,
    hasTeam: staff > 1, // one is the founder themselves; a team is two
    hasVault: vault > 0,
    isActive: org?.status === "ACTIVE",
  };

  // The ORDER matters — each step needs the one before it, and telling someone to
  // invite staff before they have a branch to put them in is how a checklist loses trust.
  const next =
    !state.hasStructure ? { title: "Build your structure", why: "Everything else — staff, borrowers, loans — belongs to an office. Start with your head office.", href: "/console/branches" }
      : !state.hasProduct ? { title: "Create a loan product", why: "A product is what you lend: how much, how long, at what rate. Nothing can be applied for until one exists.", href: "/console/products" }
        : !state.hasTeam ? { title: "Invite your team", why: "Give each person a role — it decides what they can do and whose customers they can see.", href: "/console/team" }
          : !state.hasVault ? { title: "Connect your money rails", why: "Your own M-Pesa credentials, so you can collect repayments and pay out loans.", href: "/console/settings" }
            : !state.isActive ? { title: "Request activation", why: "You are configured. Ask us to switch you on and you can lend for real.", href: "/console" }
              : null;

  return { ...state, next };
}

/** The first thing a new admin ever hears from Riri. */
export function welcome(firstName: string | null, orgName: string, setup: SetupState): SupportAnswer {
  const who = firstName ? `, ${firstName}` : "";

  if (setup.next) {
    return {
      answer:
        `Welcome to **${orgName}**${who} 👋 I'm Riri.\n\n` +
        `I'll stay with you the whole way through. You're not set up yet, and there's an order that works — so let's do the next thing:\n\n` +
        `**${setup.next.title}** — ${setup.next.why}\n\n` +
        `Ask me anything at any point: how to price a loan, who can see what, why a payout is blocked. You can talk to me out loud with the microphone if it's easier.`,
      actions: [{ kind: "navigate", label: setup.next.title, href: setup.next.href }],
      suggestions: ["What do I do first?", "How do I create a loan product?", "Who can see whose customers?"],
    };
  }

  return {
    answer:
      `Welcome back${who} 👋\n\n` +
      `**${orgName}** is set up and lending. I can walk you through anything on the platform, explain why something is blocked, or take you straight to the screen you need.\n\n` +
      `For your actual numbers — what you're owed, what you collected, who's about to default — switch me to **Analyst**.`,
    actions: [],
    suggestions: ["How do I apply for a loan on someone's behalf?", "Why can't I disburse this loan?", "How do I chase arrears?"],
  };
}

/** Who to send someone to when the thing they asked about is not theirs to do. */
const NOT_YOURS = (a: Article) =>
  `That one isn't on your access — **${a.title.toLowerCase()}** needs a permission you don't have. Ask an administrator at your lender; they can grant it in Roles & Rights, or just do it for you.`;

/**
 * Answer a support question, for this person, at this lender.
 *
 * Everything Riri is willing to say is in the corpus (knowledge.ts) — so if she does not
 * know, she says she does not know and points at a human. The alternative, which is what
 * a generic model does, is to invent a plausible menu path; and a lender who follows
 * invented instructions and finds nothing there concludes the SOFTWARE is broken, not
 * the assistant.
 */
export async function answerSupport(
  orgId: string,
  question: string,
  ctx: { rights: ReadonlySet<string>; features: ReadonlySet<string>; firstName?: string | null; orgName?: string },
): Promise<SupportAnswer> {
  const q = question.toLowerCase().trim();

  // "What do I do now?" is a question about THIS lender, not about the platform.
  if (/^(what|where)\b.*(next|now|do i (do|start)|should i do)|^(what do i do|where do i start|help me get started|guide me)/.test(q)) {
    const setup = await setupState(orgId);
    if (setup.next) {
      return {
        answer:
          `Here's where you are, and the next thing that matters:\n\n**${setup.next.title}** — ${setup.next.why}\n\n` +
          `After that: ${[
            !setup.hasProduct && "a loan product",
            !setup.hasTeam && "your team",
            !setup.hasVault && "your M-Pesa credentials",
            !setup.isActive && "activation",
          ].filter(Boolean).join(", ") || "you're ready to lend"}.`,
        actions: [{ kind: "navigate", label: setup.next.title, href: setup.next.href }],
        suggestions: ["How do I create a loan product?", "How do I invite my team?", "Why can't I disburse?"],
      };
    }
    return {
      answer: `You're fully set up and active — there's nothing outstanding. Ask me about anything you want to run: taking an application, chasing arrears, paying out a loan.`,
      actions: [],
      suggestions: ["How do I apply for a loan on someone's behalf?", "How do I chase arrears?", "How does scoring work?"],
    };
  }

  const hits = search(q, { rights: ctx.rights, features: ctx.features, limit: 3 });

  if (!hits.length) {
    // The honest failure. She does NOT guess a menu path.
    const canDo = articlesFor(ctx.rights).slice(0, 6).map((a) => a.title.toLowerCase());
    return {
      answer:
        `I don't have an answer for that one, and I'd rather say so than send you to a screen that doesn't exist.\n\n` +
        `I can help with: ${canDo.join(", ")} — and quite a bit more. Try asking it another way, or ask your administrator.\n\n` +
        `If it's about your NUMBERS rather than how the platform works, switch me to **Analyst** — I read your live book there.`,
      actions: [],
      suggestions: ["What do I do next?", "How do I apply for a loan?", "Why can't I disburse this loan?"],
    };
  }

  const top = hits[0];
  const a = top.article;

  // They asked about something real that they are not allowed to do. Say who can.
  if (!top.permitted) {
    return { answer: NOT_YOURS(a), actions: [], articleId: a.id, suggestions: ["Who can see whose customers?", "What can my role do?"] };
  }

  // They asked about something real that their package does not include. Name the price
  // rather than walking them into an upgrade wall.
  if (!top.entitled && a.feature) {
    const plan = cheapestPlanWith(a.feature);
    return {
      answer:
        `**${a.title}** isn't on your package yet.\n\n${a.body}\n\n` +
        (plan
          ? `It comes with **${plan.name}** (KES ${plan.monthlyKes.toLocaleString()}/mo). Your loan book keeps working exactly as it does now either way — packages change which intelligence tools you get, never whether you can lend.`
          : `It isn't available yet.`),
      actions: [{ kind: "navigate", label: "See packages", href: "/console/billing" }],
      articleId: a.id,
      suggestions: ["What do the packages include?", "How do I upgrade?"],
    };
  }

  const steps = a.steps?.length
    ? "\n\n" + a.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")
    : "";

  const related = (a.related ?? [])
    .map((id) => search(id.replace(/-/g, " "), { rights: ctx.rights, features: ctx.features, limit: 1 })[0]?.article)
    .filter(Boolean) as Article[];

  return {
    answer: `**${a.title}**\n\n${a.body}${steps}`,
    actions: a.action ? [{ kind: "navigate", label: a.action.label, href: a.action.href }] : [],
    articleId: a.id,
    suggestions: [
      ...related.slice(0, 2).map((r) => r.asks[0]).filter(Boolean),
      ...hits.slice(1, 2).map((h) => h.article.asks[0]),
    ].slice(0, 3),
  };
}
