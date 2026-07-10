"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useLoad } from "@/lib/hooks/useLoad";
import { motion, AnimatePresence } from "framer-motion";
import {
  ShieldCheck, IdCard, ScanFace, UserCheck, Landmark, CheckCircle2, AlertTriangle,
  ArrowRight, FlaskConical, Lock, Loader2, PartyPopper,
} from "lucide-react";
import { useBrand, lenderFromLocation } from "@/lib/lms/useBrand";
import { ConfidenceRing } from "./ConfidenceRing";
import { Capture, type CaptureSignals } from "./Capture";
import OtpCard, { type OtpIssue } from "@/components/portal/OtpCard";

// ── Elite KYC onboarding — the "we take not-getting-defaulted seriously" funnel.
// Step order: phone + OTP → ID capture (quality+OCR) → selfie liveness → face
// match + white-bg portrait → IPRS registry → decision. Every credentialed check
// runs in high-fidelity SIMULATION until the lender adds Smile ID keys.
//
// The OTP is not ceremony: this wizard writes a KycSession keyed to a phone, and
// that session is later promoted onto the Borrower row of whoever owns that
// number. Verifying possession first is what stops one person from attaching
// their verified face to another person's account.
type StepKey = "intro" | "otp" | "id" | "liveness" | "facematch" | "iprs" | "done";
const STEPS: { key: StepKey; label: string; icon: typeof IdCard }[] = [
  { key: "id", label: "ID", icon: IdCard },
  { key: "liveness", label: "Liveness", icon: ScanFace },
  { key: "facematch", label: "Face match", icon: UserCheck },
  { key: "iprs", label: "Registry", icon: Landmark },
];

