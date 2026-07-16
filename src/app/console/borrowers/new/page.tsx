"use client";

// ─────────────────────────────────────────────────────────────────────────────
// ADD A BORROWER — a dedicated onboarding page, not a branch of the list.
//
// One screen, no scrolling, one job: turn a walk-in human into a record.
//   1. ONE NUMBER — the national registry (IPRS) fills in the person.
//   2. REVIEW — the person as the registry knows them + how to reach them.
//   3. LOCATION SNAPSHOT — with the customer's consent, pin where their
//      business and/or home is RIGHT NOW (one-time snapshot, never tracked;
//      this is what Field Ops routes and dispatch run on).
//   4. DONE — straight to KYC, their 360, or the next walk-in.
//
// Manual entry stays one click away because a registry outage must never stop
// a counter. The borrowers LIST lives at /console/borrowers and is a different
// page with a different job.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Loader2, Search, UserPlus, FlaskConical, ArrowRight, ShieldCheck, PenLine,
  MapPin, Store, Home, CheckCircle2, AlertTriangle, X, BadgeCheck,
} from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";
import { RegistryEmblem } from "@/components/kyc/RegistryEmblem";

type IprsPrefill = {
  mode: "live" | "simulation";
  fullName: string | null; firstName: string | null; otherName: string | null; surname: string | null;
  gender: string | null; dob: string | null; citizenship: string | null;
  serialNumber: string | null; placeOfBirth: string | null; placeOfLive: string | null;
  phone: string | null; email: string | null;
};

type Pin = { lat: number; lng: number; accuracy: number | null };

const field = "w-full rounded-lg border border-zinc-900/15 bg-white/80 px-3 py-2.5 text-sm outline-none placeholder:text-zinc-400";

