import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, ScanFace, ShieldAlert, Landmark, MapPin, History, CheckCircle2, XCircle, Clock, FileText, BadgeCheck,
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
import { RequestPaymentButton } from "@/components/payments/RequestPayment";
import { RiskBandCard } from "@/components/risk/RiskBandCard";
import { bandForScore, bandForBehavioural, defaultProbability, normaliseBandName, BAND_BY_KEY } from "@/lib/risk/bands";
import { assessGraduation } from "@/lib/risk/graduation";
import KycGallery from "./KycGallery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fmtKES = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
const num = (d: unknown) => Number(d ?? 0);
const dateFmt = (d: Date | string) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

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
  const [kyc, scores, crbCheck, ew] = await Promise.all([
    prisma.kycSession.findFirst({ where: { orgId, OR: [{ borrowerId: id }, { phone: b.phone }] }, orderBy: { createdAt: "desc" } }),
    prisma.scoreSnapshot.findMany({ where: { orgId, borrowerId: id }, orderBy: { createdAt: "desc" }, take: 8 }),
    prisma.kycCheck.findFirst({ where: { orgId, borrowerId: id, kind: "CRB" }, orderBy: { createdAt: "desc" } }),
    scanEntitled ? portfolioEarlyWarning(orgId) : null,
  ]);
  const risk = ew?.rows.find((r) => r.borrowerId === id) ?? null;
  const initialCrb = (crbCheck?.payload as unknown as CrbReport) ?? null;

  const name = `${b.firstName ?? "Borrower"}${b.otherName ? " " + b.otherName : ""}`.trim();
  const verified = b.kycStatus === "VERIFIED";

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
  const activeLoan = b.loans.find((l) => l.status === "ACTIVE") ?? null;
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
            relative z-20: every glass panel is its own stacking context (backdrop
            blur), so without this the kebab dropdown paints UNDER the panels below. */}
        <div className="relative z-20 mt-3 glass p-5">
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
              loanLimit={b.loanLimit != null ? Number(b.loanLimit) : null}
              creditScore={b.creditScore}
              riskBand={b.riskBand}
              nextOfKin={(b.nextOfKin as { name?: string; relationship?: string; phone?: string } | null) ?? null}
              verified={verified}
            />
          </div>
          <div className="flex items-start justify-between gap-4 flex-wrap pr-8 sm:pr-10">
            <div className="flex items-center gap-4 min-w-0">
              <BorrowerAvatar name={name} portraitUrl={portraitUrl} verified={verified} size="xl" />
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl font-bold truncate">{name}</h1>
                  {b.graduationCount > 0 && <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">GRADUATED ×{b.graduationCount}</span>}
                  <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${KYC_TONE[b.kycStatus] ?? KYC_TONE.NONE}`}>KYC {b.kycStatus}</span>
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
                {verified ? (
                  // Passing KYC is the only moment a customer is unambiguously better off
                  // than they were an hour ago. Say so — the absence of a warning is not
                  // the same as good news.
                  <p className="mt-1 flex items-center gap-1.5 text-[12px] font-medium text-emerald-700">
                    <BadgeCheck className="h-3.5 w-3.5" />
                    Identity verified{b.kycVerifiedAt ? ` on ${dateFmt(b.kycVerifiedAt)}` : ""} — cleared for disbursement.
                  </p>
                ) : (
                  <p className="mt-1 text-[12px] font-medium text-amber-700">
                    Identity not verified — no money can be disbursed to this borrower yet.
                  </p>
                )}
              </div>
            </div>
            {/* Full-width row under the identity on a phone (shrink-0 alone would
                push the third tile off the screen); a fixed strip beside it on sm+. */}
            <div className="flex w-full items-start gap-2 sm:w-auto sm:shrink-0">
              <div className="grid flex-1 grid-cols-3 gap-2 sm:flex-none">
                <Stat label="OLB" value={fmtKES(olb)} tone="text-[color:var(--brand)]" />
                <Stat label="Internal score" value={b.creditScore != null ? String(b.creditScore) : "—"} />
                <Stat label="Loans" value={`${b.loans.filter((l) => l.status === "ACTIVE").length}/${b.loans.length}`} />
              </div>
              {/* ASKING FOR MONEY IS A PRIMARY ACT, not a menu item buried behind a
                  kebab. Same component, same endpoint, same fees as the collections
                  queue and the counter — see components/payments/RequestPayment. */}
              <RequestPaymentButton
                borrowerId={b.id}
                borrowerName={name}
                channel="c360"
                label="Request payment"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2.5 text-xs font-semibold text-white hover:bg-emerald-700"
              />
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

          {/* CRB + recovery actions (client) */}
          <Customer360Client
            borrowerId={b.id}
            activeLoanId={activeLoan?.id ?? null}
            phone={b.phone}
            lat={b.lat}
            lng={b.lng}
            name={name}
            initialCrb={initialCrb}
            fieldEntitled={fieldEntitled}
          />
        </div>
      </main>
  );
}
