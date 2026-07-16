"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLoad } from "@/lib/hooks/useLoad";
import Link from "next/link";
import {
  Loader2, AlertTriangle, Users, Search, MapPin, UserPlus, ChevronLeft, ChevronRight,
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

/** At most five page buttons, windowed around the current page. */
function pageWindow(page: number, count: number): number[] {
  const start = Math.max(0, Math.min(page - 2, count - 5));
  return Array.from({ length: Math.min(5, count) }, (_, i) => start + i);
}

// One screenful of rows — long books page instead of scrolling (the pattern
// every long list in the console is converging on).
const PAGE_SIZE = 8;

export default function BorrowersPage() {
  return (
    <Suspense fallback={null}>
      <Borrowers />
    </Suspense>
  );
}

function Borrowers() {
  const router = useRouter();
  const search = useSearchParams();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Borrower[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  // Registering a customer is its own page now — old ?new=1 deep links follow it there.
  useEffect(() => {
    if (search.get("new") === "1") router.replace("/console/borrowers/new");
  }, [search, router]);

  const load = useCallback(async (query = "") => {
    try {
      const res = await fetch(`/api/console/borrowers?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (!data.success) { setError(data.message || "Could not load borrowers."); return; }
      setRows(data.borrowers);
      setPage(0);
    } catch { setError("Could not load borrowers."); }
  }, []);
  useLoad(load);

  const pageCount = rows ? Math.max(1, Math.ceil(rows.length / PAGE_SIZE)) : 1;
  const visible = rows?.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <main className="mx-auto max-w-5xl px-4 sm:px-6 py-8">
        <PageHeader
          icon={Users}
          title="Borrowers"
          subtitle="Everyone on your book — their face, their loans, and whether they are cleared to be paid."
        >
          <Link href="/console/borrowers/new" className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-800">
            <UserPlus className="h-3.5 w-3.5" /> New borrower
          </Link>
        </PageHeader>

        {error && <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}</div>}

        <div className="mt-4 flex items-center gap-2 rounded-lg border border-zinc-900/15 bg-white/80 px-3 max-w-md">
          <Search className="h-4 w-4 text-zinc-400 shrink-0" />
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load(q)}
            placeholder="Search phone, ID or name…" className="flex-1 bg-transparent outline-none text-sm py-2.5 placeholder:text-zinc-400" />
        </div>

        {!rows && !error && <div className="mt-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-zinc-400" /></div>}
        {rows?.length === 0 && <p className="mt-10 text-center text-sm text-zinc-500">No borrowers {q ? "matching your search" : "yet"}.</p>}

        <div className="mt-5 space-y-2">
          {visible?.map((b) => (
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

        {/* Page navigation — the book pages, the screen doesn't scroll. */}
        {rows && rows.length > PAGE_SIZE && (
          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-xs text-zinc-500">
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, rows.length)} of {rows.length}
            </p>
            <div className="flex items-center gap-1.5">
              <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
                aria-label="Previous page"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-900/10 bg-white/70 text-zinc-600 hover:bg-white disabled:opacity-35">
                <ChevronLeft className="h-4 w-4" />
              </button>
              {pageWindow(page, pageCount).map((i) => (
                <button key={i} onClick={() => setPage(i)} aria-label={`Page ${i + 1}`}
                  className={`h-8 min-w-8 rounded-lg px-2 text-xs font-semibold transition-colors ${
                    i === page ? "text-white" : "border border-zinc-900/10 bg-white/70 text-zinc-600 hover:bg-white"
                  }`}
                  style={i === page ? { backgroundColor: "var(--brand)" } : undefined}>
                  {i + 1}
                </button>
              ))}
              <button onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1}
                aria-label="Next page"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-900/10 bg-white/70 text-zinc-600 hover:bg-white disabled:opacity-35">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </main>
  );
}
