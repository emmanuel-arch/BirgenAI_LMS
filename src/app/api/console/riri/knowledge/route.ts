// ─────────────────────────────────────────────────────────────────────────────
// /api/console/riri/knowledge — the training console's workbench.
//
//   GET                                   the starter pack this lender inherits
//   POST { action: "validate", pack }     every problem with a draft, before it is live
//   POST { action: "preview", pack?, question }   what a customer would be told
//   POST { action: "rollback", version }  publish what an earlier version was
//
// Riri Ecosystem AI plan, Sprint 4: "upload a pack, validate it, see what it will
// answer, version it, roll it back … A lender trains Riri on their own JSON without
// us touching anything." Publishing itself goes through the generic, versioned
// /api/config/riri — the same audited path every other lender document uses — so
// this route adds the three things that path does not do, and nothing else.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { requireRight } from "@/lib/rbac/authz";
import { prisma } from "@/lib/prisma";
import { runAsPlatform } from "@/lib/db/context";
import { validatePack, type Pack } from "@/lib/riri/pack";
import { customerPacks, searchCorpus, hitSource, starterPackFor } from "@/lib/riri/portal/corpus";
import { customerLang, firstResponse, type CustomerFacts } from "@/lib/riri/portal/first-response";
import { readRiriConfig, publish, revisionValue } from "@/lib/config/store";
import { ownerFor } from "@/lib/config/riri";

export const runtime = "nodejs";

/** A customer with nothing on file — so a preview shows what the PACKS say, not a balance. */
const NOBODY = (lender: string): CustomerFacts => ({
  found: false, lender, firstName: null, kycStatus: "NONE", bookSource: "onboarding", bookIssue: null,
  limit: 0, outstanding: 0, available: 0, loanCount: 0, activeLoan: null, schedule: [], score: null, scoreMax: 900,
  band: null, scoreTone: null, scoreDrivers: [], avgDailySales: null, savings: null,
  ratiba: { available: false, active: false, amount: null, frequency: null }, unreadMessages: 0, messages: [], application: null,
});

async function orgOf(orgId: string) {
  return runAsPlatform(() => prisma.org.findUnique({ where: { id: orgId }, select: { slug: true, name: true } }));
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const denied = await requireRight(session, "settings.view");
  if (denied) return denied;

  const org = await orgOf(session.user.orgId);
  return NextResponse.json({
    success: true,
    org: org ? { slug: org.slug, name: org.name } : null,
    starter: org ? starterPackFor(org.slug) : null,
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.orgId) return NextResponse.json({ success: false, message: "Sign in." }, { status: 401 });
  const orgId = session.user.orgId;

  let body: { action?: string; pack?: unknown; question?: string; version?: number };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, message: "Invalid request." }, { status: 400 }); }

  if (body.action === "rollback") {
    const denied = await requireRight(session, "settings.manage");
    if (denied) return denied;
    const version = Number(body.version);
    const value = Number.isInteger(version) && version > 0 ? await revisionValue(orgId, "riri", version) : null;
    if (!value) return NextResponse.json({ success: false, message: "That version does not exist." }, { status: 404 });
    const r = await publish(orgId, "riri", value, session.user.id);
    if (!r.ok) return NextResponse.json({ success: false, message: "That version no longer validates.", issues: r.issues }, { status: 422 });
    return NextResponse.json({ success: true, version: r.version, restoredFrom: version, value: r.value });
  }

  const denied = await requireRight(session, "settings.view");
  if (denied) return denied;
  const [org, cfg] = await Promise.all([orgOf(orgId), readRiriConfig(orgId)]);
  if (!org) return NextResponse.json({ success: false, message: "Organisation not found." }, { status: 404 });

  if (body.action === "validate") {
    const r = validatePack(body.pack);
    const issues = r.ok ? [...r.warnings] : [...r.issues];
    if (r.ok && r.pack.authority !== "platform") {
      const pin = cfg.value.member.kraPin;
      if (!pin) issues.push({ at: "owner", level: "error", message: "State your KRA PIN above first — it is who owns these facts." });
      else if (r.pack.owner !== ownerFor(pin)) issues.push({ at: "owner", level: "error", message: `The pack's owner is ${r.pack.owner}; your organisation is ${ownerFor(pin)}.` });
    }
    if (r.ok && r.pack.authority === "platform") issues.push({ at: "authority", level: "error", message: "Platform authority lives in code and cannot be uploaded." });
    const ok = !issues.some((i) => i.level === "error");
    return NextResponse.json({ success: true, ok, issues, entries: r.ok ? r.pack.entries.length : 0 });
  }

  if (body.action === "preview") {
    const question = (body.question ?? "").trim().slice(0, 300);
    if (!question) return NextResponse.json({ success: false, message: "Ask a test question." }, { status: 400 });

    const draft = body.pack ? validatePack(body.pack) : null;
    const published: Pack[] = cfg.value.packs.filter((p) => !(draft?.ok && p.pack === draft.pack.pack));
    const packs = customerPacks(org.slug, [...published, ...(draft?.ok ? [draft.pack] : [])]);
    const lang = customerLang(question);
    const r = firstResponse({ question, facts: NOBODY(org.name), packs, screen: null, lang });
    const hits = searchCorpus(question, lang, packs, 3).map((h) => ({ ...hitSource(h), score: Math.round(h.score), draft: h.kind === "pack" && draft?.ok ? h.served.pack.pack === draft.pack.pack : false }));

    return NextResponse.json({
      success: true,
      // A record question is answered from the customer's own account, whatever a pack says.
      answeredFromRecord: !["knowledge", "open", "navigate", "screen", "greeting", "thanks"].includes(r.intent),
      intent: r.intent,
      outcome: r.outcome,
      answer: r.answer,
      sources: r.sources,
      hits,
    });
  }

  return NextResponse.json({ success: false, message: "Unknown action." }, { status: 400 });
}
