"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Camera, Upload, RefreshCw, Loader2, CheckCircle2 } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Camera / upload capture surface — now with a LIVE COACH.
//
// The old surface waited for the shutter and let the server reject the photo
// afterwards. This one reads the viewfinder continuously — brightness, focus,
// and (where the browser can detect a face) how large and centred the face is —
// and talks the person into a good capture BEFORE the shutter: "more light",
// "hold steady", "move closer". A readiness meter fills as the frame improves
// and the guide ring turns green when a capture would pass, so an officer at a
// counter can coach a customer without knowing anything about photography.
//
// The coach is guidance, not a gate: the shutter always works, because the
// server-side quality check is the authority and a determined user must never
// be locked out by a heuristic. FaceDetector is a progressive enhancement —
// Chrome on Android has it (the loan officers' fleet); where it is missing the
// coach still runs on light and focus alone.
// ─────────────────────────────────────────────────────────────────────────────

export type CaptureSignals = { bytes: number; brightness?: number; blurVar?: number; dataUrl: string };

type Coach = { hint: string | null; readiness: number };

// Minimal typing for the (Chromium-only) shape detection API.
type DetectedFaceBox = { boundingBox: { x: number; y: number; width: number; height: number } };
type FaceDetectorLike = { detect: (el: HTMLVideoElement) => Promise<DetectedFaceBox[]> };
declare global {
  interface Window { FaceDetector?: new (opts?: { fastMode?: boolean; maxDetectedFaces?: number }) => FaceDetectorLike }
}

