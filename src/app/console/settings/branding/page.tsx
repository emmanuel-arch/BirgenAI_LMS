"use client";

// Organization → Branding. The Brand Studio plus the words (tagline/blurb),
// saved through /api/console/org/branding. Colors apply to the whole console
// on the next page load; the borrower portal picks them up immediately.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLoad } from "@/lib/hooks/useLoad";
import { Palette, Loader2, AlertTriangle, CheckCircle2, FlaskConical } from "lucide-react";
import BrandStudio, { type BrandDraft } from "@/components/branding/BrandStudio";

type Branding = {
  name: string; slug: string; accent: string; accentSoft: string; accent2: string | null;
  tagline: string | null; blurb: string | null; logoUrl: string | null; logoScale: number;
};

export default function BrandingPage() {
  const router = useRouter();
  const [branding, setBranding] = useState<Branding | null>(null);
  const [storage, setStorage] = useState<"live" | "simulation">("simulation");
  const [draft, setDraft] = useState<BrandDraft | null>(null);
  const [tagline, setTagline] = useState("");
  const [blurb, setBlurb] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useLoad(async () => {
    try {
      const res = await fetch("/api/console/org/branding");
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not load branding."); return; }
      setBranding(data.branding);
      setStorage(data.storage);
      setTagline(data.branding.tagline ?? "");
      setBlurb(data.branding.blurb ?? "");
    } catch { setError("Could not load branding."); }
  });

  const save = async () => {
    setSaving(true); setError(null); setNotice(null);
    try {
      const res = await fetch("/api/console/org/branding", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(draft ? { logoDataUrl: draft.logoDataUrl ?? undefined, accent: draft.accent, accentSoft: draft.accentSoft, accent2: draft.accent2, logoScale: draft.logoScale } : {}),
          tagline, blurb,
        }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not save."); return; }
      setBranding((b) => (b ? { ...b, ...data.branding } : b));
      // Repaint the server-rendered shell NOW — the sidebar letterhead beside this
      // very form is the first place the admin looks for their change, and a save
      // that only shows up after a hard reload reads as a save that didn't work.
      router.refresh();
      setNotice("Branding saved — the console around you just picked it up. Your team sees it on their next page load; the borrower portal already has it.");
    } catch { setError("Could not save."); } finally { setSaving(false); }
  };

  if (!branding) {
    return (
      <main className="mx-auto max-w-3xl px-4 sm:px-6 py-8">
        {error
          ? <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}</div>
          : <div className="glass p-4 text-sm text-zinc-500 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 sm:px-6 py-8">
      <h1 className="text-xl font-bold flex items-center gap-2">
        <Palette className="h-5 w-5" style={{ color: "var(--brand)" }} /> Branding
      </h1>
      <p className="mt-1 text-sm text-zinc-500 max-w-2xl">
        Your logo and colors, applied to the staff console and your borrower portal at {branding.slug}.birgenai.com.
        Other lenders on the platform never see or share these.
      </p>
      {storage === "simulation" && (
        <p className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-violet-100 px-2 py-1 text-[11px] font-semibold text-violet-700">
          <FlaskConical className="h-3 w-3" /> Object storage isn&apos;t connected — logos are stored inline (keep them small).
        </p>
      )}

      {notice && <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50/90 px-3 py-2.5 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> {notice}</div>}
      {error && <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}</div>}

      <div className="mt-5">
        <BrandStudio
          orgName={branding.name}
          initial={{ accent: branding.accent, accent2: branding.accent2, logoUrl: branding.logoUrl, logoScale: branding.logoScale }}
          onDraft={setDraft}
        />
      </div>

      <div className="glass mt-4 p-5">
        <p className="text-sm font-semibold">Words</p>
        <label className="mt-3 block">
          <span className="text-[11px] font-semibold text-zinc-600">Tagline</span>
          <span className="block text-[11px] text-zinc-500">One line under your name on the borrower portal — what you promise.</span>
          <input value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={120} placeholder="Credit that understands your cashflow."
            className="mt-1.5 w-full rounded-lg border border-zinc-900/15 bg-white/80 px-3 py-2.5 text-sm outline-none" />
        </label>
        <label className="mt-3 block">
          <span className="text-[11px] font-semibold text-zinc-600">About line</span>
          <span className="block text-[11px] text-zinc-500">A sentence about who you are, shown where borrowers choose a lender.</span>
          <input value={blurb} onChange={(e) => setBlurb(e.target.value)} maxLength={240} placeholder="Nairobi's microfinance for market traders."
            className="mt-1.5 w-full rounded-lg border border-zinc-900/15 bg-white/80 px-3 py-2.5 text-sm outline-none" />
        </label>
      </div>

      <button onClick={save} disabled={saving}
        className="mt-4 inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        style={{ backgroundColor: "var(--brand)" }}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save branding
      </button>
    </main>
  );
}
