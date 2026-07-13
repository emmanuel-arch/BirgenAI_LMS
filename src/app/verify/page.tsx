"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE BORROWER'S DOOR into KYC — they verify themselves, on their own phone.
//
// Order: phone + OTP → the pipeline (ID, liveness, face match, registry) → decision.
// The OTP is not ceremony. This wizard writes a KycSession keyed to a phone, and
// that session is later promoted onto the Borrower row of whoever owns that number.
// Proving possession first is what stops one person from attaching their verified
// face to another person's account.
//
// The pipeline itself lives in components/kyc/VerifyFlow — the SAME component the
// officer drives at the counter, so a customer verified at home went through exactly
// the checks a customer verified at the branch did.
//
// WHICH LENDER. This page has no session to ask, so it reads the lender from the
// address bar: the subdomain, or ?lender=. When neither is there it now STOPS. It
// used to fall back to a default org, which meant a verification could be written
// into a lender's book that had never heard of the person — see the note in
// api/console/kyc/verify/route.ts. A KYC record filed against the wrong tenant is
// worse than no KYC record, because everyone believes it exists.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useLoad } from "@/lib/hooks/useLoad";
import { motion } from "framer-motion";
import {
  ShieldCheck, ScanFace, UserCheck, AlertTriangle, ArrowRight, Lock, Loader2, PartyPopper, Building2,
} from "lucide-react";
import { useBrand, lenderFromLocation } from "@/lib/lms/useBrand";
import { useLang } from "@/lib/i18n/useLang";
import { fmt, type PortalDict } from "@/lib/i18n/portal";
import { LangToggle } from "@/components/portal/LangToggle";
import { VerifyFlow, type FlowOutcome, type KycPost } from "@/components/kyc/VerifyFlow";
import OtpCard, { type OtpIssue } from "@/components/portal/OtpCard";

type Gate = "resolving" | "no-lender" | "intro" | "otp" | "pipeline" | "done";

export default function VerifyPage() {
  const { lang, t } = useLang();
  const [lender, setLender] = useState<string | null>(null);
  const [gate, setGate] = useState<Gate>("resolving");
  const [phone, setPhone] = useState("");
  const [otpIssue, setOtpIssue] = useState<OtpIssue | null>(null);
  const [nationalId, setNationalId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<FlowOutcome | null>(null);

  useLoad(() => {
    const slug = lenderFromLocation();
    setLender(slug);
    setGate(slug ? "intro" : "no-lender");
  });

  const brand = useBrand(lender);
  const brandStyle = useMemo(() => ({ ["--brand" as never]: brand.accent, ["--brand-soft" as never]: brand.accentSoft }), [brand]);

  // The phone is never sent — the server reads it from the verified session.
  const post: KycPost = useCallback(async (step, payload) => {
    const { sessionId, ...rest } = payload as { sessionId?: string };
    const res = await fetch("/api/portal/kyc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lenderSlug: lender, nationalId, step, sessionId, payload: rest }),
    });
    return res.json();
  }, [lender, nationalId]);

  const startVerification = async () => {
    setError(null);
    if (!phone.trim() || !nationalId.trim()) { setError(t.verify.enterPhoneAndId); return; }
    setBusy(true);
    try {
      // Already verified this number with this lender? Don't spend another SMS.
      try {
        const s = await fetch(`/api/portal/session?phone=${encodeURIComponent(phone.trim())}`).then((r) => r.json());
        if (s?.authenticated && s.lenderSlug === lender && s.matchesPhone) { setGate("pipeline"); return; }
      } catch { /* no session — issue a code as normal */ }

      const res = await fetch("/api/portal/otp", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lenderSlug: lender, phone: phone.trim(), lang }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || t.errors.couldNotSendCode); return; }
      setOtpIssue({ delivered: !!data.delivered, devCode: data.devCode });
      setGate("otp");
    } catch { setError(t.errors.couldNotSendCode); } finally { setBusy(false); }
  };

  const startStyle = "flex items-center gap-2 rounded-lg border border-zinc-900/15 bg-white/80 px-3";
  const input = "flex-1 bg-transparent outline-none text-sm py-3 placeholder:text-zinc-400";

  return (
    <div className="relative min-h-screen text-zinc-900" style={brandStyle}>
      <div aria-hidden className="fixed inset-0 z-0 bg-[url('/images/white-background.png')] bg-cover bg-center" />
      <div className="relative z-10 mx-auto max-w-3xl px-4 py-8">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" style={{ color: "var(--brand)" }} />
            <span className="text-sm font-bold">{t.verify.heading}</span>
          </div>
          <LangToggle />
        </div>

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50/90 px-3 py-2.5 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        {gate === "resolving" && (
          <div className="mt-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-zinc-400" /></div>
        )}

        {/* The honest stop. We will not guess whose customer this is. */}
        {gate === "no-lender" && (
          <div className="glass mt-5 rounded-3xl bg-white/65 p-6 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-900/5">
              <Building2 className="h-7 w-7 text-zinc-400" />
            </div>
            <h1 className="mt-4 text-xl font-bold">{t.verify.noLenderTitle}</h1>
            <p className="mt-2 text-sm leading-relaxed text-zinc-500">
              {t.verify.noLenderBody} <span className="font-semibold text-zinc-700">yourlender.birgenai.com</span>.
            </p>
          </div>
        )}

        {gate === "intro" && (
          <div className="glass mt-5 rounded-3xl bg-white/65 p-6">
            <div className="text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl" style={{ backgroundColor: "var(--brand-soft)" }}>
                <ScanFace className="h-7 w-7" style={{ color: "var(--brand)" }} />
              </div>
              <h1 className="mt-4 text-2xl font-bold">{t.verify.introTitle}</h1>
              <p className="mt-2 text-sm text-zinc-500">
                {fmt(t.verify.introSub, { name: brand.name })}
              </p>
            </div>
            <div className="mt-5 space-y-3">
              <div className={startStyle}><input className={input} inputMode="tel" placeholder={t.verify.phonePlaceholder} value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
              <div className={startStyle}><input className={input} inputMode="numeric" placeholder={t.verify.idPlaceholder} value={nationalId} onChange={(e) => setNationalId(e.target.value)} /></div>
            </div>
            <button onClick={startVerification} disabled={busy}
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold text-white disabled:opacity-60" style={{ backgroundColor: "var(--brand)" }}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {t.verify.start} <ArrowRight className="h-4 w-4" />
            </button>
            <p className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-zinc-400"><Lock className="h-3 w-3" /> {t.verify.dpaNote}</p>
          </div>
        )}

        {gate === "otp" && otpIssue && lender && (
          <div className="mt-5">
            <OtpCard
              lenderSlug={lender}
              phone={phone.trim()}
              issue={otpIssue}
              onVerified={() => { setError(null); setGate("pipeline"); }}
              onChangeNumber={() => { setOtpIssue(null); setError(null); setGate("intro"); }}
            />
          </div>
        )}

        {gate === "pipeline" && (
          <VerifyFlow
            post={post}
            onDone={(o) => { setOutcome(o); setGate("done"); }}
            onSessionExpired={() => { setOtpIssue(null); setGate("intro"); setError(t.errors.sessionExpired); }}
          />
        )}

        {gate === "done" && outcome && <DoneCard outcome={outcome} brandName={brand.name} lender={lender ?? ""} t={t} />}
      </div>
    </div>
  );
}

