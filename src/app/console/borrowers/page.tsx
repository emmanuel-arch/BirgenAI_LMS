"use client";

// THE CUSTOMER BOOK.
//
// For a bridged lender this is not our table — it is theirs, read through live
// (see api/console/borrowers). Micromart's Micro Eazy entity carries 17,017
// customers, which changes what this screen has to be: a book that size cannot be
// fetched and filtered in the browser, so the search and the paging both happen in
// the lender's database and this page asks for one screenful at a time.
//
// The header strip carries WHOLE-BOOK figures, not page figures. "Every customer
// needs a location" is the single most important thing an officer can learn here —
// none of these 17,017 has ever been geo-verified, so all of them are field work
// waiting to happen — and that claim is only honest if the number behind it counts
// the book rather than the fifty rows on screen.
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLoad } from "@/lib/hooks/useLoad";
import Link from "next/link";
import {
  AlertTriangle, Users, Search, MapPinOff, UserPlus, ChevronLeft, ChevronRight,
  RadioTower, RotateCw, X,
} from "lucide-react";
import { BorrowerAvatar } from "@/components/kyc/BorrowerAvatar";
import { PageHeader } from "@/components/shell/PageHeader";

type Borrower = {
  id: string; name: string | null; phone: string; nationalId: string | null;
  kycStatus: string; creditScore: number | null; riskBand: string | null;
  locationType: string | null; locationAddress: string | null; hasGeo: boolean;
  createdAt: string | null; loansCount: number; activeLoans: number; clearedLoans: number;
  olb: number; totalBorrowed: number; applications: number; graduated: boolean; lastConsent: string | null;
  /** Signed, short-lived, and null far more often than not — see lib/kyc/avatars. */
  portraitUrl: string | null;
  /** Present on rows read from the lender's own book. */
  loanLimit?: number | null;
  graduationCount?: number;
  accountStatus?: string;
};

type BookStats = { total: number; active: number; needsLocation: number; scored: number; withOpenLoan: number };

const fmtKES = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
const fmtNum = (n: number) => n.toLocaleString();

/** At most five page buttons, windowed around the current page. */
function pageWindow(page: number, count: number): number[] {
  const start = Math.max(0, Math.min(page - 2, count - 5));
  return Array.from({ length: Math.min(5, count) }, (_, i) => start + i);
}

// A denser screenful than the old eight: this book is long, and every extra row
// that fits is one less page turn between an officer and the customer they want.
const PAGE_SIZE = 12;

const BAND_TONE: Record<string, string> = {
  PRIME: "bg-emerald-100 text-emerald-700",
  STRONG: "bg-sky-100 text-sky-700",
  WATCH: "bg-amber-100 text-amber-700",
  HIGH: "bg-rose-100 text-rose-700",
};

/** One whole-book figure. Tabular, because these sit in a row and get compared. */
function BookStat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="glass px-3.5 py-3">
      <p className="t-label">{label}</p>
      <p className={`t-num mt-1 text-xl font-bold leading-none ${tone ?? ""}`} style={tone ? undefined : { color: "var(--ink)" }}>
        {value}
      </p>
      {hint && <p className="t-meta mt-1 text-[11px] leading-tight">{hint}</p>}
    </div>
  );
}

/** Rows that look like rows before the data lands — a spinner tells you nothing
    about what is coming; a skeleton tells you it is a list of people. */
