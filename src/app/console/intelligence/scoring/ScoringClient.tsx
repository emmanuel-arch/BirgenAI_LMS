"use client";

// The Credit Scoring console (see page.tsx for the four-panel design). All the
// arithmetic here is deterministic and shown — a projection that cannot say
// which accounts it assumed cured is a mood, not a plan.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Target, Play, Loader2, TrendingUp, TrendingDown, ArrowRight, PhoneCall, ShieldCheck,
  Gauge, SlidersHorizontal, Package, Calculator, Bot, CheckCircle2,
} from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";

type SlimRow = {
  borrowerId: string; loanId: string; name: string; band: "WATCH" | "ELEVATED" | "HIGH";
  dpd: number; balance: number; riskScore: number; expectedLoss: number; reasons: string[];
};
type Engine = { key: string; name: string; role: string; population: string; live: boolean; note: string; count: number };
type Trend = { ranAt: string; atRiskPct: number; projectedLoss: number; high: number; watchlist: number };
type Movement = { entered: number; left: number; escalated: number; improved: number };

const kes = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
const pct = (n: number) => `${n.toFixed(1)}%`;

export function ScoringClient(props: {
  generatedAt: string;
  olb: number; atRiskValue: number; atRiskPct: number; projectedLoss: number;
  bands: { high: number; elevated: number; watch: number };
  activeLoans: number;
  rows: SlimRow[];
  trend: Trend[];
  weekAgo: { ranAt: string; atRiskPct: number; projectedLoss: number; high: number; watchlist: number } | null;
  movement: Movement;
  engines: Engine[];
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [ranMsg, setRanMsg] = useState<string | null>(null);

  const runNow = async () => {
    setRunning(true); setRanMsg(null);
    try {
      const res = await fetch("/api/console/intelligence/run", { method: "POST" });
      const d = await res.json();
      setRanMsg(d.success ? "Batch scored — the book was recorded just now." : d.message || "Run failed.");
      if (d.success) router.refresh();
    } catch { setRanMsg("Run failed."); } finally { setRunning(false); }
  };

  return (
    <main className="mx-auto max-w-5xl px-4 sm:px-6 py-8">
      <PageHeader
        icon={Target}
        title="Credit Scoring"
        subtitle="Every engine on the fleet, the whole book batch-scored, and the exact accounts to cure to hit next week's number."
      >
        <button onClick={runNow} disabled={running}
          className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-50">
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Batch score now
        </button>
      </PageHeader>
      {ranMsg && <p className="mt-3 flex items-center gap-1.5 text-xs text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> {ranMsg}</p>}

      <WeekOverWeek {...props} />
      <Projection rows={props.rows} olb={props.olb} atRiskValue={props.atRiskValue} atRiskPct={props.atRiskPct} />
      <Playbook rows={props.rows} />
      <Engines engines={props.engines} />
    </main>
  );
}

// ── 1 · This week vs last week ────────────────────────────────────────────────

function Delta({ now, then, goodWhenDown = true, fmt }: { now: number; then: number | null; goodWhenDown?: boolean; fmt: (n: number) => string }) {
  if (then == null) return <span className="text-[10px] text-zinc-400">no run a week ago to compare</span>;
  const d = now - then;
  if (Math.abs(d) < 0.05) return <span className="text-[10px] font-semibold text-zinc-500">unchanged vs last week</span>;
  const improving = goodWhenDown ? d < 0 : d > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold ${improving ? "text-emerald-600" : "text-rose-600"}`}>
      {d > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {d > 0 ? "+" : ""}{fmt(d)} vs last week
    </span>
  );
}

function WeekOverWeek(p: Parameters<typeof ScoringClient>[0]) {
  const { weekAgo, movement } = p;
  const spark = p.trend.slice(-14);
  const maxPct = Math.max(5, ...spark.map((t) => t.atRiskPct));
  return (
    <div className="glass mt-4 p-5">
      <h2 className="text-sm font-semibold">The book, this week vs last</h2>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <div className="rounded-xl border border-zinc-900/10 bg-white/60 p-3.5">
          <p className="text-[10px] uppercase tracking-wide text-zinc-500">Value at risk</p>
          <p className="text-xl font-bold" style={{ color: "var(--brand)" }}>{pct(p.atRiskPct)}</p>
          <p className="text-[11px] text-zinc-500">{kes(p.atRiskValue)} of {kes(p.olb)}</p>
          <Delta now={p.atRiskPct} then={weekAgo?.atRiskPct ?? null} fmt={(n) => `${n.toFixed(1)}pp`} />
        </div>
        <div className="rounded-xl border border-zinc-900/10 bg-white/60 p-3.5">
          <p className="text-[10px] uppercase tracking-wide text-zinc-500">Projected loss</p>
          <p className="text-xl font-bold text-zinc-800">{kes(p.projectedLoss)}</p>
          <p className="text-[11px] text-zinc-500">balance × blended PD</p>
          <Delta now={p.projectedLoss} then={weekAgo?.projectedLoss ?? null} fmt={(n) => kes(Math.abs(n))} />
        </div>
        <div className="rounded-xl border border-zinc-900/10 bg-white/60 p-3.5">
          <p className="text-[10px] uppercase tracking-wide text-zinc-500">Watchlist</p>
          <p className="text-xl font-bold text-zinc-800">
            {p.bands.high + p.bands.elevated + p.bands.watch}
            <span className="ml-1.5 text-xs font-semibold text-rose-600">{p.bands.high} high</span>
          </p>
          <p className="text-[11px] text-zinc-500">of {p.activeLoans} active loans</p>
          <Delta now={p.bands.high} then={weekAgo?.high ?? null} fmt={(n) => `${Math.abs(Math.round(n))} high`} />
        </div>
      </div>

      {/* Band migrations since the previous run — who moved, not just how many. */}
      <div className="mt-3 flex flex-wrap gap-1.5 text-[10px] font-semibold">
        <span className="rounded-full bg-rose-100 px-2 py-0.5 text-rose-700">{movement.entered} entered the watchlist</span>
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700">{movement.left} left it</span>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">{movement.escalated} escalated a band</span>
        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-sky-700">{movement.improved} improved a band</span>
      </div>

      {/* At-risk % across the recorded runs — one series, no legend needed. */}
      {spark.length >= 2 && (
        <div className="mt-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-zinc-400">At-risk % · last {spark.length} runs</p>
          <svg viewBox={`0 0 ${spark.length * 24} 48`} className="mt-1 h-12 w-full max-w-md" preserveAspectRatio="none" role="img" aria-label="At-risk percentage trend">
            <polyline
              fill="none" stroke="#0284c7" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"
              points={spark.map((t, i) => `${i * 24 + 12},${46 - (t.atRiskPct / maxPct) * 42}`).join(" ")}
            />
            {spark.map((t, i) => (
              <circle key={t.ranAt} cx={i * 24 + 12} cy={46 - (t.atRiskPct / maxPct) * 42} r="2.5" fill="#0284c7">
                <title>{new Date(t.ranAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} — {pct(t.atRiskPct)}</title>
              </circle>
            ))}
          </svg>
        </div>
      )}
    </div>
  );
}

// ── 2 · The projection: honest arithmetic toward a target ────────────────────

function Projection({ rows, olb, atRiskValue, atRiskPct }: { rows: SlimRow[]; olb: number; atRiskValue: number; atRiskPct: number }) {
  const [target, setTarget] = useState(() => Math.max(1, Math.floor(atRiskPct) - 5));

  const plan = useMemo(() => {
    const needValue = Math.max(0, atRiskValue - (target / 100) * olb);
    if (needValue <= 0) return { needValue: 0, accounts: [] as SlimRow[], covered: 0 };
    // Freshest arrears first — a loan one week late is far more recoverable than
    // one three months late (the collections queue sorts the same way).
    const candidates = [...rows].sort((a, b) => a.dpd - b.dpd || b.balance - a.balance);
    const picked: SlimRow[] = [];
    let covered = 0;
    for (const r of candidates) {
      if (covered >= needValue) break;
      picked.push(r);
      covered += r.balance;
    }
    return { needValue, accounts: picked, covered };
  }, [rows, olb, atRiskValue, target]);

  return (
    <div className="glass mt-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Next week&apos;s number, worked backwards</h2>
        <label className="flex items-center gap-2 text-xs text-zinc-500">
          Target at-risk
          <input
            type="number" min={0} max={99} value={target}
            onChange={(e) => setTarget(Math.max(0, Math.min(99, Number(e.target.value) || 0)))}
            className="w-16 rounded-lg border border-zinc-900/15 bg-white/80 px-2 py-1.5 text-center text-sm font-bold outline-none"
          />
          %
        </label>
      </div>

      {plan.needValue <= 0 ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-emerald-700">
          <ShieldCheck className="h-4 w-4" /> You are already at or below {target}% — hold the line: the playbook below keeps it there.
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-zinc-600">
            To move from <span className="font-bold">{pct(atRiskPct)}</span> to <span className="font-bold">{target}%</span>,{" "}
            <span className="font-bold" style={{ color: "var(--brand)" }}>{kes(plan.needValue)}</span> of at-risk balance has to
            come back to schedule — that is <span className="font-bold">{plan.accounts.length} account{plan.accounts.length === 1 ? "" : "s"}</span>,
            freshest arrears first. Assumes the book itself holds still; new arrears move the target.
          </p>
          <div className="mt-3 space-y-1.5">
            {plan.accounts.slice(0, 8).map((r) => (
              <Link key={r.loanId} href={`/console/borrowers/${r.borrowerId}`}
                className="flex items-center justify-between gap-2 rounded-lg border border-zinc-900/10 bg-white/60 px-3 py-2 text-xs hover:bg-white">
                <span className="flex min-w-0 items-center gap-2">
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold ${r.band === "HIGH" ? "bg-rose-100 text-rose-700" : r.band === "ELEVATED" ? "bg-amber-100 text-amber-700" : "bg-zinc-900/5 text-zinc-600"}`}>{r.band}</span>
                  <span className="truncate font-medium text-zinc-700">{r.name}</span>
                  <span className="shrink-0 text-zinc-400">{r.dpd} dpd</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="font-bold tabular-nums" style={{ color: "var(--brand)" }}>{kes(r.balance)}</span>
                  <ArrowRight className="h-3 w-3 text-zinc-400" />
                </span>
              </Link>
            ))}
            {plan.accounts.length > 8 && <p className="text-[11px] text-zinc-400">…and {plan.accounts.length - 8} more in the collections queue, same order.</p>}
          </div>
          <Link href="/console/collections" className="mt-3 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-bold text-white" style={{ backgroundColor: "var(--brand)" }}>
            <PhoneCall className="h-3.5 w-3.5" /> Work these in Collections
          </Link>
        </>
      )}
    </div>
  );
}

