"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE SUITE KIT — the pieces every one of the six systems is built from.
//
// One vocabulary of parts, so a stat tile in ConnectDesk is the same object as a
// stat tile in Ledgerly and a person reading their second system already knows
// how to read it. Everything here is presentational; nothing fetches.
//
// ── THE CHART RULES THESE PARTS OBEY ─────────────────────────────────────────
// Thin marks. 2px lines. Data-ends rounded 4px and anchored to the baseline. A
// 2px surface gap between adjacent fills so a stacked bar reads as segments
// rather than a smear. Grid and axes recessive — the data is the ink. Numbers
// tabular, right-aligned, always. Text wears text tokens and never the series
// colour; a coloured mark beside a label carries the identity instead.
//
// Every mark that carries meaning by colour also carries it another way — a
// label, a short code, a position — because colour alone fails for roughly one
// man in twelve and for every printout.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

// ── Formatting ───────────────────────────────────────────────────────────────

export const KES = (n: number, opts: { compact?: boolean } = {}) => {
  if (!Number.isFinite(n)) return "—";
  if (opts.compact) {
    const abs = Math.abs(n);
    if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
    if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toFixed(0);
  }
  return n.toLocaleString("en-KE", { maximumFractionDigits: 0 });
};

export const N = (n: number) => (Number.isFinite(n) ? n.toLocaleString("en-KE") : "—");
export const PCT = (n: number, dp = 1) => (Number.isFinite(n) ? `${n.toFixed(dp)}%` : "—");

/**
 * "3 minutes ago" — the freshness stamp that proves a screen is live.
 *
 * ── THE HYDRATION TRAP ───────────────────────────────────────────────────────
 * This is a function of the CURRENT TIME, so a server render and the client
 * render that follows it produce different strings — "50s ago" then "52s ago" —
 * and React reports a hydration mismatch. On a page that opens a demo, that is a
 * red error overlay on the screen.
 *
 * So: use this freely in text that is computed on the server and rendered once
 * (a `foot` on a server component, a table cell), and use `<TimeAgo>` anywhere
 * the value is rendered by a CLIENT component — it renders a stable absolute
 * string until it has mounted, then switches to relative and keeps ticking.
 */
export function ago(d: Date | string | null | undefined): string {
  if (!d) return "never";
  const t = typeof d === "string" ? new Date(d) : d;
  const s = Math.floor((Date.now() - t.getTime()) / 1000);
  if (s < 0) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const days = Math.floor(s / 86400);
  if (days < 30) return `${days}d ago`;
  return t.toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * A relative time that is safe to render from a client component, and that keeps
 * counting up while somebody is looking at it.
 *
 * First paint — server and client alike — is the absolute time, which is a pure
 * function of the timestamp and therefore identical on both. After mount it
 * switches to the relative form and re-renders every ten seconds. The
 * `suppressHydrationWarning` is belt-and-braces for the swap itself.
 *
 * The ticking is the point on a demo: a timestamp that visibly advances while
 * you are talking is the only proof that separates live from a screenshot.
 */
export function TimeAgo({ at, prefix = "" }: { at: Date | string | null | undefined; prefix?: string }) {
  const [mounted, setMounted] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => {
    setMounted(true);
    const t = setInterval(() => tick((n) => n + 1), 10_000);
    return () => clearInterval(t);
  }, []);

  if (!at) return <span>—</span>;
  return (
    <span suppressHydrationWarning>
      {prefix}
      {mounted ? ago(at) : shortTime(at)}
    </span>
  );
}

export const shortDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-KE", { day: "numeric", month: "short" }) : "—";

export const shortTime = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" }) : "—";

// ── Surfaces ─────────────────────────────────────────────────────────────────

export function Card({ children, className = "", pad = true }: { children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section
      className={`rounded-xl border border-zinc-900/[0.07] bg-white shadow-[0_1px_2px_rgba(16,16,24,0.04)] ${pad ? "p-4" : ""} ${className}`}
    >
      {children}
    </section>
  );
}

