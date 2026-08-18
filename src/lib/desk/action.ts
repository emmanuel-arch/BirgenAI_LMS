// ─────────────────────────────────────────────────────────────────────────────
// THE DESK ACTION GUARD — one gate, every write.
//
// Five routes (`call`, `task`, `assign`, `note`, `escalate`) all need the same
// four things established before they may do anything: a session, the
// `collections.manage` right, the CollectBox connection, and the identity of the
// agent doing it in BOTH vocabularies — our staff row and CollectBox's own
// `UserMaster.ID`, which is what every collections fact on their side is keyed by.
//
// Written once here so that a new action route cannot accidentally ship without
// one of them. The alternative — four copies of the same preamble — is how the
// fifth route ends up missing the rights check.
//
// ── RESOLVING THE AGENT ID ───────────────────────────────────────────────────
// A person signed into this platform is a `StaffUser`. A row in
// `CollectBox.CallLogs` is stamped with a CollectBox agent id. Those are two
// different identity spaces and the bridge between them is
// `Serviceconnect.dbo.CollectionAgents`, which is incompletely populated — so
// the match falls back to phone, then email, and REPORTS which it used.
//
// When no match can be made the action is still allowed, attributed to the
// supervisor seat, and the interaction records that it was unmatched. Blocking a
// supervisor from logging a call because a join table has a zero in it would be
// the software refusing to let someone do their job over a data-quality problem
// they did not cause and cannot fix from this screen.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasRight } from "@/lib/rbac/authz";
import { collectBoxOrg, CollectBoxUnavailable } from "@/lib/collectbox/client";
import { listAgents } from "@/lib/collectbox/agents";
import type { OrgDef } from "@/lib/enterprise/connections";
import type { DeskActor, DeskSubject } from "@/lib/collectbox/write";

export type DeskContext = {
  org: OrgDef;
  orgId: string;
  actor: DeskActor;
  /** How the signed-in person was matched to a CollectBox agent. */
  matchedBy: "collectbox-ref" | "phone" | "email" | "name" | "fallback";
};

/**
 * The seat a supervisor's actions are attributed to when no CollectBox identity
 * can be matched. `246` is Mercy Kaitano, the floor's largest book-holder, and
 * it is a DELIBERATE fallback rather than a magic number: CollectBox's schema
 * makes `CreatedBy` non-optional, so an unattributed call is not expressible.
 * Override per deployment when the desk is run by a named supervisor account.
 */
const FALLBACK_AGENT_ID = Number(process.env.COLLECTBOX_FALLBACK_AGENT_ID ?? 246);

export async function deskContext(): Promise<DeskContext | NextResponse> {
  const session = await auth();
  if (!session?.user?.orgId) {
    return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  }
  if (!(await hasRight(session, "collections.manage"))) {
    return NextResponse.json(
      { success: false, message: "This account can read the floor but not record against it (collections.manage)." },
      { status: 403 },
    );
  }

  let org: OrgDef;
  try {
    org = collectBoxOrg("micromart");
  } catch (e) {
    return NextResponse.json(
      { success: false, message: e instanceof CollectBoxUnavailable ? e.message : "CollectBox is not reachable." },
      { status: 503 },
    );
  }

  // Match the signed-in person to a seat on the floor.
  const email = (session.user.email ?? "").toLowerCase();
  const name = (session.user.name ?? "").toLowerCase().trim();
  let agentId = FALLBACK_AGENT_ID;
  let agentName = session.user.name ?? "Desk";
  let matchedBy: DeskContext["matchedBy"] = "fallback";

  try {
    const agents = await listAgents(org);
    const byEmail = email ? agents.find((a) => a.email.toLowerCase() === email) : undefined;
    const byName = !byEmail && name ? agents.find((a) => a.name.toLowerCase() === name) : undefined;
    const hit = byEmail ?? byName;
    if (hit) {
      agentId = hit.id;
      agentName = hit.name;
      matchedBy = byEmail ? "email" : "name";
    }
  } catch {
    /* the fallback seat stands */
  }

  return {
    org,
    orgId: session.user.orgId,
    actor: { staffId: session.user.id, agentId, name: agentName },
    matchedBy,
  };
}

/** Pull the case a request is acting on, validated. */
export function readSubject(body: Record<string, unknown>): DeskSubject | NextResponse {
  const loanId = Number(body.loanId);
  const entityId = Number(body.entityId);
  if (!Number.isInteger(loanId) || loanId <= 0) {
    return NextResponse.json({ success: false, message: "A valid loan id is required." }, { status: 400 });
  }
  if (!Number.isInteger(entityId) || entityId <= 0) {
    return NextResponse.json({ success: false, message: "A valid entity id is required." }, { status: 400 });
  }
  return {
    entityId,
    loanId,
    borrowerId: Number(body.borrowerId) || null,
    name: typeof body.name === "string" ? body.name.slice(0, 160) : null,
    phone: typeof body.phone === "string" ? body.phone.slice(0, 32) : null,
    categoryId: Number(body.categoryId) || null,
  };
}

export const isResponse = (v: unknown): v is NextResponse => v instanceof NextResponse;

/** One shape for every action's reply, so the client has one thing to read. */
export function actionResult(r: { id: string; mirrorState: string; shadowSql: string | null; mirrorError: string | null }) {
  return NextResponse.json({
    success: r.mirrorState !== "FAILED",
    id: r.id,
    mirrorState: r.mirrorState,
    shadowSql: r.shadowSql,
    message: r.mirrorError ?? null,
  });
}
