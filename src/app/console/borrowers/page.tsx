"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, AlertTriangle, Users, Search, MapPin } from "lucide-react";

type Borrower = {
  id: string; name: string | null; phone: string; nationalId: string | null;
  kycStatus: string; creditScore: number | null; riskBand: string | null;
  locationType: string | null; locationAddress: string | null; hasGeo: boolean;
  createdAt: string; loansCount: number; activeLoans: number; clearedLoans: number;
  olb: number; totalBorrowed: number; applications: number; graduated: boolean; lastConsent: string | null;
};

const fmtKES = (n: number) => `KES ${Math.round(n).toLocaleString()}`;

export default function BorrowersPage() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Borrower[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (query = "") => {
    try {
      const res = await fetch(`/api/console/borrowers?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not load borrowers."); return; }
      setRows(data.borrowers);
    } catch { setError("Could not load borrowers."); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="min-h-screen relative text-zinc-900">
      <div aria-hidden className="fixed inset-0 z-0 bg-[url('/images/white-background.png')] bg-cover bg-center" />
      <main className="relative z-10 mx-auto max-w-5xl px-4 sm:px-6 py-8">
        <Link href="/console" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800"><ArrowLeft className="h-4 w-4" /> Console</Link>
        <h1 className="mt-3 text-xl font-bold flex items-center gap-2"><Users className="h-5 w-5" style={{ color: "var(--brand)" }} /> Borrowers</h1>

        <div className="mt-4 flex items-center gap-2 rounded-lg border border-zinc-900/15 bg-white/80 px-3 max-w-md">
          <Search className="h-4 w-4 text-zinc-400 shrink-0" />
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load(q)}
            placeholder="Search phone, ID or name…" className="flex-1 bg-transparent outline-none text-sm py-2.5 placeholder:text-zinc-400" />
        </div>

        {error && <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}</div>}
        {!rows && !error && <div className="mt-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-zinc-400" /></div>}
        {rows?.length === 0 && <p className="mt-10 text-center text-sm text-zinc-500">No borrowers {q ? "matching your search" : "yet"}.</p>}

        <div className="mt-5 space-y-2">
          {rows?.map((b) => (
            <div key={b.id} className="glass p-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold text-white shrink-0" style={{ backgroundColor: "var(--brand)" }}>
                    {(b.name ?? b.phone).slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">
                      {b.name ?? b.phone}
                      {b.graduated && <span className="ml-2 rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">GRADUATED</span>}
                    </p>
                    <p className="text-xs text-zinc-500 truncate">
                      {b.phone}{b.nationalId ? ` · ID ${b.nationalId}` : ""} · KYC {b.kycStatus}
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
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