export function CardHead({
  title, sub, right, accent,
}: { title: string; sub?: ReactNode; right?: ReactNode; accent?: string }) {
  return (
    <header className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-[13px] font-semibold leading-tight text-zinc-800">
          {accent && <span aria-hidden className="h-3 w-[3px] shrink-0 rounded-full" style={{ backgroundColor: accent }} />}
          <span className="truncate">{title}</span>
        </h2>
        {sub && <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">{sub}</p>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </header>
  );
}

/** The page heading every screen in every system opens with. */
export function PageHead({
  eyebrow, title, sub, right,
}: { eyebrow?: string; title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-1 text-[9.5px] font-bold uppercase tracking-[0.14em] text-[color:var(--accent)]">{eyebrow}</p>
        )}
        <h1 className="text-[22px] font-bold leading-tight tracking-[-0.018em] text-zinc-900">{title}</h1>
        {sub && <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-zinc-500">{sub}</p>}
      </div>
      {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
    </header>
  );
}

// ── The stat tile ────────────────────────────────────────────────────────────
//
// A single number is not a chart and does not want to be one. The tile is the
// right form when the reader's question is "what is it now" — the sparkline is
// context, deliberately small and unlabelled, never the subject.

export function Stat({
  label, value, unit, delta, deltaLabel, spark, accent, foot, tone = "neutral",
}: {
  label: string;
  value: string;
  unit?: string;
  /** Percentage change. Sign drives the arrow; `good` decides the colour. */
  delta?: number | null;
  deltaLabel?: string;
  spark?: number[];
  accent?: string;
  foot?: ReactNode;
  /** Does UP mean good? Recovery: yes. Arrears: no. */
  tone?: "neutral" | "up-good" | "up-bad";
}) {
  const up = (delta ?? 0) > 0;
  const flat = delta == null || Math.abs(delta) < 0.05;
  const good = tone === "neutral" ? null : tone === "up-good" ? up : !up;
  const deltaColor = flat ? "text-zinc-400" : good == null ? "text-zinc-500" : good ? "text-emerald-600" : "text-red-600";
  const Arrow = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;

  return (
    <Card className="min-w-0">
      <p className="truncate text-[9.5px] font-bold uppercase tracking-[0.12em] text-zinc-400">{label}</p>
      <p className="mt-1.5 flex items-baseline gap-1">
        <span className="text-[23px] font-bold leading-none tracking-[-0.02em] tabular-nums text-zinc-900">{value}</span>
        {unit && <span className="text-[11px] font-medium text-zinc-400">{unit}</span>}
      </p>
      {(delta != null || deltaLabel) && (
        <p className={`mt-1.5 flex items-center gap-1 text-[11px] font-medium ${deltaColor}`}>
          <Arrow className="h-3 w-3 shrink-0" aria-hidden />
          <span className="tabular-nums">{delta != null ? `${Math.abs(delta).toFixed(1)}%` : ""}</span>
          {deltaLabel && <span className="truncate font-normal text-zinc-400">{deltaLabel}</span>}
        </p>
      )}
      {spark && spark.length > 1 && <Spark values={spark} accent={accent ?? "var(--accent)"} />}
      {foot && <p className="mt-2 truncate text-[10.5px] leading-snug text-zinc-400">{foot}</p>}
    </Card>
  );
}

/** Context, not content: no axes, no labels, no tooltip. 2px stroke. */
export function Spark({ values, accent = "var(--accent)", height = 26 }: { values: number[]; accent?: string; height?: number }) {
  if (values.length < 2) return null;
  const w = 100, h = height;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const step = w / (values.length - 1);
  const pts = values.map((v, i) => [i * step, h - ((v - min) / span) * (h - 4) - 2] as const);
  const d = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = `${d} L${w},${h} L0,${h} Z`;
  const id = `sp${Math.round(min)}${Math.round(max)}${values.length}`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-2 w-full" style={{ height }} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={accent} stopOpacity="0.18" />
          <stop offset="100%" stopColor={accent} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={d} fill="none" stroke={accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// ── Chips and badges ─────────────────────────────────────────────────────────

/**
 * A band chip. The colour carries severity; the short code carries identity.
 * Both, always — never colour alone.
 */
export function Chip({
  label, accent, title, subtle = false,
}: { label: string; accent: string; title?: string; subtle?: boolean }) {
  return subtle ? (
    <span
      title={title}
      className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums"
      style={{ backgroundColor: `${accent}14`, color: accent }}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accent }} />
      {label}
    </span>
  ) : (
    <span
      title={title}
      className="inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold text-white"
      style={{ backgroundColor: accent }}
    >
      {label}
    </span>
  );
}

export function Tag({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warn" | "bad" | "info" }) {
  const cls = {
    neutral: "bg-zinc-900/[0.05] text-zinc-600",
    good: "bg-emerald-500/10 text-emerald-700",
    warn: "bg-amber-500/12 text-amber-700",
    bad: "bg-red-500/10 text-red-700",
    info: "bg-blue-500/10 text-blue-700",
  }[tone];
  return <span className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}>{children}</span>;
}

/** The live pulse — a dot that proves the screen is reading, not remembering. */
export function LivePulse({ label, at }: { label?: string; at?: Date | string | null }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/[0.07] px-2 py-1 text-[10px] font-semibold text-emerald-700">
      <span className="relative flex h-1.5 w-1.5" aria-hidden>
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-600" />
      </span>
      {label ?? "Live"}
      {at && <span className="font-normal text-emerald-700/70">· {ago(at)}</span>}
    </span>
  );
}

