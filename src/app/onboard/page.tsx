"use client";

// Self-onboarding wizard for a new lending organization — four steps, one
// final POST. Branding lives INSIDE creation (founder's call): when the admin
// first signs in, the console is already theirs — logo top-left, their colors
// everywhere. Mobile-first like every customer-facing surface.
import { useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, Building2, ArrowRight, ArrowLeft, AlertTriangle, CheckCircle2, UserRound, Palette, ClipboardCheck } from "lucide-react";
import BrandStudio, { type BrandDraft } from "@/components/branding/BrandStudio";

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);

const STEPS = [
  { key: "org", label: "Organization", icon: Building2 },
  { key: "admin", label: "Admin account", icon: UserRound },
  { key: "brand", label: "Branding", icon: Palette },
  { key: "review", label: "Review", icon: ClipboardCheck },
] as const;

export default function OnboardOrg() {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [slug, setSlug] = useState("");
  const [blurb, setBlurb] = useState("");
  const [tagline, setTagline] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPhone, setAdminPhone] = useState("");
  const [password, setPassword] = useState("");
  const [brand, setBrand] = useState<BrandDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ slug: string; logoWarning: string | null } | null>(null);

  const effectiveSlug = useMemo(() => (slugTouched ? slug : slugify(name)), [slugTouched, slug, name]);

  const stepValid = [
    name.trim().length >= 3 && effectiveSlug.length >= 3,
    adminName.trim().length >= 2 && adminEmail.includes("@") && password.length >= 10,
    true, // branding is skippable — defaults now, Organization → Branding later
    true,
  ][step];

  const submit = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/orgs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, slug: effectiveSlug, blurb, tagline, adminName, adminEmail, adminPhone, password,
          accent: brand?.accent, accent2: brand?.accent2, logoDataUrl: brand?.logoDataUrl ?? undefined,
        }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not create the organization."); return; }
      setCreated({ slug: data.slug, logoWarning: data.logoWarning ?? null });
    } catch { setError("Could not create the organization."); } finally { setLoading(false); }
  };

  const field = "flex items-center gap-2 rounded-lg border border-zinc-900/15 bg-white/80 px-3";
  const input = "flex-1 bg-transparent outline-none text-sm py-3 placeholder:text-zinc-400 min-w-0";
  const caption = "mt-1 text-[11px] text-zinc-500";

  return (
    <div className="min-h-screen relative text-zinc-900">
      <div aria-hidden className="fixed inset-0 z-0 bg-[url('/images/white-background.png')] bg-cover bg-center" />
      <div className="relative z-10 min-h-screen flex items-start sm:items-center justify-center px-4 py-8">
        <div className="glass w-full max-w-xl rounded-3xl bg-white/65 p-6 sm:p-8">
          {created ? (
            <div className="text-center py-6">
              <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
              <h1 className="mt-4 text-2xl font-bold">Organization created</h1>
              <p className="mt-2 text-sm text-zinc-600">
                <span className="font-semibold">{created.slug}.birgenai.com</span> is reserved and your branding is
                already applied. Sign in to set up products, workflows and your team — BirgenAI will review and
                activate live lending.
              </p>
              {created.logoWarning && (
                <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50/90 px-3 py-2 text-xs text-amber-700">{created.logoWarning}</p>
              )}
              <Link href="/login" className="mt-6 inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-5 py-3 text-sm font-semibold text-white hover:bg-zinc-800">
                Go to sign in <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          ) : (
            <>
              <div className="text-center">
                <Building2 className="mx-auto h-10 w-10" style={{ color: "var(--brand)" }} />
                <h1 className="mt-3 text-2xl font-bold">Create your lending organization</h1>
                <p className="mt-1.5 text-sm text-zinc-500">Your own branded portal, products, workflows and team — powered by BirgenAI.</p>
              </div>

              {/* Step rail */}
              <div className="mt-5 flex items-center justify-center gap-1.5">
                {STEPS.map((s, i) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => i < step && setStep(i)}
                    className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold ${
                      i === step ? "text-white" : i < step ? "bg-emerald-100 text-emerald-700" : "bg-zinc-900/5 text-zinc-400"
                    }`}
                    style={i === step ? { backgroundColor: "var(--brand)" } : undefined}
                  >
                    <s.icon className="h-3 w-3" />
                    <span className="hidden sm:inline">{s.label}</span>
                    <span className="sm:hidden">{i + 1}</span>
                  </button>
                ))}
              </div>

              {error && (
                <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
                </div>
              )}

              {step === 0 && (
                <div className="mt-5 space-y-3">
                  <div>
                    <div className={field}><input className={input} placeholder="Organization name (e.g. Umoja Capital)" value={name} onChange={(e) => setName(e.target.value)} /></div>
                    <p className={caption}>The legal or trading name your borrowers know you by.</p>
                  </div>
                  <div>
                    <div className={field}>
                      <input className={input} placeholder="subdomain" value={effectiveSlug}
                        onChange={(e) => { setSlugTouched(true); setSlug(slugify(e.target.value)); }} />
                      <span className="text-xs text-zinc-400 shrink-0">.birgenai.com</span>
                    </div>
                    <p className={caption}>Your borrower portal&apos;s address. Choose carefully — it&apos;s on your posters.</p>
                  </div>
                  <div>
                    <div className={field}><input className={input} placeholder="Tagline (e.g. Credit that grows your duka)" value={tagline} onChange={(e) => setTagline(e.target.value)} /></div>
                    <p className={caption}>One line under your name on the portal — what you promise.</p>
                  </div>
                  <div>
                    <div className={field}><input className={input} placeholder="One-line description (shown to borrowers)" value={blurb} onChange={(e) => setBlurb(e.target.value)} /></div>
                    <p className={caption}>A sentence about who you are, shown where borrowers choose a lender.</p>
                  </div>
                </div>
              )}

              {step === 1 && (
                <div className="mt-5 space-y-3">
                  <div>
                    <div className={field}><input className={input} placeholder="Admin full name" value={adminName} onChange={(e) => setAdminName(e.target.value)} /></div>
                    <p className={caption}>This person gets the &quot;Org Admin&quot; role — every menu, every ability, including creating other roles.</p>
                  </div>
                  <div className={field}><input className={input} inputMode="email" placeholder="Admin email (sign-in)" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} /></div>
                  <div className={field}><input className={input} inputMode="tel" placeholder="Admin phone (07XX XXX XXX)" value={adminPhone} onChange={(e) => setAdminPhone(e.target.value)} /></div>
                  <div>
                    <div className={field}><input className={input} type="password" placeholder="Password (10+ characters)" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
                    <p className={caption}>You can change it any time from the profile menu.</p>
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="mt-5">
                  <BrandStudio orgName={name || "Your organization"} initial={{ accent: "#F97316" }} onDraft={setBrand} />
                  <p className="mt-3 text-center text-[11px] text-zinc-400">
                    No logo yet? Skip this — sensible defaults apply, and everything here lives under Organization → Branding later.
                  </p>
                </div>
              )}

              {step === 3 && (
                <div className="mt-5 space-y-2 text-sm">
                  {[
                    ["Organization", `${name} — ${effectiveSlug}.birgenai.com`],
                    ["Tagline", tagline || "—"],
                    ["Administrator", `${adminName} · ${adminEmail}${adminPhone ? ` · ${adminPhone}` : ""}`],
                    ["Logo", brand?.logoDataUrl ? "Uploaded — will appear at the top-left of your console" : "None yet — an initial-letter tile until you add one"],
                    ["Accent color", brand ? `${brand.accent} — your buttons, links and highlights` : "BirgenAI orange until you change it"],
                    ["Gradient", brand ? `${brand.accent} → ${brand.accent2} — portal hero and sign-in page` : "Derived from the accent"],
                    ["Starter roles", "Org Admin (everything) · Loan Officer · Branch Manager · Finance — edit them under Access → Roles"],
                    ["Status", "PENDING — you can configure everything; BirgenAI reviews and activates live lending"],
                  ].map(([k, v]) => (
                    <div key={k} className="flex gap-3 rounded-lg bg-white/70 border border-zinc-900/10 px-3 py-2">
                      <span className="w-28 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-zinc-400 pt-0.5">{k}</span>
                      <span className="text-[13px] text-zinc-700">{v}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-6 flex items-center gap-2">
                {step > 0 && (
                  <button onClick={() => setStep((s) => s - 1)} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-900/15 bg-white/70 px-4 py-3 text-sm font-medium text-zinc-600">
                    <ArrowLeft className="h-4 w-4" /> Back
                  </button>
                )}
                {step < STEPS.length - 1 ? (
                  <button onClick={() => setStep((s) => s + 1)} disabled={!stepValid}
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-900 px-5 py-3 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50">
                    Continue <ArrowRight className="h-4 w-4" />
                  </button>
                ) : (
                  <button onClick={submit} disabled={loading}
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-900 px-5 py-3 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60">
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Create organization <ArrowRight className="h-4 w-4" />
                  </button>
                )}
              </div>

              <p className="mt-4 text-center text-xs text-zinc-400">
                Already onboarded? <Link href="/login" className="font-semibold" style={{ color: "var(--brand)" }}>Sign in</Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
