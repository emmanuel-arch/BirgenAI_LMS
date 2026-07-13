"use client";

import { useState, useRef, useEffect, type CSSProperties, type SyntheticEvent } from "react";
import { useLoad } from "@/lib/hooks/useLoad";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Gauge, ArrowRight, ArrowLeft, Loader2, CheckCircle2, ShieldCheck, Upload, FileText,
  Lock, AlertTriangle, Phone, Banknote, HelpCircle, ChevronDown, MapPin, Crosshair,
} from "lucide-react";
import { getBrand, BRANDED_LENDERS } from "@/lib/lms/branding";
import { useBrand } from "@/lib/lms/useBrand";
import { useLang } from "@/lib/i18n/useLang";
import { fmt } from "@/lib/i18n/portal";
import { LangToggle } from "@/components/portal/LangToggle";
import { deviceFingerprint } from "@/lib/portal/fingerprint";
import CrunchTheatre, { type CrunchData } from "@/components/statement/CrunchTheatre";
import OtpCard, { type OtpIssue } from "@/components/portal/OtpCard";
import { OfferCard } from "@/components/portal/OfferCard";

const LENDERS = BRANDED_LENDERS;

// Detect the lender from the HOSTNAME (micromart.birgenai.com / micromart.localhost).
// The middleware rewrite keeps the browser URL at "/", so ?lender= alone is NOT
// visible client-side on subdomain roots — the subdomain is the source of truth,
// ?lender= the fallback for direct links.
function lenderFromLocation(): string | null {
  if (typeof window === "undefined") return null;
  const label = window.location.hostname.split(".")[0]?.toLowerCase() ?? "";
  if (LENDERS.some((l) => l.slug === label)) return label;
  const q = new URLSearchParams(window.location.search).get("lender");
  if (q && LENDERS.some((l) => l.slug === q)) return q;
  return null;
}

// Which consents exist and which are mandatory is POLICY; the words are language.
// The keys index into t.consent.items so English and Kiswahili can never list a
// different set of grants.
const CONSENT_KEYS = [
  { key: "mpesaAnalysis", required: true },
  { key: "automatedScoring", required: true },
  { key: "crbCheck", required: false },
  { key: "modelImprovement", required: false },
  { key: "crossBorder", required: false },
] as const;

type Features = Record<string, unknown> & { avgMonthlyIncome?: number; avgMonthlyNet?: number; gamblingRatio?: number };
// No serviceSuiteBorrowerId: the lender's internal id never leaves the server —
// /api/lms/apply re-derives it from the OTP-verified phone.
type Elig = { graduated: boolean; found?: boolean; clearedLoans?: number; borrowerName?: string; available?: boolean };
type Customer = {
  name: string; accountNo: string | null; nationalId: string | null; phone: string | null;
  email: string | null; age: number | null; gender: string | null; status: string;
  photoUrl: string | null; riskScore: number | null; riskCategory: string | null;
  lastScoreUpdate: string | null; loanLimit: number | null; previousLoanLimit: number | null;
  graduationPercentage: number | null; agentName: string | null; branchName: string | null;
  officeTrail: { unit: string; level: string }[];
  loansCount: number; totalBorrowed: number; olb: number; clearedLoans: number; activeLoans: number;
};
type ScorePreview = { score: number; band: string; tone: "good" | "warn" | "high" | "bad" };
type Submitted = { applicationId: string; offerId?: string | null; status: string; stageTitle: string; decision: string; score: number; band: string; posting?: { attempted: boolean; ok: boolean; message: string } };
type Product = {
  id: number; name: string; description: string | null;
  minPrincipal: number | null; maxPrincipal: number | null;
  interestRate: number | null; interestUnit: string | null;
  repaymentPeriod: number | null; repaymentUnit: string | null;
  minCreditScore: number | null;
  interestMethod?: string; disbursementMode?: string;
};

const fmtKES = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
const productTerm = (p: Product) =>
  p.repaymentPeriod ? `${p.repaymentPeriod}${p.repaymentUnit ? " " + p.repaymentUnit : ""}` : null;

const TONE: Record<string, string> = { good: "text-emerald-600", warn: "text-amber-600", high: "text-orange-600", bad: "text-red-600" };

const riskTone = (cat: string | null) => {
  const c = (cat ?? "").toLowerCase();
  if (c.includes("minor") || c.includes("low")) return "text-emerald-600";
  if (c.includes("moderate") || c.includes("medium")) return "text-amber-600";
  if (c.includes("major") || c.includes("high") || c.includes("severe")) return "text-red-600";
  return "text-zinc-700";
};

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");

const fmtDate = (iso: string | null, locale: string) =>
  iso ? new Date(iso).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" }) : null;

