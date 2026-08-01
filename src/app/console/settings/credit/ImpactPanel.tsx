"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE PREVIEW PANEL — what this edit does to real people, before Publish.
//
// This is the reason the credit matrix earns a screen rather than a JSON body.
// A form can tell you that you changed 30% to 20%. Only this can tell you that
// the change moves 340 customers, takes KES 1.2m off the book, and that the
// first one it touches is a named woman whose limit falls by 4,000.
//
// Purely presentational: the page owns the debounce, the fetch and the document.
// Everything here is a function of props, which is what lets the same component
// render as a sticky rail on a laptop and a bottom sheet on a phone without a
// second request being made.
// ─────────────────────────────────────────────────────────────────────────────
import {
  Loader2, ArrowUpRight, ArrowDownRight, Minus, RefreshCw, ChevronRight, ArrowLeft,
  EyeOff, TriangleAlert, Users, Search,
} from "lucide-react";
import type { PolicyImpact, BorrowerPreview, Mover, Outcome } from "@/lib/risk/policy-impact";
import type { LadderAssessment } from "@/lib/scoring/behaviour";

export type PreviewState = "idle" | "loading" | "ready" | "error";

export type BorrowerSearch = {
  q: string;
  onQ: (v: string) => void;
  results: { id: string; name: string | null; phone: string }[];
};

