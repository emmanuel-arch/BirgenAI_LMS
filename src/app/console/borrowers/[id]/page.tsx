import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, ScanFace, ShieldAlert, Landmark, MapPin, History, CheckCircle2, XCircle, Clock, FileText, BadgeCheck, Building2,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { resolveScope, borrowerScopeWhere } from "@/lib/rbac/scope";
import { prisma } from "@/lib/prisma";
import { hasFeature } from "@/lib/billing/entitlements";
import { portfolioEarlyWarning } from "@/lib/intelligence/earlywarning";
import { portraitsFor, PORTRAIT_TTL_SEC } from "@/lib/kyc/avatars";
import { signedUrl } from "@/lib/storage/provider";
import { BorrowerAvatar } from "@/components/kyc/BorrowerAvatar";
import type { CrbReport } from "@/lib/crb/provider";
import { Customer360Client } from "./Customer360Client";
import { BorrowerMenu } from "./BorrowerMenu";
import { BorrowerActions } from "./BorrowerActions";
import { RiskBandCard } from "@/components/risk/RiskBandCard";
import { bandForScore, bandForBehavioural, defaultProbability, normaliseBandName, BAND_BY_KEY } from "@/lib/risk/bands";
import { assessGraduation } from "@/lib/risk/graduation";
import KycGallery from "./KycGallery";

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
  return `${y} yr${y > 1 ? "s" : ""}${m ? ` ${m} mo` : ""}`;
}

const KYC_TONE: Record<string, string> = {
  VERIFIED: "bg-emerald-100 text-emerald-700", PENDING_REVIEW: "bg-amber-100 text-amber-700",
  IN_PROGRESS: "bg-sky-100 text-sky-700", FAILED: "bg-rose-100 text-rose-700", NONE: "bg-zinc-900/5 text-zinc-500",
};

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-zinc-900/10 bg-white/60 px-2.5 py-2">
      <p className="text-[9px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={`text-sm font-bold leading-tight ${tone ?? "text-zinc-800"}`}>{value}</p>
    </div>
  );
}

/** The header strip's tile — Stat at billboard size. The four numbers an officer
    prices a customer by deserve more than a 9px whisper. */
