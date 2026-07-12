"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE KYC PIPELINE — ID → liveness → face match → registry.
//
// One wizard, two front doors, and that is the whole point of extracting it.
//
//   THE BORROWER'S DOOR  (/verify)          — they verify themselves on their own
//     phone, having proved possession of the number with an OTP first. The org is
//     whichever lender's subdomain they arrived on.
//   THE COUNTER'S DOOR   (/console/kyc/[id]) — an officer verifies a customer who
//     is standing in front of them. The org is the officer's own org, from their
//     session, and the borrower is one they explicitly opened.
//
// The steps are identical; only the endpoint and who vouches for the binding
// differ. Keeping them one component is not tidiness — it is the guarantee that a
// customer verified at the counter went through exactly the checks a customer
// verified at home did. The moment these are two code paths, they start to drift,
// and the weaker one becomes the way in.
//
// `post` is the seam. Everything the flow knows about the world arrives through it.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  IdCard, ScanFace, UserCheck, Landmark, CheckCircle2, AlertTriangle, ShieldCheck, Loader2, FlaskConical,
} from "lucide-react";
import { ConfidenceRing } from "./ConfidenceRing";
import { Capture, type CaptureSignals } from "./Capture";

export type PipelineStep = "id" | "liveness" | "facematch" | "iprs";
export type StepResults = Record<string, unknown>;