const kes = (n: number) => `KES ${Math.round(n).toLocaleString("en-KE")}`;
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${kes(Math.abs(n))}`;

const MOVE_TONE: Record<string, { bg: string; fg: string; label: string }> = {
  graduate: { bg: "rgba(16,185,129,0.12)", fg: "#047857", label: "Limit rises" },
  demote: { bg: "rgba(220,38,38,0.12)", fg: "#b91c1c", label: "Limit falls" },
  hold: { bg: "rgba(15,15,25,0.06)", fg: "#4b5563", label: "Holds" },
};

function MoveChip({ move }: { move: string }) {
  const t = MOVE_TONE[move] ?? MOVE_TONE.hold;
  const Icon = move === "graduate" ? ArrowUpRight : move === "demote" ? ArrowDownRight : Minus;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
      style={{ backgroundColor: t.bg, color: t.fg }}
    >
      <Icon className="h-3 w-3" /> {t.label}
    </span>
  );
}

export function ImpactPanel({
  state, impact, detail, dirty, namesWithheld, onRefresh, onPick, search,
}: {
  state: PreviewState;
  impact: PolicyImpact | null;
  detail: BorrowerPreview | null;
  dirty: boolean;
  namesWithheld: boolean;
  onRefresh: () => void;
  onPick: (borrowerId: string | null) => void;
  /** Omitted when the caller may not read borrower data. */
  search?: BorrowerSearch;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-[color:var(--ink)]/[0.07] px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          {detail && (
            <button
              type="button"
              onClick={() => onPick(null)}
              aria-label="Back to the whole book"
              className="rounded-md p-1 text-[color:var(--ink-muted)] hover:bg-[color:var(--ink)]/[0.05] hover:text-[color:var(--ink)]"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </button>
          )}
          <p className="t-label truncate">{detail ? "One customer" : "Live preview"}</p>
          {state === "loading" && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-[color:var(--brand)]" />}
        </div>
        <button
          type="button"
          onClick={onRefresh}
          aria-label="Recalculate"
          className="rounded-md p-1 text-[color:var(--ink-muted)] hover:bg-[color:var(--ink)]/[0.05] hover:text-[color:var(--ink)]"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3">
        {state === "error" && (
          <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-2.5 py-2 text-[12px] text-amber-900">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Could not run the preview. The policy is still safe to publish — this panel is a dry run,
            not a gate.
          </p>
        )}

        {detail
          ? <BorrowerDetail detail={detail} />
          : (
            <>
              {search && <BorrowerLookup search={search} onPick={onPick} />}
              <BookImpact impact={impact} state={state} dirty={dirty} namesWithheld={namesWithheld} onPick={onPick} />
            </>
          )}
      </div>
    </div>
  );
}

/**
 * Any customer, not only the ones who move. A policy change that shifts nobody
 * still deserves the question "what does it do to HER?" — and the answer has to
 * be reachable without first finding someone the change happened to affect.
 */
function BorrowerLookup({ search, onPick }: { search: BorrowerSearch; onPick: (id: string) => void }) {
  return (
    <div className="mb-3">
      <label className="relative block">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[color:var(--ink-faint)]" />
        <input
          value={search.q}
          onChange={(e) => search.onQ(e.target.value)}
          placeholder="Try it on one customer — name, phone or ID"
          aria-label="Find a customer to preview against"
          className="w-full rounded-lg border border-[color:var(--ink)]/12 bg-white py-2 pl-8 pr-2.5 text-[12px] outline-none focus:border-[color:var(--brand)]"
        />
      </label>
      {search.results.length > 0 && (
        <ul className="mt-1 space-y-0.5 rounded-lg p-1 ring-1 ring-[color:var(--ink)]/[0.08]">
          {search.results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onPick(r.id)}
                className="w-full truncate rounded-md px-2 py-1.5 text-left text-[12px] text-[color:var(--ink-body)] hover:bg-[color:var(--ink)]/[0.05]"
              >
                <span className="font-semibold text-[color:var(--ink)]">{r.name ?? "Unnamed"}</span>
                <span className="t-meta ml-1.5 text-[11px]">{r.phone}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── The whole book ────────────────────────────────────────────────────────────

function BookImpact({
  impact, state, dirty, namesWithheld, onPick,
}: {
  impact: PolicyImpact | null;
  state: PreviewState;
  dirty: boolean;
  namesWithheld: boolean;
  onPick: (id: string) => void;
}) {
  if (!impact) {
    return (
      <p className="t-meta py-6 text-center text-[12px]">
        {state === "loading" ? "Running the matrix over your book…" : "Edit the policy to see what it would do."}
      </p>
    );
  }

  if (impact.sampled === 0) {
    return (
      <div className="py-6 text-center">
        <Users className="mx-auto h-5 w-5 text-[color:var(--ink-faint)]" />
        <p className="t-meta mt-2 text-[12px]">
          Nobody on the book has a repayment record yet, so there is nothing to preview against.
          The matrix still applies the moment your first loan is repaid.
        </p>
      </div>
    );
  }

  const bandMax = Math.max(1, ...impact.bands.flatMap((b) => [b.before, b.after]));

  return (
    <div className="space-y-4">
      {/* THE headline. Not "how many graduate" — how many END UP SOMEWHERE ELSE. */}
      <div>
        <p className="flex items-baseline gap-1.5">
          <span className="text-[2rem] font-bold leading-none tabular-nums text-[color:var(--ink)]">
            {impact.changed.toLocaleString("en-KE")}
          </span>
          <span className="t-meta text-[12px]">
            of {impact.sampled.toLocaleString("en-KE")} land somewhere else
          </span>
        </p>
        <p className="t-meta mt-1 text-[11px]">
          {dirty
            ? impact.changed === 0
              ? "Your edits change nobody's limit or band — the shape moved, the outcomes did not."
              : `Against the policy live today. Total limit change ${signed(impact.limitDelta)} across the sample.`
            : "Nothing edited yet — this is where your book stands under the live policy."}
        </p>
        {impact.truncated && (
          <p className="t-meta mt-1 text-[11px] italic">
            Sampled the {impact.sampled.toLocaleString("en-KE")} newest of {impact.book.toLocaleString("en-KE")} borrowers with a repayment record.
          </p>
        )}
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        {(["graduate", "demote", "hold"] as const).map((m) => {
          const t = MOVE_TONE[m];
          const now = impact.baselineMoves[m];
          const next = impact.moves[m];
          const d = next - now;
          return (
            <div key={m} className="rounded-lg px-2 py-2 text-center" style={{ backgroundColor: t.bg }}>
              <p className="text-[15px] font-bold leading-none tabular-nums" style={{ color: t.fg }}>{next}</p>
              <p className="mt-1 text-[9.5px] font-bold uppercase tracking-wide" style={{ color: t.fg, opacity: 0.85 }}>{t.label}</p>
              <p className="text-[10px] tabular-nums" style={{ color: t.fg, opacity: 0.7 }}>
                {d === 0 ? "no change" : `${d > 0 ? "+" : "−"}${Math.abs(d)}`}
              </p>
            </div>
          );
        })}
      </div>

      <div>
        <p className="t-label mb-1.5">Risk bands — now vs edited</p>
        <div className="space-y-1.5">
          {impact.bands.map((b) => (
            <div key={b.key} className="grid grid-cols-[5.5rem_1fr_2.6rem] items-center gap-2">
              <span className="truncate text-[11px] font-semibold text-[color:var(--ink-body)]">{b.label}</span>
              <span className="flex flex-col gap-[3px]">
                <span className="h-1.5 rounded-full bg-[color:var(--ink)]/[0.12]" style={{ width: `${(b.before / bandMax) * 100}%`, minWidth: b.before ? "3px" : 0 }} />
                <span className="h-1.5 rounded-full" style={{ width: `${(b.after / bandMax) * 100}%`, minWidth: b.after ? "3px" : 0, backgroundColor: "var(--brand)" }} />
              </span>
              <span className="text-right text-[11px] font-bold tabular-nums text-[color:var(--ink)]">
                {b.after - b.before === 0 ? "—" : `${b.after - b.before > 0 ? "+" : "−"}${Math.abs(b.after - b.before)}`}
              </span>
            </div>
          ))}
        </div>
        <p className="t-meta mt-1.5 text-[10.5px]">Grey is today, orange is the edited policy.</p>
      </div>

      <div>
        <p className="t-label mb-1.5">Who moves</p>
        {impact.movers.length === 0 ? (
          <p className="t-meta text-[12px]">Nobody — every customer lands exactly where they do today.</p>
        ) : (
          <>
            {namesWithheld && (
              <p className="t-meta mb-1.5 flex items-center gap-1 text-[10.5px]">
                <EyeOff className="h-3 w-3" /> Names withheld — your role does not include borrower access.
              </p>
            )}
            <ul className="space-y-1">
              {impact.movers.map((m) => <MoverRow key={m.borrowerId} m={m} onPick={onPick} />)}
            </ul>
            {impact.changed > impact.movers.length && (
              <p className="t-meta mt-1.5 text-[11px]">
                …and {(impact.changed - impact.movers.length).toLocaleString("en-KE")} more.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function MoverRow({ m, onPick }: { m: Mover; onPick: (id: string) => void }) {
  const up = m.limitDelta > 0;
  const flat = m.limitDelta === 0;
  return (
    <li>
      <button
        type="button"
        onClick={() => onPick(m.borrowerId)}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-[color:var(--ink)]/[0.04]"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-semibold text-[color:var(--ink)]">
            {m.name ?? m.phone ?? `Customer ${m.borrowerId.slice(0, 6)}`}
          </span>
          <span className="t-meta block truncate text-[10.5px]">
            {m.before.categoryLabel ?? "unscored"} → {m.after.categoryLabel ?? "unscored"}
            {m.scoreDelta !== 0 && ` · ${m.scoreDelta > 0 ? "+" : "−"}${Math.abs(m.scoreDelta)} pts`}
          </span>
        </span>
        <span
          className="shrink-0 text-right text-[11px] font-bold tabular-nums"
          style={{ color: flat ? "var(--ink-muted)" : up ? "#047857" : "#b91c1c" }}
        >
          {flat ? "band only" : signed(m.limitDelta)}
        </span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[color:var(--ink-faint)]" />
      </button>
    </li>
  );
}

// ── One customer ──────────────────────────────────────────────────────────────

function BorrowerDetail({ detail }: { detail: BorrowerPreview }) {
  const { before, after } = detail;
  const delta = (after.newLimit ?? after.currentLimit) - (before.newLimit ?? before.currentLimit);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[14px] font-bold text-[color:var(--ink)]">
          {detail.name ?? detail.phone ?? `Customer ${detail.borrowerId.slice(0, 6)}`}
        </p>
        <p className="t-meta text-[11px]">
          Limit today {kes(detail.currentLimit)} · {detail.loansUsed} loan{detail.loansUsed === 1 ? "" : "s"} in the window
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <SideCard title="Live policy" a={before} tone="muted" />
        <SideCard title="Edited policy" a={after} tone="brand" />
      </div>

      <p
        className="rounded-lg px-2.5 py-2 text-[12px] font-semibold"
        style={{
          backgroundColor: delta === 0 ? "rgba(15,15,25,0.04)" : delta > 0 ? "rgba(16,185,129,0.10)" : "rgba(220,38,38,0.10)",
          color: delta === 0 ? "var(--ink-body)" : delta > 0 ? "#047857" : "#b91c1c",
        }}
      >
        {delta === 0
          ? "This edit does not change what this customer is allowed to borrow."
          : `This edit ${delta > 0 ? "raises" : "lowers"} their limit by ${kes(Math.abs(delta))}.`}
      </p>

      <div>
        <p className="t-label mb-1.5">Why — under the edited policy</p>
        {after.behaviour.factors.length === 0 ? (
          <p className="t-meta text-[12px]">No factor could be measured from their record.</p>
        ) : (
          <div className="space-y-2">
            {after.behaviour.factors.map((f) => (
              <div key={f.key}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[11.5px] font-semibold text-[color:var(--ink-body)]">{f.label}</span>
                  <span className="shrink-0 text-[11px] font-bold tabular-nums text-[color:var(--ink)]">{f.raw}/100</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[color:var(--ink)]/[0.08]">
                  <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, f.raw))}%`, backgroundColor: "var(--brand)" }} />
                </div>
                <p className="t-meta mt-0.5 text-[10.5px]">
                  mostly &ldquo;{f.commonBand}&rdquo; · worth {f.weight}% of the score
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <p className="t-label mb-1">What the officer would say</p>
        <p className="text-[12px] leading-relaxed text-[color:var(--ink-body)]">{after.reason}</p>
        {before.reason !== after.reason && (
          <p className="t-meta mt-1.5 text-[11px] leading-relaxed">
            <span className="font-semibold">Today:</span> {before.reason}
          </p>
        )}
      </div>
    </div>
  );
}