function BigStat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-[8.5rem] rounded-xl border border-zinc-900/10 bg-white/60 px-4 py-3">
      <p className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={`mt-0.5 text-xl font-bold leading-tight ${tone ?? "text-zinc-800"}`}>{value}</p>
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
  const [kyc, scores, crbCheck, ew, branch] = await Promise.all([
    prisma.kycSession.findFirst({ where: { orgId, OR: [{ borrowerId: id }, { phone: b.phone }] }, orderBy: { createdAt: "desc" } }),
    prisma.scoreSnapshot.findMany({ where: { orgId, borrowerId: id }, orderBy: { createdAt: "desc" }, take: 8 }),
    prisma.kycCheck.findFirst({ where: { orgId, borrowerId: id, kind: "CRB" }, orderBy: { createdAt: "desc" } }),
    scanEntitled ? portfolioEarlyWarning(orgId) : null,
    // Where they sit in the book, said the way the org says it: the branch plus its
    // ancestors up to the head office (three levels covers every real tree we hold).
    b.branchId
      ? prisma.branch.findFirst({
          where: { id: b.branchId, orgId },
          select: { name: true, levelName: true, parent: { select: { name: true, levelName: true, parent: { select: { name: true, levelName: true } } } } },
        })
      : null,
  ]);
  const risk = ew?.rows.find((r) => r.borrowerId === id) ?? null;
  const initialCrb = (crbCheck?.payload as unknown as CrbReport) ?? null;

  const name = `${b.firstName ?? "Borrower"}${b.otherName ? " " + b.otherName : ""}`.trim();
  const verified = b.kycStatus === "VERIFIED";

  const accountAge = accountAgeOf(b.createdAt);

  // Root-first placement chain: Head Office → Region → Branch.
  type BranchNode = { name: string; levelName: string; parent?: BranchNode | null };
  const branchChain: { name: string; levelName: string }[] = [];
  for (let n = branch as BranchNode | null; n; n = n.parent ?? null) branchChain.unshift({ name: n.name, levelName: n.levelName });

  // Where this account is on the road from walk-in to money: registered →
  // KYC → statement crunched → application → active. Shown on the page so the
  // officer never has to reconstruct "what's next" from four different panels.
  const hasScore = b.creditScore != null || scores.length > 0;
  const hasApplication = b.applications.length > 0 || b.loans.length > 0;
  const hasActive = b.loans.some((l) => l.status === "ACTIVE" || l.status === "PENDING_DISBURSEMENT" || l.status === "CLEARED");
  const journey: { label: string; done: boolean; href?: string }[] = [
    { label: "Registered", done: true },
    { label: "KYC verified", done: verified, href: verified ? undefined : `/console/kyc/${b.id}?from=360` },
    { label: "Statement crunched", done: hasScore, href: hasScore ? undefined : `/console/crunch?borrowerId=${b.id}&from=360` },
    { label: "Application", done: hasApplication },
    { label: "Active loan", done: hasActive },
  ];
  const currentStep = journey.findIndex((s) => !s.done);
  // The portrait may live on the Borrower row (promoted at attach) or still only on
  // the session (a verification that hasn't been promoted — which is itself a finding).
  const portraitUrl = (await portraitsFor([b.id]))[b.id]
    ?? (kyc?.portraitKey ? await signedUrl(kyc.portraitKey, PORTRAIT_TTL_SEC) : null);
  const olb = b.loans.filter((l) => l.status === "ACTIVE").reduce((s, l) => s + num(l.balance), 0);
  const clearedCount = b.loans.filter((l) => l.status === "CLEARED").length;

  // ── Where this customer sits, and what it would take to move them ───────────
  //
  // The band is taken from whichever engine has actually spoken. Their REPAYMENT
  // record outranks their statement score, and deliberately: a statement tells you
  // what someone earns, a repayment record tells you what they DO — and once we have
  // watched them clear two loans, what they do is the better predictor of what they
  // will do next. Before that, the crunch score is all we have.
  const latestSnapshot = scores[0] ?? null;
  const bandFromBehaviour = bandForBehavioural(b.behaviouralScore);
  const bandFromScore = bandForScore(b.creditScore);
  const band = bandFromBehaviour ?? bandFromScore ?? (b.riskBand ? BAND_BY_KEY.get(normaliseBandName(b.riskBand) ?? "HIGH") ?? null : null);

  const riskView = {
    band: band
      ? {
          key: band.key, label: band.label, meaning: band.meaning,
          from: band.from, to: band.to, ink: band.ink, soft: band.soft, icon: band.icon,
          graduationPercent: band.graduationPercent,
        }
      : null,
    score: b.creditScore,
    behavioural: b.behaviouralScore,
    pd: defaultProbability(band, latestSnapshot?.pd != null ? Number(latestSnapshot.pd) : null),
  };

  // The ladder is only meaningful once they have repaid something.
  const graduation = clearedCount > 0
    ? await assessGraduation(orgId, b.id).then((g) => ({ eligible: g.eligible, reason: g.reason, newLimit: g.newLimit }))
    : null;

  return (
    <main className="mx-auto max-w-5xl px-4 sm:px-6 py-8">
        <Link href="/console/borrowers" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800"><ArrowLeft className="h-4 w-4" /> Borrowers</Link>

        {/* Identity header. The customer's FACE leads — an officer looking for a person
            is looking for a person, and the fastest fraud check anyone ever runs is
            noticing that the face beside the name is the wrong one.
            relative: the kebab button pins to this card's corner. The drawer and
            modals it opens portal to <body> — a .glass panel's backdrop-filter would
            otherwise trap and clip anything position:fixed inside it. */}
        <div className="relative mt-3 glass p-5">
          {/* The one way to MANAGE this account — pinned to the furthest top-right of
              the card, opening a drawer from the right. The card itself stays a read. */}
          <div className="absolute right-3 top-3 z-30">
            <BorrowerMenu
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
              loanLimit={b.loanLimit != null ? Number(b.loanLimit) : null}
              creditScore={b.creditScore}
              riskBand={b.riskBand}
              nextOfKin={(b.nextOfKin as { name?: string; relationship?: string; phone?: string } | null) ?? null}
              verified={verified}
            />
          </div>
          {/* pr clears the kebab pinned at right-3: the stats grid must not crowd
              its button, so the row stops a full button-width-plus-breath short. */}
          <div className="flex items-start justify-between gap-4 flex-wrap pr-10 sm:pr-16">
            <div className="min-w-0">
              <div className="flex items-center gap-4 min-w-0">
              {/* The corner tick stays off here — verification lives beside the name,
                  Twitter-style, and one identity never wears two ticks. */}
              <BorrowerAvatar name={name} portraitUrl={portraitUrl} verified={verified} tick={false} size="xl" />
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl font-bold truncate">{name}</h1>
                  {/* Verified reads like a verified handle: the filled badge, no words.
                      The words live in the tooltip for whoever hovers to ask. */}
                  {verified ? (
                    <span title={`Identity verified${b.kycVerifiedAt ? ` on ${dateFmt(b.kycVerifiedAt)}` : ""} — cleared for disbursement.`}>
                      <BadgeCheck className="h-5 w-5 shrink-0 fill-emerald-500 text-white" aria-label="KYC verified" />
                    </span>
                  ) : (
                    <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${KYC_TONE[b.kycStatus] ?? KYC_TONE.NONE}`}>KYC {b.kycStatus}</span>
                  )}
                  {b.graduationCount > 0 && <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">GRADUATED ×{b.graduationCount}</span>}
                  {/* The gate, said out loud on the customer's own page — and a way through
                      it. An unverified borrower cannot be disbursed to, so the officer
                      looking at them needs to know that here, not at the payout desk.
                      ?from=360 sends them BACK here when it's done, not to the queue. */}
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
                <p className="mt-0.5 text-sm text-zinc-500 truncate">{b.phone}{b.nationalId ? ` · ID ${b.nationalId}` : ""}{b.locationAddress ? ` · ${b.locationAddress}` : ""}</p>
                {/* Tenure and placement — how long they've banked here and whose book
                    they sit on, root-first the way the org says it. This earns the line
                    the old "identity verified" sentence held; the badge above already
                    says that in one glyph. */}
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-zinc-600">
                  <span className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-zinc-400" />
                    <span className="text-zinc-400">Account age</span>
                    <span className="font-semibold text-zinc-700">{accountAge}</span>
                  </span>
                  {branchChain.map((n, i) => (
                    <span key={`${n.name}-${i}`} className="flex items-center gap-1">
                      {i === 0 && <Building2 className="h-3.5 w-3.5 text-zinc-400" />}
                      <span className="font-semibold text-zinc-700">{n.name}</span>
                      {i > 0 && <span className="text-[10px] text-zinc-400">({n.levelName})</span>}
                    </span>
                  ))}
                </div>
                {!verified && (
                  <p className="mt-1 text-[12px] font-medium text-amber-700">
                    Identity not verified — no money can be disbursed to this borrower yet.
                  </p>
                )}
              </div>
              </div>
              {/* THE THREE PRIMARY ACTS, directly under the face. Asking for money,
                  sending a human, and asking Riri are what an officer DOES on this
                  page — they sit with the identity they act on, not across the card.
                  The kebab top-right stays what an officer may CHANGE. */}
              <div className="mt-3">
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
            {/* Full-width grid under the identity on a phone; a fixed 2×2 strip
                beside it on sm+. The four numbers an officer prices this customer
                by, big enough to be read from across a desk: what's out, what they
                may take, what the model says, and their loan record. */}
            <div className="grid w-full grid-cols-2 gap-2.5 sm:w-auto sm:shrink-0">
              <BigStat label="OLB" value={fmtKES(olb)} tone="text-[color:var(--brand)]" />
              <BigStat label="Loan limit" value={b.loanLimit != null ? fmtKES(Number(b.loanLimit)) : "—"} />
              <BigStat label="Internal score" value={b.creditScore != null ? String(b.creditScore) : "—"} />
              <BigStat label="Loans" value={`${b.loans.filter((l) => l.status === "ACTIVE").length}/${b.loans.length}`} />
            </div>
          </div>

          {/* The journey strip — which step this account is on, and a way into
              the step it is waiting for. */}
          <div className="mt-4 border-t border-zinc-900/10 pt-3">
            <div className="flex items-center gap-0 overflow-x-auto">
              {journey.map((s, i) => {
                const isCurrent = i === currentStep;
                const dot = s.done ? (
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white"><CheckCircle2 className="h-3.5 w-3.5" /></span>
                ) : (
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${isCurrent ? "text-white" : "bg-zinc-900/10 text-zinc-500"}`}
                    style={isCurrent ? { backgroundColor: "var(--brand)" } : undefined}>{i + 1}</span>
                );
                const label = (
                  <span className={`ml-1.5 whitespace-nowrap text-[11px] ${s.done ? "font-medium text-zinc-600" : isCurrent ? "font-bold text-zinc-900" : "text-zinc-400"}`}>
                    {s.label}{isCurrent && <span className="ml-1 rounded bg-zinc-900/5 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-zinc-500">current step</span>}
                  </span>
                );
                return (
                  <div key={s.label} className="flex items-center">
                    {i > 0 && <span className={`mx-2 h-px w-4 sm:w-7 ${journey[i - 1].done ? "bg-emerald-400" : "bg-zinc-900/15"}`} />}
                    {s.href && isCurrent
                      ? <Link href={s.href} className="flex items-center hover:opacity-80">{dot}{label}</Link>
                      : <span className="flex items-center">{dot}{label}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* WHAT THIS CUSTOMER IS, IN ONE LOOK. Directly under the identity, above
            everything else, because it is the question every other panel on this page
            is evidence for. The bare "Internal score: 747" tile in the strip above is
            a number on a scale nobody has memorised; this says what it MEANS. */}
        <div className="mt-4">
          <RiskBandCard view={riskView} graduation={graduation} />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {/* Early-warning risk */}
          <div className="glass p-5">
            <h2 className="text-sm font-semibold flex items-center gap-2"><ShieldAlert className="h-4 w-4" style={{ color: "var(--brand)" }} /> Early-warning risk</h2>
            {risk ? (
              <div className="mt-3">
                <div className="flex items-center gap-2.5">
                  <span className={`rounded-md px-2 py-0.5 text-xs font-bold ${risk.band === "HIGH" ? "bg-rose-100 text-rose-700" : risk.band === "ELEVATED" ? "bg-amber-100 text-amber-700" : "bg-zinc-900/5 text-zinc-600"}`}>{risk.band}</span>
                  <div className="flex-1 h-2 rounded-full bg-zinc-900/8 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${risk.riskScore}%`, backgroundColor: risk.band === "HIGH" ? "#e11d48" : risk.band === "ELEVATED" ? "#d97706" : "#a1a1aa" }} />
                  </div>
                  <span className="text-xs font-bold tabular-nums">{risk.riskScore}</span>
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {risk.reasons.map((r, i) => <span key={i} className="rounded-full border border-zinc-900/10 bg-white/60 px-2 py-0.5 text-[10px] text-zinc-600">{r}</span>)}
                </div>
                <p className="mt-2.5 text-xs text-zinc-500">Recommended: <span className="font-semibold text-zinc-700">{risk.action.label}</span> · projected loss {fmtKES(risk.expectedLoss)}</p>
              </div>
            ) : (
              <p className="mt-3 text-sm text-zinc-500 flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> No early-warning signals — performing to schedule.</p>
            )}
          </div>

          {/* Identity & KYC */}
          <div className="glass p-5">
            <h2 className="text-sm font-semibold flex items-center gap-2"><ScanFace className="h-4 w-4" style={{ color: "var(--brand)" }} /> Identity &amp; KYC</h2>
            {kyc ? (
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Stat label="ID quality" value={kyc.idQualityScore != null ? `${kyc.idQualityScore}` : "—"} />
                <Stat label="Liveness" value={kyc.livenessScore != null ? `${kyc.livenessScore}` : "—"} tone={kyc.livenessPassed ? "text-emerald-600" : undefined} />
                <Stat label="Face match" value={kyc.faceMatchScore != null ? `${kyc.faceMatchScore}` : "—"} />
                <Stat label="IPRS" value={kyc.iprsMatched ? "Matched" : "—"} tone={kyc.iprsMatched ? "text-emerald-600" : undefined} />
                <div className="col-span-2 sm:col-span-4 text-xs text-zinc-500">
                  Session <span className="font-semibold">{kyc.status}</span> · {kyc.provider} · {dateFmt(kyc.createdAt)}
                  {kyc.iprsName ? ` · registry: ${kyc.iprsName}` : ""}
                </div>
                {/* Keys only — the images come from signed URLs, on demand. */}
                <div className="col-span-2 sm:col-span-4">
                  <KycGallery
                    portraitKey={b.portraitKey ?? kyc.portraitKey}
                    idFrontKey={b.idFrontKey ?? kyc.idFrontKey}
                    selfieKey={b.selfieKey ?? kyc.selfieKey}
                  />
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm text-zinc-500">
                No KYC session on file.{" "}
                <Link href={`/console/kyc/${b.id}?from=360`} className="font-semibold" style={{ color: "var(--brand)" }}>Start verification</Link>
              </p>
            )}
          </div>

          {/* Loans */}
          <div className="glass p-5">
            <h2 className="text-sm font-semibold flex items-center gap-2"><Landmark className="h-4 w-4" style={{ color: "var(--brand)" }} /> Loans <span className="text-zinc-400 font-normal">· {clearedCount} cleared</span></h2>
            <div className="mt-3 space-y-2">
              {b.loans.length === 0 && <p className="text-sm text-zinc-500">No loans yet.</p>}
              {b.loans.slice(0, 6).map((l) => {
                const total = l.installments.length;
                const paid = l.installments.filter((i) => i.status === "PAID").length;
                return (
                  <div key={l.id} className="rounded-lg border border-zinc-900/10 bg-white/60 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium truncate">{l.product.name}</p>
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${l.status === "ACTIVE" ? "bg-sky-100 text-sky-700" : l.status === "CLEARED" ? "bg-emerald-100 text-emerald-700" : "bg-zinc-900/5 text-zinc-600"}`}>{l.status}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-xs text-zinc-500">
                      <span>{fmtKES(num(l.loanAmount))} · {paid}/{total} paid</span>
                      <span className="font-semibold" style={{ color: "var(--brand)" }}>{fmtKES(num(l.balance))}</span>
                    </div>
                    <Link href={`/console/loans/${l.id}/statement`} className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium hover:underline" style={{ color: "var(--brand)" }}>
                      <FileText className="h-3 w-3" /> Statement
                    </Link>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Score history (closed ML loop) */}
          <div className="glass p-5">
            <h2 className="text-sm font-semibold flex items-center gap-2"><History className="h-4 w-4" style={{ color: "var(--brand)" }} /> Score history <span className="text-zinc-400 font-normal">· closed ML loop</span></h2>
            <div className="mt-3 space-y-1.5">
              {scores.length === 0 && <p className="text-sm text-zinc-500">No scores recorded.</p>}
              {scores.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-zinc-500 truncate">{s.modelKind} <span className="text-zinc-400">{s.modelVersion}</span></span>
                  <span className="flex items-center gap-2 shrink-0">
                    {s.score != null && <span className="font-semibold text-zinc-700">{s.score}</span>}
                    {s.pd != null && <span className="text-zinc-400">PD {Number(s.pd).toFixed(2)}</span>}
                    <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${s.outcome === "REPAID" ? "bg-emerald-100 text-emerald-700" : s.outcome === "DEFAULTED" ? "bg-rose-100 text-rose-700" : "bg-zinc-900/5 text-zinc-500"}`}>{s.outcome}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Field visits */}
          {b.fieldVisits.length > 0 && (
            <div className="glass p-5">
              <h2 className="text-sm font-semibold flex items-center gap-2"><MapPin className="h-4 w-4" style={{ color: "var(--brand)" }} /> Field visits</h2>
              <div className="mt-3 space-y-1.5">
                {b.fieldVisits.map((v) => (
                  <div key={v.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-zinc-600 truncate">{v.label}{v.agent ? ` · ${v.agent.firstName}` : ""}</span>
                    <span className="flex items-center gap-1.5 shrink-0 text-zinc-500">
                      {v.status === "VERIFIED" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : v.status === "FAILED" ? <XCircle className="h-3.5 w-3.5 text-rose-500" /> : <Clock className="h-3.5 w-3.5 text-amber-500" />}
                      {v.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* The credit bureau panel. The actions that used to sit under it now live in
              the header strip — see BorrowerActions. */}
          <Customer360Client borrowerId={b.id} initialCrb={initialCrb} />
        </div>
      </main>
  );
}
