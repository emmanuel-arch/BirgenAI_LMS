"use client";

// ─────────────────────────────────────────────────────────────────────────────
// ADD A BORROWER — one screen that reshapes itself to the lender's rails.
//
// This page used to be the IPRS flow with a manual escape hatch, because IPRS was
// the only rail we had. Which meant a lender with no registry contract opened a
// screen built around a lookup they cannot make, and a lender with an OCR-first
// process had nowhere to point a camera.
//
// It now renders the ONBOARDING CONTRACT (lib/config/onboarding-contract.ts):
// which rails exist, which opens first, which fields to show, which are required,
// which documents to take, what extra questions this lender invented. The customer
// app reads the same contract from the same endpoint, so the two screens cannot
// drift — a field the lender adds appears in both, and one they hide vanishes from
// both, without a deploy.
//
// FOUR RAILS, ONE REVIEW STEP:
//   IPRS   one ID number; the registry returns the person.
//   OCR    a photograph of the card; the reader fills the form. Free, always there.
//   CRB    the bureau identifies them and returns their standing in one call.
//   MANUAL somebody types it. The floor under every other rail, because they all
//          depend on a third party that will one day be down.
//
// Whatever the rail, it lands on the same REVIEW step, which is where the lender's
// own required fields, documents and extra questions are enforced. That is what
// keeps four entry points from becoming four different definitions of "registered".
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Loader2, Search, UserPlus, FlaskConical, ArrowRight, ShieldCheck, PenLine,
  MapPin, CheckCircle2, AlertTriangle, BadgeCheck, Camera, ScanLine, Gauge,
  RefreshCw, ArrowLeft,
} from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";
import { RegistryEmblem } from "@/components/kyc/RegistryEmblem";
import { useLoad } from "@/lib/hooks/useLoad";
import { GeoBlock, geoSatisfied, type Pin, type Place } from "@/components/borrowers/GeoBlock";
import { DetailFields } from "@/components/borrowers/DetailFields";
import { validateDetailValues, type DetailValues } from "@/lib/config/details";
import type { OnboardingContract, ContractField } from "@/lib/config/onboarding-contract";
import type { OnboardingMethod } from "@/lib/config/borrower";

type IprsPrefill = {
  mode: "live" | "simulation";
  fullName: string | null; firstName: string | null; otherName: string | null; surname: string | null;
  gender: string | null; dob: string | null; citizenship: string | null;
  serialNumber: string | null; placeOfBirth: string | null; placeOfLive: string | null;
  phone: string | null; email: string | null;
};

const field =
  "w-full rounded-lg border border-ash-900/15 bg-paper/80 px-3 py-2.5 text-sm outline-none placeholder:text-ash-400 focus:border-transparent focus:ring-2 focus:ring-[color:var(--brand)]";

/** How each rail describes itself on the picker. */
const RAIL_ICON: Record<OnboardingMethod, typeof Search> = {
  iprs: ShieldCheck, ocr: ScanLine, crb: Gauge, manual: PenLine,
};