function SideCard({ title, a, tone }: { title: string; a: LadderAssessment; tone: "muted" | "brand" }) {
  const o: Outcome = {
    move: a.move,
    score: a.behaviour.scored ? a.behaviour.score : null,
    categoryKey: a.behaviour.category?.key ?? null,
    categoryLabel: a.behaviour.category?.label ?? null,
    limit: a.newLimit ?? a.currentLimit,
    reason: a.reason,
  };
  return (
    <div
      className="rounded-xl px-2.5 py-2.5 ring-1"
      style={
        tone === "brand"
          ? { backgroundColor: "var(--brand-soft)", ["--tw-ring-color" as never]: "var(--brand)" }
          : { ["--tw-ring-color" as never]: "rgba(15,15,25,0.09)" }
      }
    >
      <p className="t-label">{title}</p>
      <p className="mt-1 text-[1.4rem] font-bold leading-none tabular-nums text-[color:var(--ink)]">
        {o.score === null ? "—" : o.score}
        {o.score !== null && <span className="text-[11px] font-semibold text-[color:var(--ink-faint)]">/100</span>}
      </p>
      <p className="t-meta mt-0.5 truncate text-[11px]">{o.categoryLabel ?? "Not scoreable"}</p>
      <div className="mt-1.5"><MoveChip move={o.move} /></div>
      <p className="mt-1.5 text-[12px] font-bold tabular-nums text-[color:var(--ink)]">{kes(o.limit)}</p>
    </div>
  );
}
