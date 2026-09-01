// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMER 360.
//
// Everything one lender knows about one customer, from BOTH books, on one page.
//
// ── THE TWO BOOKS ────────────────────────────────────────────────────────────
// For a bridged lender this page is a join, and saying which side answered is
// not a footnote — it is the page's main honesty obligation:
//
//   THEIRS (ServiceSuite, read live at render)   the loans, the balances, the
//     arrears register, the whole ledger, the officer, the office trail, the
//     portrait, and the repayment record every score below is computed from.
//   OURS (Postgres)                              KYC and its images, pins and
//     consent, guarantors, applications, interactions, the audit trail, and
//     anything we originated.
//
// The old page read only the second one. So a customer with fourteen loans and
// KSh 125,642 disbursed on the lender's own screen rendered here as "OLB KES 0 ·
// Loans 0/0", with initials where their face should be — because in OUR book they
// were a row created four seconds ago by the resolve step. Everything rendered
// correctly. Nothing rendered the customer.
//
// ── AND THE BAND IS COMPUTED, NOT COPIED ─────────────────────────────────────
// The header tile used to read "INTERNAL SCORE 4500" beside "STATEMENT SCORE
// 4500 / 900", and banded everyone PRIME on the strength of it, because the
// resolve step had copied ServiceSuite's `Borrowers.CreditScore` — a cumulative
// points column that runs to 28 million on this book — into a field the product
// reads as 300–900. Now the score is computed from their actual instalments by
// the same engine a native lender's customers go through, under this lender's own
// published credit policy. Measured across all 17,018 customers of entity 3005 it
// lands within a mean of 0.33 points of the lender's own stored figure.
// ─────────────────────────────────────────────────────────────────────────────
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, BadgeCheck, Building2, CheckCircle2, Clock, History, Landmark,
  Radio, ScanFace, ShieldAlert,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { resolveScope, borrowerScopeWhere } from "@/lib/rbac/scope";
import { prisma } from "@/lib/prisma";
import { hasFeature } from "@/lib/billing/entitlements";
import { resolveOrg } from "@/lib/tenancy";
import { portfolioEarlyWarning } from "@/lib/intelligence/earlywarning";
import { portraitsFor, PORTRAIT_TTL_SEC } from "@/lib/kyc/avatars";
import { signedUrl } from "@/lib/storage/provider";
import { BorrowerAvatar } from "@/components/kyc/BorrowerAvatar";
import type { CrbReport } from "@/lib/crb/provider";
import { MERGED_CRB_ONLY } from "@/lib/crb/rows";
import { Customer360Client } from "./Customer360Client";
import { BorrowerManagePanel } from "./BorrowerMenu";
import { placesOf } from "./places";
import { BorrowerActions } from "./BorrowerActions";
import { RiskBandCard, type RiskView } from "@/components/risk/RiskBandCard";
import { bandForScore, bandForBehavioural, defaultProbability, normaliseBandName, BAND_BY_KEY } from "@/lib/risk/bands";
import { previewLadder } from "@/lib/risk/graduation";
import KycGallery from "./KycGallery";
import { CustomerTimeline, type TimelineEvent } from "./CustomerTimeline";
import { Customer360Workspace, type Section } from "./Customer360Workspace";
import { readLiveCustomer360 } from "@/lib/lms/customer360";
import { readMasterFile } from "@/lib/lms/master-file";
import { MasterFilePanel, masterFileBadge } from "./MasterFilePanel";
import {
  Panel, Provenance, LiveLoans, LiveLedger, ScoreFactors, LadderPanel,
  ScoreComparison, EarlyWarning, PeoplePanel, PlacesPanel, MoneySummary,
  RatibaPanel, type RatibaView,
} from "./Customer360Sections";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fmtKES = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
const num = (d: unknown) => Number(d ?? 0);
const dateFmt = (d: Date | string) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

/** How long they have banked with this lender — whole months, spoken plainly. */
function accountAgeOf(createdAt: Date | string): string {
  const months = Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24 * 30.44)));
  if (months < 12) return `${months} ${months === 1 ? "month" : "months"}`;
  const y = Math.floor(months / 12);
  const m = months % 12;
  return `${y}y${m ? ` ${m}m` : ""}`;
}

const KYC_TONE: Record<string, string> = {
  VERIFIED: "bg-emerald-500/12 text-emerald-700", PENDING_REVIEW: "bg-amber-500/12 text-amber-700",
  IN_PROGRESS: "bg-sky-500/12 text-sky-700", FAILED: "bg-rose-500/12 text-rose-700", NONE: "bg-ash-900/[0.06] text-[color:var(--ink-muted)]",
};

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-ash-900/10 bg-paper/60 px-2.5 py-2">
      <p className="t-label">{label}</p>
      <p className={`text-sm font-bold leading-tight ${tone ?? "text-[color:var(--ink)]"}`}>{value}</p>
    </div>
  );
}

