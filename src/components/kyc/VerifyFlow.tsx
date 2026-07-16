"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE KYC PIPELINE — three steps, three questions, three vendors.
//
//   1. ID + REGISTRY  Google Vision reads the card; IPRS says who that number
//                     belongs to; and THE NAME ON THE CARD MUST BE THE NAME IN THE
//                     REGISTRY. That is the fraud gate. A borrowed or altered ID
//                     dies here, before a photograph is ever taken, and the wizard
//                     will not advance past it.
//   2. FACE MATCH     One selfie, compared by AWS Rekognition against the portrait
//                     printed on the document we just stored.
//   3. REGISTRY       The government record, shown. (Not re-queried — the lookup is
//                     billed, and step 1 already asked.)
//
// LIVENESS CHALLENGES ARE GONE. "Blink twice, now smile" is theatre against a photo
// held up to a webcam, and it cost the customer thirty seconds. The real anti-spoof
// signal is Rekognition's face detection — one face, front-on, eyes open — and it
// now runs inside step 2 where it belongs.
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
//
// THE THEATRE IS HONEST. Every scan sweep, rising percentage and confidence ring
// on this screen is staging around a REAL server round-trip — the progress bar
// only completes when the check actually returned, the score in the ring is the
// score the server stored, and the evidence tray shows the exact frames that were
// submitted. Nothing animates its way past a failed check. (Same contract as the
// statement cruncher's CrunchTheatre.)
//
// THE WIZARD SPEAKS THE CUSTOMER'S LANGUAGE (useLang). At the counter that means
// the officer can flip it to Kiswahili for the person facing the camera — the
// coach chips and challenge prompts are read by the CUSTOMER, not the officer.
// The server's challenge strings stay English on the wire (they are re-derived
// and verified server-side); the dictionary translates the known set for display.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  IdCard, UserCheck, Landmark, CheckCircle2, AlertTriangle, ShieldCheck, Loader2, FlaskConical, ArrowRight, XCircle,
} from "lucide-react";
import { useLang } from "@/lib/i18n/useLang";
import { fmt, type PortalDict } from "@/lib/i18n/portal";
import { ConfidenceRing } from "./ConfidenceRing";
import { Capture, type CaptureSignals } from "./Capture";

export type PipelineStep = "id" | "facematch" | "iprs";
export type StepResults = Record<string, unknown>;

