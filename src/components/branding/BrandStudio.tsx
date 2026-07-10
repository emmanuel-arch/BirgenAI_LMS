"use client";

// The Brand Studio — upload a logo, get a brand.
//
// Everything happens in the browser on a canvas: transparency check, optional
// background removal (border flood-fill — free, no service), dominant-color
// extraction, and the derived accent/gradient. The parent receives a draft on
// every change and decides where it goes (settings PUT or the onboarding
// payload). Every setting says in plain words what it controls.
import { useRef, useState } from "react";
import { UploadCloud, Wand2, RotateCcw, Palette as PaletteIcon } from "lucide-react";
import {
  type Pixels, type PaletteEntry, hasTransparency, removeBackground, extractPalette,
  deriveBrand, accentSoftFrom, darken, isHexColor,
} from "@/lib/branding/palette";

export type BrandDraft = {
  /** 512px-long-edge PNG data URL, present only when the user picked a new logo. */
  logoDataUrl: string | null;
  accent: string;
  accentSoft: string;
  accent2: string;
};

const UPLOAD_EDGE = 512; // stored copy
const ANALYSIS_EDGE = 64; // palette votes — plenty at 4-bit quantization

function draw(img: HTMLImageElement, edge: number): { canvas: HTMLCanvasElement; pixels: Pixels } {
  const scale = Math.min(1, edge / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  return { canvas, pixels: { data: data.data, width: w, height: h } };
}

function pixelsToDataUrl(p: Pixels): string {
  const canvas = document.createElement("canvas");
  canvas.width = p.width; canvas.height = p.height;
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(p.data), p.width, p.height), 0, 0);
  return canvas.toDataURL("image/png");
}

const CHECKER: React.CSSProperties = {
  backgroundImage:
    "linear-gradient(45deg,#e4e4e7 25%,transparent 25%),linear-gradient(-45deg,#e4e4e7 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#e4e4e7 75%),linear-gradient(-45deg,transparent 75%,#e4e4e7 75%)",
  backgroundSize: "12px 12px",
  backgroundPosition: "0 0, 0 6px, 6px -6px, -6px 0",
};