export default function VerifyPage() {
  const [lender, setLender] = useState("hub");
  const [phone, setPhone] = useState("");
  const [otpIssue, setOtpIssue] = useState<OtpIssue | null>(null);
  const [nationalId, setNationalId] = useState("");
  const [step, setStep] = useState<StepKey>("intro");
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [mode, setMode] = useState<"simulation" | "live">("simulation");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, unknown>>({});
  const [preview, setPreview] = useState<string | null>(null);

  useLoad(() => { setLender(lenderFromLocation() ?? "hub"); });
  const brand = useBrand(lender);
  const brandStyle = useMemo(() => ({ ["--brand" as never]: brand.accent, ["--brand-soft" as never]: brand.accentSoft }), [brand]);

  // The phone is no longer sent — the server reads it from the verified session.
  const call = async (stepKey: string, payload: Record<string, unknown>) => {
    const res = await fetch("/api/portal/kyc", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lenderSlug: lender, nationalId, step: stepKey, sessionId, payload }),
    });
    return res.json();
  };

  const startVerification = async () => {
    setError(null);
    if (!phone.trim() || !nationalId.trim()) { setError("Enter your phone and ID to begin."); return; }
    setBusy(true);
    try {
      // Already verified this number with this lender? Don't spend another SMS.
      try {
        const s = await fetch(`/api/portal/session?phone=${encodeURIComponent(phone.trim())}`).then((r) => r.json());
        if (s?.authenticated && s.lenderSlug === lender && s.matchesPhone) { setStep("id"); return; }
      } catch { /* no session — issue a code as normal */ }

      const res = await fetch("/api/portal/otp", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lenderSlug: lender, phone: phone.trim() }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not send a code."); return; }
      setOtpIssue({ delivered: !!data.delivered, devCode: data.devCode });
      setStep("otp");
    } catch { setError("Could not send a code."); } finally { setBusy(false); }
  };

  const captureStep = async (stepKey: StepKey, sig: CaptureSignals) => {
    setBusy(true); setError(null); setPreview(sig.dataUrl);
    // Deliberate ~1.4s dwell so the scan animation reads as "analysing", not instant.
    await new Promise((r) => setTimeout(r, 1400));
    try {
      // The image itself now goes to the server, which stores it in a private
      // bucket once the step passes. Previously only the metrics were sent and
      // the photo died in the browser.
      const data = await call(stepKey, { bytes: sig.bytes, brightness: sig.brightness, blurVar: sig.blurVar, image: sig.dataUrl });
      if (data.needsOtp) { setStep("intro"); setOtpIssue(null); setError("Your session expired — verify your number again."); return; }
      if (!data.success) { setError(data.message || "Check failed."); return; }
      setSessionId(data.sessionId); setMode(data.mode);
      setResults((r) => ({ ...r, [stepKey]: data }));
      if (data.retake) { setError(gateMessage(data)); return; }
      advance(stepKey);
    } catch { setError("Something went wrong — try again."); } finally { setBusy(false); }
  };

  const runIprs = async () => {
    setBusy(true); setError(null);
    await new Promise((r) => setTimeout(r, 1200));
    try {
      const data = await call("iprs", {});
      if (data.needsOtp) { setStep("intro"); setOtpIssue(null); setError("Your session expired — verify your number again."); return; }
      if (!data.success) { setError(data.message); return; }
      setResults((r) => ({ ...r, iprs: data }));
      const fin = await call("finalize", {});
      setResults((r) => ({ ...r, finalize: fin }));
      setStep("done");
    } catch { setError("Registry check failed."); } finally { setBusy(false); }
  };

  const advance = (from: StepKey) => {
    setPreview(null); setError(null);
    if (from === "id") setStep("liveness");
    else if (from === "liveness") setStep("facematch");
    else if (from === "facematch") setStep("iprs");
  };

  const gateMessage = (d: Record<string, unknown>) => {
    const q = d.quality as { issues?: string[] } | undefined;
    const l = d.liveness as { passed?: boolean } | undefined;
    if (q?.issues?.length) {
      const map: Record<string, string> = {
        "resolution-too-low": "Image is too small — move closer and fill the frame.",
        "low-resolution": "A little blurry — hold steady and retake.",
        "glare-detected": "Too much glare — tilt away from the light.",
        "too-dark": "Too dark — find better lighting.",
        "image-blurry": "Out of focus — hold steady and retake.",
      };
      return map[q.issues[0]] ?? "Please retake a clearer photo.";
    }
    if (l && !l.passed) return "Couldn't confirm liveness — face the camera in good light and retake.";
    return "Please retake.";
  };

  const startStyle = "flex items-center gap-2 rounded-lg border border-zinc-900/15 bg-white/80 px-3";
  const input = "flex-1 bg-transparent outline-none text-sm py-3 placeholder:text-zinc-400";
  const stepIndex = STEPS.findIndex((s) => s.key === step);

  return (
    <div className="min-h-screen relative text-zinc-900" style={brandStyle}>
      <div aria-hidden className="fixed inset-0 z-0 bg-[url('/images/white-background.png')] bg-cover bg-center" />
      <div className="relative z-10 mx-auto max-w-md px-4 py-8">
        {/* Header + simulation badge */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" style={{ color: "var(--brand)" }} />
            <span className="text-sm font-bold">Identity verification</span>
          </div>
          {mode === "simulation" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-[10px] font-semibold text-amber-700">
              <FlaskConical className="h-3 w-3" /> DEMO MODE
            </span>
          )}
        </div>

        {/* Step rail — the OTP gate sits before the pipeline, so it has no rung. */}
        {step !== "intro" && step !== "otp" && step !== "done" && (
          <div className="mt-5 flex items-center gap-1.5">
            {STEPS.map((s, i) => (
              <div key={s.key} className="flex flex-1 items-center gap-1.5">
                <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-colors ${i < stepIndex ? "bg-emerald-500 text-white" : i === stepIndex ? "text-white" : "bg-zinc-900/5 text-zinc-400"}`}
                  style={i === stepIndex ? { backgroundColor: "var(--brand)" } : undefined}>
                  {i < stepIndex ? <CheckCircle2 className="h-4 w-4" /> : <s.icon className="h-4 w-4" />}
                </div>
                {i < STEPS.length - 1 && <div className={`h-0.5 flex-1 rounded ${i < stepIndex ? "bg-emerald-500" : "bg-zinc-900/10"}`} />}
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50/90 px-3 py-2.5 text-sm text-amber-800">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
          </div>
        )}

        <AnimatePresence mode="wait">
          <motion.div key={step} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.25 }} className="mt-5">
            {step === "intro" && (
              <div className="glass rounded-3xl bg-white/65 p-6">
                <div className="text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl" style={{ backgroundColor: "var(--brand-soft)" }}>
                    <ScanFace className="h-7 w-7" style={{ color: "var(--brand)" }} />
                  </div>
                  <h1 className="mt-4 text-2xl font-bold">Let&apos;s confirm it&apos;s really you</h1>
                  <p className="mt-2 text-sm text-zinc-500">A 60-second check: your ID, a quick selfie, and a registry match. Bank-grade, encrypted, and done once.</p>
                </div>
                <div className="mt-5 space-y-3">
                  <div className={startStyle}><input className={input} inputMode="tel" placeholder="Phone number (07XX…)" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
                  <div className={startStyle}><input className={input} inputMode="numeric" placeholder="National ID number" value={nationalId} onChange={(e) => setNationalId(e.target.value)} /></div>
                </div>
                <button onClick={startVerification} disabled={busy}
                  className="mt-5 w-full inline-flex items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold text-white disabled:opacity-60" style={{ backgroundColor: "var(--brand)" }}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Start verification <ArrowRight className="h-4 w-4" />
                </button>
                <p className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-zinc-400"><Lock className="h-3 w-3" /> Protected under the Data Protection Act</p>
              </div>
            )}

            {step === "otp" && otpIssue && (
              <OtpCard
                lenderSlug={lender}
                phone={phone.trim()}
                issue={otpIssue}
                onVerified={() => { setError(null); setStep("id"); }}
                onChangeNumber={() => { setOtpIssue(null); setError(null); setStep("intro"); }}
              />
            )}

            {step === "id" && (
              <div className="glass rounded-3xl bg-white/65 p-5">
                <h2 className="text-base font-bold">Scan the front of your ID</h2>
                <p className="mt-1 text-xs text-zinc-500">Lay it flat, fill the frame, avoid glare.</p>
                <div className="mt-4">
                  <Capture frame="id" facing="environment" busy={busy} onCapture={(s) => captureStep("id", s)} />
                </div>
                {(results.id as { ocr?: { fullName?: string; confidence?: number } })?.ocr && (
                  <ExtractedCard ocr={(results.id as { ocr: { fullName: string; idNumber: string; dob: string; confidence: number } }).ocr} />
                )}
              </div>
            )}

            {step === "liveness" && (
              <div className="glass rounded-3xl bg-white/65 p-5">
                <h2 className="text-base font-bold">Now a quick selfie</h2>
                <p className="mt-1 text-xs text-zinc-500">Look straight at the camera — we check you&apos;re a live person, not a photo.</p>
                <div className="mt-4">
                  <Capture frame="face" facing="user" busy={busy} onCapture={(s) => captureStep("liveness", s)} />
                </div>
              </div>
            )}

            {step === "facematch" && (
              <FaceMatchStep preview={preview} busy={busy} result={results.facematch as never}
                onRun={(s) => captureStep("facematch", s)} />
            )}

            {step === "iprs" && (
              <div className="glass rounded-3xl bg-white/65 p-6 text-center">
                <Landmark className="mx-auto h-10 w-10" style={{ color: "var(--brand)" }} />
                <h2 className="mt-3 text-base font-bold">Government registry match</h2>
                <p className="mt-1 text-xs text-zinc-500">We confirm your ID against the national registry (IPRS).</p>
                <button onClick={runIprs} disabled={busy}
                  className="mt-5 w-full inline-flex items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold text-white disabled:opacity-60" style={{ backgroundColor: "var(--brand)" }}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Run registry check
                </button>
              </div>
            )}

            {step === "done" && <DoneCard results={results} brandName={brand.name} lender={lender} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function ExtractedCard({ ocr }: { ocr: { fullName: string; idNumber: string; dob: string; confidence: number } }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Details read ({ocr.confidence}% confidence)</p>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <div><span className="text-zinc-400">Name</span><p className="font-semibold">{ocr.fullName}</p></div>
        <div><span className="text-zinc-400">ID No.</span><p className="font-semibold">{ocr.idNumber}</p></div>
        <div><span className="text-zinc-400">DOB</span><p className="font-semibold">{ocr.dob}</p></div>
      </div>
    </motion.div>
  );
}

function FaceMatchStep({ preview, busy, result, onRun }: { preview: string | null; busy: boolean; result: { faceMatch?: { score: number; band: string } } | undefined; onRun: (s: CaptureSignals) => void }) {
  const fm = result?.faceMatch;
  return (
    <div className="glass rounded-3xl bg-white/65 p-6">
      <h2 className="text-base font-bold">Matching your face to your ID</h2>
      <p className="mt-1 text-xs text-zinc-500">One more selfie so we can compare it to your ID portrait.</p>
      {!fm ? (
        <div className="mt-4"><Capture frame="face" facing="user" busy={busy} onCapture={onRun} /></div>
      ) : (
        <div className="mt-5 flex flex-col items-center">
          <ConfidenceRing value={fm.score} label="similarity" />
          <p className={`mt-3 text-sm font-semibold ${fm.band === "match" ? "text-emerald-600" : fm.band === "review" ? "text-amber-600" : "text-red-600"}`}>
            {fm.band === "match" ? "Strong match ✓" : fm.band === "review" ? "Needs a human review" : "Not a match"}
          </p>
          <p className="mt-1 text-[11px] text-zinc-400">Background removed · standardized to a white portrait</p>
        </div>
      )}
    </div>
  );
}

function DoneCard({ results, brandName, lender }: { results: Record<string, unknown>; brandName: string; lender: string }) {
  const fin = results.finalize as { status?: string; flags?: string[] } | undefined;
  const verified = fin?.status === "VERIFIED";
  const review = fin?.status === "PENDING_REVIEW";
  const fm = (results.facematch as { faceMatch?: { score: number } })?.faceMatch;
  const live = (results.liveness as { liveness?: { score: number } })?.liveness;
  const iprs = (results.iprs as { iprs?: { matched: boolean; name: string } })?.iprs;
  return (
    <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="glass rounded-3xl bg-white/70 p-6 text-center">
      <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", delay: 0.1 }}
        className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${verified ? "bg-emerald-100" : review ? "bg-amber-100" : "bg-red-100"}`}>
        {verified ? <PartyPopper className="h-8 w-8 text-emerald-600" /> : review ? <UserCheck className="h-8 w-8 text-amber-600" /> : <AlertTriangle className="h-8 w-8 text-red-600" />}
      </motion.div>
      <h1 className="mt-4 text-2xl font-bold">{verified ? "You're verified!" : review ? "Almost there" : "We need another look"}</h1>
      <p className="mt-2 text-sm text-zinc-500">
        {verified ? `Your identity is confirmed with ${brandName}. You can now apply for a loan.`
          : review ? "Your face match needs a quick human review — an officer will confirm shortly."
          : "Some checks didn't pass. An officer will reach out to help."}
      </p>
      <div className="mt-5 grid grid-cols-3 gap-2 text-center">
        {[["Liveness", live?.score], ["Face", fm?.score], ["Registry", iprs?.matched ? 100 : 0]].map(([k, v]) => (
          <div key={k as string} className="rounded-xl border border-zinc-900/10 bg-white/70 p-2.5">
            <p className="text-lg font-bold" style={{ color: "var(--brand)" }}>{v != null ? `${v}%` : "—"}</p>
            <p className="text-[10px] uppercase tracking-wide text-zinc-500">{k}</p>
          </div>
        ))}
      </div>
      {verified && (
        <Link href={`/?lender=${lender}`} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold text-white" style={{ backgroundColor: "var(--brand)" }}>
          Continue to your loan <ArrowRight className="h-4 w-4" />
        </Link>
      )}
    </motion.div>
  );
}