/** The one seam: how this flow talks to a server. Portal and console pass different ones. */
export type KycPost = (step: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>>;

export type FlowOutcome = {
  status: string; // VERIFIED | PENDING_REVIEW | FAILED
  flags: string[];
  results: StepResults;
};

const STEPS: { key: PipelineStep; icon: typeof IdCard }[] = [
  { key: "id", icon: IdCard },
  { key: "facematch", icon: UserCheck },
  { key: "iprs", icon: Landmark },
];

const stepLabel = (key: PipelineStep, t: PortalDict): string =>
  key === "id" ? t.kyc.stepId : key === "facematch" ? t.kyc.stepFace : t.kyc.stepRegistry;

/** What the pipeline can actually do right now, leg by leg (see kyc/provider.ts). */
export type Capabilities = { ocr: "live" | "simulation"; registry: "live" | "simulation"; face: "live" | "simulation" };

/** The registry's verdict on the name printed on the card. */
type NameGate = {
  verdict: "exact" | "strong" | "partial" | "none";
  score: number;
  shared: string[];
  onlyOnDocument: string[];
  onlyInRegistry: string[];
  summary: string;
};

/**
 * Turn a machine's verdict into something a person can act on.
 *
 * The server now sends a written `message` for the two cases where the words matter
 * most — a name that does not match the registry, and a selfie it could not use. It
 * is a whole sentence, aimed at whoever is standing there, so it wins over any
 * generic string we could pick from a table.
 */
function gateMessage(d: Record<string, unknown>, t: PortalDict): string {
  if (typeof d.message === "string" && d.message.trim()) return d.message;
  const q = d.quality as { issues?: string[] } | undefined;
  if (q?.issues?.length) return t.kyc.gates[q.issues[0]] ?? t.kyc.gateDefault;
  return t.kyc.gateDefault;
}

/** How long a successful step's result stays on screen before auto-advancing. */
const REVEAL_MS = 2600;

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
  const { t } = useLang();
  const [step, setStep] = useState<PipelineStep>("id");
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [mode, setMode] = useState<"simulation" | "live">("simulation");
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<StepResults>({});
  // The result of the step that JUST passed, held on screen before advancing.
  const [reveal, setReveal] = useState<PipelineStep | null>(null);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The evidence: the exact frames that were submitted, kept visible throughout.
  const [idImage, setIdImage] = useState<string | null>(null);
  const [selfieImage, setSelfieImage] = useState<string | null>(null);
  const [analysing, setAnalysing] = useState<string | null>(null); // the frame under the scanner right now
  // The id step FAILED to bind to this customer (wrong person's ID). We keep the
  // extraction on screen — mismatch highlighted — instead of silently returning to
  // the camera, so the officer sees WHY, and there is no Continue.
  const [idBlocked, setIdBlocked] = useState(false);

  useEffect(() => () => { if (advanceTimer.current) clearTimeout(advanceTimer.current); }, []);

  const call = async (stepKey: string, payload: Record<string, unknown>) => post(stepKey, { ...payload, sessionId });

  /** Every response passes through here, so "your session died" is handled once. */
  const accept = (data: Record<string, unknown>): boolean => {
    if (data.needsOtp) {
      setError(t.kyc.sessionExpired);
      onSessionExpired?.();
      return false;
    }
    if (!data.success) {
      setError((data.message as string) || t.kyc.stepFailed);
      return false;
    }
    if (data.sessionId) setSessionId(data.sessionId as string);
    if (data.mode) setMode(data.mode as "simulation" | "live");
    if (data.capabilities) setCaps(data.capabilities as Capabilities);
    return true;
  };

  const goNext = (from: PipelineStep) => {
    if (advanceTimer.current) { clearTimeout(advanceTimer.current); advanceTimer.current = null; }
    setReveal(null);
    setError(null);
    setAnalysing(null);
    setIdBlocked(false);
    if (from === "id") setStep("facematch");
    else if (from === "facematch") setStep("iprs");
  };

  /** Throw away the rejected ID and re-open the camera to try another document. */
  const retakeId = () => {
    setIdBlocked(false);
    setReveal(null);
    setError(null);
    setIdImage(null);
    setResults((r) => { const next = { ...r }; delete next.id; return next; });
  };

  /** Hold the step's result on screen, then move on (or let Continue skip the wait). */
  const revealThenAdvance = (from: PipelineStep) => {
    setAnalysing(null);
    setReveal(from);
    advanceTimer.current = setTimeout(() => goNext(from), REVEAL_MS);
  };

  const captureStep = async (stepKey: PipelineStep, sig: CaptureSignals) => {
    setBusy(true);
    setError(null);
    setAnalysing(sig.dataUrl);
    if (stepKey === "id") setIdImage(sig.dataUrl);
    if (stepKey === "facematch") setSelfieImage(sig.dataUrl);
    // A deliberate dwell so the scan reads as "analysing", not "instant" — the
    // theatre runs across this AND the real round-trip, and cannot outrun it.
    await new Promise((r) => setTimeout(r, 1600));
    try {
      const data = await call(stepKey, { bytes: sig.bytes, brightness: sig.brightness, blurVar: sig.blurVar, image: sig.dataUrl });
      if (!accept(data)) { setAnalysing(null); return; }
      setResults((r) => ({ ...r, [stepKey]: data }));
      if (data.retake) { setAnalysing(null); setError(gateMessage(data, t)); return; }
      // THE GATES. Two things must hold before a photograph is ever taken: the card
      // must belong to the person the registry holds for that number (the name gate),
      // AND that person must be the customer whose account this is (the binding gate).
      // A blocked identity does NOT advance — but we keep the extraction on screen with
      // the mismatch highlighted, so the officer sees exactly which name disagrees,
      // rather than a bare error over an empty camera.
      if (data.blocked) { setAnalysing(null); setIdBlocked(true); setReveal(null); setError(gateMessage(data, t)); return; }
      // The ID step never auto-advances: the officer reads the three-way name
      // comparison and confirms it is this customer before we open the camera.
      if (stepKey === "id") { setAnalysing(null); setReveal("id"); return; }
      revealThenAdvance(stepKey);
    } catch {
      setAnalysing(null);
      setError(t.kyc.somethingWrong);
    } finally {
      setBusy(false);
    }
  };

  const runIprs = async () => {
    setBusy(true);
    setError(null);
    await new Promise((r) => setTimeout(r, 1600));
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
      setError(t.kyc.registryFailed);
    } finally {
      setBusy(false);
    }
  };

  const stepIndex = STEPS.findIndex((s) => s.key === step);
  const doneCount = stepIndex + (reveal ? 1 : 0);
  const pct = Math.round((doneCount / STEPS.length) * 100);

  return (
    <div>
      {header}

      {/* WHAT IS ACTUALLY LIVE, LEG BY LEG.
          The old badge was a single "DEMO MODE — no licensed identity provider", which
          became a lie the moment the registry went live while face matching had not:
          it said nothing was real when two thirds of it was. Three vendors do three
          jobs here, and each one is either connected or it isn't — so say which. */}
      {caps && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <CapChip label={t.kyc.capOcr} live={caps.ocr === "live"} t={t} />
          <CapChip label={t.kyc.capRegistry} live={caps.registry === "live"} t={t} />
          <CapChip label={t.kyc.capFace} live={caps.face === "live"} t={t} />
        </div>
      )}

      {/* ── Mission progress: the bar fills a quarter per completed check. ── */}
      <div className="mt-4">
        <div className="flex items-baseline justify-between">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[color:var(--ink-faint)]">{t.kyc.progressLabel}</p>
          <p className="text-xs font-bold tabular-nums" style={{ color: "var(--brand)" }}>{pct}%</p>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-zinc-900/[0.08]">
          <motion.div
            className="h-full rounded-full"
            style={{ backgroundColor: "var(--brand)" }}
            initial={false}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.7, ease: "easeOut" }}
          />
        </div>
        <div className="mt-2.5 flex items-center gap-1.5">
          {STEPS.map((s, i) => {
            const done = i < stepIndex || (i === stepIndex && reveal === s.key);
            const current = i === stepIndex && !done;
            const label = stepLabel(s.key, t);
            return (
              <div key={s.key} className="flex flex-1 items-center gap-1.5">
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                    done ? "bg-emerald-500 text-white" : current ? "text-white" : "bg-zinc-900/5 text-zinc-400"
                  }`}
                  style={current ? { backgroundColor: "var(--brand)" } : undefined}
                  title={label}
                >
                  {done ? <CheckCircle2 className="h-4 w-4" /> : <s.icon className="h-4 w-4" />}
                </div>
                <span className={`hidden truncate text-[11px] font-medium sm:block ${done ? "text-emerald-600" : current ? "text-[color:var(--ink)]" : "text-[color:var(--ink-faint)]"}`}>
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50/90 px-3 py-2.5 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {/* ── THE IDENTITY BIND, FULL WIDTH. Before any camera opens, the officer reads
             the name off the card beside the name the registry returned beside the
             customer whose account this is — and confirms all three are one person.
             This is the fraud gate made visible: a borrowed ID is caught here. ── */}
      {step === "id" && (reveal === "id" || idBlocked) ? (
        <IdExtractionReveal
          result={results.id as IdStepResult}
          idImage={idImage}
          blocked={idBlocked}
          onContinue={() => goNext("id")}
          onRetake={retakeId}
          t={t}
        />
      ) : (
      /* ── The stage + the dossier. Mobile stacks; desktop is a control room. ── */
      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <AnimatePresence mode="wait">
            <motion.div
              key={`${step}-${reveal ?? "active"}`}
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.25 }}
            >
              {/* ID DOCUMENT */}
              {step === "id" && (
                <div className="glass rounded-3xl bg-white/65 p-5">
                  <h2 className="text-base font-bold">{t.kyc.scanIdTitle}</h2>
                  <p className="mt-1 text-xs text-zinc-500">{t.kyc.scanIdSub}</p>
                  <div className="mt-4">
                    {analysing ? (
                      <ScanTheatre image={analysing} aspect="id" lines={t.kyc.idLines} />
                    ) : (
                      <Capture frame="id" facing="environment" busy={busy} onCapture={(s) => captureStep("id", s)} />
                    )}
                  </div>
                </div>
              )}

              {/* FACE MATCH */}
              {step === "facematch" && reveal !== "facematch" && (
                <div className="glass rounded-3xl bg-white/65 p-5">
                  <h2 className="text-base font-bold">{t.kyc.faceTitle}</h2>
                  <p className="mt-1 text-xs text-zinc-500">{t.kyc.faceSub}</p>
                  <div className="mt-4">
                    {analysing && idImage ? (
                      <MatchTheatre idImage={idImage} selfie={analysing} t={t} />
                    ) : analysing ? (
                      <ScanTheatre image={analysing} aspect="face" lines={t.kyc.faceLines} />
                    ) : (
                      <Capture frame="face" facing="user" busy={busy} onCapture={(s) => captureStep("facematch", s)} />
                    )}
                  </div>
                </div>
              )}
              {step === "facematch" && reveal === "facematch" && (
                <FaceMatchReveal
                  idImage={idImage}
                  selfie={selfieImage}
                  result={results.facematch as never}
                  onContinue={() => goNext("facematch")}
                  t={t}
                />
              )}

              {/* REGISTRY */}
              {step === "iprs" && (
                <div className="glass rounded-3xl bg-white/65 p-6 text-center">
                  {busy ? (
                    <RegistryTheatre t={t} />
                  ) : (
                    <>
                      <Landmark className="mx-auto h-10 w-10" style={{ color: "var(--brand)" }} />
                      <h2 className="mt-3 text-base font-bold">{t.kyc.registryTitle}</h2>
                      <p className="mt-1 text-xs text-zinc-500">{t.kyc.registrySub}</p>
                      <button
                        onClick={runIprs}
                        disabled={busy}
                        className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
                        style={{ backgroundColor: "var(--brand)" }}
                      >
                        <ShieldCheck className="h-4 w-4" /> {t.kyc.runRegistry}
                      </button>
                    </>
                  )}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* ── The dossier: everything captured and confirmed so far, always visible. ── */}
        <Dossier idImage={idImage} selfie={selfieImage} results={results} mode={mode} t={t} />
      </div>
      )}
    </div>
  );
}

// ── Theatre pieces ────────────────────────────────────────────────────────────
// Progress climbs to ~92% on a clock and STOPS — only a real server response
// unmounts the theatre. A check that fails never shows 100.

function useClimb(topAt = 92, ms = 2400): number {
  const [p, setP] = useState(0);
  useEffect(() => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      const k = Math.min(1, (Date.now() - t0) / ms);
      setP(Math.round(topAt * (1 - Math.pow(1 - k, 2.2))));
    }, 60);
    return () => clearInterval(iv);
  }, [topAt, ms]);
  return p;
}

function ScanTheatre({ image, lines, aspect }: { image: string; lines: string[]; aspect: "id" | "face" }) {
  const p = useClimb();
  const line = lines[Math.min(lines.length - 1, Math.floor((p / 92) * lines.length))];
  return (
    <div className={`relative w-full overflow-hidden rounded-2xl bg-zinc-900 ${aspect === "id" ? "aspect-[1.586/1]" : "aspect-square"}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image} alt="" className="h-full w-full object-cover opacity-80" />
      <motion.div
        className="pointer-events-none absolute inset-x-0 h-10 bg-gradient-to-b from-transparent via-[var(--brand)]/35 to-transparent motion-reduce:hidden"
        initial={{ top: "-10%" }} animate={{ top: ["-10%", "95%", "-10%"] }} transition={{ duration: 2.1, repeat: Infinity, ease: "easeInOut" }}
      />
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-3">
        <div className="flex items-center justify-between text-white">
          <span className="flex items-center gap-1.5 text-xs font-medium"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {line}</span>
          <span className="text-sm font-bold tabular-nums">{p}%</span>
        </div>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/20">
          <div className="h-full rounded-full bg-[var(--brand)] transition-all duration-150" style={{ width: `${p}%` }} />
        </div>
      </div>
    </div>
  );
}

