"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE CHART BUILDER — tick the columns, get a chart, and be told why not.
//
// The columns of the book, grouped by the thing they describe: a borrower, a
// loan, a product, a payment. Tick what you want to see. The builder works out
// what can honestly be drawn from that selection and offers exactly those forms
// — and for every form it cannot offer, it says WHY, in a sentence that tells
// you what to pick instead.
//
// ── THE REFUSALS ARE THE PRODUCT ─────────────────────────────────────────────
// Every self-service tool lets somebody build a pie chart of average interest
// rate by month. It renders. It is meaningless. The refusal is not friction —
// it is the difference between a tool people trust and a tool that produced the
// slide nobody could defend in the meeting.
//
// So the unavailable forms are SHOWN, greyed, with their reason attached, rather
// than hidden. "Donut shows parts of a whole, and average loan size is an
// average — the parts do not add up to anything" teaches somebody how charts
// work. A missing button teaches them nothing.
//
// ── STATE LIVES IN THE URL ───────────────────────────────────────────────────
// Ticking a field is a navigation, so the finished chart is a link somebody can
// send. That is the entire reason to build this rather than export to Excel:
// a finding that cannot be shared with its provenance intact turns into a
// screenshot, and a screenshot cannot be checked.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Check, Ban, CircleCheck, Info, RotateCcw, Loader2, Hash, Tag, CalendarDays, ListOrdered } from "lucide-react";
import {
  FIELDS, fieldsBySource, field, isMeasure, isDimension, checkPlot, guidance,
  SOURCE_LABEL, SOURCE_BLURB, type Field,
} from "@/lib/analytics/fields";
import { buildQuery } from "@/lib/analytics/params";
import { VizPanel, type VizForm, type VizRow } from "./viz/VizPanel";
import { STATUS } from "./viz/theme";

const ROLE_ICON = {
  measure: Hash,
  dimension: Tag,
  ordinal: ListOrdered,
  temporal: CalendarDays,
} as const;

const ROLE_HINT = {
  measure: "A number — goes up the y axis",
  dimension: "A category — splits the chart",
  ordinal: "An ordered category — keeps its order",
  temporal: "A date — goes along the x axis",
} as const;

