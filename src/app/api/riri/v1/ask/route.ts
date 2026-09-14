// ─────────────────────────────────────────────────────────────────────────────
// POST /api/riri/v1/ask — the only endpoint a partner ever calls.
//
// Riri Ecosystem AI plan §02:
//
//   x-riri-org  KE/LENDER/<KRA PIN>
//   x-riri-ts   1757577600000
//   x-riri-sig  HMAC-SHA256 hex over `${ts}.${exact body}`
//   { "question": "...",
//     "context": { "surface": "partner-embed", "screen": "/loans/4821",
//                  "subject": { "kind": "borrower", "id": "..." }, "lang": "auto" },
//     "consent_ref": "cr_..." }                 # required for anything about a person
//
//   → { answer, engine, evidence, sql, actions, sources: [{ pack, version }], confidence }
//
// WHAT A PARTNER'S RIRI GETS, AND WHAT IT DOES NOT (founder's decision, 11 Sep):
// their own knowledge packs and the platform's document packs. NOT our console's
// system map, NOT our metric definitions, NOT another member's packs. So `actions`
// is always empty here — a tenant pack cannot produce a navigation action, and a
// partner's screens are theirs to publish.
//
// ANYTHING ABOUT A PERSON refuses without a consent_ref, checked here before any
// read. Record tools over a partner's own book arrive with their relay host; until
// then a subject question answers 501 and says so, rather than answering from
// knowledge as though the person had been looked at.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { verify } from "@/lib/enterprise/relay";
import { resolveOrg } from "@/lib/tenancy";
import { enterOrg } from "@/lib/db/context";
import { readRiriConfig } from "@/lib/config/store";
import { partnerFor, PARTNER_ORG_HEADER, PARTNER_SIG_HEADER, PARTNER_TS_HEADER } from "@/lib/riri/partner";
import { AUDIENCE_OF, type RiriSurface } from "@/lib/riri/core/context";
import { servedPacks, searchCorpus } from "@/lib/riri/portal/corpus";
import { customerLang } from "@/lib/riri/portal/first-response";
import { checkTraps, mustRefuse } from "@/lib/riri/traps";
import { logRiriQuery } from "@/lib/riri/log";

export const runtime = "nodejs";

const SURFACES: RiriSurface[] = ["partner-embed", "customer-dock", "ussd", "voice"];

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const partner = partnerFor(req.headers.get(PARTNER_ORG_HEADER));
  const ts = req.headers.get(PARTNER_TS_HEADER) ?? "";
  const sig = req.headers.get(PARTNER_SIG_HEADER) ?? "";

  // One answer for every authentication failure: an endpoint that says WHICH part
  // was wrong is a map for somebody guessing member codes.
  if (!partner || !ts || !sig || raw.length > 20_000 || !verify(partner.secret, ts, raw, sig)) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  let body: { question?: unknown; context?: { surface?: unknown; screen?: unknown; subject?: unknown; lang?: unknown }; consent_ref?: unknown };
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const question = typeof body.question === "string" ? body.question.trim().slice(0, 500) : "";
  if (!question) return NextResponse.json({ error: "question_required" }, { status: 400 });

  const surface: RiriSurface = SURFACES.includes(body.context?.surface as RiriSurface) ? (body.context!.surface as RiriSurface) : "partner-embed";
  const audience = AUDIENCE_OF[surface] === "customer" ? "customer" : "staff";
  const subject = body.context?.subject && typeof body.context.subject === "object" ? body.context.subject : null;
  const consentRef = typeof body.consent_ref === "string" && /^cr_[A-Za-z0-9_-]{6,80}$/.test(body.consent_ref) ? body.consent_ref : null;

  // Consent lives in the tool body — checked before anything about a person is read.
  if (subject && !consentRef) {
    return NextResponse.json({ error: "consent_required", message: "A question about a person needs a consent_ref from the Consent Center." }, { status: 403 });
  }
  if (subject) {
    return NextResponse.json({ error: "record_tools_unavailable", message: "Record tools over your own book are not enabled for this member yet. Ask without a subject for knowledge answers." }, { status: 501 });
  }

  const org = await resolveOrg(partner.orgSlug);
  if (!org) return NextResponse.json({ error: "member_not_found" }, { status: 404 });
  enterOrg(org.id);

  const refusal = mustRefuse(checkTraps(question));
  const lang = body.context?.lang === "sw" || body.context?.lang === "en" ? body.context.lang : customerLang(question);
  const cfg = await readRiriConfig(org.id).catch(() => null);
  const packs = servedPacks(org.slug, cfg?.value.packs ?? [], audience);
  const top = refusal ? null : searchCorpus(question, lang, packs, 1, false)[0] ?? null;

  const answer = refusal
    ? refusal.trap.say
    : top
      ? top.kind === "article" ? `${top.title}\n\n${top.body}` : `${top.entry.answer}${top.entry.url ? `\n\nMore: ${top.entry.url}` : ""}`
      : lang === "sw"
        ? `Sina jibu la hilo kwenye maarifa ya ${org.name}.`
        : `I don't have an answer for that in ${org.name}'s knowledge.`;

  void logRiriQuery({
    orgId: org.id, staffId: null, model: "partner", question,
    route: refusal ? "refused" : top ? "knowledge" : "partner:none",
    metricId: top?.sourceId ?? null, ok: Boolean(top) && !refusal,
  });

  return NextResponse.json({
    answer,
    engine: "support",
    evidence: refusal ? "Refused — the underlying data cannot answer this" : top ? "Answered from a knowledge pack" : "No knowledge entry matched",
    sql: null,
    actions: [],
    sources: top && top.kind === "pack"
      ? [{ pack: top.served.ref.pack, version: top.served.ref.version, authority: top.served.ref.authority, starter: top.served.ref.starter }]
      : [],
    confidence: refusal ? "certain" : top ? (top.score >= 30 ? "certain" : "likely") : "unsure",
  });
}