/** ID portrait and selfie side by side, both under the scanner, similarity climbing. */
function MatchTheatre({ idImage, selfie, t }: { idImage: string; selfie: string; t: PortalDict }) {
  const p = useClimb(92, 2800);
  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        {[{ src: idImage, label: t.kyc.idPortrait }, { src: selfie, label: t.kyc.liveSelfie }].map((f) => (
          <div key={f.label} className="relative aspect-square overflow-hidden rounded-xl bg-zinc-900">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={f.src} alt={f.label.toLowerCase()} className="h-full w-full object-cover opacity-85" />
            <motion.div
              className="pointer-events-none absolute inset-y-0 w-8 bg-gradient-to-r from-transparent via-[var(--brand)]/40 to-transparent motion-reduce:hidden"
              initial={{ left: "-10%" }} animate={{ left: ["-10%", "95%", "-10%"] }} transition={{ duration: 1.9, repeat: Infinity, ease: "easeInOut" }}
            />
            <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-white">{f.label}</span>
            {/* Landmark crosses — the geometry being compared. */}
            {[[30, 38], [70, 38], [50, 58], [38, 74], [62, 74]].map(([x, y], i) => (
              <span key={i} className="absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/80 motion-reduce:hidden" style={{ left: `${x}%`, top: `${y}%` }} />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-600"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t.kyc.comparingGeometry}</span>
        <span className="text-sm font-bold tabular-nums" style={{ color: "var(--brand)" }}>{p}%</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-zinc-900/10">
        <div className="h-full rounded-full bg-[var(--brand)] transition-all duration-150" style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}

function RegistryTheatre({ t }: { t: PortalDict }) {
  const p = useClimb(92, 2200);
  const lines = t.kyc.registryLines;
  return (
    <div className="py-4">
      <Landmark className="mx-auto h-10 w-10 animate-pulse" style={{ color: "var(--brand)" }} />
      <p className="mt-3 text-sm font-semibold">{lines[Math.min(lines.length - 1, Math.floor((p / 92) * lines.length))]}</p>
      <div className="mx-auto mt-4 h-1.5 max-w-xs overflow-hidden rounded-full bg-zinc-900/10">
        <div className="h-full rounded-full bg-[var(--brand)] transition-all duration-150" style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}

// ── Result reveals ───────────────────────────────────────────────────────────

/** The shape the "id" step returns — OCR + registry + the binding to this customer. */
type IdStepResult = {
  ocr?: { fullName: string; idNumber: string; dob: string; confidence: number };
  iprs?: { name?: string | null; matched?: boolean };
  name?: NameGate;
  registryFound?: boolean;
  binding?: {
    borrowerName: string;
    borrowerId: string;
    cardId: string;
    idBinds: boolean | null;
    identityVerdict: "exact" | "strong" | "partial" | "none";
    passed: boolean;
  };
};

/**
 * THE IDENTITY BIND, FULL WIDTH — the fraud gate made visible.
 *
 * The old reveal showed a small centred card: the card name beside the registry
 * name. It proved the DOCUMENT was honest, but never that the document was THIS
 * customer's — so an officer could verify Julia's account with Emmanuel's genuine
 * ID and Emmanuel's genuine face, and every check went green.
 *
 * This panel puts three names side by side and makes the officer read them: what
 * the camera pulled off the card, what the national registry returned for that
 * number, and the customer whose account is open. Only when all three are one
 * person does "continue" appear. When they are not, the row that disagrees is lit
 * red and there is no way forward but to scan the right person's ID.
 */
function IdExtractionReveal({ result, idImage, blocked, onContinue, onRetake, t }: {
  result: IdStepResult | undefined;
  idImage: string | null;
  blocked: boolean;
  onContinue: () => void;
  onRetake: () => void;
  t: PortalDict;
}) {
  const b = t.kyc.bind;
  const ocr = result?.ocr;
  const registryName = result?.iprs?.name ?? null;
  const binding = result?.binding;
  const borrowerName = binding?.borrowerName || "";
  const borrowerId = binding?.borrowerId || "";
  const noRecord = result?.registryFound === false || !registryName;

  // Does the card ↔ registry pair agree? (the original name gate)
  const docAgrees = !noRecord && (result?.name?.verdict === "exact" || result?.name?.verdict === "strong");
  // Does the registry identity ↔ this customer's record agree? (the new bind)
  const recordAgrees = !!binding?.passed;
  const allMatch = !blocked && docAgrees && recordAgrees;

  const rows: { key: string; label: string; value: string | null; agrees: boolean; sub?: string | null }[] = [
    { key: "read", label: b.read, value: ocr?.fullName ?? null, agrees: !noRecord, sub: ocr?.idNumber ? `${b.idNo} ${ocr.idNumber}` : null },
    { key: "registry", label: b.registry, value: registryName, agrees: docAgrees, sub: null },
    { key: "record", label: b.record, value: borrowerName || null, agrees: recordAgrees, sub: borrowerId ? `${b.idNo} ${borrowerId}` : null },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass mt-5 rounded-3xl bg-white/70 p-5 sm:p-7"
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        {/* LEFT — the evidence: the card, and the fields lifted straight off it. */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[color:var(--ink-faint)]">{b.extracted}</p>
          {idImage && (
            <div className="mt-2 overflow-hidden rounded-2xl ring-1 ring-zinc-900/10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={idImage} alt="" className="aspect-[1.586/1] w-full object-cover" />
            </div>
          )}
          <dl className="mt-3 space-y-2">
            {[
              { k: t.kyc.name, v: ocr?.fullName },
              { k: b.idNo, v: ocr?.idNumber },
              { k: b.dob, v: ocr?.dob },
            ].map((f) => (
              <div key={f.k} className="flex items-baseline justify-between gap-3 rounded-lg bg-zinc-900/[0.04] px-3 py-2">
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{f.k}</dt>
                <dd className="min-w-0 truncate text-right text-sm font-bold text-zinc-800">{f.v || "—"}</dd>
              </div>
            ))}
          </dl>
          {ocr?.confidence != null && (
            <p className="mt-2 text-right text-[11px] text-[color:var(--ink-faint)]">
              {fmt(b.confidence, { conf: ocr.confidence })}
            </p>
          )}
        </div>

        {/* RIGHT — the three names, read top to bottom, each with its own verdict. */}
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-zinc-900">{b.title}</h2>
          <p className="mt-1 text-xs leading-relaxed text-zinc-500">{b.sub}</p>

          <div className="mt-4 space-y-2.5">
            {rows.map((r, i) => (
              <div key={r.key}>
                <motion.div
                  initial={{ opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.08 * i }}
                  className={`flex items-center gap-3 rounded-xl border p-3 ${
                    r.agrees ? "border-emerald-200 bg-emerald-50/70" : "border-rose-300 bg-rose-50/80"
                  }`}
                >
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${r.agrees ? "bg-emerald-500" : "bg-rose-500"} text-white`}>
                    {r.agrees ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">{r.label}</p>
                    <p className={`truncate text-base font-bold ${r.agrees ? "text-zinc-900" : "text-rose-700"}`}>{r.value || "—"}</p>
                    {r.sub && <p className="truncate text-[11px] text-zinc-500">{r.sub}</p>}
                  </div>
                  <span className={`shrink-0 text-[11px] font-semibold ${r.agrees ? "text-emerald-600" : "text-rose-600"}`}>
                    {r.agrees ? b.agrees : b.disagrees}
                  </span>
                </motion.div>
                {/* connective seam between the rows */}
                {i < rows.length - 1 && (
                  <div className="ml-[1.15rem] h-2 w-px bg-zinc-900/15" aria-hidden />
                )}
              </div>
            ))}
          </div>

          {/* The verdict, and the only way forward. */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.34 }}
            className={`mt-4 rounded-2xl border p-4 ${allMatch ? "border-emerald-300 bg-emerald-50/70" : "border-rose-300 bg-rose-50/80"}`}
          >
            <p className={`flex items-center gap-2 text-sm font-bold ${allMatch ? "text-emerald-700" : "text-rose-700"}`}>
              {allMatch ? <ShieldCheck className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
              {allMatch ? b.confirmedTitle : noRecord ? t.kyc.gateNoRecord : b.mismatchTitle}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-zinc-600">
              {allMatch
                ? fmt(b.confirmedBody, { name: borrowerName || registryName || "" })
                : noRecord
                  ? b.noRecordBody
                  : fmt(b.mismatchBody, { name: borrowerName || "this customer" })}
            </p>

            {allMatch ? (
              <button
                onClick={onContinue}
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white sm:w-auto"
                style={{ backgroundColor: "var(--brand)" }}
              >
                {b.continue} <ArrowRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                onClick={onRetake}
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-rose-300 bg-white/80 px-5 py-3 text-sm font-semibold text-rose-700 hover:bg-white sm:w-auto"
              >
                {b.retake} <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </motion.div>
        </div>
      </div>
    </motion.div>
  );
}

function FaceMatchReveal({ idImage, selfie, result, onContinue, t }: {
  idImage: string | null;
  selfie: string | null;
  result: { faceMatch?: { score: number; band: string } } | undefined;
  onContinue: () => void;
  t: PortalDict;
}) {
  const fm = result?.faceMatch;
  if (!fm) return null;
  const good = fm.band === "match";
  const review = fm.band === "review";
  return (
    <div className="glass rounded-3xl bg-white/65 p-6">
      <div className="mx-auto grid max-w-xs grid-cols-2 gap-2">
        {[idImage, selfie].map((src, i) => src && (
          <div key={i} className={`relative aspect-square overflow-hidden rounded-xl ring-2 ${good ? "ring-emerald-500" : review ? "ring-amber-500" : "ring-red-500"}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={i === 0 ? t.kyc.idPortrait.toLowerCase() : t.kyc.liveSelfie.toLowerCase()} className="h-full w-full object-cover" />
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-col items-center">
        <ConfidenceRing value={fm.score} label={t.kyc.similarityRing} />
        <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
          className={`mt-3 inline-flex items-center gap-1.5 text-sm font-bold ${good ? "text-emerald-600" : review ? "text-amber-600" : "text-red-600"}`}>
          {good ? <CheckCircle2 className="h-4 w-4" /> : review ? <AlertTriangle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
          {good ? t.kyc.matchConfirmed : review ? t.kyc.needsHumanReview : t.kyc.notAMatch}
        </motion.p>
        <p className="mt-1 text-[11px] text-zinc-400">{t.kyc.bgRemoved}</p>
        <button onClick={onContinue} className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: "var(--brand)" }}>
          {t.kyc.continue} <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

/** One leg of the pipeline, and whether it is actually connected to anything. */
function CapChip({ label, live, t }: { label: string; live: boolean; t: PortalDict }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
        live ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
      }`}
    >
      {live ? <ShieldCheck className="h-3 w-3" /> : <FlaskConical className="h-3 w-3" />}
      {label} · {live ? t.kyc.capLive : t.kyc.capSim}
    </span>
  );
}

// ── The dossier: the case file building up beside the stage ──────────────────

function Dossier({ idImage, selfie, results, mode, t }: {
  idImage: string | null;
  selfie: string | null;
  results: StepResults;
  mode: "simulation" | "live";
  t: PortalDict;
}) {
  const id = results.id as { quality?: { score?: number }; ocr?: { fullName?: string; idNumber?: string } } | undefined;
  const live = (results.liveness as { liveness?: { score?: number; passed?: boolean } })?.liveness;
  const fm = (results.facematch as { faceMatch?: { score?: number; band?: string } })?.faceMatch;
  const iprs = (results.iprs as { iprs?: { matched?: boolean; name?: string | null } })?.iprs;

  const rows: { label: string; value: string; good: boolean }[] = [];
  if (id?.quality?.score != null) rows.push({ label: t.kyc.imageQuality, value: `${id.quality.score}%`, good: id.quality.score >= 70 });
  if (live?.score != null) rows.push({ label: t.kyc.livenessRow, value: `${live.score}%`, good: !!live.passed });
  if (fm?.score != null) rows.push({ label: t.kyc.faceSimilarity, value: `${fm.score}%`, good: fm.band === "match" });
  if (iprs) rows.push({ label: t.kyc.registryRow, value: iprs.matched ? t.kyc.matched : t.kyc.noRecord, good: !!iprs.matched });

  return (
    <aside className="glass h-fit rounded-3xl bg-white/65 p-4 lg:sticky lg:top-24">
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[color:var(--ink-faint)]">{t.kyc.caseFile}</p>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <EvidenceSlot label={t.kyc.idFront} pendingLabel={t.kyc.pending} image={idImage} wide />
        <EvidenceSlot label={t.kyc.selfie} pendingLabel={t.kyc.pending} image={selfie} />
      </div>

      {id?.ocr?.fullName && (
        <div className="mt-3 rounded-lg bg-zinc-900/[0.04] p-2.5 text-xs">
          <p className="font-semibold text-[color:var(--ink)]">{id.ocr.fullName}</p>
          {id.ocr.idNumber && <p className="mt-0.5 text-[color:var(--ink-muted)]">ID {id.ocr.idNumber}</p>}
        </div>
      )}

      {rows.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between text-xs">
              <span className="text-[color:var(--ink-muted)]">{r.label}</span>
              <span className={`inline-flex items-center gap-1 font-bold tabular-nums ${r.good ? "text-emerald-600" : "text-amber-600"}`}>
                {r.good ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />} {r.value}
              </span>
            </div>
          ))}
        </div>
      )}

      {rows.length === 0 && !idImage && (
        <p className="mt-3 text-xs leading-relaxed text-[color:var(--ink-muted)]">
          {t.kyc.dossierEmpty}
        </p>
      )}

      <p className="mt-3 border-t border-zinc-900/10 pt-2 text-[10px] text-[color:var(--ink-faint)]">
        {mode === "live" ? t.kyc.liveProvider : t.kyc.simProvider}
      </p>
    </aside>
  );
}

function EvidenceSlot({ label, pendingLabel, image, wide }: { label: string; pendingLabel: string; image: string | null; wide?: boolean }) {
  return (
    <div>
      <p className="mb-1 text-[9px] font-bold uppercase tracking-wider text-[color:var(--ink-faint)]">{label}</p>
      <div className={`relative overflow-hidden rounded-lg bg-zinc-900/[0.05] ${wide ? "aspect-[1.586/1]" : "aspect-square"} ${image ? "" : "border border-dashed border-zinc-900/15"}`}>
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt={label} className="h-full w-full object-cover" />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-[9px] text-[color:var(--ink-faint)]">{pendingLabel}</span>
        )}
      </div>
    </div>
  );
}