export default function ChartBuilder({
  rows,
  /** How many distinct categories the current dimension actually returned. */
  categoryCount,
  /** Set when the selection could not be queried — the server says why. */
  serverNote,
}: {
  rows: VizRow[];
  categoryCount: number;
  serverNote?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();

  const current = useMemo(() => new URLSearchParams(sp.toString()), [sp]);
  const picked = useMemo(() => (current.get("f") ?? "").split(",").filter(Boolean), [current]);
  const chosenForm = current.get("form") as VizForm | null;

  const go = (patch: Record<string, string | string[] | null>) => {
    startTransition(() => router.push(`${pathname}${buildQuery(current, patch)}`, { scroll: false }));
  };

  const toggleField = (key: string) => {
    const next = picked.includes(key) ? picked.filter((k) => k !== key) : [...picked, key];
    // Dropping the last field also drops the form, so the builder does not
    // re-open on a chart type that no longer applies to anything.
    go({ f: next, form: next.length === 0 ? null : chosenForm });
  };

  const chosen = picked.map(field).filter((f): f is Field => !!f);
  const dims = chosen.filter(isDimension);
  const measures = chosen.filter(isMeasure);

  const verdicts = checkPlot({ fields: picked, categoryCount });
  const available = verdicts.filter((v) => v.ok);
  const blocked = verdicts.filter((v) => !v.ok);
  const guide = guidance({ fields: picked, categoryCount });

  // The form actually drawn: the reader's choice if it is still legal, otherwise
  // the recommended one. A selection change that invalidates the current form
  // must not leave a broken chart on screen.
  const activeForm: VizForm | null =
    (chosenForm && available.some((v) => v.form === chosenForm) ? chosenForm : null) ??
    available.find((v) => v.recommended)?.form ??
    available[0]?.form ??
    null;

  const series = measures.map((m) => ({ key: m.key, label: m.label, format: m.format }));

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      {/* ── The column picker ────────────────────────────────────────────── */}
      <aside className="rounded-2xl border border-ash-900/10 bg-paper">
        <div className="flex items-center justify-between border-b border-ash-900/[0.07] px-4 py-3">
          <div>
            <p className="text-[12px] font-bold text-ash-800">Columns</p>
            <p className="text-[10px] text-ash-500">{picked.length} selected</p>
          </div>
          {picked.length > 0 && (
            <button
              type="button"
              onClick={() => go({ f: null, form: null })}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold text-ash-500 hover:bg-ash-900/5"
            >
              <RotateCcw className="h-3 w-3" /> Reset
            </button>
          )}
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-2">
          {fieldsBySource().map(({ source, fields }) => (
            <div key={source} className="mb-2">
              <p className="px-2 pb-1 pt-2 text-[9px] font-bold uppercase tracking-[0.12em] text-ash-400">
                {SOURCE_LABEL[source]}
              </p>
              <p className="px-2 pb-1.5 text-[10px] leading-snug text-ash-400">{SOURCE_BLURB[source]}</p>
              {fields.map((f) => {
                const on = picked.includes(f.key);
                const Icon = ROLE_ICON[f.role];
                return (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => toggleField(f.key)}
                    title={`${f.hint} — ${ROLE_HINT[f.role]}`}
                    className={`mb-0.5 flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
                      on ? "bg-violet-50 ring-1 ring-violet-200" : "hover:bg-ash-900/[0.04]"
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                        on ? "border-violet-600 bg-violet-600" : "border-ash-300"
                      }`}
                    >
                      {on && <Check className="h-2.5 w-2.5 text-white" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1">
                        <Icon className="h-2.5 w-2.5 shrink-0 text-ash-400" />
                        <span className={`truncate text-[12px] ${on ? "font-semibold text-violet-900" : "text-ash-700"}`}>
                          {f.label}
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate text-[10px] leading-snug text-ash-400">{f.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* The legend for the column list itself — four roles, four icons. */}
        <div className="border-t border-ash-900/[0.07] px-4 py-2.5">
          {(Object.keys(ROLE_ICON) as Array<keyof typeof ROLE_ICON>).map((r) => {
            const Icon = ROLE_ICON[r];
            return (
              <p key={r} className="flex items-center gap-1.5 py-0.5 text-[10px] text-ash-500">
                <Icon className="h-2.5 w-2.5 text-ash-400" /> {ROLE_HINT[r]}
              </p>
            );
          })}
        </div>
      </aside>

      {/* ── The chart and the coaching ───────────────────────────────────── */}
      <div className="min-w-0 space-y-3">
        {/* The one-line guide. Says what to do next, never just "invalid". */}
        <div
          className="flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-[12px] leading-snug ring-1"
          style={{
            backgroundColor: guide.tone === "warn" ? `${STATUS.warning}12` : guide.tone === "ok" ? `${STATUS.good}0d` : "rgba(15,15,25,0.03)",
            color: guide.tone === "warn" ? "#8a5a00" : guide.tone === "ok" ? "#0a6b0a" : "#52514e",
            ["--tw-ring-color" as never]: guide.tone === "warn" ? `${STATUS.warning}44` : guide.tone === "ok" ? `${STATUS.good}33` : "rgba(15,15,25,0.07)",
          }}
        >
          {guide.tone === "ok" ? <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
          <span>{guide.text}</span>
          {pending && <Loader2 className="ml-auto h-3.5 w-3.5 shrink-0 animate-spin opacity-60" />}
        </div>

        {serverNote && (
          <p className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-[12px] text-amber-800 ring-1 ring-amber-200">{serverNote}</p>
        )}

        {/* The chart. */}
        {activeForm && dims.length === 1 && measures.length > 0 ? (
          <VizPanel
            key={activeForm}
            title={`${measures.map((m) => m.label).join(" and ")} by ${dims[0].label.toLowerCase()}`}
            subtitle={
              measures.length === 1
                ? measures[0].hint
                : `${measures.length} measures on one axis — they share a scale, so read the shapes rather than the exact heights.`
            }
            data={rows}
            series={series}
            forms={[activeForm]}
            format={measures[0].format}
            height={340}
            emptyHint="Nothing matched this cut. Widen the date range or clear a filter."
          />
        ) : (
          <div className="flex h-56 items-center justify-center rounded-2xl border border-dashed border-ash-900/15 bg-paper px-6 text-center">
            <p className="max-w-sm text-[13px] leading-snug text-ash-500">
              {dims.length === 0
                ? "Pick one column to split by — a branch, a product, a risk band, a date."
                : dims.length > 1
                  ? "Keep one column to split by. Two category axes cannot share one chart."
                  : "Now pick a number to plot."}
            </p>
          </div>
        )}

        {/* ── The form gallery: what you can draw, and what you cannot ───── */}
        {picked.length > 0 && (
          <div className="rounded-2xl border border-ash-900/10 bg-paper p-4">
            <p className="text-[12px] font-bold text-ash-800">Chart types</p>
            <p className="mt-0.5 text-[11px] text-ash-500">
              {available.length} available for this selection. The rest are shown with the reason — that reason is usually
              the fastest way to work out what to pick next.
            </p>

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {available.map((v) => {
                const on = activeForm === v.form;
                return (
                  <button
                    key={v.form}
                    type="button"
                    onClick={() => go({ form: v.form })}
                    className={`rounded-xl border p-3 text-left transition-colors ${
                      on ? "border-violet-400 bg-violet-50" : "border-ash-900/10 hover:border-ash-900/25"
                    }`}
                  >
                    <p className="flex items-center gap-1.5 text-[12px] font-semibold text-ash-800">
                      {v.label}
                      {v.recommended && (
                        <span className="rounded bg-emerald-100 px-1 py-0.5 text-[8px] font-bold uppercase text-emerald-700">
                          natural fit
                        </span>
                      )}
                      {on && <Check className="ml-auto h-3.5 w-3.5 text-violet-600" />}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-snug text-ash-500">{v.purpose}</p>
                  </button>
                );
              })}
            </div>

            {blocked.length > 0 && (
              <div className="mt-3 border-t border-ash-900/[0.07] pt-3">
                <p className="text-[10px] font-bold uppercase tracking-wide text-ash-400">Not available, and why</p>
                <div className="mt-1.5 space-y-1">
                  {blocked.map((v) => (
                    <p key={v.form} className="flex items-start gap-1.5 text-[11px] leading-snug text-ash-500">
                      <Ban className="mt-0.5 h-3 w-3 shrink-0 text-ash-300" />
                      <span>
                        <span className="font-semibold text-ash-600">{v.label}</span> — {v.reason}
                      </span>
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Quick starts. A blank builder is intimidating; three worked examples
            are worth more than any amount of instruction. */}
        {picked.length === 0 && (
          <div className="rounded-2xl border border-ash-900/10 bg-paper p-4">
            <p className="text-[12px] font-bold text-ash-800">Start from a question</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {QUICK_STARTS.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  onClick={() => go({ f: q.fields, form: q.form })}
                  className="rounded-xl border border-ash-900/10 p-3 text-left transition-colors hover:border-violet-300 hover:bg-violet-50/50"
                >
                  <p className="text-[12px] font-semibold text-ash-800">{q.label}</p>
                  <p className="mt-0.5 text-[11px] leading-snug text-ash-500">
                    {q.fields.map((k) => field(k)?.label).filter(Boolean).join(" · ")}
                  </p>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Worked examples. Each is a real question a lender asks in a real meeting. */
const QUICK_STARTS: Array<{ label: string; fields: string[]; form: VizForm }> = [
  { label: "Which branch is carrying the most money?", fields: ["office.branch", "loan.balance"], form: "bar" },
  { label: "Is the book growing month by month?", fields: ["loan.borrowDate", "loan.principal"], form: "line" },
  { label: "Which product goes bad most often?", fields: ["product.name", "loan.par30"], form: "column" },
  { label: "What size of loan do we actually write?", fields: ["loan.sizeBand", "loan.count"], form: "histogram" },
  { label: "Does a bigger book mean a worse one?", fields: ["officer.name", "loan.balance", "loan.par30Amount"], form: "scatter" },
  { label: "Who are our customers, by age?", fields: ["borrower.ageBand", "borrower.count"], form: "histogram" },
];

/** Exported so the page can seed a first-load selection without duplicating it. */
export const DEFAULT_BUILDER_FIELDS = ["office.branch", "loan.balance"];

/** Every field key, so the page can validate the URL before querying. */
export const ALL_FIELD_KEYS = FIELDS.map((f) => f.key);
