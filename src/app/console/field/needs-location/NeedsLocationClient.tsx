"use client";

// ─────────────────────────────────────────────────────────────────────────────
// NEEDS LOCATION — the campaign behind the location gate.
//
// A customer with no pin is invisible to routes and, once the gate is on, cannot
// be disbursed to. On a native book that is a short list of stragglers. On
// Micromart's Micro Eazy book it is EVERY customer — 17,017 of 17,017, with no
// coordinate in any of the three columns their schema carries and no usable
// address text either — and a screen that answers a number that size with a
// scrolling list has not answered it at all.
//
// So this screen is built to survive the real number. It says three things in
// order, and each one comes from the lender's own database:
//
//   1. WHERE YOU STAND. Coverage across the whole book, not the page. 0% is not a
//      figure to bury under a table.
//
//   2. WHAT TO DO FIRST. 38 customers have money out at an address nobody holds —
//      that is one afternoon of work and the only genuinely urgent part. 16,977
//      more carry a standing limit and meet the gate at their next loan; KES 110.8m
//      of approved limit sits behind it. 2 have never borrowed. Triage is the
//      screen's spine, not a filter tucked in a corner.
//
//   3. WHAT IT COSTS TO FINISH. Their book already assigns every customer to one of
//      169 named officers, so the backlog shards into real queues, and the planner
//      turns officers × pins-per-day into a date. Against that sits the honest
//      alternative: 2,211 customers came back to borrow in twelve months and would
//      have been pinned at application for free — which clears this backlog in
//      years, not weeks. Both numbers are shown. The lender picks.
//
// Every row opens through the resolve step, because the pin has to land somewhere
// and a live `ss:` ref has no local record yet.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useLoad } from "@/lib/hooks/useLoad";
import {
  AlertTriangle, MapPinOff, MapPin, CheckCircle2, ShieldAlert, Loader2, Search, X,
  ChevronLeft, ChevronRight, RadioTower, RotateCw, Users, CalendarClock, Wallet,
  TrendingUp, UserCheck, ChevronDown,
} from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";
import { BorrowerAvatar } from "@/components/kyc/BorrowerAvatar";
import { planCampaign, humanDuration, TIER_META, type TierKey } from "@/lib/field/campaign";

type Customer = {
  id: string;
  serviceSuiteId: number | null;
  name: string;
  phone: string;
  nationalId: string | null;
  portraitUrl: string | null;
  tier: TierKey;
  verified: boolean;
  activeLoans: number;
  olb: number;
  clearedLoans: number;
  loanLimit: number | null;
  creditScore: number | null;
  riskCategory: string | null;
  graduationCount: number;
  dueInDays: number | null;
  agentId: number | null;
  agentName: string | null;
  since: string | null;
};

type Stats = {
  total: number; pinned: number; unpinned: number;
  moneyOutCustomers: number; moneyOutOlb: number;
  repeatCustomers: number; repeatLimit: number;
  dormantCustomers: number;
  agentQueues: number;
  unpinnedKycVerified: number; unpinnedScored: number;
  limitBehindGate: number;
  returning12m: number; activeMonths12m: number;
};

type Queue = { agentId: number; agentName: string | null; customers: number; moneyOut: number; olb: number; limitBehindGate: number };

const PAGE_SIZE = 10;

const fmtNum = (n: number) => n.toLocaleString();
const fmtKES = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
/** Hero figures only. A board reads "KES 110.8M"; it does not read nine digits. */
const compactKES = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e9) return `KES ${(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `KES ${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `KES ${Math.round(n / 1e3)}K`;
  return `KES ${Math.round(n)}`;
};

function pageWindow(page: number, count: number): number[] {
  const start = Math.max(0, Math.min(page - 2, count - 5));
  return Array.from({ length: Math.min(5, count) }, (_, i) => start + i);
}

/** "in 20 days" · "23 days past due" · null when nothing is owed. */
function dueLabel(days: number | null): { text: string; overdue: boolean } | null {
  if (days == null || !Number.isFinite(days)) return null;
  if (days < 0) return { text: `${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"} past due`, overdue: true };
  if (days === 0) return { text: "due today", overdue: true };
  return { text: `due in ${days} ${days === 1 ? "day" : "days"}`, overdue: false };
}