// ── 3 · The default-reduction playbook ────────────────────────────────────────

const DRIVERS: { match: RegExp; title: string; action: string; href: string; icon: typeof Gauge }[] = [
  { match: /past due|missed|dues paid|trajectory/, title: "Arrears pressure", action: "Run a collections sprint — freshest arrears first, promises recorded, tickets for genuine hardship.", href: "/console/collections", icon: PhoneCall },
  { match: /model PD|credit score/i, title: "Weak origination scores", action: "Re-crunch statements at renewal and let the approved-limit wall size the next loan.", href: "/console/crunch", icon: Calculator },
  { match: /first-cycle/, title: "First-cycle concentration", action: "Point new borrowers at a smaller starter product — the ladder caps them, the product should too.", href: "/console/products", icon: Package },
  { match: /KYC not verified/, title: "Unverified identities in the book", action: "Clear the KYC queue — an unverified borrower can't be disbursed to again until they are.", href: "/console/kyc", icon: ShieldCheck },
  { match: /large exposure/, title: "Concentration risk", action: "Review the exposure weights in Model Tuning against your own book before saving.", href: "/console/intelligence/tuning", icon: SlidersHorizontal },
];

function Playbook({ rows }: { rows: SlimRow[] }) {
  const drivers = useMemo(() => {
    const counts = DRIVERS.map((d) => ({
      ...d,
      hits: rows.filter((r) => r.reasons.some((x) => d.match.test(x))).length,
      value: rows.filter((r) => r.reasons.some((x) => d.match.test(x))).reduce((s, r) => s + r.balance, 0),
    }));
    return counts.filter((d) => d.hits > 0).sort((a, b) => b.value - a.value).slice(0, 4);
  }, [rows]);

  if (drivers.length === 0) {
    return (
      <div className="glass mt-4 p-5">
        <h2 className="text-sm font-semibold">Default-reduction playbook</h2>
        <p className="mt-2 text-sm text-zinc-500">No live risk drivers — the book is performing to schedule.</p>
      </div>
    );
  }

  const maxValue = Math.max(...drivers.map((d) => d.value), 1);
  return (
    <div className="glass mt-4 p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Default-reduction playbook — what is actually driving risk</h2>
        <button data-riri-open="analytics" className="inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: "var(--brand)" }}>
          <Bot className="h-3.5 w-3.5" /> Ask Riri
        </button>
      </div>
      <div className="mt-3 space-y-2.5">
        {drivers.map((d) => (
          <div key={d.title} className="rounded-xl border border-zinc-900/10 bg-white/60 p-3.5">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-[13px] font-semibold text-zinc-800">
                <d.icon className="h-4 w-4" style={{ color: "var(--brand)" }} /> {d.title}
              </p>
              <p className="text-xs text-zinc-500"><span className="font-bold text-zinc-700">{d.hits}</span> loans · {kes(d.value)}</p>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-900/[0.06]">
              <div className="h-full rounded-full" style={{ width: `${(d.value / maxValue) * 100}%`, backgroundColor: "var(--brand)" }} />
            </div>
            <p className="mt-2 text-xs text-zinc-600">{d.action}</p>
            <Link href={d.href} className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-bold" style={{ color: "var(--brand)" }}>
              Open <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 4 · The engine fleet ──────────────────────────────────────────────────────

function Engines({ engines }: { engines: Engine[] }) {
  return (
    <div className="glass mt-4 p-5">
      <h2 className="text-sm font-semibold">The scoring fleet</h2>
      <p className="mt-0.5 text-[11px] text-zinc-500">
        Every engine, its population, and how many scores it has produced on this book. The router picks per applicant; nothing is scored twice.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {engines.map((e) => (
          <div key={e.key} className="rounded-xl border border-zinc-900/10 bg-white/60 p-3.5">
            <div className="flex items-start justify-between gap-2">
              <p className="text-[13px] font-semibold leading-tight text-zinc-800">{e.name}</p>
              <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">LIVE</span>
            </div>
            <p className="mt-1 text-[11px] leading-snug text-zinc-500">{e.role}</p>
            <div className="mt-2 flex items-center justify-between text-[10px]">
              <span className="rounded bg-zinc-900/5 px-1.5 py-0.5 font-semibold text-zinc-500">{e.population}</span>
              <span className="font-bold tabular-nums text-zinc-700">{e.count.toLocaleString()} scores</span>
            </div>
            <p className="mt-1.5 text-[10px] text-zinc-400">{e.note}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