export default function BrandStudio({
  orgName,
  initial,
  onDraft,
}: {
  orgName: string;
  initial: { accent: string; accent2?: string | null; logoUrl?: string | null };
  onDraft: (draft: BrandDraft) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [logo, setLogo] = useState<string | null>(null); // current (possibly bg-removed) data URL
  const [rawLogo, setRawLogo] = useState<string | null>(null); // as uploaded, for "keep original"
  const [removedPreview, setRemovedPreview] = useState<string | null>(null); // offered, not yet accepted
  const [transparent, setTransparent] = useState<boolean | null>(null);
  const [palette, setPalette] = useState<PaletteEntry[]>([]);
  const [accent, setAccent] = useState(initial.accent);
  const [accent2, setAccent2] = useState(initial.accent2 ?? darken(initial.accent));
  const [note, setNote] = useState<string | null>(null);

  const emit = (next: Partial<{ logo: string | null; accent: string; accent2: string }>) => {
    const a = next.accent ?? accent;
    onDraft({
      logoDataUrl: next.logo !== undefined ? next.logo : logo,
      accent: a,
      accentSoft: accentSoftFrom(a),
      accent2: next.accent2 ?? accent2,
    });
  };

  const analyze = (dataUrl: string, alreadyRemoved: boolean) => {
    const img = new Image();
    img.onload = () => {
      const { pixels } = draw(img, UPLOAD_EDGE);
      const isTransparent = hasTransparency(pixels);
      setTransparent(isTransparent);
      setRemovedPreview(null);

      const effective = dataUrl;
      if (!isTransparent && !alreadyRemoved) {
        const removed = removeBackground(pixels);
        if (removed) setRemovedPreview(pixelsToDataUrl(removed));
        else setNote("This logo's background isn't a single solid color, so it can't be removed automatically. A design tool can — or use it as is.");
      }

      // Palette votes come from the smaller copy for speed; same result.
      const { pixels: small } = draw(img, ANALYSIS_EDGE);
      const pal = extractPalette(small);
      setPalette(pal);
      const derived = deriveBrand(pal);
      if (derived) {
        setAccent(derived.accent);
        setAccent2(derived.accent2);
        setLogo(effective);
        onDraft({ logoDataUrl: effective, accent: derived.accent, accentSoft: derived.accentSoft, accent2: derived.accent2 });
        setNote(null);
        return;
      }
      setLogo(effective);
      emit({ logo: effective });
      setNote("Couldn't find a strong color in this logo (mostly black/white?) — pick your colors below.");
    };
    img.src = dataUrl;
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { setNote("Use a PNG, JPEG or WebP image."); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const { canvas } = draw(img, UPLOAD_EDGE);
        const dataUrl = canvas.toDataURL("image/png");
        setRawLogo(dataUrl);
        analyze(dataUrl, false);
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const acceptRemoval = () => {
    if (!removedPreview) return;
    setLogo(removedPreview);
    setTransparent(true);
    setRemovedPreview(null);
    emit({ logo: removedPreview });
  };

  const pickAccent = (color: string) => {
    setAccent(color);
    const nextAccent2 = accent2 === darken(accent) || !isHexColor(accent2) ? darken(color) : accent2;
    setAccent2(nextAccent2);
    emit({ accent: color, accent2: nextAccent2 });
  };

  const currentLogo = logo ?? initial.logoUrl ?? null;

  return (
    <div className="space-y-4">
      {/* Logo upload */}
      <div className="glass p-5">
        <p className="text-sm font-semibold flex items-center gap-1.5"><UploadCloud className="h-4 w-4 text-zinc-400" /> Logo</p>
        <p className="mt-0.5 text-[11px] text-zinc-500">
          Shown at the far left of your team&apos;s console and on your borrower portal. A transparent PNG looks best.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex h-20 w-20 items-center justify-center rounded-xl border-2 border-dashed border-zinc-900/15 bg-white/60 hover:bg-white"
            aria-label="Upload logo"
            style={currentLogo ? CHECKER : undefined}
          >
            {currentLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={currentLogo} alt="Logo preview" className="max-h-16 max-w-16 object-contain" />
            ) : (
              <UploadCloud className="h-6 w-6 text-zinc-400" />
            )}
          </button>
          <div className="text-[11px] text-zinc-500 space-y-1">
            <p>{currentLogo ? "Click the tile to replace it." : "Click to upload — PNG, JPEG or WebP."}</p>
            {transparent === true && <p className="text-emerald-600 font-medium">✓ Transparent background — it will sit cleanly on any surface.</p>}
            {transparent === false && !removedPreview && <p className="text-amber-600 font-medium">This logo has a solid background.</p>}
          </div>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        </div>

        {removedPreview && rawLogo && (
          <div className="mt-4 rounded-xl border border-amber-300/60 bg-amber-50/70 p-4">
            <p className="text-sm font-semibold text-amber-800 flex items-center gap-1.5"><Wand2 className="h-4 w-4" /> Remove the background?</p>
            <p className="mt-0.5 text-[11px] text-amber-700">We detected a solid background and can lift the logo off it — free, done right here in your browser.</p>
            <div className="mt-3 flex items-center gap-4">
              {[{ label: "Original", src: rawLogo }, { label: "Background removed", src: removedPreview }].map((v) => (
                <div key={v.label} className="text-center">
                  <div className="flex h-20 w-20 items-center justify-center rounded-lg border border-zinc-900/10" style={CHECKER}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={v.src} alt={v.label} className="max-h-16 max-w-16 object-contain" />
                  </div>
                  <p className="mt-1 text-[10px] text-zinc-500">{v.label}</p>
                </div>
              ))}
              <div className="flex flex-col gap-2">
                <button type="button" onClick={acceptRemoval} className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700">
                  Use the transparent version
                </button>
                <button type="button" onClick={() => setRemovedPreview(null)} className="rounded-lg border border-zinc-900/15 bg-white/70 px-3 py-1.5 text-xs font-medium text-zinc-600">
                  Keep the original
                </button>
              </div>
            </div>
          </div>
        )}
        {note && <p className="mt-3 text-[11px] text-zinc-500">{note}</p>}
      </div>

      {/* Colors */}
      <div className="glass p-5">
        <p className="text-sm font-semibold flex items-center gap-1.5"><PaletteIcon className="h-4 w-4 text-zinc-400" /> Colors</p>
        {palette.length > 0 && (
          <div className="mt-3">
            <p className="text-[11px] text-zinc-500">From your logo — click a swatch to make it your accent:</p>
            <div className="mt-1.5 flex gap-2">
              {palette.map((p) => (
                <button
                  key={p.color}
                  type="button"
                  onClick={() => pickAccent(p.color)}
                  className={`h-9 w-9 rounded-lg border-2 ${accent === p.color ? "border-zinc-900" : "border-transparent"}`}
                  style={{ backgroundColor: p.color }}
                  title={`${p.color} · ${(p.share * 100).toFixed(0)}% of the logo`}
                />
              ))}
            </div>
          </div>
        )}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-[11px] font-semibold text-zinc-600">Accent</span>
            <span className="block text-[11px] text-zinc-500">The color of your buttons, links, highlights and active menu items.</span>
            <span className="mt-1.5 flex items-center gap-2">
              <input type="color" value={isHexColor(accent) ? accent : "#f97316"} onChange={(e) => pickAccent(e.target.value)} className="h-9 w-12 cursor-pointer rounded border border-zinc-900/15" />
              <code className="text-xs text-zinc-500">{accent}</code>
            </span>
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold text-zinc-600">Gradient partner</span>
            <span className="block text-[11px] text-zinc-500">The far end of your gradient — used on your portal hero and sign-in page.</span>
            <span className="mt-1.5 flex items-center gap-2">
              <input type="color" value={isHexColor(accent2) ? accent2 : darken(accent)} onChange={(e) => { setAccent2(e.target.value); emit({ accent2: e.target.value }); }} className="h-9 w-12 cursor-pointer rounded border border-zinc-900/15" />
              <code className="text-xs text-zinc-500">{accent2}</code>
            </span>
          </label>
        </div>
      </div>

      {/* Live preview */}
      <div className="glass p-5">
        <p className="text-sm font-semibold">Preview</p>
        <p className="mt-0.5 text-[11px] text-zinc-500">Exactly what these settings drive — your console top bar, buttons, and portal hero.</p>
        <div className="mt-3 overflow-hidden rounded-xl border border-zinc-900/10 bg-white">
          <div className="flex h-11 items-center gap-2 border-b border-zinc-900/10 px-3">
            {currentLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={currentLogo} alt="" className="h-6 w-6 rounded object-contain" />
            ) : (
              <span className="flex h-6 w-6 items-center justify-center rounded text-[10px] font-bold text-white" style={{ backgroundColor: accent }}>{orgName.slice(0, 1)}</span>
            )}
            <span className="text-xs font-bold text-zinc-800">{orgName}</span>
            <span className="ml-auto rounded-full px-2.5 py-1 text-[10px] font-semibold text-white" style={{ backgroundColor: accent }}>Primary button</span>
          </div>
          <div className="flex h-16 items-center px-4" style={{ background: `linear-gradient(135deg, ${accent}, ${accent2})` }}>
            <p className="text-xs font-bold text-white drop-shadow">Credit that understands your cashflow.</p>
          </div>
          <div className="flex items-center gap-2 px-3 py-2.5">
            <span className="rounded-md px-2 py-1 text-[10px] font-semibold" style={{ backgroundColor: accentSoftFrom(accent), color: accent }}>Soft badge</span>
            <span className="text-[11px]" style={{ color: accent }}>An accent link</span>
          </div>
        </div>
        {rawLogo && (
          <button type="button" onClick={() => { setRawLogo(null); setLogo(null); setPalette([]); setTransparent(null); setRemovedPreview(null); emit({ logo: null }); }} className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-zinc-500 hover:text-zinc-800">
            <RotateCcw className="h-3 w-3" /> Discard the new logo
          </button>
        )}
      </div>
    </div>
  );
}