// ── Coverage ─────────────────────────────────────────────────────────────────
// The headline. A progress bar at 0% is a strange thing to draw, so this draws the
// GAP instead: the unpinned share is the filled part, in the colour of a warning,
// and the pinned share is what has to grow. It reads correctly at 0% and at 97%.
function CoverageHero({ stats, live, entityId }: { stats: Stats; live: boolean; entityId: number | null }) {
  const pct = stats.total > 0 ? (stats.pinned / stats.total) * 100 : 0;
  const complete = stats.unpinned === 0;

  return (
    <section className="glass mt-4 overflow-hidden">
      <div className="grid gap-5 p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-8">
        <div className="min-w-0">
          <p className="t-label">Location coverage</p>
          <div className="mt-1 flex flex-wrap items-end gap-x-3 gap-y-1">
            <span
              className="t-num text-4xl font-bold leading-none tracking-tight"
              style={{ color: complete ? "#047857" : "var(--ink)" }}
            >
              {pct < 1 && pct > 0 ? pct.toFixed(1) : Math.round(pct)}%
            </span>
            <span className="t-body pb-0.5 text-[13px]">
              of the book is pinned — <span className="t-num font-semibold">{fmtNum(stats.pinned)}</span> of{" "}
              <span className="t-num font-semibold">{fmtNum(stats.total)}</span>
            </span>
          </div>

          {/* The bar. Pinned is brand, the gap is amber — so an empty book looks
              like work outstanding rather than a loading state. */}
          <div className="mt-3.5 h-2.5 w-full overflow-hidden rounded-full bg-amber-200/70" role="img"
               aria-label={`${Math.round(pct)} percent of customers have a location on file`}>
            <div className="h-full rounded-full transition-[width] duration-700 ease-out"
                 style={{ width: `${Math.max(pct, 0)}%`, backgroundColor: "var(--brand)" }} />
          </div>

          <p className="t-body mt-3 text-[13px]">
            {complete ? (
              <>Every customer on this book has a location. Nobody is missing from your routes.</>
            ) : (
              <>
                <span className="font-semibold" style={{ color: "var(--ink)" }}>
                  {fmtNum(stats.unpinned)} customer{stats.unpinned === 1 ? "" : "s"} cannot be routed or disbursed to.
                </span>{" "}
                {live
                  ? "Read live from the lender's own system — this is their book as it stands right now."
                  : "Counted across your whole book, not the rows on this page."}
              </>
            )}
          </p>
        </div>

        {/* The two numbers that make the gap matter. */}
        <div className="grid shrink-0 grid-cols-2 gap-2 sm:w-[19rem]">
          <div className="rounded-xl border border-rose-200/80 bg-rose-50/60 px-3 py-2.5">
            <p className="t-label flex items-center gap-1 text-rose-700/80"><Wallet className="h-3 w-3" aria-hidden /> Money out</p>
            <p className="t-num mt-1 text-lg font-bold leading-none text-rose-700">{compactKES(stats.moneyOutOlb)}</p>
            <p className="t-meta mt-1 text-[11px] leading-tight text-rose-700/70">
              across {fmtNum(stats.moneyOutCustomers)} unpinned customer{stats.moneyOutCustomers === 1 ? "" : "s"}
            </p>
          </div>
          <div className="rounded-xl border border-amber-200/80 bg-amber-50/60 px-3 py-2.5">
            <p className="t-label flex items-center gap-1 text-amber-800/80"><TrendingUp className="h-3 w-3" aria-hidden /> Behind the gate</p>
            <p className="t-num mt-1 text-lg font-bold leading-none text-amber-800">{compactKES(stats.limitBehindGate)}</p>
            <p className="t-meta mt-1 text-[11px] leading-tight text-amber-800/70">approved limit awaiting a pin</p>
          </div>
        </div>
      </div>

      {live && (
        <p className="t-meta flex items-center gap-1.5 border-t border-ash-900/[0.06] px-5 py-2">
          <RadioTower className="h-3.5 w-3.5" style={{ color: "var(--brand)" }} aria-hidden />
          Live connection{entityId != null ? ` · entity ${entityId}` : ""} · coverage checked against every location column on their schema
        </p>
      )}
    </section>
  );
}