export default function NewBorrowerPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [contract, setContract] = useState<OnboardingContract | null>(null);
  const [contractError, setContractError] = useState<string | null>(null);
  const [rail, setRail] = useState<OnboardingMethod | null>(null);
  const [step, setStep] = useState<"capture" | "review" | "done">("capture");

  const [nationalId, setNationalId] = useState("");
  const [consent, setConsent] = useState(false);
  const [prefill, setPrefill] = useState<IprsPrefill | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [source, setSource] = useState<{ engine: string; confidence: number | null } | null>(null);
  const [lookupNote, setLookupNote] = useState<string | null>(null);
  const [existing, setExisting] = useState<{ id: string; name: string; phone: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── The person, as the review step holds them ──
  const [values, setValues] = useState<Record<string, string>>({});
  const [details, setDetails] = useState<DetailValues>({});
  const [detailIssues, setDetailIssues] = useState<Record<string, string>>({});

  const [geoConsent, setGeoConsent] = useState(false);
  const [pins, setPins] = useState<Record<Place, Pin | null>>({ business: null, home: null });
  const [addresses, setAddresses] = useState<Record<Place, string>>({ business: "", home: "" });

  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ id: string; name: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/console/onboarding/contract?channel=console");
      const data = await res.json();
      if (!data.success) { setContractError(data.message || "Could not load the onboarding rules."); return; }
      setContract(data.contract);
      setRail(data.contract.primary);
      // A lender who does not ask for consent has already decided; pre-tick it so the
      // officer is not asked to confirm something the lender switched off.
      setConsent(!data.contract.requireConsent);
      setGeoConsent(false);
    } catch { setContractError("Could not load the onboarding rules."); }
  }, []);
  useLoad(load);

  const set = (k: string, v: string) => setValues((s) => ({ ...s, [k]: v }));
  const val = (k: string) => values[k] ?? "";
  const idDigits = nationalId.replace(/\D/g, "");

  // ── The fields the review step must render, from the contract ──
  const fields = useMemo(() => contract?.fields ?? [], [contract]);
  const requires = (k: string) => fields.some((f) => f.key === k && f.required);

  const missing = useMemo(
    () =>
      fields
        .filter((f) => f.required && !String(values[f.key] ?? "").trim())
        // Identity is captured by the rail, not typed on the review step.
        .filter((f) => !(f.key === "nationalId" && idDigits.length >= 6))
        .map((f) => f.label),
    [fields, values, idDigits],
  );

  const geoOk = contract ? geoSatisfied(contract.geo.required, contract.geo.places, pins) : true;
  const canSubmit =
    missing.length === 0 && geoOk && Object.keys(detailIssues).length === 0 &&
    (!requires("phone") || String(values.phone ?? "").replace(/\D/g, "").length >= 9);

  // ── Rails ──────────────────────────────────────────────────────────────────

  const lookupIprs = async () => {
    setBusy(true); setError(null); setExisting(null); setLookupNote(null);
    try {
      const res = await fetch("/api/console/borrowers/iprs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nationalId, consent }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "Registry lookup failed."); return; }
      if (data.existing) { setExisting(data.existing); return; }
      if (!data.found || !data.person) { setLookupNote(data.note || "No record found for that ID number."); return; }

      setPrefill({ mode: data.mode, ...data.person });
      setPhoto(data.photo ?? null);
      setSource({ engine: data.mode === "live" ? "National registry" : "Simulated registry", confidence: null });
      seedFrom({
        firstName: data.person.firstName, otherName: data.person.otherName ?? data.person.surname,
        fullName: data.person.fullName, dob: data.person.dob, gender: data.person.gender,
        phone: data.person.phone, email: data.person.email, nationalId: idDigits,
      });
      setStep("review");
    } catch { setError("Registry lookup failed."); } finally { setBusy(false); }
  };

  const scanId = async (file: File) => {
    setBusy(true); setError(null); setExisting(null); setLookupNote(null);
    try {
      const image = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error("read"));
        r.readAsDataURL(file);
      });

      const res = await fetch("/api/console/onboarding/ocr", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image, side: "front", consent }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not read the ID."); return; }
      if (data.existing && data.onDuplicate !== "warn") { setExisting(data.existing); return; }
      if (data.existing) setLookupNote(`${data.existing.name || data.existing.phone} is already on your book with this ID.`);

      setPhoto(image);
      setSource({ engine: data.engine === "google-vision" ? "Document scan" : "Simulated scan", confidence: data.confidence ?? null });
      if (!data.confident) {
        setLookupNote(`The card was only ${data.confidence ?? 0}% legible against your ${data.minConfidence}% bar — check every field before saving.`);
      }
      if (data.person.idNumber) setNationalId(String(data.person.idNumber));
      seedFrom({
        fullName: data.person.fullName, dob: data.person.dob,
        nationalId: data.person.idNumber ?? idDigits,
      });
      setStep("review");
    } catch { setError("Could not read the ID."); } finally { setBusy(false); }
  };

  const lookupCrb = async () => {
    setBusy(true); setError(null); setExisting(null); setLookupNote(null);
    try {
      // The bureau identifies the person AND returns their standing in one call, so
      // it is both an identity rail and the first risk signal on the file.
      const res = await fetch("/api/console/identity/lookup", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nationalId, consent, role: "borrower" }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "Bureau lookup failed."); return; }
      if (data.alreadyBorrower) { setExisting(data.alreadyBorrower); return; }
      if (!data.found || !data.person) { setLookupNote(data.note || "The bureau has no record for that ID number."); return; }

      setSource({ engine: "Credit bureau", confidence: null });
      seedFrom({
        fullName: data.person.fullName, firstName: data.person.firstName,
        otherName: data.person.otherName, dob: data.person.dob, gender: data.person.gender,
        phone: data.person.phone, nationalId: idDigits,
      });
      setStep("review");
    } catch { setError("Bureau lookup failed."); } finally { setBusy(false); }
  };

  /** Fill the review step's fields from whatever the rail returned. */
  const seedFrom = (p: Record<string, unknown>) => {
    const next: Record<string, string> = { ...values };
    const put = (k: string, v: unknown) => { if (v !== null && v !== undefined && v !== "") next[k] = String(v); };
    put("firstName", p.firstName ?? (typeof p.fullName === "string" ? p.fullName.split(" ")[0] : null));
    put("otherName", p.otherName ?? (typeof p.fullName === "string" ? p.fullName.split(" ").slice(1).join(" ") : null));
    put("dob", p.dob);
    put("gender", p.gender);
    put("nationalId", p.nationalId);
    put("email", p.email);
    // The registry stores a 254 number; the counter types an 07 one.
    if (p.phone) next.phone = String(p.phone).replace(/^\+?254/, "0");
    setValues(next);
  };

  const submit = async () => {
    if (!contract) return;
    setBusy(true); setError(null); setDetailIssues({});
    try {
      const issues = validateDetailValues(contract.detailGroups, details);
      if (issues.length) {
        setDetailIssues(Object.fromEntries(issues.map((i) => [i.path, i.message])));
        setError("Some of the extra details are missing or in the wrong format.");
        return;
      }

      const name = [val("firstName"), val("otherName")].filter(Boolean).join(" ").trim();
      const res = await fetch("/api/console/borrowers", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          phone: val("phone"),
          email: val("email") || undefined,
          nationalId: idDigits || val("nationalId").replace(/\D/g, "") || undefined,
          dob: val("dob") || undefined,
          gender: val("gender") || undefined,
          occupation: val("occupation") || undefined,
          businessName: val("businessName") || undefined,
          postalAddress: val("postalAddress") || undefined,
          physicalAddress: val("physicalAddress") || undefined,
          // The lender's own questions, keyed by the stable item code.
          details,
          onboardingMethod: rail,
          geo: {
            consent: geoConsent,
            business: pins.business ? { ...pins.business, address: addresses.business.trim() || undefined } : null,
            home: pins.home ? { ...pins.home, address: addresses.home.trim() || undefined } : null,
          },
          ...(prefill ? { iprs: prefill } : {}),
        }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not register the borrower."); return; }
      setCreated({ id: data.borrowerId, name: name || val("phone") });
      setStep("done");
    } catch { setError("Could not register the borrower."); } finally { setBusy(false); }
  };

  const reset = () => {
    setStep("capture"); setNationalId(""); setPrefill(null); setPhoto(null); setSource(null);
    setLookupNote(null); setExisting(null); setError(null); setValues({}); setDetails({});
    setDetailIssues({}); setGeoConsent(false);
    setPins({ business: null, home: null }); setAddresses({ business: "", home: "" });
    setCreated(null); setConsent(!contract?.requireConsent);
    setRail(contract?.primary ?? "manual");
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  if (contractError) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <p className="flex items-start gap-2 rounded-xl bg-red-500/10 px-3 py-2.5 text-sm text-red-800 ring-1 ring-red-600/20">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {contractError}
        </p>
      </main>
    );
  }
  if (!contract || !rail) {
    return <main className="flex justify-center py-20"><Loader2 className="h-5 w-5 animate-spin text-[color:var(--ink-faint)]" /></main>;
  }

  if (!contract.enabled) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6">
        <UserPlus className="mx-auto h-7 w-7 text-[color:var(--ink-faint)]" />
        <h1 className="t-display mt-3 text-[1.3rem]">Onboarding is switched off here</h1>
        <p className="t-meta mx-auto mt-2 max-w-md">
          Registering customers from the console is disabled in your borrower settings.
          Switch the console channel back on to use this screen.
        </p>
        <Link href="/console/settings/borrowers" className="mt-4 inline-block text-[12px] font-semibold underline">
          Borrower settings
        </Link>
      </main>
    );
  }

  const railSpec = contract.methods.find((m) => m.key === rail);
  const others = contract.methods.filter((m) => m.key !== rail && m.ready);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <PageHeader
        icon={UserPlus}
        title="Add a Borrower"
        subtitle={
          rail === "iprs" ? "Turn a walk-in into a customer. One ID number, and the national registry fills in the rest."
            : rail === "ocr" ? "Turn a walk-in into a customer. A photograph of their ID, and the card fills in the rest."
              : rail === "crb" ? "Turn a walk-in into a customer. The bureau confirms who they are and how they have borrowed."
                : "Turn a walk-in into a customer."
        }
      />

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      <div className="mx-auto mt-5 max-w-xl">
        {/* ── CAPTURE ── */}
        {step === "capture" && (
          <div className="glass p-6 sm:p-8">
            <div className="mx-auto max-w-md text-center">
              {rail === "iprs" && (
                <>
                  <div className="flex justify-center"><RegistryEmblem state={busy ? "checking" : "idle"} size={104} /></div>
                  <p className="mt-3 flex items-center justify-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--brand)" }}>
                    <BadgeCheck className="h-3.5 w-3.5" /> Government registry match
                  </p>
                  <p className="mt-1 text-xs text-ash-500">The ID is confirmed against the national registry (IPRS).</p>
                </>
              )}
              {rail === "ocr" && (
                <>
                  <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-3xl" style={{ backgroundColor: "var(--brand-soft)" }}>
                    {busy ? <Loader2 className="h-8 w-8 animate-spin" style={{ color: "var(--brand)" }} />
                      : <ScanLine className="h-8 w-8" style={{ color: "var(--brand)" }} />}
                  </div>
                  <p className="mt-3 flex items-center justify-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--brand)" }}>
                    <Camera className="h-3.5 w-3.5" /> Document scan
                  </p>
                  <p className="mt-1 text-xs text-ash-500">
                    {contract.ocr.capture === "both" ? "Both sides of the card." : "The front of the card."} It is read on
                    the spot and never stored.
                  </p>
                </>
              )}
              {rail === "crb" && (
                <>
                  <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-3xl" style={{ backgroundColor: "var(--brand-soft)" }}>
                    {busy ? <Loader2 className="h-8 w-8 animate-spin" style={{ color: "var(--brand)" }} />
                      : <Gauge className="h-8 w-8" style={{ color: "var(--brand)" }} />}
                  </div>
                  <p className="mt-3 flex items-center justify-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--brand)" }}>
                    <BadgeCheck className="h-3.5 w-3.5" /> Credit bureau
                  </p>
                  <p className="mt-1 text-xs text-ash-500">Who they are, and how they have borrowed, in one call.</p>
                </>
              )}
              {rail === "manual" && (
                <>
                  <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-3xl" style={{ backgroundColor: "var(--brand-soft)" }}>
                    <PenLine className="h-8 w-8" style={{ color: "var(--brand)" }} />
                  </div>
                  <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--brand)" }}>
                    Entered by hand
                  </p>
                  <p className="mt-1 text-xs text-ash-500">Nothing is looked up. Everything is typed and verified later at KYC.</p>
                </>
              )}

              {(rail === "iprs" || rail === "crb") && (
                <>
                  <p className="mt-4 text-sm text-ash-600">
                    <span className="font-semibold text-ash-800">We hate paperwork too.</span> One ID number — it fills in
                    the rest. It takes about a minute.
                  </p>
                  <input
                    className="mt-5 w-full rounded-xl border border-ash-900/15 bg-paper/80 px-4 py-3.5 text-center text-xl font-bold tracking-[0.2em] outline-none placeholder:font-normal placeholder:tracking-normal placeholder:text-ash-400 focus:border-[var(--brand)]"
                    inputMode="numeric" placeholder="National ID number" value={nationalId}
                    onChange={(e) => setNationalId(e.target.value.replace(/[^0-9]/g, "").slice(0, 10))}
                    onKeyDown={(e) => e.key === "Enter" && consent && idDigits.length >= 6 && !busy && (rail === "iprs" ? lookupIprs() : lookupCrb())}
                    autoFocus
                  />
                </>
              )}

              {contract.requireConsent && rail !== "manual" && (
                <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-lg border border-ash-900/10 bg-paper/60 p-3 text-left">
                  <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)}
                    className="mt-0.5 h-4 w-4" style={{ accentColor: "var(--brand)" }} />
                  <span className="text-xs text-ash-600">
                    {rail === "ocr"
                      ? "The customer consents to their identity document being read. The image is not stored."
                      : `The customer consents to an identity check against the ${rail === "crb" ? "credit bureau" : "national registry (IPRS)"}. Your name goes on the lookup.`}
                  </span>
                </label>
              )}

              {existing && (
                <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50/90 p-3 text-left text-sm text-amber-800">
                  Already registered: <span className="font-semibold">{existing.name || existing.phone}</span>.{" "}
                  <Link href={`/console/borrowers/${existing.id}`} className="font-bold underline">Open their profile →</Link>
                </div>
              )}
              {lookupNote && !existing && (
                <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50/90 p-3 text-left text-xs text-amber-800">
                  {lookupNote}
                  {contract.allowManualOverride && " You can still register them by hand and verify at KYC."}
                </p>
              )}

              {rail === "iprs" && (
                <button onClick={lookupIprs} disabled={busy || (contract.requireConsent && !consent) || idDigits.length < 6}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-white disabled:opacity-50"
                  style={{ backgroundColor: "var(--brand)" }}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Find them in the registry
                </button>
              )}
              {rail === "crb" && (
                <button onClick={lookupCrb} disabled={busy || (contract.requireConsent && !consent) || idDigits.length < 6}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-white disabled:opacity-50"
                  style={{ backgroundColor: "var(--brand)" }}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Check the bureau
                </button>
              )}
              {rail === "ocr" && (
                <>
                  <input
                    ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void scanId(f); e.target.value = ""; }}
                  />
                  <button onClick={() => fileRef.current?.click()} disabled={busy || (contract.requireConsent && !consent)}
                    className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-white disabled:opacity-50"
                    style={{ backgroundColor: "var(--brand)" }}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />} Photograph the ID
                  </button>
                  <p className="mt-2 text-[11px] text-ash-500">Free on every plan. No credentials, no per-lookup charge.</p>
                </>
              )}
              {rail === "manual" && (
                <button onClick={() => setStep("review")}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-white"
                  style={{ backgroundColor: "var(--brand)" }}>
                  <PenLine className="h-4 w-4" /> Enter their details
                </button>
              )}

              {/* Other rails, offered only when the lender has them and allows a fall-through. */}
              {(contract.allowFallback || contract.allowManualOverride) && others.length > 0 && (
                <div className="mt-4 flex flex-wrap items-center justify-center gap-3 text-xs">
                  {others
                    .filter((m) => contract.allowFallback || m.key === "manual")
                    .map((m) => {
                      const Icon = RAIL_ICON[m.key];
                      return (
                        <button key={m.key} onClick={() => { setRail(m.key); setError(null); setLookupNote(null); setExisting(null); }}
                          className="inline-flex items-center gap-1 text-ash-500 hover:text-ash-800">
                          <Icon className="h-3 w-3" /> {m.key === "manual" ? "Enter details manually" : m.label}
                        </button>
                      );
                    })}
                  <Link href="/console/borrowers" className="text-ash-500 hover:text-ash-800">Cancel</Link>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── REVIEW ── */}
        {step === "review" && (
          <div className="glass p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3.5">
                {photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photo.startsWith("data:") ? photo : `data:image/jpeg;base64,${photo}`} alt="Captured portrait"
                    className="h-16 w-16 shrink-0 rounded-2xl object-cover shadow-md ring-2 ring-white" />
                ) : (
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl text-xl font-bold text-white" style={{ backgroundColor: "var(--brand)" }}>
                    {(val("firstName") || "?").slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-bold">
                    {[val("firstName"), val("otherName")].filter(Boolean).join(" ") || "New customer"}
                  </h2>
                  <p className="text-xs text-ash-500">
                    {idDigits ? `ID ${idDigits}` : "No ID captured"}
                    {val("dob") ? ` · born ${val("dob")}` : ""}
                    {val("gender") ? ` · ${val("gender")}` : ""}
                  </p>
                  {prefill?.placeOfLive && (
                    <p className="truncate text-xs text-ash-500"><MapPin className="-mt-0.5 inline h-3 w-3" /> {prefill.placeOfLive}</p>
                  )}
                </div>
              </div>
              {source && (
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ${
                  source.engine.startsWith("Simulated") ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
                }`}>
                  {source.engine.startsWith("Simulated") ? <FlaskConical className="h-3 w-3" /> : <ShieldCheck className="h-3 w-3" />}
                  {source.engine.toUpperCase()}
                  {source.confidence !== null ? ` · ${source.confidence}%` : ""}
                </span>
              )}
            </div>

            {lookupNote && (
              <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50/90 p-3 text-xs text-amber-800">{lookupNote}</p>
            )}

            {/* The lender's own KYC fields, exactly as configured. */}
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {fields
                .filter((f) => f.key !== "nextOfKin")
                .map((f) => (
                  <KycInput key={f.key} f={f} value={val(f.key)} onChange={(v) => set(f.key, v)}
                    locked={f.verified && Boolean(prefill) && !contract.ocr.allowEdit} />
                ))}
            </div>

            {contract.detailGroups.length > 0 && (
              <div className="mt-5">
                <DetailFields groups={contract.detailGroups} values={details} onChange={setDetails} issues={detailIssues} />
              </div>
            )}

            {contract.geo.ask && (
              <GeoBlock
                places={contract.geo.places} required={contract.geo.required}
                consent={geoConsent} setConsent={setGeoConsent}
                pins={pins} setPin={(p, v) => setPins((s) => ({ ...s, [p]: v }))}
                addresses={addresses} setAddress={(p, v) => setAddresses((s) => ({ ...s, [p]: v }))}
                onError={setError}
              />
            )}

            {contract.documents.length > 0 && (
              <p className="mt-3 rounded-lg bg-[color:var(--ink)]/[0.03] px-3 py-2.5 text-[11.5px] text-[color:var(--ink-muted)]">
                {contract.documents.map((d) => d.name).join(", ")} {contract.documents.length === 1 ? "is" : "are"} required
                for this customer. Upload {contract.documents.length === 1 ? "it" : "them"} on the KYC step next.
              </p>
            )}

            {missing.length > 0 && (
              <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-3 py-2.5 text-[11.5px] text-amber-900 ring-1 ring-amber-600/20">
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                Still needed: {missing.join(", ")}.
              </p>
            )}
            {!geoOk && (
              <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-3 py-2.5 text-[11.5px] text-amber-900 ring-1 ring-amber-600/20">
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                This lender requires a location snapshot before a customer can be registered.
              </p>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button onClick={submit} disabled={busy || !canSubmit}
                className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                style={{ backgroundColor: "var(--brand)" }}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                Register {val("firstName") || "borrower"} <ArrowRight className="h-4 w-4" />
              </button>
              <button onClick={() => { setStep("capture"); setPrefill(null); setPhoto(null); setSource(null); }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-ash-900/15 bg-paper/70 px-4 py-2.5 text-sm font-medium text-ash-600">
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </button>
              {rail === "ocr" && (
                <button onClick={() => fileRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-ash-900/15 bg-paper/70 px-4 py-2.5 text-sm font-medium text-ash-600">
                  <RefreshCw className="h-3.5 w-3.5" /> Rescan
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── DONE ── */}
        {step === "done" && created && (
          <div className="glass p-6 text-center sm:p-8">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100">
              <BadgeCheck className="h-6 w-6 text-emerald-600" />
            </div>
            <h1 className="mt-4 text-xl font-bold">{created.name} is registered</h1>
            <p className="mt-1.5 text-sm text-ash-500">
              Next stop is KYC verification — no money can be disbursed until it&apos;s done.
              {(pins.business || pins.home) && " Their location snapshot is on file for Field Ops."}
            </p>
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <button onClick={() => router.push(`/console/kyc/${created.id}?from=360`)}
                className="inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-white"
                style={{ backgroundColor: "var(--brand)" }}>
                <ShieldCheck className="h-4 w-4" /> Verify them now <ArrowRight className="h-4 w-4" />
              </button>
              <button onClick={() => router.push(`/console/borrowers/${created.id}`)}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-ash-900/15 bg-paper/70 px-5 py-3 text-sm font-semibold text-ash-700">
                Open their 360
              </button>
            </div>
            <button onClick={reset} className="mt-3 text-xs text-ash-500 hover:text-ash-800">+ Add another borrower</button>
          </div>
        )}
      </div>

      {step === "capture" && railSpec && (
        <p className="t-meta mx-auto mt-4 max-w-xl text-center text-[11px]">
          {railSpec.blurb} Change the rails you use in{" "}
          <Link href="/console/settings/borrowers" className="font-semibold underline">borrower settings</Link>.
        </p>
      )}
    </main>
  );
}

// ── One KYC field, rendered from the contract ─────────────────────────────────

function KycInput({
  f, value, onChange, locked,
}: {
  f: ContractField;
  value: string;
  onChange: (v: string) => void;
  /** A registry-verified value an officer must not quietly retype. */
  locked: boolean;
}) {
  const type =
    f.key === "dob" ? "date"
      : f.key === "email" ? "email"
        : f.key === "phone" ? "tel"
          : "text";

  if (f.key === "gender") {
    return (
      <label className="block">
        <span className="t-label">{f.label}{f.required && <span className="ml-1 text-red-500">*</span>}</span>
        <select className={field} value={value} onChange={(e) => onChange(e.target.value)} disabled={locked}>
          <option value="">Select…</option>
          <option value="Male">Male</option>
          <option value="Female">Female</option>
        </select>
      </label>
    );
  }

  return (
    <label className="block">
      <span className="t-label">
        {f.label}
        {f.required && <span className="ml-1 text-red-500">*</span>}
        {f.verified && (
          <span className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--brand)" }}>
            <CheckCircle2 className="h-2.5 w-2.5" /> verified
          </span>
        )}
      </span>
      <input
        className={field} type={type} disabled={locked}
        inputMode={f.key === "nationalId" ? "numeric" : f.key === "phone" ? "tel" : undefined}
        placeholder={f.key === "phone" ? "07XX XXX XXX" : f.help}
        value={value} onChange={(e) => onChange(e.target.value)}
      />
      {f.unique && (
        <span className="mt-1 block text-[10.5px] text-[color:var(--ink-faint)]">
          Must be unique — no two customers may share it.
        </span>
      )}
    </label>
  );
}