export default function NewBorrowerPage() {
  const router = useRouter();
  const [step, setStep] = useState<"id" | "review" | "manual" | "done">("id");
  const [nationalId, setNationalId] = useState("");
  const [consent, setConsent] = useState(false);
  const [prefill, setPrefill] = useState<IprsPrefill | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [lookupNote, setLookupNote] = useState<string | null>(null);
  const [existing, setExisting] = useState<{ id: string; name: string; phone: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  // Location snapshots — consent first, then a pin per place.
  const [geoConsent, setGeoConsent] = useState(false);
  const [bizPin, setBizPin] = useState<Pin | null>(null);
  const [homePin, setHomePin] = useState<Pin | null>(null);
  const [bizAddress, setBizAddress] = useState("");
  const [homeAddress, setHomeAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ id: string; name: string } | null>(null);

  const idDigits = nationalId.replace(/\D/g, "");

  const lookup = async () => {
    setBusy(true); setError(null); setExisting(null); setLookupNote(null);
    try {
      const res = await fetch("/api/console/borrowers/iprs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nationalId, consent }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "Registry lookup failed."); return; }
      if (data.existing) { setExisting(data.existing); return; }
      if (!data.found || !data.person) {
        setLookupNote(data.note || "No record found for that ID number.");
        return;
      }
      setPrefill({ mode: data.mode, ...data.person });
      setPhoto(data.photo ?? null);
      setName(data.person.fullName ?? "");
      // The live registry knows how to reach them — prefill, keep editable.
      if (data.person.phone) setPhone(String(data.person.phone).replace(/^\+?254/, "0"));
      if (data.person.email) setEmail(data.person.email);
      setStep("review");
    } catch { setError("Registry lookup failed."); } finally { setBusy(false); }
  };

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/console/borrowers", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          phone,
          email: email.trim() || undefined,
          nationalId: nationalId.replace(/\D/g, "") || undefined,
          geo: {
            consent: geoConsent,
            business: bizPin ? { ...bizPin, address: bizAddress.trim() || undefined } : null,
            home: homePin ? { ...homePin, address: homeAddress.trim() || undefined } : null,
          },
          ...(prefill ? { dob: prefill.dob ?? undefined, gender: prefill.gender ?? undefined, iprs: prefill } : {}),
        }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not register the borrower."); return; }
      setCreated({ id: data.borrowerId, name: name.trim() });
      setStep("done");
    } catch { setError("Could not register the borrower."); } finally { setBusy(false); }
  };

  const reset = () => {
    setStep("id"); setNationalId(""); setConsent(false); setPrefill(null); setPhoto(null);
    setLookupNote(null); setExisting(null); setError(null); setName(""); setPhone(""); setEmail("");
    setGeoConsent(false); setBizPin(null); setHomePin(null); setBizAddress(""); setHomeAddress("");
    setCreated(null);
  };

  return (
    <main className="mx-auto max-w-5xl px-4 sm:px-6 py-8">
      {/* The page announces itself on the canvas, like every other screen — the card
          below is the WORK, not the title bar. */}
      <PageHeader
        icon={UserPlus}
        title="Add a Borrower"
        subtitle="Turn a walk-in into a customer. One ID number, and the national registry fills in the rest."
      />

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      <div className="mx-auto mt-5 max-w-xl">
      {step === "id" && (
        <div className="glass p-6 sm:p-8">
          <div className="mx-auto max-w-md text-center">
            {/* The emblem takes the space the title used to hold, and says something
                the title never did: what this screen is actually about to DO. */}
            <div className="flex justify-center">
              <RegistryEmblem state={busy ? "checking" : "idle"} size={104} />
            </div>
            <p className="mt-3 flex items-center justify-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--brand)" }}>
              <BadgeCheck className="h-3.5 w-3.5" /> Government registry match
            </p>
            <p className="mt-1 text-xs text-zinc-500">The ID is confirmed against the national registry (IPRS).</p>

            <p className="mt-4 text-sm text-zinc-600">
              <span className="font-semibold text-zinc-800">We hate paperwork too.</span> One ID number — the national
              registry fills in the rest. It takes about a minute.
            </p>

            <input
              className="mt-5 w-full rounded-xl border border-zinc-900/15 bg-white/80 px-4 py-3.5 text-center text-xl font-bold tracking-[0.2em] outline-none placeholder:font-normal placeholder:tracking-normal placeholder:text-zinc-400 focus:border-[var(--brand)]"
              inputMode="numeric"
              placeholder="National ID number"
              value={nationalId}
              onChange={(e) => setNationalId(e.target.value.replace(/[^0-9]/g, "").slice(0, 10))}
              onKeyDown={(e) => e.key === "Enter" && consent && idDigits.length >= 6 && !busy && lookup()}
              autoFocus
            />

            <label className="mt-3 flex items-start gap-2.5 rounded-lg border border-zinc-900/10 bg-white/60 p-3 text-left cursor-pointer">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4" style={{ accentColor: "var(--brand)" }} />
              <span className="text-xs text-zinc-600">
                The customer consents to an identity check against the national registry (IPRS). Your name goes on the lookup.
              </span>
            </label>

            {existing && (
              <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50/90 p-3 text-left text-sm text-amber-800">
                Already registered: <span className="font-semibold">{existing.name || existing.phone}</span>.{" "}
                <Link href={`/console/borrowers/${existing.id}`} className="font-bold underline">Open their profile →</Link>
              </div>
            )}
            {lookupNote && !existing && (
              <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50/90 p-3 text-left text-xs text-amber-800">
                {lookupNote} You can still register them manually and verify at KYC.
              </p>
            )}

            <button onClick={lookup} disabled={busy || !consent || idDigits.length < 6}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-white disabled:opacity-50"
              style={{ backgroundColor: "var(--brand)" }}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Find them in the registry
            </button>

            <div className="mt-3 flex items-center justify-center gap-4 text-xs">
              <button onClick={() => setStep("manual")} className="inline-flex items-center gap-1 text-zinc-500 hover:text-zinc-800">
                <PenLine className="h-3 w-3" /> Enter details manually
              </button>
              <Link href="/console/borrowers" className="text-zinc-500 hover:text-zinc-800">Cancel</Link>
            </div>
          </div>
        </div>
      )}

      {step === "review" && prefill && (
        <div className="glass p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3.5 min-w-0">
              {photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photo.startsWith("data:") ? photo : `data:image/jpeg;base64,${photo}`} alt="Registry portrait"
                  className="h-16 w-16 rounded-2xl object-cover ring-2 ring-white shadow-md shrink-0" />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl text-xl font-bold text-white shrink-0" style={{ backgroundColor: "var(--brand)" }}>
                  {(prefill.firstName ?? "?").slice(0, 1)}
                </div>
              )}
              <div className="min-w-0">
                <h1 className="text-lg font-bold truncate">{prefill.fullName}</h1>
                <p className="text-xs text-zinc-500">
                  ID {idDigits}
                  {prefill.dob ? ` · born ${prefill.dob}` : ""}
                  {prefill.gender ? ` · ${prefill.gender}` : ""}
                </p>
                {prefill.placeOfLive && <p className="text-xs text-zinc-500 truncate"><MapPin className="inline h-3 w-3 -mt-0.5" /> {prefill.placeOfLive}</p>}
              </div>
            </div>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ${prefill.mode === "live" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
              {prefill.mode === "live" ? <><ShieldCheck className="h-3 w-3" /> NATIONAL REGISTRY</> : <><FlaskConical className="h-3 w-3" /> SIMULATED REGISTRY</>}
            </span>
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <input className={field} inputMode="tel" placeholder="Phone (07XX XXX XXX) — required" value={phone} onChange={(e) => setPhone(e.target.value)} autoFocus={!phone} />
            <input className={field} inputMode="email" placeholder="Email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>

          <GeoBlock
            geoConsent={geoConsent} setGeoConsent={setGeoConsent}
            bizPin={bizPin} setBizPin={setBizPin} homePin={homePin} setHomePin={setHomePin}
            bizAddress={bizAddress} setBizAddress={setBizAddress} homeAddress={homeAddress} setHomeAddress={setHomeAddress}
            onError={setError}
          />

          <div className="mt-4 flex items-center gap-2">
            <button onClick={submit} disabled={busy || phone.replace(/\D/g, "").length < 9}
              className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "var(--brand)" }}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Register {prefill.firstName ?? "borrower"} <ArrowRight className="h-4 w-4" />
            </button>
            <button onClick={() => { setStep("id"); setPrefill(null); setPhoto(null); }} className="rounded-lg border border-zinc-900/15 bg-white/70 px-4 py-2.5 text-sm font-medium text-zinc-600">Back</button>
          </div>
        </div>
      )}

      {step === "manual" && (
        <div className="glass p-5 sm:p-6">
          <h1 className="text-lg font-bold">Add a borrower manually</h1>
          <p className="mt-0.5 text-[11px] text-zinc-500">The phone number is their identity everywhere — statements, payments, sign-in codes.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <input className={field} placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
            <input className={field} inputMode="tel" placeholder="Phone (07XX XXX XXX)" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <input className={field} inputMode="numeric" placeholder="National ID (optional — KYC verifies it)" value={nationalId} onChange={(e) => setNationalId(e.target.value)} />
            <input className={field} inputMode="email" placeholder="Email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>

          <GeoBlock
            geoConsent={geoConsent} setGeoConsent={setGeoConsent}
            bizPin={bizPin} setBizPin={setBizPin} homePin={homePin} setHomePin={setHomePin}
            bizAddress={bizAddress} setBizAddress={setBizAddress} homeAddress={homeAddress} setHomeAddress={setHomeAddress}
            onError={setError}
          />

          <div className="mt-4 flex items-center gap-2 flex-wrap">
            <button onClick={submit} disabled={busy || name.trim().length < 3 || phone.replace(/\D/g, "").length < 9}
              className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "var(--brand)" }}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Register borrower
            </button>
            <button onClick={() => setStep("id")} className="rounded-lg border border-zinc-900/15 bg-white/70 px-4 py-2.5 text-sm font-medium text-zinc-600">Use the registry instead</button>
            <Link href="/console/borrowers" className="rounded-lg border border-zinc-900/15 bg-white/70 px-4 py-2.5 text-sm font-medium text-zinc-600">Cancel</Link>
          </div>
        </div>
      )}

      {step === "done" && created && (
        <div className="glass p-6 sm:p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100">
            <BadgeCheck className="h-6 w-6 text-emerald-600" />
          </div>
          <h1 className="mt-4 text-xl font-bold">{created.name} is registered</h1>
          <p className="mt-1.5 text-sm text-zinc-500">
            Next stop is KYC verification — no money can be disbursed until it&apos;s done.
            {(bizPin || homePin) && " Their location snapshot is on file for Field Ops."}
          </p>
          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            <button onClick={() => router.push(`/console/kyc/${created.id}?from=360`)}
              className="inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-white" style={{ backgroundColor: "var(--brand)" }}>
              <ShieldCheck className="h-4 w-4" /> Verify them now <ArrowRight className="h-4 w-4" />
            </button>
            <button onClick={() => router.push(`/console/borrowers/${created.id}`)}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-900/15 bg-white/70 px-5 py-3 text-sm font-semibold text-zinc-700">
              Open their 360
            </button>
          </div>
          <button onClick={reset} className="mt-3 text-xs text-zinc-500 hover:text-zinc-800">
            + Add another borrower
          </button>
        </div>
      )}
      </div>
    </main>
  );
}