/** The masthead's tile. The numbers an officer prices a customer by, at reading size. */
function BigStat({ label, value, tone, sub }: { label: string; value: string; tone?: string; sub?: string }) {
  return (
    <div className="min-w-[8rem] rounded-xl border border-ash-900/10 bg-paper/60 px-4 py-2.5">
      <p className="t-label">{label}</p>
      <p className={`mt-0.5 text-xl font-bold leading-tight tabular-nums ${tone ?? "text-[color:var(--ink)]"}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-[color:var(--ink-faint)]">{sub}</p>}
    </div>
  );
}

export default async function Customer360({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.orgId) redirect("/login");
  const orgId = session.user.orgId;
  const { id } = await params;

  // A list that filters correctly while the detail page renders any id you type is not
  // a boundary — it is a speed bump. The scope filter goes in THIS query too.
  const scope = await resolveScope(session);

  const b = await prisma.borrower.findFirst({
    where: { id, orgId, ...borrowerScopeWhere(scope) },
    include: {
      loans: { orderBy: { createdAt: "desc" }, include: { product: { select: { name: true } }, installments: { select: { status: true, amountDue: true, amountPaid: true, dueDate: true } } } },
      fieldVisits: { orderBy: { createdAt: "desc" }, take: 5, include: { agent: { select: { firstName: true, otherName: true } } } },
      applications: { select: { id: true, status: true }, orderBy: { createdAt: "desc" }, take: 5 },
    },
  });
  if (!b) redirect("/console/borrowers");

  // Early-warning is a Premium engine — don't even run it for a plan that hasn't
  // bought it, let alone render its output.
  const [scanEntitled, fieldEntitled] = await Promise.all([
    hasFeature(orgId, "portfolio-scan"),
    hasFeature(orgId, "route-planner"),
  ]);
  const [kyc, scores, crbCheck, ew, branch, guarantors, standingOrders] = await Promise.all([
    prisma.kycSession.findFirst({ where: { orgId, OR: [{ borrowerId: id }, { phone: b.phone }] }, orderBy: { createdAt: "desc" } }),
    prisma.scoreSnapshot.findMany({ where: { orgId, borrowerId: id }, orderBy: { createdAt: "desc" }, take: 8 }),
    // MERGED_CRB_ONLY: the master file now also stores individual Metropol
    // reports as CRB rows, and this panel wants the lender's whole merged file —
    // without the filter a raw report-22 payload would win on recency and render
    // as if it were the bureau's verdict.
    prisma.kycCheck.findFirst({ where: { orgId, borrowerId: id, kind: "CRB", ...MERGED_CRB_ONLY }, orderBy: { createdAt: "desc" } }),
    scanEntitled ? portfolioEarlyWarning(orgId) : null,
    // Where they sit in the book, said the way the org says it: the branch plus its
    // ancestors up to the head office (three levels covers every real tree we hold).
    b.branchId
      ? prisma.branch.findFirst({
          where: { id: b.branchId, orgId },
          select: { name: true, levelName: true, parent: { select: { name: true, levelName: true, parent: { select: { name: true, levelName: true } } } } },
        })
      : null,
    // The people standing behind their money. They hang off applications, but an
    // officer asks the question about the PERSON, which is why the row is
    // denormalised onto the borrower in the first place.
    prisma.guarantor.findMany({
      where: { orgId, borrowerId: id },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, fullName: true, phone: true, relationship: true, status: true },
    }),
    // M-PESA Ratiba. The table, the Daraja call and the callback have existed
    // for months with no console surface at all — so the officer on the phone
    // about a late instalment could not see whether this customer had a standing
    // order that should have collected it.
    prisma.standingOrder.findMany({
      where: { orgId, borrowerId: id },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, status: true, amount: true, frequency: true, startDate: true, endDate: true, simulated: true, createdById: true },
    }).catch(() => []),
  ]);
  const risk = ew?.rows.find((r) => r.borrowerId === id) ?? null;
  const initialCrb = (crbCheck?.payload as unknown as CrbReport) ?? null;

  // ── THE LENDER'S OWN BOOK ───────────────────────────────────────────────────
  // Everything above is ours. This is theirs, and for a bridged lender it is most
  // of what the page is actually about. Non-fatal by construction: a lender whose
  // database is unreachable still gets a working Customer 360 of what WE hold,
  // with the live sections absent and said to be absent — which is the only
  // honest degradation, because a zero here reads as "they owe nothing".
  const org = session.user.orgSlug ? await resolveOrg(session.user.orgSlug) : null;
  const bridged = !!(org?.mode === "BRIDGED" && org.bridgedReady && org.registry && org.entityId);
  const live = bridged
    ? await readLiveCustomer360(
        org!.registry!,
        org!.entityId,
        { serviceSuiteBorrowerId: b.serviceSuiteBorrowerId, phone: b.phone },
        orgId,
      ).catch(() => null)
    : null;

  // ── THE MASTER FILE ─────────────────────────────────────────────────────────
  // Every scrutiny this ecosystem has ever obtained about this person, composed
  // from the systems that already own each one. It is read AFTER the live block
  // because the repayment record is the single heaviest piece of evidence in it,
  // and that comes from the lender's own schedule.
  const masterFile = await readMasterFile(orgId, id, {
    behaviour: live?.behaviour ?? null,
    hasLiveBook: !!live,
  }).catch(() => null);

  // ── Customer timeline: interactions + limit + score + approval history ────────
  // Merged from the live tables into one spine; interactions are activity rows so a
  // logged disposition needs no schema change and also shows in Oversight.
  const [gradEvents, calls, activity, staffRows, apps] = await Promise.all([
    prisma.graduationEvent.findMany({ where: { orgId, borrowerId: id }, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.collectionCall.findMany({ where: { orgId, borrowerId: id }, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.auditLog.findMany({ where: { orgId, entityId: id, action: { in: ["borrower.interaction", "borrower.limit-allocated", "borrower.limit", "borrower.score"] } }, orderBy: { createdAt: "desc" }, take: 40 }),
    prisma.staffUser.findMany({ where: { orgId }, select: { id: true, firstName: true, otherName: true } }),
    prisma.loanApplication.findMany({ where: { orgId, borrowerId: id }, select: { id: true, status: true, decision: true, amountRequested: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  const staffNm = new Map(staffRows.map((s) => [s.id, `${s.firstName ?? ""} ${s.otherName ?? ""}`.trim() || "Staff"]));
  const kesT = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
  const timeline: TimelineEvent[] = [];
  for (const g of gradEvents) timeline.push({ id: `g-${g.id}`, kind: "limit", at: g.createdAt.toISOString(), title: `Limit raised to ${kesT(Number(g.newLimit))}`, detail: `from ${kesT(Number(g.previousLimit))} · ${g.riskBand} ${Math.round(g.riskScore)}/100`, actor: g.decidedBy === "cron" ? "graduation engine" : (g.decidedBy ? staffNm.get(g.decidedBy) ?? null : null), tone: "up" });
  for (const s of scores) timeline.push({ id: `s-${s.id}`, kind: "score", at: s.createdAt.toISOString(), title: `Scored ${s.score ?? "—"}${s.riskBand ? ` (${s.riskBand})` : ""}`, detail: `${s.modelKind} · ${s.modelVersion}`, actor: s.capturedBy ?? null });
  for (const a of apps) timeline.push({ id: `a-${a.id}`, kind: "approval", at: a.createdAt.toISOString(), title: `Application ${a.status.replace(/_/g, " ").toLowerCase()}`, detail: `${kesT(Number(a.amountRequested))}${a.decision ? ` · ${a.decision}` : ""}` });
  for (const c of calls) timeline.push({ id: `c-${c.id}`, kind: "interaction", at: c.createdAt.toISOString(), title: `Call — ${c.outcome.replace(/_/g, " ").toLowerCase()}`, detail: c.note, actor: staffNm.get(c.createdBy) ?? null });
  for (const ev of activity) {
    const m = (ev.meta ?? {}) as Record<string, unknown>;
    const actor = ev.actorId ? staffNm.get(ev.actorId) ?? null : null;
    if (ev.action === "borrower.interaction") timeline.push({ id: `i-${ev.id}`, kind: "interaction", at: ev.createdAt.toISOString(), title: String(m.disposition ?? "Interaction"), detail: [m.channel, m.note].filter(Boolean).join(" · ") || null, actor });
    else if (ev.action === "borrower.limit-allocated") timeline.push({ id: `l-${ev.id}`, kind: "limit", at: ev.createdAt.toISOString(), title: `Starting limit ${kesT(Number(m.startingLimit ?? 0))}${m.tier ? ` · ${m.tier}` : ""}`, detail: Array.isArray(m.reasons) && m.reasons[0] ? String((m.reasons[0] as { detail?: string }).detail ?? "") : null, actor, tone: "up" });
    else if (ev.action === "borrower.limit") timeline.push({ id: `l-${ev.id}`, kind: "limit", at: ev.createdAt.toISOString(), title: "Limit override", detail: String(m.note ?? m.reason ?? "") || null, actor });
    else if (ev.action === "borrower.score") timeline.push({ id: `sc-${ev.id}`, kind: "score", at: ev.createdAt.toISOString(), title: "Score adjusted", detail: String(m.note ?? "") || null, actor });
  }
  timeline.sort((a, b) => b.at.localeCompare(a.at));
  const timelineTop = timeline.slice(0, 40);

  const name = `${b.firstName ?? "Borrower"}${b.otherName ? " " + b.otherName : ""}`.trim();
  const verified = b.kycStatus === "VERIFIED";
  const accountAge = accountAgeOf(b.createdAt);

  // Root-first placement chain: Head Office → Region → Branch. Ours where we have
  // it; the lender's own office trail where we do not, which for a bridged book is
  // almost always — their tree is the real one and ours is a stub.
  type BranchNode = { name: string; levelName: string; parent?: BranchNode | null };
  const branchChain: { name: string; levelName: string }[] = [];
  for (let n = branch as BranchNode | null; n; n = n.parent ?? null) branchChain.unshift({ name: n.name, levelName: n.levelName });
  const officeTrail = branchChain.length
    ? branchChain.map((n) => n.name)
    : (live?.profile.officeTrail ?? []).map((n) => n.unit);

  // ── THE FACE ────────────────────────────────────────────────────────────────
  // Three sources, in order of how much we trust them, and the third is the fix:
  //   1. the portrait promoted onto the Borrower row at KYC attach
  //   2. the one still only on the KYC session (itself a finding)
  //   3. THE LENDER'S OWN PHOTO — 13,403 of entity 3005's 17,021 customers have
  //      one, which is exactly why the borrower LIST showed faces while this page
  //      showed initials: the list read their book and this page never did.
  const portraitUrl = (await portraitsFor([b.id]))[b.id]
    ?? (kyc?.portraitKey ? await signedUrl(kyc.portraitKey, PORTRAIT_TTL_SEC) : null)
    ?? live?.profile.photoUrl
    ?? null;

  // ── The numbers, live where a live book answered ───────────────────────────
  const liveLoans = live?.statement?.loans ?? [];
  const olb = live
    ? liveLoans.filter((l) => l.status === "ACTIVE").reduce((s, l) => s + l.balance, 0)
    : b.loans.filter((l) => l.status === "ACTIVE").reduce((s, l) => s + num(l.balance), 0);
  const loansTotal = live ? liveLoans.length : b.loans.length;
  const loansActive = live ? liveLoans.filter((l) => l.status === "ACTIVE").length : b.loans.filter((l) => l.status === "ACTIVE").length;
  const clearedCount = live ? liveLoans.filter((l) => l.status === "CLEARED").length : b.loans.filter((l) => l.status === "CLEARED").length;
  const loanLimit = live?.profile.loanLimit ?? (b.loanLimit != null ? Number(b.loanLimit) : null);
  const arrearsTotal = liveLoans.reduce((s, l) => s + (l.arrears || 0), 0);
  const worstDpd = liveLoans.reduce((m, l) => Math.max(m, l.daysInArrears ?? 0), 0);

  // ── WHAT THIS CUSTOMER IS ───────────────────────────────────────────────────
  // The live behavioural score wins outright where we have one, because it was
  // computed a second ago from their real instalments under this lender's own
  // policy. Everything below it is the fallback ladder for a native customer, or
  // for a live book that did not answer.
  const liveBehaviour = live?.behaviour ?? null;
  const liveScore = liveBehaviour?.scored ? liveBehaviour.score : null;
  const bandFromLive = liveBehaviour?.category ? BAND_BY_KEY.get(normaliseBandName(liveBehaviour.category.key) ?? "HIGH") ?? null : null;
  const band =
    bandFromLive
    ?? bandForBehavioural(b.behaviouralScore)
    ?? bandForScore(b.creditScore)
    ?? (b.riskBand ? BAND_BY_KEY.get(normaliseBandName(b.riskBand) ?? "HIGH") ?? null : null);

  const riskView: RiskView = {
    band: band
      ? {
          key: band.key,
          // THE LENDER'S OWN WORD for this category where their policy names one.
          // Micromart publish three ("Minor risk" / "Moderate" / "Major risk") and
          // showing them our "Prime" instead would be renaming their vocabulary on
          // their own screen. The COLOUR and the geometry stay ours.
          label: liveBehaviour?.category?.label ?? band.label,
          meaning: band.meaning,
          from: band.from, to: band.to, ink: band.ink, soft: band.soft, icon: band.icon,
          graduationPercent: liveBehaviour?.category?.graduationPercent ?? band.graduationPercent,
        }
      : null,
    score: b.creditScore,
    behavioural: liveScore ?? b.behaviouralScore,
    pd: defaultProbability(band, liveBehaviour?.pd ?? (scores[0]?.pd != null ? Number(scores[0].pd) : null)),
  };

  // The ladder. Live where the live book answered — it is the same engine either
  // way, but only one of them has seen this customer actually repay anything.
  const graduation = live?.ladder
    ? { eligible: live.ladder.move === "graduate", reason: live.ladder.reason, newLimit: live.ladder.newLimit }
    : clearedCount > 0
      ? await previewLadder(orgId, b.id).then(({ assessment: g }) => ({
          eligible: g.move === "graduate",
          reason: g.reason,
          newLimit: g.newLimit,
        })).catch(() => null)
      : null;

  // Where this account is on the road from walk-in to money.
  const hasScore = b.creditScore != null || scores.length > 0 || liveScore != null;
  const hasApplication = b.applications.length > 0 || loansTotal > 0;
  const hasActive = loansActive > 0 || clearedCount > 0 || b.loans.some((l) => l.status === "PENDING_DISBURSEMENT");
  const journey: { label: string; done: boolean; href?: string }[] = [
    { label: "Registered", done: true },
    { label: "KYC verified", done: verified, href: verified ? undefined : `/console/kyc/${b.id}?from=360` },
    { label: "Scored", done: hasScore, href: hasScore ? undefined : `/console/crunch?borrowerId=${b.id}&from=360` },
    { label: "Application", done: hasApplication },
    { label: "Active loan", done: hasActive },
  ];
  const currentStep = journey.findIndex((s) => !s.done);

  const ratiba: RatibaView[] = standingOrders.map((o) => ({
    id: o.id,
    status: o.status,
    amount: Number(o.amount),
    frequency: o.frequency,
    startDate: o.startDate.toISOString(),
    endDate: o.endDate ? o.endDate.toISOString() : null,
    simulated: o.simulated,
    byStaff: !!o.createdById,
  }));
  const ratibaOn = ratiba.some((o) => o.status === "ACTIVE");
  // The next instalment still carrying money, from the lender's own schedule.
  const nextDue = liveLoans
    .filter((l) => l.status === "ACTIVE" && l.expectedClearDate)
    .map((l) => ({ date: l.expectedClearDate!, amount: l.installmentAmount ?? l.balance }))
    .sort((x, y) => x.date.localeCompare(y.date))[0] ?? null;

  const places = placesOf(b);
  const visits = b.fieldVisits.map((v) => ({
    id: v.id, label: v.label, status: v.status,
    agent: v.agent ? `${v.agent.firstName ?? ""} ${v.agent.otherName ?? ""}`.trim() || null : null,
  }));

  // ── THE MASTHEAD ────────────────────────────────────────────────────────────
  const masthead = (
    <div className="glass p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-4">
            {/* The corner tick stays off — verification lives beside the name,
                Twitter-style, and one identity never wears two ticks. */}
            <BorrowerAvatar name={name} portraitUrl={portraitUrl} verified={verified} tick={false} size="xl" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="t-title truncate">{name}</h1>
                {verified ? (
                  <span title={`Identity verified${b.kycVerifiedAt ? ` on ${dateFmt(b.kycVerifiedAt)}` : ""} — cleared for disbursement.`}>
                    <BadgeCheck className="h-5 w-5 shrink-0 fill-emerald-500 text-white" aria-label="KYC verified" />
                  </span>
                ) : (
                  <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${KYC_TONE[b.kycStatus] ?? KYC_TONE.NONE}`}>KYC {b.kycStatus}</span>
                )}
                {b.graduationCount > 0 && (
                  <span className="rounded-md bg-emerald-500/12 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                    GRADUATED ×{b.graduationCount}
                  </span>
                )}
                {!verified && (
                  <Link
                    href={`/console/kyc/${b.id}?from=360`}
                    className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold text-white"
                    style={{ backgroundColor: "var(--brand)" }}
                  >
                    Start verification →
                  </Link>
                )}
              </div>
              <p className="mt-0.5 truncate t-meta">
                {b.phone}
                {b.nationalId ? ` · ID ${b.nationalId}` : ""}
                {live?.profile.accountNo ? ` · A/C ${live.profile.accountNo}` : ""}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[color:var(--ink-muted)]">
                <span className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-[color:var(--ink-faint)]" />
                  <span className="text-[color:var(--ink-faint)]">Account age</span>
                  <span className="font-semibold text-[color:var(--ink)]">{accountAge}</span>
                </span>
                {officeTrail.length > 0 && (
                  <span className="flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5 text-[color:var(--ink-faint)]" />
                    <span className="font-semibold text-[color:var(--ink)]">{officeTrail.join(" › ")}</span>
                  </span>
                )}
                {live?.profile.agentName && (
                  <span className="text-[color:var(--ink-faint)]">
                    Officer <span className="font-semibold text-[color:var(--ink)]">{live.profile.agentName}</span>
                  </span>
                )}
              </div>
              {!verified && (
                <p className="mt-1 text-[12px] font-medium text-amber-700">
                  Identity not verified — no money can be disbursed to this borrower yet.
                </p>
              )}
            </div>
          </div>

          {/* THE THREE PRIMARY ACTS, directly under the face. Asking for money,
              sending a human, and asking Riri are what an officer DOES here. */}
          <div className="mt-3.5">
            <BorrowerActions
              borrowerId={b.id}
              name={name}
              lat={b.lat}
              lng={b.lng}
              fieldEntitled={fieldEntitled}
              subject={{ kind: "borrower", id: b.id, label: name }}
            />
          </div>
        </div>

        {/* The five numbers this customer is priced by, big enough to read from
            across a desk — and, for a bridged lender, every one of them read from
            the lender's own book rather than from our empty copy of it. */}
        <div className="grid w-full grid-cols-2 gap-2.5 sm:w-auto sm:shrink-0 sm:grid-cols-3">
          <BigStat label="Outstanding" value={fmtKES(olb)} tone="text-[color:var(--brand)]" />
          <BigStat label="Loan limit" value={loanLimit != null ? fmtKES(loanLimit) : "—"} />
          <BigStat
            label="Score"
            value={liveScore != null ? liveScore.toFixed(1) : b.behaviouralScore != null ? b.behaviouralScore.toFixed(1) : "—"}
            sub={liveScore != null ? "of 100 · from their repayments" : undefined}
          />
          <BigStat label="Loans" value={`${loansActive}/${loansTotal}`} sub={clearedCount > 0 ? `${clearedCount} cleared` : undefined} />
          <BigStat
            label="Arrears"
            value={arrearsTotal > 0 ? fmtKES(arrearsTotal) : "—"}
            sub={worstDpd > 0 ? `${worstDpd} days past due` : "nothing behind"}
            tone={arrearsTotal > 0 ? "text-rose-600" : undefined}
          />
          <BigStat
            label="Auto-repay"
            value={ratibaOn ? "On" : "Off"}
            sub={ratibaOn ? "Safaricom collects" : "collected by hand"}
            tone={ratibaOn ? "text-emerald-600" : undefined}
          />
        </div>
      </div>

      {/* The journey strip — which step this account is on, and a way into the
          step it is waiting for. */}
      <div className="mt-4 border-t border-ash-900/10 pt-3">
        <div className="flex items-center gap-0 overflow-x-auto">
          {journey.map((s, i) => {
            const isCurrent = i === currentStep;
            const dot = s.done ? (
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white"><CheckCircle2 className="h-3.5 w-3.5" /></span>
            ) : (
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${isCurrent ? "text-white" : "bg-ash-900/10 text-[color:var(--ink-faint)]"}`}
                style={isCurrent ? { backgroundColor: "var(--brand)" } : undefined}
              >
                {i + 1}
              </span>
            );
            const label = (
              <span className={`ml-1.5 whitespace-nowrap text-[11px] ${s.done ? "font-medium text-[color:var(--ink-muted)]" : isCurrent ? "font-bold text-[color:var(--ink)]" : "text-[color:var(--ink-faint)]"}`}>
                {s.label}
                {isCurrent && <span className="ml-1 rounded bg-ash-900/5 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-[color:var(--ink-faint)]">current step</span>}
              </span>
            );
            return (
              <div key={s.label} className="flex items-center">
                {i > 0 && <span className={`mx-2 h-px w-4 sm:w-7 ${journey[i - 1].done ? "bg-emerald-400" : "bg-ash-900/15"}`} />}
                {s.href && isCurrent
                  ? <Link href={s.href} className="flex items-center hover:opacity-80">{dot}{label}</Link>
                  : <span className="flex items-center">{dot}{label}</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  // ── THE SECTIONS ────────────────────────────────────────────────────────────
  const sections: Section[] = [];

  sections.push({
    key: "overview",
    label: "Overview",
    icon: "LayoutDashboard",
    content: (
      <div className="space-y-4">
        {live && org && <Provenance lender={org.name} entityId={org.entityId} degraded={live.degraded} matchedBy={live.matchedBy} />}
        <RiskBandCard view={riskView} graduation={graduation} />
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Early-warning risk" icon={<ShieldAlert className="h-4 w-4" style={{ color: "var(--brand)" }} />}>
            <EarlyWarning risk={risk} />
          </Panel>
          <Panel
            title="Identity & KYC"
            icon={<ScanFace className="h-4 w-4" style={{ color: "var(--brand)" }} />}
            note={verified ? "Cleared for disbursement." : "Money cannot leave until this is done."}
          >
            {kyc ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="ID quality" value={kyc.idQualityScore != null ? `${kyc.idQualityScore}` : "—"} />
                <Stat label="Liveness" value={kyc.livenessScore != null ? `${kyc.livenessScore}` : "—"} tone={kyc.livenessPassed ? "text-emerald-600" : undefined} />
                <Stat label="Face match" value={kyc.faceMatchScore != null ? `${kyc.faceMatchScore}` : "—"} />
                <Stat label="IPRS" value={kyc.iprsMatched ? "Matched" : "—"} tone={kyc.iprsMatched ? "text-emerald-600" : undefined} />
              </div>
            ) : (
              <p className="t-meta">
                No KYC session on file.{" "}
                <Link href={`/console/kyc/${b.id}?from=360`} className="font-semibold" style={{ color: "var(--brand)" }}>Start verification</Link>
              </p>
            )}
          </Panel>
        </div>
      </div>
    ),
  });

  if (live?.statement) {
    const st = live.statement;
    sections.push({
      key: "money",
      label: "Money",
      icon: "Banknote",
      badge: String(st.loans.length),
      tone: arrearsTotal > 0 ? "bad" : "brand",
      content: (
        <div className="space-y-4">
          {org && <Provenance lender={org.name} entityId={org.entityId} degraded={live.degraded} matchedBy={live.matchedBy} />}
          <MoneySummary statement={st} />
          <Panel
            title="Auto-repay — M-PESA Ratiba"
            icon={<Radio className="h-4 w-4" style={{ color: "var(--brand)" }} />}
            note="Whether Safaricom is collecting these instalments, or somebody has to."
          >
            <RatibaPanel orders={ratiba} nextDue={nextDue} />
          </Panel>
          <Panel
            title="Every loan they have taken"
            icon={<Landmark className="h-4 w-4" style={{ color: "var(--brand)" }} />}
            note="Arrears is the lender's own register, never our arithmetic — so this page and their PAR reports can never disagree."
            right={
              <Link href={`/console/borrowers/${b.id}/statement`} className="text-[12px] font-semibold hover:underline" style={{ color: "var(--brand)" }}>
                Full statement →
              </Link>
            }
          >
            <LiveLoans loans={st.loans} />
          </Panel>
          <Panel
            title="The ledger"
            icon={<History className="h-4 w-4" style={{ color: "var(--brand)" }} />}
            note={`${st.totals.count.toLocaleString()} entries, newest first. "In" is money reaching the customer.`}
          >
            <LiveLedger txns={st.transactions.slice(0, 60)} truncated={st.truncated || st.transactions.length > 60} />
          </Panel>
        </div>
      ),
    });
  } else if (b.loans.length > 0) {
    // A NATIVE customer, or a live book that did not answer. Our own loans, said
    // plainly as ours.
    sections.push({
      key: "money",
      label: "Money",
      icon: "Banknote",
      badge: String(b.loans.length),
      content: (
        <Panel title="Loans" icon={<Landmark className="h-4 w-4" style={{ color: "var(--brand)" }} />} note={`${clearedCount} cleared`}>
          <div className="space-y-2">
            {b.loans.slice(0, 12).map((l) => {
              const total = l.installments.length;
              const paid = l.installments.filter((i) => i.status === "PAID").length;
              return (
                <div key={l.id} className="rounded-lg border border-ash-900/10 bg-paper/60 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium">{l.product.name}</p>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${l.status === "ACTIVE" ? "bg-sky-500/12 text-sky-700" : l.status === "CLEARED" ? "bg-emerald-500/12 text-emerald-700" : "bg-ash-900/[0.06] text-[color:var(--ink-muted)]"}`}>{l.status}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-xs text-[color:var(--ink-muted)]">
                    <span>{fmtKES(num(l.loanAmount))} · {paid}/{total} paid</span>
                    <span className="font-semibold" style={{ color: "var(--brand)" }}>{fmtKES(num(l.balance))}</span>
                  </div>
                  <Link href={`/console/loans/${l.id}/statement`} className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium hover:underline" style={{ color: "var(--brand)" }}>
                    Statement
                  </Link>
                </div>
              );
            })}
          </div>
        </Panel>
      ),
    });
  }

  sections.push({
    key: "risk",
    label: "Risk & score",
    icon: "Gauge",
    badge: liveScore != null ? liveScore.toFixed(0) : b.behaviouralScore != null ? b.behaviouralScore.toFixed(0) : null,
    tone: band?.key === "HIGH" ? "bad" : band?.key === "WATCH" ? "warn" : "good",
    content: (
      <div className="space-y-4">
        <RiskBandCard view={riskView} graduation={graduation} />
        {liveBehaviour?.scored ? (
          <>
            <Panel
              title="Why the score is what it is"
              note={`Computed from ${liveBehaviour.installmentsUsed} instalments across ${liveBehaviour.loans.length} loan${liveBehaviour.loans.length === 1 ? "" : "s"}${liveBehaviour.includesLiveLoan ? ", including one still being repaid — so this can still move." : "."}`}
            >
              <ScoreFactors behaviour={liveBehaviour} />
            </Panel>
            {live?.profile.riskScore != null && (
              <Panel title="Against the lender's own score" note="Ours is computed now; theirs was frozen when their job last ran.">
                <ScoreComparison
                  ours={liveBehaviour.score}
                  theirs={live.profile.riskScore}
                  theirLabel={live.profile.riskCategory}
                  lastRun={live.profile.lastScoreUpdate}
                />
              </Panel>
            )}
            {live?.ladder && (
              <Panel title="Where the ladder would put their limit" note="What this lender's own published credit policy says, applied to this record.">
                <LadderPanel ladder={live.ladder} />
              </Panel>
            )}
          </>
        ) : (
          <Panel title="Not scored from behaviour yet">
            <p className="t-meta">
              No instalment has fallen due for this customer, so there is nothing to score them on. That is a fact worth
              knowing rather than a gap — a band assigned without a repayment record would be a guess wearing a number.
            </p>
          </Panel>
        )}
        {scores.length > 0 && (
          <Panel title="Score history" icon={<History className="h-4 w-4" style={{ color: "var(--brand)" }} />} note="closed ML loop">
            <div className="space-y-1.5">
              {scores.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-[color:var(--ink-muted)]">{s.modelKind} <span className="text-[color:var(--ink-faint)]">{s.modelVersion}</span></span>
                  <span className="flex shrink-0 items-center gap-2">
                    {s.score != null && <span className="font-semibold text-[color:var(--ink)]">{s.score}</span>}
                    {s.pd != null && <span className="text-[color:var(--ink-faint)]">PD {Number(s.pd).toFixed(2)}</span>}
                    <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${s.outcome === "REPAID" ? "bg-emerald-500/12 text-emerald-700" : s.outcome === "DEFAULTED" ? "bg-rose-500/12 text-rose-700" : "bg-ash-900/[0.06] text-[color:var(--ink-faint)]"}`}>{s.outcome}</span>
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        )}
      </div>
    ),
  });

  sections.push({
    key: "identity",
    label: "Identity",
    icon: "ShieldCheck",
    badge: verified ? "✓" : b.kycStatus === "NONE" ? "!" : null,
    tone: verified ? "good" : "warn",
    content: (
      <div className="space-y-4">
        <Panel
          title="KYC"
          icon={<ScanFace className="h-4 w-4" style={{ color: "var(--brand)" }} />}
          note={kyc ? `Session ${kyc.status} · ${kyc.provider} · ${dateFmt(kyc.createdAt)}${kyc.iprsName ? ` · registry: ${kyc.iprsName}` : ""}` : undefined}
        >
          {kyc ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="ID quality" value={kyc.idQualityScore != null ? `${kyc.idQualityScore}` : "—"} />
              <Stat label="Liveness" value={kyc.livenessScore != null ? `${kyc.livenessScore}` : "—"} tone={kyc.livenessPassed ? "text-emerald-600" : undefined} />
              <Stat label="Face match" value={kyc.faceMatchScore != null ? `${kyc.faceMatchScore}` : "—"} />
              <Stat label="IPRS" value={kyc.iprsMatched ? "Matched" : "—"} tone={kyc.iprsMatched ? "text-emerald-600" : undefined} />
              <div className="col-span-2 sm:col-span-4">
                {/* Keys only — the images come from signed URLs, on demand. */}
                <KycGallery
                  portraitKey={b.portraitKey ?? kyc.portraitKey}
                  idFrontKey={b.idFrontKey ?? kyc.idFrontKey}
                  selfieKey={b.selfieKey ?? kyc.selfieKey}
                />
              </div>
            </div>
          ) : (
            <p className="t-meta">
              No KYC session on file.{" "}
              <Link href={`/console/kyc/${b.id}?from=360`} className="font-semibold" style={{ color: "var(--brand)" }}>Start verification</Link>
            </p>
          )}
        </Panel>
        {/* The credit bureau. Its own client island — a CRB pull costs money, so it
            is asked for, never fetched because a page opened. */}
        <Customer360Client borrowerId={b.id} initialCrb={initialCrb} />
      </div>
    ),
  });

  if (masterFile) {
    const mb = masterFileBadge(masterFile);
    sections.push({
      key: "master",
      label: "Master file",
      icon: "FileLock2",
      badge: mb.badge,
      tone: mb.tone,
      content: <MasterFilePanel file={masterFile} borrowerId={b.id} />,
    });
  }

  const peopleCount = (b.nextOfKin ? 1 : 0) + guarantors.length + (live?.profile.agentName ? 1 : 0);
  sections.push({
    key: "people",
    label: "People",
    icon: "Users",
    badge: peopleCount > 0 ? String(peopleCount) : null,
    content: (
      <Panel title="Everyone around this customer" note="Who to call, who is liable, and whose book they sit on.">
        <PeoplePanel
          kin={(b.nextOfKin as { name?: string; relationship?: string; phone?: string } | null) ?? null}
          officer={live?.profile.agentName ?? null}
          branchTrail={officeTrail}
          guarantors={guarantors.map((g) => ({ ...g, relationship: g.relationship ?? null }))}
        />
      </Panel>
    ),
  });

  if (fieldEntitled || places.length > 0 || visits.length > 0) {
    sections.push({
      key: "places",
      label: "Places",
      icon: "MapPin",
      badge: places.length > 0 ? String(places.length) : "0",
      tone: places.length > 0 ? "brand" : "warn",
      content: (
        <Panel title="Where they can be found" note="Consented snapshots, captured once — never a track.">
          <PlacesPanel places={places} visits={visits} />
        </Panel>
      ),
    });
  }

  sections.push({
    key: "timeline",
    label: "Timeline",
    icon: "History",
    badge: timeline.length > 0 ? String(timeline.length) : null,
    content: <CustomerTimeline borrowerId={b.id} events={timelineTop} />,
  });

  sections.push({
    key: "manage",
    label: "Manage",
    icon: "Settings2",
    content: (
      <Panel title="What you can do to this account" note="Every one of these lands as an audit row under your name. Nothing here is a quiet edit.">
        <BorrowerManagePanel
          borrowerId={b.id}
          name={name}
          phone={b.phone}
          email={b.email}
          nationalId={b.nationalId}
          locationType={b.locationType}
          locationAddress={b.locationAddress}
          lat={b.lat}
          lng={b.lng}
          homeLat={b.homeLat}
          homeLng={b.homeLng}
          homeAddress={b.homeAddress}
          loanLimit={loanLimit}
          creditScore={b.creditScore}
          riskBand={b.riskBand}
          nextOfKin={(b.nextOfKin as { name?: string; relationship?: string; phone?: string } | null) ?? null}
          verified={verified}
        />
      </Panel>
    ),
  });

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <Link href="/console/borrowers" className="inline-flex items-center gap-1.5 text-sm text-[color:var(--ink-muted)] hover:text-[color:var(--ink)]">
        <ArrowLeft className="h-4 w-4" /> Borrowers
      </Link>
      <div className="mt-3">
        <Customer360Workspace masthead={masthead} sections={sections} />
      </div>
    </main>
  );
}
