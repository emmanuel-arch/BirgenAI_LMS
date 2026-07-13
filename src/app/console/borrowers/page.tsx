"use client";

import { Suspense, useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLoad } from "@/lib/hooks/useLoad";
import Link from "next/link";
import {
  Loader2, AlertTriangle, CheckCircle2, Users, Search, MapPin, UserPlus, Landmark, FlaskConical, ArrowRight, ShieldCheck, PenLine,
} from "lucide-react";
import { BorrowerAvatar } from "@/components/kyc/BorrowerAvatar";
import { PageHeader } from "@/components/shell/PageHeader";

type Borrower = {
  id: string; name: string | null; phone: string; nationalId: string | null;
  kycStatus: string; creditScore: number | null; riskBand: string | null;
  locationType: string | null; locationAddress: string | null; hasGeo: boolean;
  createdAt: string; loansCount: number; activeLoans: number; clearedLoans: number;
  olb: number; totalBorrowed: number; applications: number; graduated: boolean; lastConsent: string | null;
  /** Signed, short-lived, and null far more often than not — see lib/kyc/avatars. */
  portraitUrl: string | null;
};

const fmtKES = (n: number) => `KES ${Math.round(n).toLocaleString()}`;

export default function BorrowersPage() {
  return (
    <Suspense fallback={null}>
      <Borrowers />
    </Suspense>
  );
}