function SkeletonRows() {
  return (
    <div className="mt-5 space-y-2" aria-hidden>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="glass flex items-center gap-3 p-4">
          <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-ash-900/10" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3 animate-pulse rounded bg-ash-900/10" style={{ width: `${38 + ((i * 11) % 26)}%` }} />
            <div className="h-2.5 animate-pulse rounded bg-ash-900/[0.07]" style={{ width: `${54 + ((i * 7) % 22)}%` }} />
          </div>
          <div className="hidden gap-6 sm:flex">
            <div className="h-7 w-14 animate-pulse rounded bg-ash-900/[0.07]" />
            <div className="h-7 w-20 animate-pulse rounded bg-ash-900/[0.07]" />
          </div>
        </div>
      ))}
    </div>
  );
}

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
  const [needle, setNeedle] = useState("");
  const [rows, setRows] = useState<Borrower[] | null>(null);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<BookStats | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [entityId, setEntityId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);

  // Registering a customer is its own page now — old ?new=1 deep links follow it there.
  useEffect(() => {
    if (search.get("new") === "1") router.replace("/console/borrowers/new");
  }, [search, router]);

  // Debounce the box into the server. The page reset belongs HERE and not in the
  // loader: typing a new search while on page 7 must not ask for page 7 of a
  // result set that may only have one page.
  useEffect(() => {
    const t = setTimeout(() => {
      setNeedle((prev) => (prev === q.trim() ? prev : q.trim()));
      setPage((prev) => (q.trim() === needle ? prev : 0));
    }, 350);
    return () => clearTimeout(t);
    // `needle` is read to avoid a pointless reset when nothing actually changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        q: needle,
        take: String(PAGE_SIZE),
        skip: String(page * PAGE_SIZE),
      });
      const res = await fetch(`/api/console/borrowers?${params}`);
      const data = await res.json();
      if (!data.success) {
        setError(data.message || "Could not load the customer book.");
        return;
      }
      setRows(data.borrowers ?? []);
      // A native org's route returns no `total`; fall back to what it sent.
      setTotal(typeof data.total === "number" ? data.total : (data.borrowers?.length ?? 0));
      setSource(data.source ?? null);
      setEntityId(typeof data.entityId === "number" ? data.entityId : null);
      if (data.stats) setStats(data.stats as BookStats);
    } catch {
      setError("Could not reach the customer book.");
    } finally {
      setBusy(false);
    }
  }, [needle, page]);
  useLoad(load, [needle, page]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min((page + 1) * PAGE_SIZE, total);
  const live = source === "servicesuite";

  return (
    <main className="mx-auto max-w-5xl px-4 sm:px-6 py-8">
      <PageHeader
        icon={Users}
        title="Customers"
        subtitle={
          live
            ? "Read live from the lender's own system — every figure here is their book as it stands right now, not a copy of it."
            : "Everyone on your book — their face, their loans, and whether they are cleared to be paid."
        }
      >
        <Link href="/console/borrowers/new" className="inline-flex items-center gap-1.5 rounded-lg bg-invert px-4 py-2 text-xs font-semibold text-invert-fg hover:bg-invert-2">
          <UserPlus className="h-3.5 w-3.5" /> New customer
        </Link>
      </PageHeader>

      {live && (
        <p className="t-meta mt-3 inline-flex items-center gap-1.5">
          <RadioTower className="h-3.5 w-3.5" style={{ color: "var(--brand)" }} aria-hidden />
          Live connection{entityId != null ? ` · entity ${entityId}` : ""}
        </p>
      )}

      {/* WHOLE-BOOK figures. Shown on the unfiltered first page only, because that
          is the only time they describe what the reader is looking at. */}
      {stats && !needle && (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <BookStat label="Customers" value={fmtNum(stats.total)} hint={`${fmtNum(stats.active)} active`} />
          <BookStat
            label="Need a location"
            value={fmtNum(stats.needsLocation)}
            hint={stats.total ? `${Math.round((stats.needsLocation / stats.total) * 100)}% of the book` : undefined}
            tone="text-amber-700"
          />
          <BookStat label="Scored" value={fmtNum(stats.scored)} hint="carry a credit score" />
          <BookStat label="Open loans" value={fmtNum(stats.withOpenLoan)} hint="customers owing today" />
        </div>
      )}

      {/* The location gap is the whole field-ops story, so it gets said in words
          once rather than left for the reader to infer from a number. */}
      {stats && !needle && stats.needsLocation === stats.total && stats.total > 0 && (
        <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-300/70 bg-amber-50/80 px-3 py-2.5">
          <MapPinOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden />
          <p className="t-body text-[13px] text-amber-900">
            <span className="font-semibold">No customer on this book has a verified location.</span>{" "}
            Money cannot be released to an unpinned customer, so all {fmtNum(stats.total)} are field work waiting
            to be scheduled — they are already queued in{" "}
            <Link href="/console/field" className="underline decoration-amber-700/40 underline-offset-2 hover:decoration-amber-700">
              Field operations
            </Link>.
          </p>
        </div>
      )}

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span className="flex-1">{error}</span>
          <button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-red-300 px-2 py-1 text-xs font-semibold hover:bg-red-100">
            <RotateCw className="h-3 w-3" aria-hidden /> Retry
          </button>
        </div>
      )}

      <div className="mt-4 flex max-w-md items-center gap-2 rounded-lg border border-ash-900/15 bg-paper/80 px-3">
        <Search className={`h-4 w-4 shrink-0 ${busy ? "animate-pulse text-ash-500" : "text-ash-400"}`} aria-hidden />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search phone, ID or name…"
          aria-label="Search customers"
          className="flex-1 bg-transparent py-2.5 text-sm outline-none placeholder:text-ash-400"
        />
        {q && (
          <button onClick={() => setQ("")} aria-label="Clear search" className="shrink-0 rounded p-1 text-ash-400 hover:text-ash-700">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {needle && rows && (
        <p className="t-meta mt-2">
          {total === 0 ? "No match" : `${fmtNum(total)} ${total === 1 ? "match" : "matches"}`} for “{needle}”
        </p>
      )}

      {!rows && !error && <SkeletonRows />}

      {rows?.length === 0 && !error && (
        <div className="glass mt-5 px-6 py-12 text-center">
          <p className="t-section">{needle ? "Nobody on this book matches that" : "No customers yet"}</p>
          <p className="t-meta mx-auto mt-1.5 max-w-sm">
            {needle
              ? "Search by mobile number, national ID, or any part of a name."
              : "Register the first customer, or connect the lender's system to read their existing book."}
          </p>
        </div>
      )}

      <div className={`mt-5 space-y-2 transition-opacity ${busy && rows ? "opacity-60" : "opacity-100"}`}>
        {rows?.map((b) => (
          // A `ss:` row came from the lender's live book and has no local record
          // yet, so it opens through the resolver, which seeds one and hands off
          // to the canonical page. Local rows link straight there as before.
          <Link
            key={b.id}
            href={b.id.startsWith("ss:") ? `/console/borrowers/resolve/${encodeURIComponent(b.id)}` : `/console/borrowers/${b.id}`}
            className="glass block p-4 transition-colors hover:bg-paper/80"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <BorrowerAvatar name={b.name ?? b.phone} portraitUrl={b.portraitUrl} verified={b.kycStatus === "VERIFIED"} size="sm" />
                <div className="min-w-0">
                  <p className="t-section flex items-center gap-2 sm:truncate">
                    <span className="truncate">{b.name ?? b.phone}</span>
                    {b.graduated && (
                      <span className="shrink-0 rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">GRADUATED</span>
                    )}
                    {b.riskBand && BAND_TONE[b.riskBand] && (
                      <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${BAND_TONE[b.riskBand]}`}>{b.riskBand}</span>
                    )}
                  </p>
                  <p className="t-meta sm:truncate">
                    <span className="t-num">{b.phone}</span>
                    {b.nationalId ? <> · ID <span className="t-num">{b.nationalId}</span></> : ""}
                    {/* The tick on the avatar says "verified". Only the absence needs words. */}
                    {b.kycStatus !== "VERIFIED" && <span className="font-medium text-amber-700"> · not verified</span>}
                    {b.creditScore != null && <> · score <span className="t-num font-semibold">{b.creditScore}</span></>}
                    {!b.hasGeo && (
                      <span className="ml-1.5 inline-flex items-center gap-1 align-middle text-amber-700" title="No verified location — cannot be disbursed to">
                        <MapPinOff className="h-3 w-3" aria-hidden />
                        <span className="text-[11px] font-medium">no pin</span>
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-4 text-right">
                <div>
                  <p className="t-label">Loans</p>
                  <p className="t-num text-sm font-bold">{b.activeLoans} / {b.loansCount}</p>
                </div>
                <div>
                  <p className="t-label">OLB</p>
                  <p className="t-num text-sm font-bold" style={{ color: "var(--brand)" }}>{fmtKES(b.olb)}</p>
                </div>
                <div className="hidden sm:block">
                  <p className="t-label">{b.loanLimit != null ? "Limit" : "Borrowed"}</p>
                  <p className="t-num text-sm font-bold">{fmtKES(b.loanLimit ?? b.totalBorrowed)}</p>
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Page navigation — the book pages, the screen doesn't scroll. Paging is
          served by the lender's database, so page 800 costs what page 1 costs. */}
      {total > PAGE_SIZE && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="t-meta t-num">
            {fmtNum(from)}–{fmtNum(to)} of {fmtNum(total)}
          </p>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0 || busy}
              aria-label="Previous page"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-ash-900/10 bg-paper/70 text-ash-600 hover:bg-paper disabled:opacity-35"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            {pageWindow(page, pageCount).map((i) => (
              <button
                key={i}
                onClick={() => setPage(i)}
                disabled={busy}
                aria-label={`Page ${i + 1}`}
                aria-current={i === page ? "page" : undefined}
                className={`t-num h-8 min-w-8 rounded-lg px-2 text-xs font-semibold transition-colors ${
                  i === page ? "text-white" : "border border-ash-900/10 bg-paper/70 text-ash-600 hover:bg-paper"
                }`}
                style={i === page ? { backgroundColor: "var(--brand)" } : undefined}
              >
                {i + 1}
              </button>
            ))}
            <button
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={page >= pageCount - 1 || busy}
              aria-label="Next page"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-ash-900/10 bg-paper/70 text-ash-600 hover:bg-paper disabled:opacity-35"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