// ── The location snapshot — consent, then a pin per place ─────────────────────
// The officer is STANDING at the business (or home) during onboarding; the pin
// is the device's position at that moment. One snapshot, never tracked — this
// is what dispatch and route planning run on.
function GeoBlock({
  geoConsent, setGeoConsent, bizPin, setBizPin, homePin, setHomePin,
  bizAddress, setBizAddress, homeAddress, setHomeAddress, onError,
}: {
  geoConsent: boolean; setGeoConsent: (v: boolean) => void;
  bizPin: Pin | null; setBizPin: (p: Pin | null) => void;
  homePin: Pin | null; setHomePin: (p: Pin | null) => void;
  bizAddress: string; setBizAddress: (s: string) => void;
  homeAddress: string; setHomeAddress: (s: string) => void;
  onError: (s: string | null) => void;
}) {
  const [locating, setLocating] = useState<"business" | "home" | null>(null);

  const capture = (kind: "business" | "home") => {
    if (!navigator.geolocation) { onError("This device has no location service."); return; }
    setLocating(kind); onError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const pin = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy ? Math.round(pos.coords.accuracy) : null };
        (kind === "business" ? setBizPin : setHomePin)(pin);
        setLocating(null);
      },
      () => { onError("Could not read the location — check the browser's location permission."); setLocating(null); },
      { enableHighAccuracy: true, timeout: 12000 },
    );
  };

  const slot = (kind: "business" | "home", pin: Pin | null, setPin: (p: Pin | null) => void, address: string, setAddress: (s: string) => void, Icon: typeof Store) => (
    <div className={`rounded-xl border p-2.5 ${pin ? "border-emerald-300 bg-emerald-50/60" : "border-zinc-900/10 bg-white/60"}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold capitalize text-zinc-700">
          <Icon className="h-3.5 w-3.5" style={{ color: "var(--brand)" }} /> {kind}
        </span>
        {pin ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5" /> pinned{pin.accuracy ? ` ±${pin.accuracy}m` : ""}
            <button onClick={() => setPin(null)} aria-label={`Clear ${kind} pin`} className="text-zinc-400 hover:text-zinc-700"><X className="h-3.5 w-3.5" /></button>
          </span>
        ) : (
          <button onClick={() => capture(kind)} disabled={!geoConsent || locating !== null}
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-40"
            style={{ backgroundColor: "var(--brand)" }}>
            {locating === kind ? <Loader2 className="h-3 w-3 animate-spin" /> : <MapPin className="h-3 w-3" />} Pin here
          </button>
        )}
      </div>
      <input className="mt-2 w-full rounded-lg border border-zinc-900/10 bg-white/80 px-2.5 py-1.5 text-xs outline-none placeholder:text-zinc-400"
        placeholder={`${kind === "business" ? "Shop / stall" : "House"} landmark (optional)`}
        value={address} onChange={(e) => setAddress(e.target.value)} />
    </div>
  );

  return (
    <div className="mt-3 border-t border-zinc-900/10 pt-3">
      <label className="flex items-start gap-2.5 rounded-lg border border-zinc-900/10 bg-white/60 p-3 cursor-pointer">
        <input type="checkbox" checked={geoConsent} onChange={(e) => setGeoConsent(e.target.checked)} className="mt-0.5 h-4 w-4" style={{ accentColor: "var(--brand)" }} />
        <span className="text-xs text-zinc-600">
          The customer consents to a <span className="font-semibold">one-time location snapshot</span> of where we are right now
          (their business and/or home). It is saved once for field visits — never tracked.
        </span>
      </label>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {slot("business", bizPin, setBizPin, bizAddress, setBizAddress, Store)}
        {slot("home", homePin, setHomePin, homeAddress, setHomeAddress, Home)}
      </div>
    </div>
  );
}
