import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, ScanFace, ShieldAlert, Landmark, MapPin, History, CheckCircle2, XCircle, Clock, FileText,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasFeature } from "@/lib/billing/entitlements";
import { portfolioEarlyWarning } from "@/lib/intelligence/earlywarning";
import type { CrbReport } from "@/lib/crb/provider";
import { Customer360Client } from "./Customer360Client";
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

  const b = await prisma.borrower.findFirst({
    where: { id, orgId },
    include: {
      loans: { orderBy: { createdAt: "desc" }, include: { product: { select: { name: true } }, installments: { select: { status: true, amountDue: true, amountPaid: true, dueDate: true } } } },
      fieldVisits: { orderBy: { createdAt: "desc" }, take: 5, include: { agent: { select: { firstName: true, otherName: true } } } },
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
  const activeLoan = b.loans.find((l) => l.status === "ACTIVE") ?? null;
  const olb = b.loans.filter((l) => l.status === "ACTIVE").reduce((s, l) => s + num(l.balance), 0);
  const clearedCount = b.loans.filter((l) => l.status === "CLEARED").length;

  return (
    <div className="min-h-screen relative text-zinc-900">
      <div aria-hidden className="fixed inset-0 z-0 bg-[url('/images/white-background.png')] bg-cover bg-center" />
      <main className="relative z-10 mx-auto max-w-5xl px-4 sm:px-6 py-8">
        <Link href="/console/borrowers" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800"><ArrowLeft className="h-4 w-4" /> Borrowers</Link>

        {/* Identity header */}
        <div className="mt-3 glass p-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl text-lg font-bold text-white shrink-0" style={{ backgroundColor: "var(--brand)" }}>
                {name.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl font-bold truncate">{name}</h1>
                  {b.graduationCount > 0 && <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">GRADUATED ×{b.graduationCount}</span>}
                  <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${KYC_TONE[b.kycStatus] ?? KYC_TONE.NONE}`}>KYC {b.kycStatus}</span>
                </div>
                <p className="mt-0.5 text-sm text-zinc-500 truncate">{b.phone}{b.nationalId ? ` · ID ${b.nationalId}` : ""}{b.locationAddress ? ` · ${b.locationAddress}` : ""}</p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 shrink-0">
              <Stat label="OLB" value={fmtKES(olb)} tone="text-[color:var(--brand)]" />
              <Stat label="Internal score" value={b.creditScore != null ? String(b.creditScore) : "—"} />
              <Stat label="Loans" value={`${b.loans.filter((l) => l.status === "ACTIVE").length}/${b.loans.length}`} />
            </div>
          </div>
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
              <p className="mt-3 text-sm text-zinc-500">No KYC session on file. <Link href="/verify" className="font-semibold" style={{ color: "var(--brand)" }}>Start verification</Link></p>
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
    </div>
  );
}