/** The one seam: how this flow talks to a server. Portal and console pass different ones. */
export type KycPost = (step: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>>;

export type FlowOutcome = {
  status: string; // VERIFIED | PENDING_REVIEW | FAILED
  flags: string[];
  results: StepResults;
};

const STEPS: { key: PipelineStep; label: string; icon: typeof IdCard }[] = [
  { key: "id", label: "ID", icon: IdCard },
  { key: "liveness", label: "Liveness", icon: ScanFace },
  { key: "facematch", label: "Face match", icon: UserCheck },
  { key: "iprs", label: "Registry", icon: Landmark },
];

/** Turn a machine's quality verdict into something a person can act on. */
function gateMessage(d: Record<string, unknown>): string {
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
}

export function VerifyFlow({
  post,
  onDone,
  onSessionExpired,
  /** Rendered above the rail — the console names the customer, the portal doesn't need to. */
  header,
}: {
  post: KycPost;
  onDone: (outcome: FlowOutcome) => void;
  /** The borrower's OTP lapsed mid-flow. Only the portal can do anything about it. */
  onSessionExpired?: () => void;
  header?: React.ReactNode;
}) {
  const [step, setStep] = useState<PipelineStep>("id");
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [mode, setMode] = useState<"simulation" | "live">("simulation");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<StepResults>({});
  const [preview, setPreview] = useState<string | null>(null);
  // Active liveness: the server issues the challenges, one captured frame each.
  const [challenges, setChallenges] = useState<string[] | null>(null);
  const [frames, setFrames] = useState<{ challenge: string; bytes: number; image: string }[]>([]);

  const call = async (stepKey: string, payload: Record<string, unknown>) => post(stepKey, { ...payload, sessionId });

  /** Every response passes through here, so "your session died" is handled once. */
  const accept = (data: Record<string, unknown>): boolean => {
    if (data.needsOtp) {
      setError("The verification session expired — start again.");
      onSessionExpired?.();
      return false;
    }
    if (!data.success) {
      setError((data.message as string) || "That step could not be completed.");
      return false;
    }
    if (data.sessionId) setSessionId(data.sessionId as string);
    if (data.mode) setMode(data.mode as "simulation" | "live");
    return true;
  };

  const advance = (from: PipelineStep) => {
    setPreview(null);
    setError(null);
    if (from === "id") setStep("liveness");
    else if (from === "liveness") setStep("facematch");
    else if (from === "facematch") setStep("iprs");
  };

  const captureStep = async (stepKey: PipelineStep, sig: CaptureSignals) => {
    setBusy(true);
    setError(null);
    setPreview(sig.dataUrl);
    // A deliberate dwell so the scan animation reads as "analysing", not "instant".
    await new Promise((r) => setTimeout(r, 1400));
    try {
      const data = await call(stepKey, { bytes: sig.bytes, brightness: sig.brightness, blurVar: sig.blurVar, image: sig.dataUrl });
      if (!accept(data)) return;
      setResults((r) => ({ ...r, [stepKey]: data }));
      if (data.retake) { setError(gateMessage(data)); return; }
      advance(stepKey);
    } catch {
      setError("Something went wrong — try again.");
    } finally {
      setBusy(false);
    }
  };

  // What to DO arrives before the camera opens. The server derives the same
  // challenges again at verification time, so these cannot be swapped for easier ones.
  const startLiveness = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await call("liveness-challenges", {});
      if (!accept(data)) return;
      setChallenges(data.challenges as string[]);
      setFrames([]);
    } catch {
      setError("Could not start the liveness check.");
    } finally {
      setBusy(false);
    }
  };

  const captureLivenessFrame = async (sig: CaptureSignals) => {
    if (!challenges) return;
    const next = [...frames, { challenge: challenges[frames.length], bytes: sig.bytes, image: sig.dataUrl }];
    if (next.length < challenges.length) { setFrames(next); return; }

    setBusy(true);
    setError(null);
    setPreview(sig.dataUrl);
    await new Promise((r) => setTimeout(r, 1200));
    try {
      const data = await call("liveness", { frames: next });
      if (!accept(data)) { setFrames([]); return; }
      setResults((r) => ({ ...r, liveness: data }));
      if (data.retake) {
        setFrames([]);
        setError("Couldn't confirm liveness — follow each prompt in good light and try again.");
        return;
      }
      setFrames([]);
      advance("liveness");
    } catch {
      setError("Something went wrong — try again.");
      setFrames([]);
    } finally {
      setBusy(false);
    }
  };

  const runIprs = async () => {
    setBusy(true);
    setError(null);
    await new Promise((r) => setTimeout(r, 1200));
    try {
      const data = await call("iprs", {});
      if (!accept(data)) return;
      const withIprs = { ...results, iprs: data };
      setResults(withIprs);

      const fin = await call("finalize", {});
      if (!accept(fin)) return;
      onDone({
        status: (fin.status as string) ?? "FAILED",
        flags: (fin.flags as string[]) ?? [],
        results: { ...withIprs, finalize: fin },
      });
    } catch {
      setError("Registry check failed.");
    } finally {
      setBusy(false);
    }
  };

  const stepIndex = STEPS.findIndex((s) => s.key === step);

  return (
    <div>
      {header}

      {mode === "simulation" && (
        <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold text-amber-700">
          <FlaskConical className="h-3 w-3" /> DEMO MODE — no licensed identity provider connected
        </p>
      )}

      {/* Step rail */}
      <div className="mt-5 flex items-center gap-1.5">
        {STEPS.map((s, i) => (
          <div key={s.key} className="flex flex-1 items-center gap-1.5">
            <div
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                i < stepIndex ? "bg-emerald-500 text-white" : i === stepIndex ? "text-white" : "bg-zinc-900/5 text-zinc-400"
              }`}
              style={i === stepIndex ? { backgroundColor: "var(--brand)" } : undefined}
            >
              {i < stepIndex ? <CheckCircle2 className="h-4 w-4" /> : <s.icon className="h-4 w-4" />}
            </div>
            {i < STEPS.length - 1 && <div className={`h-0.5 flex-1 rounded ${i < stepIndex ? "bg-emerald-500" : "bg-zinc-900/10"}`} />}
          </div>
        ))}
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50/90 px-3 py-2.5 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.25 }}
          className="mt-5"
        >
          {step === "id" && (
            <div className="glass rounded-3xl bg-white/65 p-5">
              <h2 className="text-base font-bold">Scan the front of the ID</h2>
              <p className="mt-1 text-xs text-zinc-500">Lay it flat, fill the frame, avoid glare.</p>
              <div className="mt-4">
                <Capture frame="id" facing="environment" busy={busy} onCapture={(s) => captureStep("id", s)} />
              </div>
              {(results.id as { ocr?: { fullName?: string } })?.ocr && (
                <ExtractedCard ocr={(results.id as { ocr: { fullName: string; idNumber: string; dob: string; confidence: number } }).ocr} />
              )}
            </div>
          )}

          {step === "liveness" && (
            <div className="glass rounded-3xl bg-white/65 p-5">
              <h2 className="text-base font-bold">Liveness check</h2>
              {!challenges ? (
                <>
                  <p className="mt-1 text-xs text-zinc-500">
                    Two quick things a photograph cannot do — that is how we know this is a live person.
                  </p>
                  <button
                    onClick={startLiveness}
                    disabled={busy}
                    className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
                    style={{ backgroundColor: "var(--brand)" }}
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanFace className="h-4 w-4" />} Start the check
                  </button>
                </>
              ) : (
                <>
                  <div className="mt-2 rounded-lg px-3 py-2 text-sm font-semibold text-white" style={{ backgroundColor: "var(--brand)" }}>
                    {frames.length + 1} of {challenges.length}: {challenges[frames.length].charAt(0).toUpperCase() + challenges[frames.length].slice(1)}
                  </div>
                  <p className="mt-1.5 text-xs text-zinc-500">Do it, then capture — face the camera in good light.</p>
                  <div className="mt-3">
                    <Capture frame="face" facing="user" busy={busy} onCapture={captureLivenessFrame} />
                  </div>
                </>
              )}
            </div>
          )}

          {step === "facematch" && (
            <FaceMatchStep busy={busy} result={results.facematch as never} onRun={(s) => captureStep("facematch", s)} />
          )}

          {step === "iprs" && (
            <div className="glass rounded-3xl bg-white/65 p-6 text-center">
              <Landmark className="mx-auto h-10 w-10" style={{ color: "var(--brand)" }} />
              <h2 className="mt-3 text-base font-bold">Government registry match</h2>
              <p className="mt-1 text-xs text-zinc-500">The ID is confirmed against the national registry (IPRS).</p>
              <button
                onClick={runIprs}
                disabled={busy}
                className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
                style={{ backgroundColor: "var(--brand)" }}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Run registry check
              </button>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* The captured frame, held while the machine looks at it. */}
      {preview && busy && <p className="mt-3 text-center text-[11px] text-zinc-400">Analysing the capture…</p>}
    </div>
  );
}

function ExtractedCard({ ocr }: { ocr: { fullName: string; idNumber: string; dob: string; confidence: number } }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
        <CheckCircle2 className="h-3.5 w-3.5" /> Details read ({ocr.confidence}% confidence)
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <div><span className="text-zinc-400">Name</span><p className="font-semibold">{ocr.fullName}</p></div>
        <div><span className="text-zinc-400">ID No.</span><p className="font-semibold">{ocr.idNumber}</p></div>
        <div><span className="text-zinc-400">DOB</span><p className="font-semibold">{ocr.dob}</p></div>
      </div>
    </motion.div>
  );
}

function FaceMatchStep({ busy, result, onRun }: {
  busy: boolean;
  result: { faceMatch?: { score: number; band: string } } | undefined;
  onRun: (s: CaptureSignals) => void;
}) {
  const fm = result?.faceMatch;
  return (
    <div className="glass rounded-3xl bg-white/65 p-6">
      <h2 className="text-base font-bold">Matching the face to the ID</h2>
      <p className="mt-1 text-xs text-zinc-500">One more selfie, compared against the ID portrait.</p>
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
