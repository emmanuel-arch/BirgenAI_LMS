"use client";

import { Suspense, useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLoad } from "@/lib/hooks/useLoad";
import Link from "next/link";
import { Loader2, AlertTriangle, CheckCircle2, Users, Search, MapPin, UserPlus } from "lucide-react";
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
  const [notice, setNotice] = useState<string | null>(null);
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

        {notice && <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50/90 px-3 py-2.5 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> {notice}</div>}
        {error && <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}</div>}

        {creating && (
          <NewBorrowerPanel
            onClose={() => setCreating(false)}
            onCreated={async (msg) => { setCreating(false); setNotice(msg); setError(null); await load(q); }}
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

// Register a walk-in customer. Identity now — KYC (the /verify wizard) and
// scoring follow through the normal machinery once they apply.
function NewBorrowerPanel({ onClose, onCreated, setError }: {
  onClose: () => void; onCreated: (msg: string) => void; setError: (s: string | null) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [locationType, setLocationType] = useState<"business" | "home">("business");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/console/borrowers", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, nationalId: nationalId || undefined, locationType, locationAddress: address || undefined }),
      });
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not register the borrower."); return; }
      onCreated(`${name.trim()} registered — and now waiting on KYC Verification. No money can be disbursed to them until they are verified.`);
    } catch { setError("Could not register the borrower."); } finally { setBusy(false); }
  };

  const field = "w-full rounded-lg border border-zinc-900/15 bg-white/80 px-3 py-2.5 text-sm outline-none placeholder:text-zinc-400";

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
        <button onClick={onClose} className="rounded-lg border border-zinc-900/15 bg-white/70 px-4 py-2.5 text-sm font-medium text-zinc-600">Cancel</button>
      </div>
    </div>
  );
}