function Borrowers() {
  const search = useSearchParams();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Borrower[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ msg: string; borrowerId?: string } | null>(null);
  // The sidebar's "New Borrower" deep-links here with ?new=1.
  const [creating, setCreating] = useState(search.get("new") === "1");

  const load = useCallback(async (query = "") => {
    try {
      const res = await fetch(`/api/console/borrowers?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not load borrowers."); return; }
      setRows(data.borrowers);
    } catch { setError("Could not load borrowers."); }
  }, []);
  useLoad(load);

  return (
    <main className="mx-auto max-w-5xl px-4 sm:px-6 py-8">
        <PageHeader
          icon={Users}
          title="Borrowers"
          subtitle="Everyone on your book — their face, their loans, and whether they are cleared to be paid."
        >
          <button onClick={() => setCreating((v) => !v)} className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-800">
            <UserPlus className="h-3.5 w-3.5" /> New borrower
          </button>
        </PageHeader>

        {notice && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50/90 px-3 py-2.5 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              {notice.msg}{" "}
              {notice.borrowerId && (
                <Link href={`/console/kyc/${notice.borrowerId}?from=360`} className="font-bold underline">
                  Verify them now →
                </Link>
              )}
            </span>
          </div>
        )}
        {error && <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}</div>}

        {creating && (
          <NewBorrowerPanel
            onClose={() => setCreating(false)}
            onCreated={async (msg, borrowerId) => { setCreating(false); setNotice({ msg, borrowerId }); setError(null); await load(q); }}
            setError={setError}
          />
        )}

        <div className="mt-4 flex items-center gap-2 rounded-lg border border-zinc-900/15 bg-white/80 px-3 max-w-md">
          <Search className="h-4 w-4 text-zinc-400 shrink-0" />
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load(q)}
            placeholder="Search phone, ID or name…" className="flex-1 bg-transparent outline-none text-sm py-2.5 placeholder:text-zinc-400" />
        </div>

        {!rows && !error && <div className="mt-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-zinc-400" /></div>}
        {rows?.length === 0 && <p className="mt-10 text-center text-sm text-zinc-500">No borrowers {q ? "matching your search" : "yet"}.</p>}

        <div className="mt-5 space-y-2">
          {rows?.map((b) => (
            <Link key={b.id} href={`/console/borrowers/${b.id}`} className="glass p-4 block hover:bg-white/80 transition-colors">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex items-center gap-3">
                  <BorrowerAvatar
                    name={b.name ?? b.phone}
                    portraitUrl={b.portraitUrl}
                    verified={b.kycStatus === "VERIFIED"}
                    size="sm"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold sm:truncate">
                      {b.name ?? b.phone}
                      {b.graduated && <span className="ml-2 rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">GRADUATED</span>}
                    </p>
                    {/* Phones wrap to a second line — a truncated score or a hidden
                        "not verified" is worse than a taller row. */}
                    <p className="text-xs text-zinc-500 sm:truncate">
                      {b.phone}{b.nationalId ? ` · ID ${b.nationalId}` : ""}
                      {/* The tick on the avatar says "verified". Only the absence needs words. */}
                      {b.kycStatus !== "VERIFIED" && <span className="font-medium text-amber-700"> · not verified</span>}
                      {b.creditScore != null && <> · score <span className="font-semibold">{b.creditScore}</span></>}
                      {b.hasGeo && <MapPin className="inline h-3 w-3 ml-1 -mt-0.5 text-zinc-400" />}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-right shrink-0">
                  <div><p className="text-[10px] uppercase text-zinc-500">Loans</p><p className="text-sm font-bold">{b.activeLoans} / {b.loansCount}</p></div>
                  <div><p className="text-[10px] uppercase text-zinc-500">OLB</p><p className="text-sm font-bold" style={{ color: "var(--brand)" }}>{fmtKES(b.olb)}</p></div>
                  <div className="hidden sm:block"><p className="text-[10px] uppercase text-zinc-500">Borrowed</p><p className="text-sm font-bold">{fmtKES(b.totalBorrowed)}</p></div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Register a walk-in customer — REGISTRY-FIRST.
//
// The officer types ONE number; the national registry (IPRS, server-side) fills
// in the person. The identity fields on the record came from the registry, not
// from a keyboard, so a typo'd name can't survive onboarding. The registry has
// no phone numbers, so the phone — the identity key everywhere else — is the
// one thing still typed. Manual entry stays one click away, because a registry
// outage must never stop a counter.
// ─────────────────────────────────────────────────────────────────────────────
type IprsPrefill = {
  mode: "live" | "simulation";
  fullName: string | null; firstName: string | null; otherName: string | null; surname: string | null;
  gender: string | null; dob: string | null; citizenship: string | null;
  serialNumber: string | null; placeOfBirth: string | null; placeOfLive: string | null;
};

function NewBorrowerPanel({ onClose, onCreated, setError }: {
  onClose: () => void; onCreated: (msg: string, borrowerId?: string) => void; setError: (s: string | null) => void;
}) {
  const [step, setStep] = useState<"id" | "review" | "manual">("id");
  const [nationalId, setNationalId] = useState("");
  const [consent, setConsent] = useState(false);
  const [prefill, setPrefill] = useState<IprsPrefill | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [lookupNote, setLookupNote] = useState<string | null>(null);
  const [existing, setExisting] = useState<{ id: string; name: string; phone: string } | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [locationType, setLocationType] = useState<"business" | "home">("business");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);

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
          nationalId: nationalId.replace(/\D/g, "") || undefined,
          locationType,
          locationAddress: address || undefined,
          ...(prefill ? { dob: prefill.dob ?? undefined, gender: prefill.gender ?? undefined, iprs: prefill } : {}),
        }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not register the borrower."); return; }
      onCreated(
        `${name.trim()} registered${prefill ? " with their registry identity on file" : ""} — next stop is KYC verification; no money can be disbursed until it's done.`,
        data.borrowerId,
      );
    } catch { setError("Could not register the borrower."); } finally { setBusy(false); }
  };

  const field = "w-full rounded-lg border border-zinc-900/15 bg-white/80 px-3 py-2.5 text-sm outline-none placeholder:text-zinc-400";
  const idDigits = nationalId.replace(/\D/g, "");

  // ── STEP 1 — one number. ────────────────────────────────────────────────────
  if (step === "id") {
    return (
      <div className="glass mt-4 p-6 sm:p-8">
        <div className="mx-auto max-w-md text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl" style={{ backgroundColor: "var(--brand-soft)" }}>
            <Landmark className="h-6 w-6" style={{ color: "var(--brand)" }} />
          </div>
          <h2 className="mt-4 text-2xl font-bold tracking-tight">We hate paperwork too.</h2>
          <p className="mt-1.5 text-sm text-zinc-500">
            One ID number — the national registry fills in the rest. It takes about a minute.
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
            <button onClick={onClose} className="text-zinc-500 hover:text-zinc-800">Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  // ── STEP 2 — the person, as the registry knows them. ───────────────────────
  if (step === "review" && prefill) {
    const chip = (label: string, value: string | null) => value && (
      <div key={label} className="rounded-lg border border-zinc-900/10 bg-white/60 px-2.5 py-1.5">
        <p className="text-[9px] uppercase tracking-wide text-zinc-500">{label}</p>
        <p className="text-xs font-semibold text-zinc-800">{value}</p>
      </div>
    );
    return (
      <div className="glass mt-4 p-5 sm:p-6">
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
              <h2 className="text-lg font-bold truncate">{prefill.fullName}</h2>
              <p className="text-xs text-zinc-500">ID {idDigits}{prefill.serialNumber ? ` · serial ${prefill.serialNumber}` : ""}</p>
            </div>
          </div>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ${prefill.mode === "live" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
            {prefill.mode === "live" ? <><ShieldCheck className="h-3 w-3" /> NATIONAL REGISTRY</> : <><FlaskConical className="h-3 w-3" /> SIMULATED REGISTRY</>}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {chip("Gender", prefill.gender)}
          {chip("Date of birth", prefill.dob)}
          {chip("Citizenship", prefill.citizenship)}
          {chip("Place of birth", prefill.placeOfBirth)}
          {chip("Lives in", prefill.placeOfLive)}
        </div>

        <p className="mt-3 text-[11px] text-zinc-500">
          This is a registry <span className="font-semibold">prefill</span>, not a verification — the face, liveness and
          document checks still run at KYC. All that&apos;s left to type is how to reach them.
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <input className={field} inputMode="tel" placeholder="Phone (07XX XXX XXX) — required" value={phone} onChange={(e) => setPhone(e.target.value)} autoFocus />
          <div className="flex gap-2">
            {(["business", "home"] as const).map((t) => (
              <button key={t} type="button" onClick={() => setLocationType(t)}
                className={`flex-1 rounded-lg border px-3 py-2.5 text-sm font-medium capitalize ${locationType === t ? "border-transparent text-white" : "border-zinc-900/15 bg-white/80 text-zinc-600"}`}
                style={locationType === t ? { backgroundColor: "var(--brand)" } : undefined}>
                {t}
              </button>
            ))}
          </div>
          <input className={`${field} sm:col-span-2`} placeholder="Address / landmark (optional — field agents use this)" value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button onClick={submit} disabled={busy || phone.replace(/\D/g, "").length < 9}
            className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "var(--brand)" }}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Register {prefill.firstName ?? "borrower"} <ArrowRight className="h-4 w-4" />
          </button>
          <button onClick={() => { setStep("id"); setPrefill(null); setPhoto(null); }} className="rounded-lg border border-zinc-900/15 bg-white/70 px-4 py-2.5 text-sm font-medium text-zinc-600">Back</button>
        </div>
      </div>
    );
  }

  // ── Manual fallback — the old form, one click away, never the default. ──────
  return (
    <div className="glass mt-4 p-5">
      <p className="text-sm font-semibold">Register a walk-in borrower</p>
      <p className="mt-0.5 text-[11px] text-zinc-500">The phone number is their identity everywhere — statements, payments, sign-in codes.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <input className={field} placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className={field} inputMode="tel" placeholder="Phone (07XX XXX XXX)" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <input className={field} inputMode="numeric" placeholder="National ID (optional — KYC verifies it)" value={nationalId} onChange={(e) => setNationalId(e.target.value)} />
        <div className="flex gap-2">
          {(["business", "home"] as const).map((t) => (
            <button key={t} type="button" onClick={() => setLocationType(t)}
              className={`flex-1 rounded-lg border px-3 py-2.5 text-sm font-medium capitalize ${locationType === t ? "border-transparent text-white" : "border-zinc-900/15 bg-white/80 text-zinc-600"}`}
              style={locationType === t ? { backgroundColor: "var(--brand)" } : undefined}>
              {t}
            </button>
          ))}
        </div>
        <input className={`${field} sm:col-span-2`} placeholder="Address / landmark (optional — field agents use this)" value={address} onChange={(e) => setAddress(e.target.value)} />
      </div>
      <div className="mt-4 flex items-center gap-2">
        <button onClick={submit} disabled={busy || name.trim().length < 3 || phone.replace(/\D/g, "").length < 9}
          className="inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: "var(--brand)" }}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Register borrower
        </button>
        <button onClick={() => setStep("id")} className="rounded-lg border border-zinc-900/15 bg-white/70 px-4 py-2.5 text-sm font-medium text-zinc-600">Use the registry instead</button>
        <button onClick={onClose} className="rounded-lg border border-zinc-900/15 bg-white/70 px-4 py-2.5 text-sm font-medium text-zinc-600">Cancel</button>
      </div>
    </div>
  );
}
