"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Camera, Upload, RefreshCw, Loader2 } from "lucide-react";

// Camera / upload capture surface with a live scanning-line animation. Returns
// the captured image's byte length + lightweight brightness/blur signals so the
// server-side quality gate has real inputs (works with or without a webcam).
export type CaptureSignals = { bytes: number; brightness?: number; blurVar?: number; dataUrl: string };

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
  const fileRef = useRef<HTMLInputElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [camError, setCamError] = useState(false);

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

  const analyze = (canvas: HTMLCanvasElement): { brightness: number; blurVar: number } => {
    const ctx = canvas.getContext("2d");
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
  };

  const shoot = () => {
    const video = videoRef.current, canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    const sig = analyze(canvas);
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
        const sig = analyze(canvas);
        // Report the ORIGINAL byte size: it is the resolution proxy the quality
        // gate reads, and re-encoding must not make a bad photo look acceptable.
        onCapture({ bytes: f.size, dataUrl, ...sig });
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(f);
  };

  const aspect = frame === "id" ? "aspect-[1.586/1]" : "aspect-square";

  return (
    <div>
      <div className={`relative ${aspect} w-full overflow-hidden rounded-2xl bg-zinc-900 ring-1 ring-white/20`}>
        {!camError ? (
          <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-white/70">
            <Camera className="h-8 w-8" />
            <p className="text-xs">Camera unavailable — upload a photo instead</p>
          </div>
        )}
        {/* Framing guide */}
        <div className={`pointer-events-none absolute inset-4 rounded-xl border-2 border-dashed border-white/50`} />
        {/* Scanning line */}
        {!camError && !busy && (
          <motion.div className="pointer-events-none absolute inset-x-4 h-0.5 bg-[var(--brand)] shadow-[0_0_12px_var(--brand)]"
            initial={{ top: "12%" }} animate={{ top: ["12%", "88%", "12%"] }} transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }} />
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

export function RetakeButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-900/15 bg-white/70 px-4 py-2 text-xs font-semibold text-zinc-700 hover:bg-white">
      <RefreshCw className="h-3.5 w-3.5" /> Retake
    </button>
  );
}
