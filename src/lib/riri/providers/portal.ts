// ─────────────────────────────────────────────────────────────────────────────
// THE PORTAL HOST — Riri, standing in front of one customer and their own row.
//
// Riri Ecosystem AI plan, §02 Contract 1: "Already implemented by providers/lms.ts.
// Needs two more: servicesuite.ts (over the read-only relay) and portal.ts (the
// customer, one row — their own)." This is the second.
//
// The difference from the LMS host is the whole design: an officer's Riri may be
// pointed at any customer the officer's scope admits; a customer's Riri may be
// pointed at exactly ONE person, and that person is decided by the phone the
// session proved — never by an id in a request. So `subject()` ignores the id it
// is handed unless it is the caller's own, and there is no `book()` beyond
// themselves. There is no memory either: a customer's conversation is not an
// officer's working notes, and remembering it between sessions is a data
// protection question this host does not answer by default.
//
// The tools below are the customer rows of the plan's Table 4. Each calls `gate()`
// at the top of its body — the check is in the tool, not the prompt.
// ─────────────────────────────────────────────────────────────────────────────
import type { ResolvedOrg } from "@/lib/tenancy";
import type { BorrowerSession } from "@/lib/portal/session";
import { readPosition, type CustomerPosition } from "@/lib/portal/position";
import { readRiriConfig } from "@/lib/config/store";
import type { RiriHost, RiriActor, RiriSubjectFacts } from "../host";
import { gate, toolSpec, type ToolRefusal } from "../core/tools";
import { resolveScreen, type RiriContext, type RiriLang } from "../core/context";
import { APP_SCREENS } from "../portal/app-map";
import { customerPacks, type ServedPack } from "../portal/corpus";
import type { CustomerFacts } from "../portal/first-response";
import type { Pack } from "../pack";

export type PortalHost = RiriHost & {
  context: RiriContext;
  /** customer.record — the one read every money answer stands on. */
  record(): Promise<CustomerFacts | ToolRefusal>;
  /** The server-side borrower id, for filing an escalation. Never sent to a client. */
  borrowerId(): Promise<string | null>;
  /** Tier B + platform packs this customer may retrieve. */
  packs(): Promise<ServedPack[]>;
  /** Whether this lender has Riri answering first. */
  firstResponseEnabled(): Promise<boolean>;
  assistantName(): Promise<string>;
};

export function portalHost(args: {
  org: ResolvedOrg;
  session: BorrowerSession;
  route?: string | null;
  lang?: RiriLang;
  nationalId?: string | null;
}): PortalHost {
  const { org, session } = args;

  const context: RiriContext = {
    system: "app",
    surface: "customer-dock",
    audience: "customer",
    tenant: org.id,
    tenantName: org.name,
    actor: { kind: "customer", id: null, name: null },
    screen: resolveScreen(APP_SCREENS, args.route),
    route: args.route ?? null,
    subject: null,
    lang: args.lang ?? "en",
    // The proven phone is the consent for the customer's own record. See core/tools.ts.
    consentRef: null,
  };

  // One read per request, however many tools ask. Home and Riri share the function;
  // within a request they share the result.
  let position: Promise<CustomerPosition> | null = null;
  const pos = () => (position ??= readPosition(org, session, args.nationalId));

  let config: ReturnType<typeof readRiriConfig> | null = null;
  const cfg = () => (config ??= readRiriConfig(org.id));

  return {
    orgId: org.id,
    lenderName: org.name,
    context,

    async actor(): Promise<RiriActor> {
      const p = await pos();
      return { id: null, name: p.firstName, roleTitle: "Customer", branch: null, rights: new Set() };
    },

    async subject(kind: string): Promise<RiriSubjectFacts | null> {
      // The id argument is deliberately unread: a customer's subject is themselves.
      if (kind !== "borrower") return null;
      const p = await pos();
      if (p.erased) return { kind: "borrower", id: "self", label: "you", lines: ["Record erased"], restricted: true };
      return { kind: "borrower", id: "self", label: p.firstName ?? "you", lines: [] };
    },

    async book(): Promise<string[]> {
      return [];
    },

    async recall() {
      return [];
    },

    async remember() {
      /* no customer memory — see the header */
    },

    async record() {
      const refused = gate(toolSpec("customer.record")!, context);
      if (refused) return refused;
      const { borrowerId: _id, erased: _erased, ...facts } = await pos();
      void _id; void _erased;
      return facts;
    },

    async borrowerId() {
      return (await pos()).borrowerId;
    },

    async packs() {
      const doc = await cfg().catch(() => null);
      const published: Pack[] = doc?.value.packs ?? [];
      return customerPacks(org.slug, published);
    },

    async firstResponseEnabled() {
      const doc = await cfg().catch(() => null);
      return doc?.value.customer.firstResponse ?? true;
    },

    async assistantName() {
      const doc = await cfg().catch(() => null);
      return doc?.value.member.assistantName || "Riri";
    },
  };
}

export const isRefusal = (x: unknown): x is ToolRefusal =>
  Boolean(x && typeof x === "object" && (x as { ok?: unknown }).ok === false && "tool" in (x as object));
