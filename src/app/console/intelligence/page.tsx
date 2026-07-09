import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Gauge, ShieldAlert, SlidersHorizontal } from "lucide-react";
import { auth } from "@/lib/auth";
import { hasFeature } from "@/lib/billing/entitlements";
import { UpgradeCard } from "@/components/billing/UpgradeCard";
import { portfolioEarlyWarning } from "@/lib/intelligence/earlywarning";
import { tuningFor, isDefault } from "@/lib/intelligence/tuning";
import { Watchlist } from "./Watchlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fmt = (n: number) => `KES ${Math.round(n).toLocaleString()}`;

export default async function IntelligencePage() {
  const session = await auth();
  if (!session?.user?.orgId) redirect("/login");

  if (!(await hasFeature(session.user.orgId, "portfolio-scan"))) {
    return (
      <div className="min-h-screen relative text-zinc-900">
        <div aria-hidden className="fixed inset-0 z-0 bg-[url('/images/white-background.png')] bg-cover bg-center" />
        <main className="relative z-10 mx-auto max-w-5xl px-4 sm:px-6 py-10">
          <Link href="/console" className="mb-6 inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800">
            <ArrowLeft className="h-4 w-4" /> Console
          </Link>
          <UpgradeCard
            feature="portfolio-scan"
            title="Credit Intelligence"
            blurb="Score every active loan for the early signs of default — arrears depth, missed installments, payment trajectory — and act while the money is still recoverable."
          />
        </main>
      </div>
    );
  }

  // Premium can shape this policy. Everyone else is scored on the BirgenAI defaults,
  // and the page says which — a risk score with no stated policy behind it is a rumour.
  const [ew, tuneEntitled, tuning] = await Promise.all([
    portfolioEarlyWarning(session.user.orgId),
    hasFeature(session.user.orgId, "model-tuning"),
    tuningFor(session.user.orgId),
  ]);
  const isTuned = !isDefault(tuning);
  const parPct = ew.tiles.olb > 0 ? (ew.tiles.atRiskValue / ew.tiles.olb) * 100 : 0;

  const TILES = [
    { label: "Value at risk", value: fmt(ew.tiles.atRiskValue), sub: `${parPct.toFixed(1)}% of book`, tone: "warn" as const },
    { label: "On watchlist", value: String(ew.tiles.watchlist), sub: "borrowers flagged", tone: undefined },
    { label: "High risk", value: String(ew.tiles.high), sub: "act now", tone: ew.tiles.high > 0 ? ("bad" as const) : undefined },
    { label: "Projected loss", value: fmt(ew.tiles.projectedLoss), sub: "expected", tone: "bad" as const },
    { label: "Outstanding book", value: fmt(ew.tiles.olb), sub: null, tone: undefined },
  ];
  const toneColor = (t?: "warn" | "bad") => (t === "bad" ? "#e11d48" : t === "warn" ? "#d97706" : "var(--brand)");

  return (
    <div className="min-h-screen relative text-zinc-900">
      <div aria-hidden className="fixed inset-0 z-0 bg-[url('/images/white-background.png')] bg-cover bg-center" />
      <main className="relative z-10 mx-auto max-w-5xl px-4 sm:px-6 py-8">
        <Link href="/console" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800"><ArrowLeft className="h-4 w-4" /> Console</Link>
        <div className="mt-3 flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2"><Gauge className="h-5 w-5" style={{ color: "var(--brand)" }} /> Credit Intelligence</h1>
            <p className="mt-1 text-sm text-zinc-500 max-w-2xl">Portfolio early-warning. Every active loan is scored on live repayment behaviour, the origination model&apos;s PD, and structural risk — so you recover the money before it walks.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {tuneEntitled && (
              <Link href="/console/intelligence/tuning"
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-900/15 bg-white/70 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-white">
                <SlidersHorizontal className="h-3.5 w-3.5" /> {isTuned ? "Your risk policy" : "Tune the policy"}
              </Link>
            )}
            <span className="rounded-full bg-white/70 px-3 py-1 text-[11px] font-medium text-zinc-500 border border-zinc-900/10">Closed ML loop · updated just now</span>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-zinc-400">
          {isTuned ? "Scored with your own risk policy." : "Scored with the BirgenAI default risk policy."} Anyone in arrears is shown, whatever they score.
        </p>

        <div className="mt-5 grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
          {TILES.map((t) => (
            <div key={t.label} className="glass p-3.5">
              <p className="text-[10px] uppercase tracking-wide text-zinc-500">{t.label}</p>
              <p className="mt-1 text-base font-bold leading-tight" style={{ color: toneColor(t.tone) }}>{t.value}</p>
              {t.sub && <p className="mt-0.5 text-[10px] text-zinc-500">{t.sub}</p>}
            </div>
          ))}
        </div>

        {ew.rows.length === 0 ? (
          <div className="mt-8 glass p-10 text-center">
            <ShieldAlert className="mx-auto h-9 w-9 text-emerald-500" />
            <p className="mt-3 text-sm font-semibold">Your book is clean</p>
            <p className="mt-1 text-sm text-zinc-500">No active loan is showing early-warning signals. Riri is watching — the instant one starts to slip, it lands here with a recommended action.</p>
          </div>
        ) : (
          <div className="mt-7">
            <h2 className="text-sm font-semibold flex items-center gap-2"><ShieldAlert className="h-4 w-4" style={{ color: "var(--brand)" }} /> Watchlist <span className="text-zinc-400 font-normal">· ranked by risk</span></h2>
            <div className="mt-3"><Watchlist rows={ew.rows} /></div>
          </div>
        )}
      </main>
    </div>
  );
}