// ── The horizontal magnitude bar ─────────────────────────────────────────────
//
// For "which band holds the money" the reader is comparing magnitudes across a
// short ordered list, and a horizontal bar beats a donut every time: the labels
// fit, the baseline is shared, and the eye compares lengths rather than angles.

export function BarRow({
  label, chip, value, max, accent, right, onClick, active,
}: {
  label: string;
  chip?: ReactNode;
  value: number;
  max: number;
  accent: string;
  right?: ReactNode;
  onClick?: () => void;
  active?: boolean;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper
      {...(onClick ? { type: "button" as const, onClick } : {})}
      className={`group flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors ${
        onClick ? "hover:bg-zinc-900/[0.03]" : ""
      } ${active ? "bg-zinc-900/[0.045]" : ""}`}
    >
      <span className="flex w-[126px] shrink-0 items-center gap-1.5">
        {chip}
        <span className="truncate text-[11.5px] font-medium text-zinc-600">{label}</span>
      </span>
      <span className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-zinc-900/[0.055]">
        <span
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%`, backgroundColor: accent }}
        />
      </span>
      <span className="w-[92px] shrink-0 text-right text-[11.5px] font-semibold tabular-nums text-zinc-700">{right}</span>
    </Wrapper>
  );
}

// ── The column chart, with a hover layer ─────────────────────────────────────
//
// An HTML chart IS interactive; shipping one without a tooltip throws away the
// only advantage it has over a printed figure. Hit targets span the full column
// height, not just the bar, so a near-zero hour is still hoverable.

export type Column = { label: string; value: number; sub?: string };

export function Columns({
  data, accent = "var(--accent)", height = 120, format = (n: number) => KES(n, { compact: true }),
}: {
  data: Column[];
  accent?: string;
  height?: number;
  format?: (n: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...data.map((d) => d.value), 1);

  return (
    <div className="relative">
      <div className="flex items-end gap-[2px]" style={{ height }}>
        {data.map((d, i) => {
          const h = (d.value / max) * 100;
          const on = hover === i;
          return (
            <button
              key={`${d.label}-${i}`}
              type="button"
              className="group relative flex h-full min-w-0 flex-1 items-end"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              aria-label={`${d.label}: ${format(d.value)}`}
            >
              <span
                className="w-full rounded-t transition-[height,opacity] duration-300"
                style={{
                  height: `${Math.max(h, d.value > 0 ? 2 : 0)}%`,
                  backgroundColor: accent,
                  opacity: hover == null ? 0.85 : on ? 1 : 0.35,
                }}
              />
            </button>
          );
        })}
      </div>

      {/* Axis: first, middle and last only. A label under every column is noise. */}
      <div className="mt-1.5 flex justify-between text-[9.5px] tabular-nums text-zinc-400">
        <span>{data[0]?.label}</span>
        <span>{data[Math.floor(data.length / 2)]?.label}</span>
        <span>{data[data.length - 1]?.label}</span>
      </div>

      {hover != null && data[hover] && (
        <div className="pointer-events-none absolute -top-1 left-1/2 z-10 -translate-x-1/2 -translate-y-full rounded-lg bg-zinc-900 px-2.5 py-1.5 text-[11px] text-white shadow-lg">
          <p className="font-semibold tabular-nums">{format(data[hover].value)}</p>
          <p className="text-[10px] text-white/60">
            {data[hover].label}
            {data[hover].sub ? ` · ${data[hover].sub}` : ""}
          </p>
        </div>
      )}
    </div>
  );
}

// ── States ───────────────────────────────────────────────────────────────────

export function Empty({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-900/12 bg-white/60 px-6 py-10 text-center">
      <p className="text-[13px] font-semibold text-zinc-700">{title}</p>
      {detail && <p className="mt-1 max-w-md text-[12px] leading-relaxed text-zinc-500">{detail}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/**
 * A named failure, never a blank screen.
 *
 * A collections floor that renders zero rows because the database was
 * unreachable is indistinguishable from a quiet day, and that ambiguity is
 * dangerous in a system whose job is to notice people who stopped paying.
 */
export function Broken({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="rounded-xl border border-red-500/25 bg-red-500/[0.04] px-4 py-3.5">
      <p className="text-[12.5px] font-semibold text-red-800">{title}</p>
      {detail && <p className="mt-1 text-[11.5px] leading-relaxed text-red-700/80">{detail}</p>}
    </div>
  );
}

/** Content that is illustrative rather than read from the live book — said plainly. */
export function Simulated({ children, why }: { children?: ReactNode; why: string }) {
  return (
    <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2">
      <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-800">
        <span className="mt-px shrink-0 rounded bg-amber-500/20 px-1 py-0.5 text-[8.5px] font-bold uppercase tracking-wide">
          Simulated
        </span>
        <span>{why}</span>
      </p>
      {children}
    </div>
  );
}

export function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-9 animate-pulse rounded-lg bg-zinc-900/[0.045]" />
      ))}
    </div>
  );
}

// ── Buttons ──────────────────────────────────────────────────────────────────

export function Btn({
  children, onClick, variant = "ghost", size = "md", disabled, type = "button", title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "solid" | "ghost" | "outline" | "danger";
  size?: "sm" | "md";
  disabled?: boolean;
  type?: "button" | "submit";
  title?: string;
}) {
  const base = "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45";
  const sz = size === "sm" ? "px-2 py-1 text-[11px]" : "px-3 py-1.5 text-[12px]";
  const look = {
    solid: "text-white hover:brightness-110",
    ghost: "text-zinc-600 hover:bg-zinc-900/[0.055] hover:text-zinc-900",
    outline: "border border-zinc-900/12 bg-white text-zinc-700 hover:bg-zinc-900/[0.03]",
    danger: "bg-red-600 text-white hover:bg-red-700",
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`${base} ${sz} ${look}`}
      style={variant === "solid" ? { backgroundColor: "var(--accent)" } : undefined}
    >
      {children}
    </button>
  );
}