// ── Triage ───────────────────────────────────────────────────────────────────
function TierTabs({
  stats, tier, onTier,
}: { stats: Stats; tier: TierKey | ""; onTier: (t: TierKey | "") => void }) {
  const counts: Record<TierKey, { n: number; money: string }> = {
    MONEY_OUT: { n: stats.moneyOutCustomers, money: fmtKES(stats.moneyOutOlb) + " out" },
    REPEAT: { n: stats.repeatCustomers, money: compactKES(stats.repeatLimit) + " of limit" },
    DORMANT: { n: stats.dormantCustomers, money: "no exposure" },
  };

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => onTier("")}
          aria-pressed={tier === ""}
          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
            tier === "" ? "text-white" : "border border-ash-900/10 bg-paper/70 text-ash-600 hover:bg-paper"
          }`}
          style={tier === "" ? { backgroundColor: "var(--brand)" } : undefined}
        >
          Everyone · {fmtNum(stats.unpinned)}
        </button>
        {(Object.keys(TIER_META) as TierKey[]).map((k) => {
          const meta = TIER_META[k];
          const on = tier === k;
          return (
            <button
              key={k}
              onClick={() => onTier(on ? "" : k)}
              aria-pressed={on}
              title={meta.blurb}
              className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors"
              style={{
                borderColor: on ? meta.tone.ring : "rgba(24,24,27,0.10)",
                backgroundColor: on ? meta.tone.soft : "rgba(255,255,255,0.70)",
                color: on ? meta.tone.ink : "#52525b",
              }}
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: meta.tone.dot }} aria-hidden />
              {meta.short} · <span className="t-num">{fmtNum(counts[k].n)}</span>
            </button>
          );
        })}
      </div>
      <p className="t-meta mt-2">
        {tier ? TIER_META[tier].blurb : "Worked in that order: live exposure first, then the biggest limit waiting on the gate."}
        {tier && <> · <span className="t-num">{counts[tier].money}</span></>}
      </p>
    </div>
  );
}

// ── The plan ─────────────────────────────────────────────────────────────────
// Officers × pins-per-day → a date. The arithmetic lives in lib/field/campaign so
// it can be read and tested without a browser; this is only its dials.
function CampaignPlanner({ stats, backlog }: { stats: Stats; backlog: number }) {
  // Default to the queues their book already has, so the first answer on screen is
  // the one that needs no new hiring. A native book has none — six is a small team.
  const [officers, setOfficers] = useState(() => Math.max(stats.agentQueues || 6, 1));
  const [rate, setRate] = useState(8);

  const organicPerMonth = stats.returning12m > 0 ? stats.returning12m / 12 : 0;
  const plan = useMemo(
    () => planCampaign({ backlog, officers, pinsPerOfficerPerDay: rate, daysPerWeek: 6, organicPerMonth }),
    [backlog, officers, rate, organicPerMonth],
  );

  const finish = plan.finishesOn.toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });

  return (
    <section className="glass mt-3 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="t-section flex items-center gap-2">
          <CalendarClock className="h-4 w-4" style={{ color: "var(--brand)" }} aria-hidden />
          What it takes to finish
        </h2>
        <p className="t-meta">{fmtNum(backlog)} pins to capture</p>
      </div>

      <div className="mt-4 grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-8">
        <div className="min-w-0 space-y-4">
          <Dial
            label="Officers on the list"
            value={officers}
            min={1}
            max={Math.max(stats.agentQueues || 0, 40)}
            onChange={setOfficers}
            hint={
              stats.agentQueues > 0
                ? `Their book already assigns every customer to one of ${fmtNum(stats.agentQueues)} officers`
                : "No upstream officer assignment on this book"
            }
            suffix={officers === 1 ? "officer" : "officers"}
          />
          <Dial
            label="Pins per officer per day"
            value={rate}
            min={1}
            max={40}
            onChange={setRate}
            hint="Captured on a visit the officer was already making, or on a dedicated round"
            suffix="per day"
          />
        </div>

        <div className="shrink-0 sm:w-[15rem]">
          <div className="rounded-xl px-4 py-3.5" style={{ backgroundColor: "rgba(24,24,27,0.035)" }}>
            <p className="t-label">Book covered in</p>
            <p className="t-num mt-1 text-2xl font-bold leading-none" style={{ color: "var(--ink)" }}>
              {humanDuration(plan.workingDays)}
            </p>
            <p className="t-meta mt-1.5 text-[11px] leading-tight">
              {fmtNum(plan.workingDays)} working days · six-day week
            </p>
            <p className="t-body mt-2.5 text-[13px] font-semibold" style={{ color: "var(--brand)" }}>
              by {finish}
            </p>
            <p className="t-meta mt-2 border-t border-ash-900/[0.07] pt-2 text-[11px] leading-tight">
              <span className="t-num font-semibold">{fmtNum(plan.perOfficer)}</span> customers each ·{" "}
              <span className="t-num font-semibold">{fmtNum(Math.round(plan.perDay))}</span> pins a day as a team
            </p>
          </div>
        </div>
      </div>

      {/* Coverage over the first twelve weeks — real percentages of a real backlog. */}
      <div className="mt-4 border-t border-ash-900/[0.06] pt-3.5">
        <p className="t-label">Coverage by week</p>
        <div className="mt-2 flex items-end gap-2">
          {plan.curve.map((p) => (
            <div key={p.week} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <div className="flex h-14 w-full items-end overflow-hidden rounded-md bg-ash-900/[0.05]">
                <div
                  className="w-full rounded-md transition-[height] duration-500"
                  style={{ height: `${Math.max(p.pct, 1.5)}%`, backgroundColor: p.pct >= 99.5 ? "#059669" : "var(--brand)" }}
                />
              </div>
              <span className="t-num text-[11px] font-semibold" style={{ color: "var(--ink)" }}>
                {p.pct >= 99.5 ? "100%" : `${p.pct < 10 ? p.pct.toFixed(1) : Math.round(p.pct)}%`}
              </span>
              <span className="t-meta text-[10px] leading-none">wk {p.week}</span>
            </div>
          ))}
        </div>
      </div>

      {/* The do-nothing option, stated plainly. It is the honest comparison, and on
          a quiet book it is the argument FOR the campaign rather than against it. */}
      {stats.returning12m > 0 && (
        <p className="t-meta mt-3.5 border-t border-ash-900/[0.06] pt-3 leading-relaxed">
          <span className="font-semibold" style={{ color: "var(--ink)" }}>Or wait for them.</span>{" "}
          <span className="t-num">{fmtNum(stats.returning12m)}</span> of these customers came back to borrow in the last
          twelve months{stats.activeMonths12m > 0 && stats.activeMonths12m < 12 ? ` (across ${stats.activeMonths12m} months of lending)` : ""} —
          each one would have been pinned at application, at no cost.{" "}
          {plan.organicOnlyMonths != null && (
            <>At that rate alone the backlog clears in{" "}
              <span className="font-semibold" style={{ color: "var(--ink)" }}>
                {plan.organicOnlyMonths >= 24 ? `${(plan.organicOnlyMonths / 12).toFixed(1)} years` : `${plan.organicOnlyMonths} months`}
              </span>, which is why the {fmtNum(stats.moneyOutCustomers)} with money out are worth chasing now.
            </>
          )}
        </p>
      )}
    </section>
  );
}

function Dial({
  label, value, min, max, onChange, hint, suffix,
}: { label: string; value: number; min: number; max: number; onChange: (n: number) => void; hint: string; suffix: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label className="t-label" htmlFor={`dial-${label}`}>{label}</label>
        <span className="t-num text-sm font-bold" style={{ color: "var(--ink)" }}>
          {fmtNum(value)} <span className="t-meta font-normal">{suffix}</span>
        </span>
      </div>
      <input
        id={`dial-${label}`}
        type="range"
        min={min}
        max={max}
        value={Math.min(value, max)}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full accent-[var(--brand)]"
        style={{ accentColor: "var(--brand)" }}
      />
      <p className="t-meta mt-1 text-[11px] leading-tight">{hint}</p>
    </div>
  );
}

// ── Officer queues ───────────────────────────────────────────────────────────
// The backlog is unassignable as one list of 17,017 and entirely assignable as 169
// queues. That split is the lender's own (Borrowers.EntityAgent), not ours.
function QueuePanel({
  queues, agentId, onAgent,
}: { queues: Queue[]; agentId: number; onAgent: (id: number) => void }) {
  const [open, setOpen] = useState(false);
  const shown = open ? queues : queues.slice(0, 6);
  const selected = queues.find((q) => q.agentId === agentId) ?? null;

  return (
    <section className="glass mt-3 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="t-section flex items-center gap-2">
          <UserCheck className="h-4 w-4" style={{ color: "var(--brand)" }} aria-hidden />
          Officer queues
        </h2>
        <p className="t-meta">
          {fmtNum(queues.length)} officers already carry this book · money out first
        </p>
      </div>

      {selected && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-ash-900/10 bg-paper/70 px-3 py-2">
          <p className="t-body min-w-0 flex-1 text-[13px]">
            Showing <span className="font-semibold">{selected.agentName ?? `officer ${selected.agentId}`}</span>&rsquo;s
            queue — <span className="t-num">{fmtNum(selected.customers)}</span> customers,{" "}
            <span className="t-num">{fmtNum(selected.moneyOut)}</span> with money out
          </p>
          <button onClick={() => onAgent(0)} className="inline-flex shrink-0 items-center gap-1 rounded-md border border-ash-900/10 px-2 py-1 text-xs font-semibold text-ash-600 hover:bg-paper">
            <X className="h-3 w-3" aria-hidden /> Clear
          </button>
        </div>
      )}

      <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
        {shown.map((qq) => {
          const on = qq.agentId === agentId;
          return (
            <li key={qq.agentId}>
              <button
                onClick={() => onAgent(on ? 0 : qq.agentId)}
                aria-pressed={on}
                className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                  on ? "border-ash-900/20 bg-paper" : "border-ash-900/[0.08] bg-paper/60 hover:bg-paper/90"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="t-body truncate text-[13px] font-semibold">{qq.agentName ?? `Officer ${qq.agentId}`}</p>
                  <p className="t-meta text-[11px]">
                    <span className="t-num">{fmtNum(qq.customers)}</span> to pin
                    {qq.limitBehindGate > 0 && <> · <span className="t-num">{compactKES(qq.limitBehindGate)}</span> of limit</>}
                  </p>
                </div>
                {qq.moneyOut > 0 && (
                  <span className="t-num shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                    {qq.moneyOut} out
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {queues.length > 6 && (
        <button
          onClick={() => setOpen((v) => !v)}
          className="t-meta mt-2.5 inline-flex items-center gap-1 font-semibold hover:underline"
          style={{ color: "var(--brand)" }}
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
          {open ? "Show fewer" : `Show all ${fmtNum(queues.length)} officers`}
        </button>
      )}
    </section>
  );
}

// ── Rows ─────────────────────────────────────────────────────────────────────
function SkeletonRows() {
  return (
    <div className="mt-3 space-y-2" aria-hidden>
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="glass flex items-center gap-3 p-3.5">
          <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-ash-900/10" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3 animate-pulse rounded bg-ash-900/10" style={{ width: `${34 + ((i * 13) % 28)}%` }} />
            <div className="h-2.5 animate-pulse rounded bg-ash-900/[0.07]" style={{ width: `${50 + ((i * 9) % 24)}%` }} />
          </div>
          <div className="h-8 w-24 shrink-0 animate-pulse rounded-lg bg-ash-900/[0.07]" />
        </div>
      ))}
    </div>
  );
}

function CustomerRow({ c }: { c: Customer }) {
  const meta = TIER_META[c.tier];
  const due = dueLabel(c.dueInDays);
  // A live row has no local record yet, so it opens through the resolver, which
  // seeds one and hands off. `drop=location` survives the hop and is what makes
  // Customer 360 open straight onto the pin.
  const href = c.id.startsWith("ss:")
    ? `/console/borrowers/resolve/${encodeURIComponent(c.id)}?drop=location`
    : `/console/borrowers/${c.id}?drop=location`;

  return (
    <li>
      <Link href={href} className="glass block p-3.5 transition-colors hover:bg-paper/85">
        <div className="flex flex-wrap items-center gap-3">
          <span className="relative shrink-0">
            <BorrowerAvatar name={c.name} portraitUrl={c.portraitUrl} verified={c.verified} size="sm" />
            <span
              className="absolute -bottom-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full ring-2 ring-white"
              style={{ backgroundColor: meta.tone.dot }}
              title={meta.label}
            >
              <MapPinOff className="h-2.5 w-2.5 text-white" aria-hidden />
            </span>
          </span>

          <div className="min-w-0 flex-1">
            <p className="t-section flex items-center gap-2 sm:truncate">
              <span className="truncate">{c.name}</span>
              {!c.verified && <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-label="Not KYC verified" />}
              {c.graduationCount > 0 && (
                <span className="t-num shrink-0 rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                  {c.graduationCount}× graduated
                </span>
              )}
            </p>
            <p className="t-meta sm:truncate">
              <span className="t-num">{c.phone}</span>
              {c.nationalId && <> · ID <span className="t-num">{c.nationalId}</span></>}
              {c.creditScore != null && <> · score <span className="t-num font-semibold">{c.creditScore}</span></>}
              {c.agentName && <> · {c.agentName}</>}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-4 text-right">
            {c.tier === "MONEY_OUT" ? (
              <div>
                <p className="t-label">Out now</p>
                <p className="t-num text-sm font-bold text-rose-700">{fmtKES(c.olb)}</p>
                {due && (
                  <p className={`t-meta text-[10px] leading-none ${due.overdue ? "font-semibold text-rose-700" : ""}`}>{due.text}</p>
                )}
              </div>
            ) : (
              <div>
                <p className="t-label">{c.loanLimit ? "Limit" : "Cleared"}</p>
                <p className="t-num text-sm font-bold" style={{ color: "var(--ink)" }}>
                  {c.loanLimit ? fmtKES(c.loanLimit) : `${c.clearedLoans} loans`}
                </p>
              </div>
            )}
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
              style={{ backgroundColor: "var(--brand)" }}
            >
              <MapPin className="h-3.5 w-3.5" aria-hidden /> Drop pin
            </span>
          </div>
        </div>
      </Link>
    </li>
  );
}

// ── The screen ───────────────────────────────────────────────────────────────
export function NeedsLocationClient() {
  const [rows, setRows] = useState<Customer[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [queues, setQueues] = useState<Queue[] | null>(null);
  const [total, setTotal] = useState(0);
  const [source, setSource] = useState<string | null>(null);
  const [entityId, setEntityId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [q, setQ] = useState("");
  const [needle, setNeedle] = useState("");
  const [tier, setTier] = useState<TierKey | "">("");
  const [agentId, setAgentId] = useState(0);
  const [page, setPage] = useState(0);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        take: String(PAGE_SIZE),
        skip: String(page * PAGE_SIZE),
      });
      if (needle) params.set("q", needle);
      if (tier) params.set("tier", tier);
      if (agentId) params.set("agent", String(agentId));

      const res = await fetch(`/api/console/field/needs-location?${params}`);
      const d = await res.json();
      if (!d.success) { setError(d.message || "Could not load the list."); return; }
      setRows(d.customers ?? []);
      setTotal(typeof d.total === "number" ? d.total : (d.customers?.length ?? 0));
      setSource(d.source ?? null);
      setEntityId(typeof d.entityId === "number" ? d.entityId : null);
      // Whole-book context arrives once, on the unfiltered first page. Keep what we
      // were given rather than blanking it when a filter narrows the view.
      if (d.stats) setStats(d.stats as Stats);
      if (d.queues) setQueues(d.queues as Queue[]);
    } catch {
      setError("Could not reach the list.");
    } finally {
      setBusy(false);
    }
  }, [needle, tier, agentId, page]);
  useLoad(load, [needle, tier, agentId, page]);

  // Debounce the box in the HANDLER rather than an effect, so there is no
  // setState-in-effect to reason about, and reset paging when the query actually
  // changes — asking for page 7 of a one-page result is the classic version of
  // this bug. The timer lives in a ref because the handler is recreated on render.
  const timer = useRef<number | undefined>(undefined);
  const lastNeedle = useRef("");
  const onSearch = useCallback((v: string) => {
    setQ(v);
    const t = v.trim();
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (lastNeedle.current === t) return;
      lastNeedle.current = t;
      setNeedle(t);
      setPage(0);
    }, 350);
  }, []);

  const setTierAndReset = (t: TierKey | "") => { setTier(t); setPage(0); };
  const setAgentAndReset = (id: number) => { setAgentId(id); setPage(0); };

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min((page + 1) * PAGE_SIZE, total);
  const live = source === "servicesuite";
  const filtered = Boolean(needle || tier || agentId);
  const done = stats != null && stats.unpinned === 0;

  return (
    <main className="mx-auto max-w-5xl px-4 sm:px-6 py-8">
      <PageHeader
        icon={MapPinOff}
        title="Needs location"
        subtitle="Every customer with no pin on file — missing from your routes, and blocked from disbursement until an officer drops it. Worked worst first."
      >
        <Link href="/console/field" className="inline-flex items-center gap-1.5 rounded-lg border border-ash-900/15 bg-paper/70 px-3.5 py-2 text-xs font-semibold text-ash-700 hover:bg-paper">
          <Users className="h-3.5 w-3.5" aria-hidden /> Visits &amp; routes
        </Link>
      </PageHeader>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50/90 px-3 py-2.5 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span className="flex-1">{error}</span>
          <button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-red-300 px-2 py-1 text-xs font-semibold hover:bg-red-100">
            <RotateCw className="h-3 w-3" aria-hidden /> Retry
          </button>
        </div>
      )}

      {stats && <CoverageHero stats={stats} live={live} entityId={entityId} />}

      {done ? (
        <div className="mt-3 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5 text-sm text-emerald-800">
          <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-600" aria-hidden />
          <div>
            <p className="font-semibold">Every customer on your book has a location.</p>
            <p className="mt-0.5 text-emerald-700">Nobody is missing from your routes.</p>
          </div>
        </div>
      ) : (
        <>
          {stats && <CampaignPlanner stats={stats} backlog={stats.unpinned} />}
          {queues && queues.length > 1 && <QueuePanel queues={queues} agentId={agentId} onAgent={setAgentAndReset} />}
          {stats && <TierTabs stats={stats} tier={tier} onTier={setTierAndReset} />}
        </>
      )}

      {!done && (
        <>
          <div className="mt-3 flex max-w-md items-center gap-2 rounded-lg border border-ash-900/15 bg-paper/80 px-3">
            <Search className={`h-4 w-4 shrink-0 ${busy ? "animate-pulse text-ash-500" : "text-ash-400"}`} aria-hidden />
            <input
              value={q}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Search phone, ID or name…"
              aria-label="Search customers needing a location"
              className="flex-1 bg-transparent py-2.5 text-sm outline-none placeholder:text-ash-400"
            />
            {q && (
              <button onClick={() => onSearch("")} aria-label="Clear search" className="shrink-0 rounded p-1 text-ash-400 hover:text-ash-700">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <p className="t-meta mt-2.5 flex items-center gap-1.5">
            {busy && rows && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
            {rows == null
              ? "Loading…"
              : filtered
                ? `${fmtNum(total)} ${total === 1 ? "customer" : "customers"} in this view`
                : `${fmtNum(total)} to capture`}
          </p>

          {!rows && !error && <SkeletonRows />}

          {rows?.length === 0 && !error && (
            <div className="glass mt-3 px-6 py-12 text-center">
              <p className="t-section">Nothing in this view</p>
              <p className="t-meta mx-auto mt-1.5 max-w-sm">
                {filtered ? "Clear the filters, or search by mobile number, national ID, or any part of a name." : "No customer here is missing a location."}
              </p>
            </div>
          )}

          <ul className={`mt-3 space-y-2 transition-opacity ${busy && rows ? "opacity-60" : "opacity-100"}`}>
            {rows?.map((c) => <CustomerRow key={c.id} c={c} />)}
          </ul>

          {total > PAGE_SIZE && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="t-meta t-num">{fmtNum(from)}–{fmtNum(to)} of {fmtNum(total)}</p>
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

          {/* Two gates, not one. Saying only "no location" would let a lender think a
              pinning campaign alone opens the book — on this entity nobody is KYC
              verified either, and that is the other thing standing between these
              customers and a disbursement. */}
          {stats && stats.unpinnedKycVerified === 0 && stats.unpinned > 0 && (
            <p className="t-meta mt-4 flex items-start gap-1.5 leading-relaxed">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />
              <span>
                None of these <span className="t-num">{fmtNum(stats.unpinned)}</span> customers is KYC verified in the
                lender&rsquo;s system either, though all{" "}
                <span className="t-num">{fmtNum(stats.unpinnedScored)}</span> carry a credit score. A pin clears the
                location gate; identity verification is the second one, and the officer can capture both on the same visit.
              </span>
            </p>
          )}
        </>
      )}
    </main>
  );
}
