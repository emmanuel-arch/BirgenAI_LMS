"use client";

// The borrower's captured identity documents.
//
// Deliberately NOT rendered on page load. A national ID photo and a face are the
// most sensitive things this system holds, and an officer glancing at a loan
// balance has no reason to have them on screen. Revealing them is one click, and
// that click is what gets written to the audit log.
//
// Each image is fetched as a signed URL that expires in about two minutes, so a
// screenshot of the DOM is worth nothing a few minutes later.
import { useState } from "react";
import { Eye, EyeOff, Loader2, ImageOff, FlaskConical, Lock } from "lucide-react";

type Doc = { key: string; label: string };
type Loaded = { label: string; url: string | null; note?: string };

export default function KycGallery({ portraitKey, idFrontKey, selfieKey }: {
  portraitKey?: string | null;
  idFrontKey?: string | null;
  selfieKey?: string | null;
}) {
  const [shown, setShown] = useState<Loaded[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const docs: Doc[] = [
    ...(portraitKey ? [{ key: portraitKey, label: "Portrait" }] : []),
    ...(idFrontKey ? [{ key: idFrontKey, label: "National ID" }] : []),
    ...(selfieKey ? [{ key: selfieKey, label: "Selfie" }] : []),
  ];
  if (docs.length === 0) return null;

  const simulated = docs.every((d) => d.key.startsWith("sim/"));

  const reveal = async () => {
    setBusy(true);
    setError(null);
    try {
      const loaded = await Promise.all(
        docs.map(async (d) => {
          const res = await fetch(`/api/console/kyc/asset?key=${encodeURIComponent(d.key)}`);
          const data = await res.json();
          if (!data.success) return { label: d.label, url: null, note: data.message as string };
          return { label: d.label, url: (data.url as string | null) ?? null, note: data.message as string | undefined };
        }),
      );
      setShown(loaded);
    } catch {
      setError("Could not open the documents.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 border-t border-zinc-900/10 pt-3">
      {!shown ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-zinc-500 flex items-center gap-1.5">
            <Lock className="h-3.5 w-3.5" />
            {docs.length} identity document{docs.length === 1 ? "" : "s"} on file
            {simulated && (
              <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                <FlaskConical className="h-3 w-3" /> NOT STORED
              </span>
            )}
          </p>
          <button onClick={reveal} disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-900/15 bg-white/70 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-white disabled:opacity-60">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />} Show documents
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-zinc-500">Links expire in about two minutes. This view was logged.</p>
            <button onClick={() => setShown(null)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-900/15 bg-white/70 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-white">
              <EyeOff className="h-3.5 w-3.5" /> Hide
            </button>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {shown.map((d) => (
              <figure key={d.label} className="min-w-0">
                <div className="aspect-[4/3] overflow-hidden rounded-xl border border-zinc-900/10 bg-zinc-50">
                  {d.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={d.url} alt={d.label} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center text-zinc-400">
                      <ImageOff className="h-5 w-5" />
                      <span className="text-[10px] leading-tight">{d.note ?? "Unavailable"}</span>
                    </div>
                  )}
                </div>
                <figcaption className="mt-1 text-[11px] text-zinc-500">{d.label}</figcaption>
              </figure>
            ))}
          </div>
        </>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