function DoneCard({ outcome, brandName, lender, t }: { outcome: FlowOutcome; brandName: string; lender: string; t: PortalDict }) {
  const verified = outcome.status === "VERIFIED";
  const review = outcome.status === "PENDING_REVIEW";
  const fm = (outcome.results.facematch as { faceMatch?: { score: number } })?.faceMatch;
  const live = (outcome.results.liveness as { liveness?: { score: number } })?.liveness;
  const iprs = (outcome.results.iprs as { iprs?: { matched: boolean } })?.iprs;

  return (
    <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="glass mt-5 rounded-3xl bg-white/70 p-6 text-center">
      <motion.div
        initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", delay: 0.1 }}
        className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${verified ? "bg-emerald-100" : review ? "bg-amber-100" : "bg-red-100"}`}
      >
        {verified ? <PartyPopper className="h-8 w-8 text-emerald-600" /> : review ? <UserCheck className="h-8 w-8 text-amber-600" /> : <AlertTriangle className="h-8 w-8 text-red-600" />}
      </motion.div>
      <h1 className="mt-4 text-2xl font-bold">{verified ? t.verify.doneVerified : review ? t.verify.doneReview : t.verify.doneFailed}</h1>
      <p className="mt-2 text-sm text-zinc-500">
        {verified ? fmt(t.verify.doneVerifiedSub, { name: brandName })
          : review ? t.verify.doneReviewSub
          : t.verify.doneFailedSub}
      </p>
      <div className="mt-5 grid grid-cols-3 gap-2 text-center">
        {([[t.verify.liveness, live?.score], [t.verify.face, fm?.score], [t.verify.registry, iprs?.matched ? 100 : 0]] as const).map(([k, v]) => (
          <div key={k} className="rounded-xl border border-zinc-900/10 bg-white/70 p-2.5">
            <p className="text-lg font-bold" style={{ color: "var(--brand)" }}>{v != null ? `${v}%` : "—"}</p>
            <p className="text-[10px] uppercase tracking-wide text-zinc-500">{k}</p>
          </div>
        ))}
      </div>
      {verified && lender && (
        <Link href={`/?lender=${lender}`} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold text-white" style={{ backgroundColor: "var(--brand)" }}>
          {t.verify.continueToLoan} <ArrowRight className="h-4 w-4" />
        </Link>
      )}
    </motion.div>
  );
}