/** Stat tile for the Customer-360 card. */
function Tile({ label, value, sub, valueClass }: { label: string; value: string; sub?: string | null; valueClass?: string }) {
  return (
    <div className="rounded-xl border border-zinc-900/10 bg-white/70 p-3.5">
      <p className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={`mt-1 text-lg font-bold leading-tight ${valueClass ?? "text-zinc-900"}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-zinc-500">{sub}</p>}
    </div>
  );
}

// White glass panel — the portal's core surface over the white background image.
const GLASS = "rounded-2xl border border-white/70 bg-white/60 backdrop-blur-xl shadow-[0_8px_30px_rgba(0,0,0,0.06)]";

export default function LmsPortal() {
  // Phase-1 standalone portal: no platform login — borrowers identify by phone
  // (+ national ID) inside the wizard; staff/borrower auth arrives in Phase 2.
  const session: { user?: { id?: string; name?: string | null } } | null = null;
  const fileRef = useRef<HTMLInputElement>(null);
  const { lang, t } = useLang();
  const dateLocale = lang === "sw" ? "sw-KE" : "en-KE";

  const [step, setStep] = useState(0);
  const [lender, setLender] = useState("micromart");
  const [phone, setPhone] = useState("");
  const [otpIssue, setOtpIssue] = useState<OtpIssue | null>(null);
  const [elig, setElig] = useState<Elig | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [photoErr, setPhotoErr] = useState(false);
  const [consent, setConsent] = useState<Record<string, boolean>>({});
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [crunching, setCrunching] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [features, setFeatures] = useState<Features | null>(null);
  const [scorePreview, setScorePreview] = useState<ScorePreview | null>(null);
  const [amount, setAmount] = useState("");
  // Pay-to-institution products (§7): the school's paybill, captured here.
  const [payee, setPayee] = useState({ name: "", paybill: "", account: "" });
  const [productRef, setProductRef] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoaded, setProductsLoaded] = useState(false);
  // The approved limit for the chosen product — previewed by the same engine that
  // enforces it at apply, so the slider's ceiling and the server's wall agree.
  const [limitInfo, setLimitInfo] = useState<{
    approvedLimit: number;
    borrowerClass: string;
    reasons: { code: string; factor: string; detail: string; direction: string }[];
  } | null>(null);
  const [limitLoading, setLimitLoading] = useState(false);
  const [submitted, setSubmitted] = useState<Submitted | null>(null);
  const [offerSigned, setOfferSigned] = useState(false);

  // Geo capture — one-time, consented location for loan verification (never tracked).
  const [geoConsent, setGeoConsent] = useState(false);
  const [locationType, setLocationType] = useState<"business" | "home">("business");
  const [location, setLocation] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [manualAddress, setManualAddress] = useState("");
  const [geoStatus, setGeoStatus] = useState<"idle" | "capturing" | "error" | "done">("idle");
  const [geoError, setGeoError] = useState<string | null>(null);
  const [scoped, setScoped] = useState(false); // locked to one lender via subdomain
  // Branding is resolved client-side (hostname); render no brand until then so a
  // white-label subdomain never flashes the BirgenAI logo on first paint.
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // After mount: reveal branding (no white-label logo flash) and, on a per-lender
  // host, pre-select that lender and skip the chooser.
  useLoad(() => {
    setMounted(true);
    const l = lenderFromLocation();
    if (l) { setLender(l); setScoped(true); }
  });

  const lenderObj = LENDERS.find((l) => l.slug === lender)!;
  // DB-first: an org that onboarded this morning wears its own logo/colors here.
  const brand = useBrand(lender);

  // White-label: the browser tab carries the lender's name, not BirgenAI's.
  useEffect(() => {
    if (scoped) document.title = brand.name;
  }, [scoped, brand.name]);
  const next = () => setStep((s) => s + 1);
  const back = () => setStep((s) => Math.max(0, s - 1));

  // Step 0 → 1. Nothing about this borrower is looked up until they prove the
  // number is theirs — eligibility and the Customer-360 both return real PII.
  const requestOtp = async () => {
    setError(null);
    if (!phone.trim()) { setError(t.errors.enterPhone); return; }
    setLoading(true);
    try {
      // Already verified this number with this lender (reload, back-navigation)?
      // Don't spend another SMS — or another slot in their OTP budget.
      try {
        const s = await fetch(`/api/portal/session?phone=${encodeURIComponent(phone.trim())}`).then((r) => r.json());
        if (s?.authenticated && s.lenderSlug === lender && s.matchesPhone) { await runEligibility(); return; }
      } catch { /* no session — issue a code as normal */ }

      const res = await fetch("/api/portal/otp", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lenderSlug: lender, phone: phone.trim(), lang }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || t.errors.couldNotSendCode); return; }
      setOtpIssue({ delivered: !!data.delivered, devCode: data.devCode });
      setStep(1);
    } catch { setError(t.errors.couldNotSendCode); } finally { setLoading(false); }
  };

  // Runs once the phone is verified. The server reads it from the session
  // cookie, so neither call sends a phone number any more.
  const runEligibility = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/lms/eligibility", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lenderSlug: lender }),
      });
      const data = await res.json();
      if (data.needsOtp) { setStep(0); setError(t.errors.sessionExpired); return; }
      if (!data.success) { setError(data.message || t.errors.checkFailed); return; }
      setElig(data);
      // Known customer → show their own Customer-360 profile (the trust step:
      // the portal mirrors what the lender's LMS knows) before consent. Unknown
      // numbers go straight to consent as new applicants.
      if (data.found) {
        try {
          const ciRes = await fetch("/api/lms/customer-info", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lenderSlug: lender }),
          });
          const ci = await ciRes.json();
          if (ci?.success && ci.found && ci.customer) {
            setCustomer(ci.customer);
            setPhotoErr(false);
            setStep(2);
            return;
          }
        } catch { /* the profile is progressive enhancement — never blocks the funnel */ }
      }
      setCustomer(null);
      setStep(3);
    } catch { setError(t.errors.couldNotRunCheck); } finally { setLoading(false); }
  };

  // "Not me" — drop the verified session before handing the phone back.
  const signOutBorrower = async () => {
    try { await fetch("/api/portal/session", { method: "DELETE" }); } catch { /* best-effort */ }
    setCustomer(null); setElig(null); setPhone(""); setOtpIssue(null); setStep(0);
  };

  // The crunch itself runs inside the theatre overlay — it owns the upload and
  // the staged reveal (decrypt → parse → extract → ledger → audit → score).
  // We only gate on a file and take the finished result.
  const startCrunch = () => {
    setError(null);
    if (!file) { setError(t.errors.uploadStatement); return; }
    setCrunching(true);
  };

  const onCrunchComplete = (data: CrunchData) => {
    setFeatures(data.features);
    setScorePreview({ score: data.creditScore.score, band: data.creditScore.band, tone: data.creditScore.tone });
    setCrunching(false);
    next();
  };

  // Load the lender's products once the borrower reaches the amount step.
  useEffect(() => {
    if (step !== 5 || productsLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/lms/products", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lenderSlug: lender }),
        });
        const data = await res.json();
        if (!cancelled && data?.success && Array.isArray(data.products)) setProducts(data.products);
      } catch {
        /* fall back to manual amount entry */
      } finally {
        if (!cancelled) setProductsLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [step, lender, productsLoaded]);

  const selectedProduct = products.find((p) => String(p.id) === productRef) ?? null;

  // Ask for the approved limit once a product is chosen (and re-ask per product —
  // the ceiling depends on the product's own bounds).
  useEffect(() => {
    if (step !== 5 || !productRef || !features) { setLimitInfo(null); return; }
    let cancelled = false;
    setLimitLoading(true);
    (async () => {
      try {
        const res = await fetch("/api/lms/limit", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lenderSlug: lender, productRef, features }),
        });
        const data = await res.json();
        if (!cancelled) setLimitInfo(data?.success && data.available ? { approvedLimit: data.approvedLimit, borrowerClass: data.borrowerClass, reasons: data.reasons ?? [] } : null);
      } catch {
        if (!cancelled) setLimitInfo(null); // no preview ≠ no application; the server still enforces
      } finally {
        if (!cancelled) setLimitLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [step, productRef, features, lender]);

  const overLimit = limitInfo != null && limitInfo.approvedLimit > 0 && Number(amount) > limitInfo.approvedLimit;

  // 0 / null bounds mean "no limit" (e.g. device financing where the amount is the
  // device price). Only enforce a bound when it is a positive number.
  const hasMin = (p: Product) => p.minPrincipal != null && p.minPrincipal > 0;
  const hasMax = (p: Product) => p.maxPrincipal != null && p.maxPrincipal > 0;

  const selectProduct = (p: Product) => {
    setProductRef(String(p.id));
    // Seed the amount with the product minimum if empty / below it.
    const amt = Number(amount);
    if (hasMin(p) && (!amount || amt < p.minPrincipal!)) setAmount(String(Math.round(p.minPrincipal!)));
  };

  const amountOutOfRange =
    selectedProduct != null && amount.trim() !== "" &&
    ((hasMin(selectedProduct) && Number(amount) < selectedProduct.minPrincipal!) ||
      (hasMax(selectedProduct) && Number(amount) > selectedProduct.maxPrincipal!));

  const captureLocation = () => {
    setGeoError(null);
    if (!geoConsent) { setGeoConsent(true); }
    if (!("geolocation" in navigator)) { setGeoStatus("error"); setGeoError(t.geo.unsupported); return; }
    setGeoStatus("capturing");
    navigator.geolocation.getCurrentPosition(
      (p) => { setLocation({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }); setGeoStatus("done"); },
      (err) => {
        setGeoStatus("error");
        setGeoError(err.code === err.PERMISSION_DENIED ? t.geo.denied : t.geo.failed);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  const submit = async () => {
    setError(null);
    if (!amount.trim() || Number(amount) <= 0) { setError(t.errors.enterAmount); return; }
    if (amountOutOfRange && selectedProduct) {
      const lo = hasMin(selectedProduct) ? fmt(t.errors.amountFrom, { kes: fmtKES(selectedProduct.minPrincipal!) }) : "";
      const hi = hasMax(selectedProduct) ? fmt(t.errors.amountUpTo, { kes: fmtKES(selectedProduct.maxPrincipal!) }) : "";
      setError(fmt(t.errors.amountRange, { product: selectedProduct.name, lo, hi }));
      return;
    }
    if (selectedProduct?.disbursementMode === "TO_THIRD_PARTY" && !/^\d{5,8}$/.test(payee.paybill)) {
      setError(t.errors.paybillRequired);
      return;
    }
    if (overLimit && limitInfo) {
      setError(fmt(t.errors.overLimit, { kes: fmtKES(limitInfo.approvedLimit) }));
      return;
    }
    setLoading(true);
    try {
      // Fraud signal, not tracking: a hash of the device's stable traits, so the
      // console can see one device applying as many different people.
      const fp = await deviceFingerprint().catch(() => null);
      const res = await fetch("/api/lms/apply", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // No phone, no borrower id, no graduated flag: the server derives all
          // of it from the verified session. Only a new applicant's own name.
          lenderSlug: lender,
          borrowerName: elig?.found ? undefined : elig?.borrowerName,
          productRef: productRef.trim() || undefined, amountRequested: Number(amount),
          features,
          consent: { ...consent, geoTagging: geoConsent || !!location || manualAddress.trim().length > 0 },
          location: location ? { lat: location.lat, lng: location.lng, accuracy: location.accuracy } : undefined,
          locationType,
          locationAddress: manualAddress.trim() || undefined,
          deviceFingerprint: fp ?? undefined,
          // The language they chose to read their credit agreement in — every SMS
          // about this loan (reminders, arrears, receipts) follows it.
          language: lang,
          payee: selectedProduct?.disbursementMode === "TO_THIRD_PARTY"
            ? { name: payee.name.trim() || undefined, paybill: payee.paybill, account: payee.account.trim() || undefined }
            : undefined,
        }),
      });
      const data = await res.json();
      if (data.needsOtp) { setStep(0); setError(t.errors.sessionExpired); return; }
      if (!data.success) {
        // The server's wall: it recomputed the limit and the ask was above it.
        // Update the preview so the screen shows the same ceiling the wall used.
        if (data.limitExceeded) {
          setLimitInfo((prev) => ({ approvedLimit: data.approvedLimit ?? 0, borrowerClass: prev?.borrowerClass ?? "", reasons: prev?.reasons ?? [] }));
        }
        setError(data.message || t.errors.couldNotSubmit);
        return;
      }
      setSubmitted(data);
      next();
    } catch { setError(t.errors.submissionFailed); } finally { setLoading(false); }
  };

  const coreConsents = consent.mpesaAnalysis && consent.automatedScoring;

  const brandStyle = { "--brand": brand.accent, "--brand-soft": brand.accentSoft } as CSSProperties;
  const onLogoError = (e: SyntheticEvent<HTMLImageElement>, fallback: string) => {
    const img = e.target as HTMLImageElement;
    if (img.src.endsWith(fallback)) { img.style.display = "none"; return; }
    img.src = fallback;
  };

  return (
    <div className="min-h-screen text-zinc-900 relative overflow-x-hidden" style={brandStyle}>
      {/* Full-bleed white background image behind the whole lending system */}
      <div aria-hidden className="fixed inset-0 z-0 bg-[url('/images/white-background.png')] bg-cover bg-center" />

      {/* Top bar — BirgenAI company logo left; language + account right */}
      <header className="sticky top-0 z-30 border-b border-zinc-900/10 bg-white/70 backdrop-blur-xl">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2.5 min-w-0">
            {!mounted ? null : scoped ? (
              // White-label: the lender IS the app — no BirgenAI branding anywhere.
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={brand.logo} alt={brand.name} className="h-8 w-8 object-contain shrink-0" onError={(e) => onLogoError(e, brand.fallbackLogo)} />
                <span className="text-base font-bold truncate">{brand.name}</span>
              </>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src="/images/logo.png" alt="BirgenAI" className="h-8 w-auto object-contain"
                onError={(e) => onLogoError(e, "/images/BirgenAI-logo.png")} />
            )}
          </Link>
          <div className="flex items-center gap-3 min-w-0">
            <span className="hidden sm:block text-xs text-zinc-400 truncate">{scoped ? brand.blurb : ""}</span>
            <LangToggle />
          </div>
        </div>
      </header>

      <div className="relative z-10 mx-auto max-w-6xl px-4 sm:px-6 py-6 lg:py-8">
        <main className="min-w-0">
          {/* Branded hero — only when the portal is locked to one lender (subdomain).
              Hidden on the landing card, which carries the lender logo itself. */}
          {scoped && step > 0 && (
            <div className={`${GLASS} relative overflow-hidden max-w-xl mx-auto mb-5`}>
              {brand.hero && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={brand.hero} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover opacity-15"
                  onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
              )}
              <div className="relative px-4 sm:px-5 py-4 flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white ring-1 ring-zinc-900/10 overflow-hidden shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={brand.logo} alt={brand.name} className="h-9 w-9 object-contain" onError={(e) => onLogoError(e, brand.fallbackLogo)} />
                </div>
                <div>
                  <p className="text-lg font-bold leading-tight">{brand.name}</p>
                  <p className="text-xs text-zinc-500">{brand.tagline}</p>
                </div>
              </div>
            </div>
          )}

          <div className="max-w-xl mx-auto">
            {error && (
              <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
              </div>
            )}

            {/* STEP 0 — landing: one centred glass card. Logo → wording → lender
                choice (hidden on scoped subdomains) → phone. No sidebar, no
                progress bar, no ID field — everything fits without scrolling.
                Rendered after mount so white-label hosts never flash BirgenAI. */}
            {step === 0 && mounted && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                className="min-h-[55vh] flex items-center justify-center">
                <div className={`${GLASS} w-full rounded-3xl bg-white/65 backdrop-blur-2xl p-6 sm:p-8`}>
                  <div className="text-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={scoped ? brand.logo : "/images/logo.png"} alt={scoped ? brand.name : "BirgenAI"}
                      className="mx-auto mb-4 h-12 w-auto object-contain"
                      onError={(e) => onLogoError(e, scoped ? brand.fallbackLogo : "/images/BirgenAI-logo.png")} />
                    <h1 className="text-2xl sm:text-3xl font-bold">
                      {scoped ? t.landing.titleScoped : t.landing.titleOpen}
                    </h1>
                    <p className="mt-2 text-sm text-zinc-500">
                      {scoped ? fmt(t.landing.subScoped, { name: brand.name }) : t.landing.subOpen}
                    </p>
                  </div>

                  {!scoped && (
                    <div className="mt-5 space-y-2.5">
                      {LENDERS.map((l) => {
                        const lb = getBrand(l.slug);
                        const active = lender === l.slug;
                        return (
                          <button key={l.slug} onClick={() => setLender(l.slug)}
                            className={`w-full flex items-center gap-3 rounded-2xl border p-3.5 text-left transition-colors ${active ? "" : "border-zinc-900/10 bg-white/70 hover:border-zinc-900/25"}`}
                            style={active ? { borderColor: lb.accent, backgroundColor: lb.accentSoft } : undefined}>
                            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white ring-1 ring-zinc-900/10 overflow-hidden shrink-0">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={l.logo} alt={l.name} className="h-8 w-8 object-contain" onError={(e) => onLogoError(e, l.fallbackLogo)} />
                            </div>
                            <div className="flex-1">
                              <p className="font-semibold">{l.name}</p>
                              <p className="text-xs text-zinc-500">{l.blurb}</p>
                            </div>
                            {active && <CheckCircle2 className="h-5 w-5" style={{ color: lb.accent }} />}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <div className="mt-5 flex items-center gap-2 rounded-lg border border-zinc-900/15 bg-white/80 px-3">
                    <Phone className="h-4 w-4 text-zinc-400 shrink-0" />
                    <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel"
                      placeholder={scoped ? t.landing.phonePlaceholderScoped : t.landing.phonePlaceholderOpen}
                      className="flex-1 bg-transparent outline-none text-sm py-3 placeholder:text-zinc-400" />
                  </div>

                  <button onClick={requestOtp} disabled={loading}
                    className="mt-5 w-full inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-900 px-5 py-3 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60">
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {t.common.continue} <ArrowRight className="h-4 w-4" />
                  </button>
                  <p className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-zinc-400">
                    <Lock className="h-3 w-3" /> {t.landing.smsNote}
                  </p>
                </div>
              </motion.div>
            )}

            {/* STEP 1 — prove the number is yours. Everything past this point
                (profile, limits, balances, an application) is real PII. */}
            {step === 1 && otpIssue && (
              <div className="min-h-[55vh] flex items-center justify-center">
                <OtpCard
                  lenderSlug={lender}
                  phone={phone.trim()}
                  issue={otpIssue}
                  onVerified={runEligibility}
                  onChangeNumber={() => { setOtpIssue(null); setError(null); setStep(0); }}
                />
              </div>
            )}

            {/* STEP 2 — Customer 360: the borrower's own profile as the lender's
                LMS knows it (photo, officer, branch, limits) — the trust step. */}
            {step === 2 && customer && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className={`${GLASS} p-5 sm:p-6`}>
                <div className="flex items-center gap-4">
                  {customer.photoUrl && !photoErr ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={customer.photoUrl} alt={customer.name} onError={() => setPhotoErr(true)}
                      className="h-20 w-20 rounded-2xl object-cover ring-2 ring-white shadow-md shrink-0" />
                  ) : (
                    <div className="flex h-20 w-20 items-center justify-center rounded-2xl text-2xl font-bold text-white shadow-md shrink-0"
                      style={{ backgroundColor: "var(--brand)" }}>
                      {initials(customer.name)}
                    </div>
                  )}
                  <div className="min-w-0">
                    <h1 className="text-xl font-bold leading-tight truncate">{customer.name}</h1>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {customer.accountNo && (
                        <span className="rounded-md bg-zinc-900/5 px-2 py-0.5 text-[11px] font-semibold text-zinc-600">ACC {customer.accountNo}</span>
                      )}
                      <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${customer.status === "ACTIVE" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                        {customer.status}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
                  {customer.nationalId && (<><span className="text-zinc-500">{t.profile.idNumber}</span><span className="text-right font-medium">{customer.nationalId}</span></>)}
                  {customer.age != null && (<><span className="text-zinc-500">{t.profile.age}</span><span className="text-right font-medium">{fmt(t.profile.years, { n: customer.age })}</span></>)}
                  {customer.gender && (<><span className="text-zinc-500">{t.profile.gender}</span><span className="text-right font-medium">{customer.gender}</span></>)}
                  {customer.email && (<><span className="text-zinc-500">{t.profile.email}</span><span className="text-right font-medium truncate">{customer.email}</span></>)}
                  {customer.agentName && (<><span className="text-zinc-500">{t.profile.yourOfficer}</span><span className="text-right font-medium">{customer.agentName}</span></>)}
                </div>

                {customer.officeTrail.length > 0 && (
                  <p className="mt-3 text-xs text-zinc-500">
                    {customer.officeTrail.map((o, i) => (
                      <span key={i}>
                        {i > 0 && <span className="mx-1 text-zinc-400">›</span>}
                        <span className="font-medium text-zinc-700">{o.unit}</span>
                        {o.level && o.level !== o.unit && <span className="text-zinc-400"> [{o.level}]</span>}
                      </span>
                    ))}
                  </p>
                )}

                <div className="mt-5 grid grid-cols-2 gap-2.5">
                  {customer.riskScore != null && (
                    <Tile label={t.profile.creditScore} value={String(customer.riskScore)}
                      sub={fmtDate(customer.lastScoreUpdate, dateLocale) ? fmt(t.profile.updated, { date: fmtDate(customer.lastScoreUpdate, dateLocale)! }) : null} />
                  )}
                  {customer.riskCategory && (
                    <Tile label={t.profile.riskCategory} value={customer.riskCategory} valueClass={riskTone(customer.riskCategory)} />
                  )}
                  {customer.loanLimit != null && (
                    <Tile label={t.profile.loanLimit} value={fmtKES(customer.loanLimit)}
                      sub={customer.previousLoanLimit != null ? fmt(t.profile.previous, { kes: fmtKES(customer.previousLoanLimit) }) : null} />
                  )}
                  {customer.graduationPercentage != null && (
                    <Tile label={t.profile.loanGraduation} value={`${customer.graduationPercentage}%`} />
                  )}
                  <Tile label={fmt(t.profile.loans, { n: customer.loansCount })} value={fmtKES(customer.totalBorrowed)}
                    sub={fmt(t.profile.cleared, { n: customer.clearedLoans })} />
                  <Tile label={t.profile.outstanding} value={fmtKES(customer.olb)}
                    sub={customer.activeLoans > 0 ? fmt(t.profile.active, { n: customer.activeLoans }) : t.profile.nothingDue} />
                </div>

                <p className="mt-4 text-xs text-zinc-500 flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                  {fmt(t.profile.shownToConfirm, { name: lenderObj.name })}
                </p>

                <div className="mt-5 flex gap-2">
                  <button onClick={signOutBorrower}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-900/15 px-4 py-3 text-sm text-zinc-600 hover:bg-zinc-900/5">
                    {t.profile.notMe}
                  </button>
                  <button onClick={() => setStep(3)}
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-900 px-5 py-3 text-sm font-semibold text-white hover:bg-zinc-800">
                    {t.profile.thisIsMyAccount} <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </motion.div>
            )}

            {/* STEP 3 — eligibility result + consent */}
            {step === 3 && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className={`${GLASS} p-5 sm:p-6`}>
                {elig?.graduated ? (
                  <div className="rounded-2xl border border-emerald-300 bg-emerald-50/90 p-4 mb-5">
                    <p className="flex items-center gap-2 font-semibold text-emerald-700"><CheckCircle2 className="h-5 w-5" /> {t.consent.preQualified}</p>
                    <p className="mt-1 text-sm text-zinc-600">
                      {fmt(t.consent.welcomeBack, { name: elig.borrowerName ? `, ${elig.borrowerName.split(" ")[0]}` : "", n: elig.clearedLoans ?? 0 })}
                    </p>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-zinc-900/10 bg-white/70 p-4 mb-5">
                    <p className="font-semibold">{t.consent.willAssess}</p>
                    <p className="mt-1 text-sm text-zinc-600">{t.consent.willAssessDetail}</p>
                  </div>
                )}

                <h2 className="text-lg font-semibold">{t.consent.yourConsent}</h2>
                <p className="text-xs text-zinc-500 mb-3">{t.consent.intro}</p>
                <div className="space-y-2">
                  {CONSENT_KEYS.map((cn) => {
                    const words = t.consent.items[cn.key];
                    return (
                      <label key={cn.key} className="flex items-start gap-3 rounded-xl border border-zinc-900/10 bg-white/70 p-3 cursor-pointer">
                        <input type="checkbox" checked={!!consent[cn.key]} onChange={(e) => setConsent((s) => ({ ...s, [cn.key]: e.target.checked }))} className="mt-0.5 h-4 w-4" style={{ accentColor: "var(--brand)" }} />
                        <div>
                          <p className="text-sm font-medium">{words.label} {cn.required && <span className="text-xs" style={{ color: "var(--brand)" }}>{t.common.required}</span>}</p>
                          <p className="text-xs text-zinc-500">{words.detail}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>

                {/* Location — optional, consented, one-time (never tracked) */}
                <div className="mt-3 rounded-xl border border-zinc-900/10 bg-white/70 p-3">
                  <div className="flex items-start gap-2.5">
                    <MapPin className="h-4 w-4 mt-0.5 shrink-0" style={{ color: "var(--brand)" }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">
                        {locationType === "business" ? t.geo.shareBusiness : t.geo.shareHome}{" "}
                        <span className="text-zinc-400 text-xs">{t.common.optional}</span>
                      </p>
                      <p className="text-xs text-zinc-500">{t.geo.help}</p>
                    </div>
                  </div>

                  <div className="mt-2.5 grid grid-cols-2 gap-2">
                    {(["business", "home"] as const).map((ty) => (
                      <button key={ty} onClick={() => setLocationType(ty)}
                        className={`rounded-lg border px-3 py-2 text-xs ${locationType === ty ? "font-semibold" : "border-zinc-900/10 bg-white/70 text-zinc-600"}`}
                        style={locationType === ty ? { borderColor: brand.accent, backgroundColor: brand.accentSoft } : undefined}>
                        {ty === "business" ? t.geo.business : t.geo.home}
                      </button>
                    ))}
                  </div>

                  {location ? (
                    <div className="mt-2.5 flex items-center justify-between gap-2 rounded-lg border border-emerald-300 bg-emerald-50/90 px-3 py-2.5 text-xs text-emerald-700">
                      <span className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> {fmt(t.geo.captured, { m: location.accuracy })}</span>
                      <button onClick={captureLocation} className="text-emerald-700 underline shrink-0">{t.geo.reCapture}</button>
                    </div>
                  ) : (
                    <button onClick={captureLocation} disabled={geoStatus === "capturing"}
                      className="mt-2.5 w-full inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-900/15 bg-white/70 px-3 py-2.5 text-sm text-zinc-700 hover:bg-white disabled:opacity-60">
                      {geoStatus === "capturing" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crosshair className="h-4 w-4" />}
                      {geoStatus === "capturing" ? t.geo.getting : t.geo.useCurrent}
                    </button>
                  )}
                  {geoError && <p className="mt-2 text-xs text-amber-600">{geoError}</p>}

                  <input value={manualAddress} onChange={(e) => setManualAddress(e.target.value)}
                    placeholder={locationType === "business" ? t.geo.addressBusiness : t.geo.addressHome}
                    className="mt-2.5 w-full rounded-lg border border-zinc-900/15 bg-white/80 px-3 py-2.5 text-sm outline-none placeholder:text-zinc-400" />
                </div>

                <div className="mt-6 flex gap-2">
                  <button onClick={() => setStep(customer ? 2 : 0)} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-900/15 px-4 py-3 text-sm text-zinc-600 hover:bg-zinc-900/5"><ArrowLeft className="h-4 w-4" /></button>
                  <button onClick={next} disabled={!coreConsents} className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-900 px-5 py-3 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50">
                    {t.common.continue} <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </motion.div>
            )}

            {/* STEP 4 — statement upload */}
            {step === 4 && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className={`${GLASS} p-5 sm:p-6`}>
                <h1 className="text-2xl font-bold">{t.statement.title}</h1>
                <p className="mt-2 text-sm text-zinc-600">{t.statement.sub}</p>

                <div className="mt-4 rounded-2xl border border-zinc-900/10 bg-white/70">
                  <button onClick={() => setShowGuide((s) => !s)} className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left text-sm">
                    <span className="flex items-center gap-2"><HelpCircle className="h-4 w-4 text-emerald-600" /> {t.statement.guideTitle}</span>
                    <ChevronDown className={`h-4 w-4 text-zinc-400 transition-transform ${showGuide ? "rotate-180" : ""}`} />
                  </button>
                  {showGuide && (
                    <div className="px-4 pb-4 text-sm text-zinc-600 border-t border-zinc-900/10 pt-3 space-y-1">
                      <p>{t.statement.guideBody}</p>
                      <p className="text-xs text-zinc-500">{t.statement.guideNote}</p>
                    </div>
                  )}
                </div>

                <div onClick={() => fileRef.current?.click()} className="mt-3 cursor-pointer rounded-xl border border-dashed border-zinc-900/20 bg-white/70 px-4 py-7 text-center hover:border-[var(--brand)]">
                  <Upload className="h-6 w-6 mx-auto mb-2" style={{ color: "var(--brand)" }} />
                  {file ? <p className="text-sm flex items-center justify-center gap-2"><FileText className="h-4 w-4" /> {file.name}</p> : <p className="text-sm text-zinc-600">{t.statement.tapToChoose}</p>}
                  <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                </div>
                <div className="mt-3 flex items-center gap-2 rounded-lg border border-zinc-900/15 bg-white/80 px-3">
                  <Lock className="h-4 w-4 text-zinc-400 shrink-0" />
                  <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t.statement.passwordPlaceholder}
                    className="flex-1 bg-transparent outline-none text-sm py-3 placeholder:text-zinc-400" />
                </div>

                <div className="mt-6 flex gap-2">
                  <button onClick={back} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-900/15 px-4 py-3 text-sm text-zinc-600 hover:bg-zinc-900/5"><ArrowLeft className="h-4 w-4" /></button>
                  <button onClick={startCrunch} className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-900 px-5 py-3 text-sm font-semibold text-white hover:bg-zinc-800">
                    <Gauge className="h-4 w-4" /> {t.statement.checkAffordability}
                  </button>
                </div>
              </motion.div>
            )}

            {/* STEP 5 — amount */}
            {step === 5 && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className={`${GLASS} p-5 sm:p-6`}>
                {scorePreview && (
                  <div className="rounded-2xl border border-zinc-900/10 bg-white/70 p-4 mb-5 text-center">
                    <p className="text-xs uppercase tracking-wide text-zinc-500">{scoped ? t.amount.yourScore : t.amount.yourBirgenScore}</p>
                    <p className={`text-3xl font-bold mt-1 ${TONE[scorePreview.tone]}`}>{scorePreview.score}<span className="text-sm text-zinc-400"> / 900</span></p>
                    <p className="text-sm text-zinc-600">{scorePreview.band}</p>
                  </div>
                )}
                <h1 className="text-2xl font-bold">{t.amount.chooseALoan}</h1>

                {/* Product picker — real products pulled from the lender's ServiceSuite */}
                {products.length > 0 ? (
                  <div className="mt-4 space-y-2">
                    <p className="text-xs text-zinc-500">{fmt(t.amount.selectProduct, { name: lenderObj.name })}</p>
                    {products.map((p) => {
                      const active = String(p.id) === productRef;
                      const term = productTerm(p);
                      return (
                        <button key={p.id} onClick={() => selectProduct(p)}
                          className={`w-full rounded-xl border p-3.5 text-left transition-colors ${active ? "" : "border-zinc-900/10 bg-white/70 hover:border-zinc-900/25"}`}
                          style={active ? { borderColor: brand.accent, backgroundColor: brand.accentSoft } : undefined}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-semibold truncate">{p.name}</p>
                              {p.description && <p className="text-xs text-zinc-500 mt-0.5 line-clamp-2">{p.description}</p>}
                            </div>
                            {active && <CheckCircle2 className="h-5 w-5 shrink-0" style={{ color: brand.accent }} />}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600">
                            {(hasMin(p) || hasMax(p)) ? (
                              <span><span className="text-zinc-400">{t.amount.amountLabel}</span> {hasMin(p) ? fmtKES(p.minPrincipal!) : "—"}{hasMax(p) ? ` – ${fmtKES(p.maxPrincipal!)}` : "+"}</span>
                            ) : (
                              <span><span className="text-zinc-400">{t.amount.amountLabel}</span> {t.amount.flexible}</span>
                            )}
                            {p.interestRate != null && (
                              <span><span className="text-zinc-400">{t.amount.interest}</span> {p.interestRate}%{p.interestUnit ? `/${p.interestUnit.toLowerCase()}` : ""}</span>
                            )}
                            {term && <span><span className="text-zinc-400">{t.amount.term}</span> {term}</span>}
                          </div>
                          {(p as { interestMethod?: string }).interestMethod === "reducing" && (
                            // §5.1: interest accrues on the falling balance, so
                            // settling ahead of schedule genuinely costs less.
                            <p className="mt-1.5 inline-block rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                              {t.amount.payEarlyBadge}
                            </p>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ) : productsLoaded ? (
                  <p className="mt-3 text-xs text-zinc-500">{t.amount.manualAmount}</p>
                ) : (
                  <p className="mt-3 text-xs text-zinc-500 flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t.amount.loadingProducts}</p>
                )}

                {/* The approved limit — the number this whole funnel exists to produce.
                    Derived from the statement's cashflow, the risk score, and the
                    borrower's history with this lender; the customer chooses anything
                    up to it. The server enforces the same figure at submission. */}
                {selectedProduct && limitLoading && (
                  <p className="mt-4 flex items-center gap-1.5 text-xs text-zinc-500">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t.amount.limitWorking}
                  </p>
                )}
                {selectedProduct && !limitLoading && limitInfo && limitInfo.approvedLimit > 0 && (
                  <div className="mt-4 rounded-2xl border p-4" style={{ borderColor: brand.accent, backgroundColor: brand.accentSoft }}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-500">{t.amount.qualifyUpTo}</p>
                        <p className="mt-0.5 text-2xl font-bold" style={{ color: brand.accent }}>{fmtKES(limitInfo.approvedLimit)}</p>
                      </div>
                      <button
                        onClick={() => setAmount(String(limitInfo.approvedLimit))}
                        className="rounded-lg px-3 py-1.5 text-xs font-bold text-white"
                        style={{ backgroundColor: brand.accent }}
                      >
                        {t.amount.useMaximum}
                      </button>
                    </div>
                    {limitInfo.borrowerClass && (
                      <p className="mt-1 text-[11px] font-semibold text-zinc-600">
                        {limitInfo.borrowerClass === "NEW" ? t.amount.classNew
                          : limitInfo.borrowerClass === "GRADUATED" ? t.amount.classGraduated
                          : t.amount.classReturning}
                      </p>
                    )}
                    {limitInfo.reasons.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {limitInfo.reasons.slice(0, 4).map((r) => (
                          <li key={r.code} className="flex items-start gap-1.5 text-[11px] text-zinc-600">
                            <span className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${r.direction === "up" ? "bg-emerald-500" : "bg-amber-500"}`} />
                            {r.detail}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                {selectedProduct && !limitLoading && limitInfo && limitInfo.approvedLimit === 0 && (
                  <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50/90 px-3 py-2.5 text-xs text-amber-800">
                    {t.amount.productUnavailable}
                  </p>
                )}

                <label className="mt-4 block text-sm font-medium">{t.amount.howMuch}</label>
                <div className="mt-2 flex items-center gap-2 rounded-lg border border-zinc-900/15 bg-white/80 px-3">
                  <Banknote className="h-4 w-4 text-zinc-400 shrink-0" />
                  <span className="text-sm text-zinc-500">KES</span>
                  <input value={amount ? Number(amount).toLocaleString() : ""} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))} placeholder="10,000" inputMode="numeric"
                    className="flex-1 bg-transparent outline-none text-sm py-3 placeholder:text-zinc-400" />
                </div>
                {overLimit && limitInfo && (
                  <p className="mt-2 text-xs font-semibold text-amber-600">
                    {fmt(t.amount.overLimitNote, { kes: fmtKES(limitInfo.approvedLimit) })}
                  </p>
                )}
                {amountOutOfRange && selectedProduct && (
                  <p className="mt-2 text-xs text-amber-600">
                    {fmt(t.amount.rangeNote, {
                      product: selectedProduct.name,
                      range: `${hasMin(selectedProduct) ? fmtKES(selectedProduct.minPrincipal!) : "—"}${hasMax(selectedProduct) ? ` – ${fmtKES(selectedProduct.maxPrincipal!)}` : "+"}`,
                    })}
                  </p>
                )}

                {selectedProduct?.disbursementMode === "TO_THIRD_PARTY" && (
                  <div className="mt-4 rounded-lg border border-zinc-900/10 bg-white/60 p-3">
                    <p className="text-sm font-medium">{t.amount.payeeTitle}</p>
                    <p className="mt-0.5 text-xs text-zinc-500">{t.amount.payeeDetail}</p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <input value={payee.name} onChange={(e) => setPayee((p) => ({ ...p, name: e.target.value }))} placeholder={t.amount.schoolName}
                        className="rounded-lg border border-zinc-900/15 bg-white/80 px-3 py-2.5 text-sm outline-none placeholder:text-zinc-400 sm:col-span-2" />
                      <input value={payee.paybill} onChange={(e) => setPayee((p) => ({ ...p, paybill: e.target.value.replace(/\D/g, "") }))} inputMode="numeric" placeholder={t.amount.paybillNumber}
                        className="rounded-lg border border-zinc-900/15 bg-white/80 px-3 py-2.5 text-sm outline-none placeholder:text-zinc-400" />
                      <input value={payee.account} onChange={(e) => setPayee((p) => ({ ...p, account: e.target.value }))} placeholder={t.amount.accountNo}
                        className="rounded-lg border border-zinc-900/15 bg-white/80 px-3 py-2.5 text-sm outline-none placeholder:text-zinc-400" />
                    </div>
                  </div>
                )}

                <div className="mt-6 flex gap-2">
                  <button onClick={back} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-900/15 px-4 py-3 text-sm text-zinc-600 hover:bg-zinc-900/5"><ArrowLeft className="h-4 w-4" /></button>
                  <button onClick={submit} disabled={loading} className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-900 px-5 py-3 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60">
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {t.amount.submit} <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </motion.div>
            )}

            {/* STEP 6a — the offer. Nothing is booked until this is signed. */}
            {step === 6 && submitted?.offerId && !offerSigned && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className={`${GLASS} p-6 sm:p-8`}>
                <OfferCard
                  offerId={submitted.offerId}
                  lenderSlug={lender}
                  phone={phone}
                  onAccepted={() => setOfferSigned(true)}
                />
              </motion.div>
            )}

            {/* STEP 6b — result */}
            {step === 6 && submitted && (!submitted.offerId || offerSigned) && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className={`${GLASS} p-6 sm:p-8 text-center`}>
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 mb-4">
                  <CheckCircle2 className="h-8 w-8 text-emerald-600" />
                </div>
                <h1 className="text-2xl font-bold">{offerSigned ? t.result.agreementSigned : t.result.applicationReceived}</h1>
                <p className="mt-2 text-sm text-zinc-600">{submitted.stageTitle} — {t.result.referenceIs} <span className="text-zinc-900 font-mono">{submitted.applicationId.slice(-8)}</span>.</p>
                <div className="mt-5 rounded-2xl border border-zinc-900/10 bg-white/70 p-5 text-left">
                  <div className="flex items-center justify-between"><span className="text-sm text-zinc-500">{scoped ? t.result.creditScore : t.result.birgenScore}</span><span className="font-semibold">{submitted.score} / 900 · {submitted.band}</span></div>
                  <div className="mt-2 flex items-center justify-between"><span className="text-sm text-zinc-500">{t.result.nextStep}</span><span className="text-sm">{submitted.decision === "APPROVE" ? t.result.lenderVerification : t.result.humanReview}</span></div>
                  {submitted.posting?.attempted && (
                    <p className="mt-3 text-xs text-zinc-500">{submitted.posting.ok ? t.result.postingOk : t.result.postingRecorded}</p>
                  )}
                </div>
                <p className="mt-4 text-xs text-zinc-500 flex items-center justify-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> {t.result.humanReviews}
                </p>
                <Link href="/" className="mt-6 inline-flex items-center gap-2 rounded-lg border border-zinc-900/15 bg-white/70 px-5 py-3 text-sm hover:bg-white">{scoped ? t.common.done : t.result.backToLoans}</Link>
              </motion.div>
            )}

          </div>
        </main>
      </div>

      {/* The M-PESA crunch theatre owns the upload, the staging and the reveal. */}
      {crunching && file && (
        <CrunchTheatre
          file={file}
          password={password || undefined}
          borrowerName={elig?.borrowerName ?? null}
          onComplete={onCrunchComplete}
          onFail={(message) => { setCrunching(false); setError(message); }}
        />
      )}
    </div>
  );
}