export function Capture({
  facing = "environment", frame = "id", onCapture, busy,
}: {
  facing?: "environment" | "user";
  frame?: "id" | "face";
  onCapture: (s: CaptureSignals) => void;
  busy?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const coachCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const detectorRef = useRef<FaceDetectorLike | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [camError, setCamError] = useState(false);
  const [coach, setCoach] = useState<Coach>({ hint: null, readiness: 0 });

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing }, audio: false });
        if (!active) { s.getTracks().forEach((t) => t.stop()); return; }
        setStream(s);
        if (videoRef.current) { videoRef.current.srcObject = s; await videoRef.current.play().catch(() => {}); }
      } catch { setCamError(true); }
    })();
    return () => { active = false; setStream((s) => { s?.getTracks().forEach((t) => t.stop()); return null; }); };
  }, [facing]);

  // ── The coach loop ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!stream || busy) return;
    if (frame === "face" && window.FaceDetector && !detectorRef.current) {
      try { detectorRef.current = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 }); } catch { /* unsupported */ }
    }
    let cancelled = false;
    const tick = async () => {
      const video = videoRef.current;
      if (cancelled || !video || video.videoWidth === 0) return;

      // Sample a small frame — the coach needs a trend, not a photograph.
      const c = (coachCanvasRef.current ??= document.createElement("canvas"));
      const w = 160, h = Math.round((video.videoHeight / video.videoWidth) * 160) || 120;
      c.width = w; c.height = h;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, w, h);
      const { brightness, blurVar } = analyzeCanvas(c);

      let hint: string | null = null;
      let readiness = 100;
      if (brightness < 55) { hint = "Too dark — find more light"; readiness -= 45; }
      else if (brightness > 228) { hint = "Too much glare — tilt away from the light"; readiness -= 40; }
      if (blurVar < 90) { hint ??= "Hold steady…"; readiness -= 30; }

      // Face framing, where the browser can see one.
      if (frame === "face" && detectorRef.current) {
        try {
          const faces = await detectorRef.current.detect(video);
          if (!faces.length) { hint = "Bring your face into the frame"; readiness = Math.min(readiness, 25); }
          else {
            const b = faces[0].boundingBox;
            const areaRatio = (b.width * b.height) / (video.videoWidth * video.videoHeight);
            const cx = (b.x + b.width / 2) / video.videoWidth;
            const cy = (b.y + b.height / 2) / video.videoHeight;
            if (areaRatio < 0.10) { hint = "Move closer"; readiness -= 35; }
            else if (areaRatio > 0.55) { hint = "Move back a little"; readiness -= 25; }
            else if (Math.abs(cx - 0.5) > 0.18 || Math.abs(cy - 0.5) > 0.2) { hint = "Centre your face"; readiness -= 20; }
          }
        } catch { /* detector flaked — light/focus coaching continues */ }
      }

      if (!cancelled) setCoach({ hint, readiness: Math.max(5, Math.min(100, readiness)) });
    };
    const iv = setInterval(() => { void tick(); }, 450);
    return () => { cancelled = true; clearInterval(iv); };
  }, [stream, busy, frame]);

  const shoot = () => {
    const video = videoRef.current, canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    const sig = analyzeCanvas(canvas);
    onCapture({ bytes: Math.round(dataUrl.length * 0.75), dataUrl, ...sig });
  };

  // A phone camera roll photo is easily 12 MP / 5 MB, and it is about to be
  // base64'd into a JSON body. Downscale to the long edge below and re-encode as
  // JPEG — the quality gates and the officer both work fine at this size.
  const MAX_EDGE = 1600;

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
        const canvas = canvasRef.current!;
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        const sig = analyzeCanvas(canvas);
        // Report the ORIGINAL byte size: it is the resolution proxy the quality
        // gate reads, and re-encoding must not make a bad photo look acceptable.
        onCapture({ bytes: f.size, dataUrl, ...sig });
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(f);
  };

  const aspect = frame === "id" ? "aspect-[1.586/1]" : "aspect-square";
  const ready = coach.readiness >= 75 && !coach.hint;
  const ringColor = camError ? "rgba(255,255,255,0.2)" : ready ? "#10b981" : coach.readiness >= 45 ? "#f59e0b" : "#ef4444";

  return (
    <div>
      <div className={`relative ${aspect} w-full overflow-hidden rounded-2xl bg-zinc-900 ring-2 transition-colors`} style={{ ["--tw-ring-color" as never]: ringColor }}>
        {!camError ? (
          <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-white/70">
            <Camera className="h-8 w-8" />
            <p className="text-xs">Camera unavailable — upload a photo instead</p>
          </div>
        )}
        {/* Framing guide */}
        <div className="pointer-events-none absolute inset-4 rounded-xl border-2 border-dashed border-white/50" />
        {/* Scanning line */}
        {!camError && !busy && (
          <motion.div className="pointer-events-none absolute inset-x-4 h-0.5 bg-[var(--brand)] shadow-[0_0_12px_var(--brand)] motion-reduce:hidden"
            initial={{ top: "12%" }} animate={{ top: ["12%", "88%", "12%"] }} transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }} />
        )}

        {/* The coach: what to fix, or that nothing needs fixing. */}
        {!camError && !busy && (
          <div className="pointer-events-none absolute inset-x-3 bottom-3 flex items-end justify-between gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold backdrop-blur-sm ${
              ready ? "bg-emerald-500/85 text-white" : "bg-black/55 text-white"
            }`}>
              {ready ? (<><CheckCircle2 className="h-3.5 w-3.5" /> Looks good — capture</>) : (coach.hint ?? "Reading the frame…")}
            </span>
            {/* Readiness meter */}
            <span className="flex h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-white/25">
              <span className="h-full rounded-full transition-all duration-300" style={{ width: `${coach.readiness}%`, backgroundColor: ringColor }} />
            </span>
          </div>
        )}

        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-2 text-white">
              <Loader2 className="h-7 w-7 animate-spin" />
              <p className="text-xs font-medium">Analysing…</p>
            </div>
          </div>
        )}
      </div>
      <canvas ref={canvasRef} className="hidden" />
      <div className="mt-3 flex gap-2">
        {!camError && (
          <button onClick={shoot} disabled={busy}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 py-3 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />} Capture
          </button>
        )}
        <button onClick={() => fileRef.current?.click()} disabled={busy}
          className={`${camError ? "flex-1" : ""} inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-900/15 bg-white/70 px-4 py-3 text-sm font-semibold text-zinc-700 hover:bg-white disabled:opacity-60`}>
          <Upload className="h-4 w-4" /> Upload
        </button>
        <input ref={fileRef} type="file" accept="image/*" capture={frame === "face" ? "user" : "environment"} onChange={onFile} className="hidden" />
      </div>
    </div>
  );
}

function analyzeCanvas(canvas: HTMLCanvasElement): { brightness: number; blurVar: number } {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { brightness: 128, blurVar: 200 };
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let sum = 0; const lum: number[] = [];
  const step = Math.max(1, Math.floor(data.length / 4 / 4000)); // sample ~4k px
  for (let i = 0; i < data.length; i += 4 * step) {
    const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    lum.push(l); sum += l;
  }
  const mean = sum / lum.length;
  const variance = lum.reduce((a, l) => a + (l - mean) ** 2, 0) / lum.length; // proxy for focus
  return { brightness: Math.round(mean), blurVar: Math.round(variance) };
}

export function RetakeButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-900/15 bg-white/70 px-4 py-2 text-xs font-semibold text-zinc-700 hover:bg-white">
      <RefreshCw className="h-3.5 w-3.5" /> Retake
    </button>
  );
}
