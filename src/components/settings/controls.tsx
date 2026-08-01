"use client";

// ─────────────────────────────────────────────────────────────────────────────
// THE SETTINGS CONTROL SET — one vocabulary for every tenant-definition screen.
//
// Borrower settings, credit policy and everything the Tenant Definition Layer
// grows next are the SAME kind of screen: a document, a section rail, live
// validation and one Publish. They should not each re-invent a toggle.
//
// These were written inline in the borrower screen; they live here now so the
// second screen costs sections, not chrome. Nothing here holds state or fetches:
// a control takes a value and hands back the next one, so the page keeps owning
// the single dirty document that Publish sends.
// ─────────────────────────────────────────────────────────────────────────────
import type { ReactNode } from "react";

export const INPUT =
  "mt-1 w-full rounded-lg border border-[color:var(--ink)]/12 bg-white px-3 py-2.5 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-[color:var(--brand)]";

export function Toggle({
  label, checked, onChange, disabled, hint,
}: {
  label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: string;
}) {
  return (
    <label
      title={hint}
      className={`flex items-center justify-center gap-1.5 sm:justify-center ${disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
    >
      <span className="t-label sm:hidden">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
        style={{ backgroundColor: checked ? "var(--brand)" : "rgba(15,15,25,0.15)" }}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${checked ? "translate-x-[1.15rem]" : "translate-x-0.5"}`} />
      </button>
    </label>
  );
}

export function SwitchRow({
  title, desc, checked, onChange,
}: {
  title: string; desc: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl px-3 py-2.5 ring-1 ring-[color:var(--ink)]/[0.07]">
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-[color:var(--ink)]">{title}</p>
        <p className="t-meta text-[11px] leading-snug">{desc}</p>
      </div>
      <Toggle label={title} checked={checked} onChange={onChange} />
    </div>
  );
}

export function Choice({
  label, value, onChange, options, cols = 3,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; hint: string }[];
  /** How many across on a wide screen. Always one-up on a phone. */
  cols?: 2 | 3 | 4;
}) {
  const grid = cols === 2 ? "sm:grid-cols-2" : cols === 4 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3";
  return (
    <div>
      <p className="t-label mb-2">{label}</p>
      <div className={`grid gap-2 ${grid}`}>
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(o.value)}
              className="rounded-xl px-3 py-3 text-left ring-1 transition-colors"
              style={
                on
                  ? { backgroundColor: "var(--brand-soft)", ["--tw-ring-color" as never]: "var(--brand)" }
                  : { ["--tw-ring-color" as never]: "rgba(15,15,25,0.09)" }
              }
            >
              <span className="flex items-center gap-2">
                <span
                  className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full ring-2"
                  style={{ ["--tw-ring-color" as never]: on ? "var(--brand)" : "rgba(15,15,25,0.2)" }}
                >
                  {on && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "var(--brand)" }} />}
                </span>
                <span className="text-[13px] font-semibold text-[color:var(--ink)]">{o.label}</span>
              </span>
              <span className="t-meta mt-1 block text-[11px] leading-snug">{o.hint}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function RuleBlock({
  title, desc, checked, onChange, children,
}: {
  title: string; desc: string; checked: boolean; onChange: (v: boolean) => void; children: ReactNode;
}) {
  return (
    <div className="rounded-xl ring-1 ring-[color:var(--ink)]/[0.07]">
      <div className="flex items-start justify-between gap-3 px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-[color:var(--ink)]">{title}</p>
          <p className="t-meta text-[11px] leading-snug">{desc}</p>
        </div>
        <Toggle label={title} checked={checked} onChange={onChange} />
      </div>
      {checked && <div className="border-t border-[color:var(--ink)]/[0.07] px-3 py-3">{children}</div>}
    </div>
  );
}

export function NumberField({
  label, value, onChange, min, max, step, help, money, suffix,
}: {
  label: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; step?: number; help?: string; money?: boolean;
  /** Unit shown inside the field — "%", "days", "×". */
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className="t-label">{label}{money ? " (KES)" : ""}</span>
      <span className="relative block">
        <input
          type="number" inputMode="decimal" value={Number.isFinite(value) ? value : 0}
          min={min} max={max} step={step ?? 1}
          onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
          className={INPUT}
          style={suffix ? { paddingRight: "2.75rem" } : undefined}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] font-semibold text-[color:var(--ink-faint)]">
            {suffix}
          </span>
        )}
      </span>
      {help && <span className="mt-1 block text-[11px] text-[color:var(--ink-faint)]">{help}</span>}
    </label>
  );
}

export function TextField({
  label, value, onChange, placeholder, help,
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; help?: string;
}) {
  return (
    <label className="block">
      <span className="t-label">{label}</span>
      <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={INPUT} />
      {help && <span className="mt-1 block text-[11px] text-[color:var(--ink-faint)]">{help}</span>}
    </label>
  );
}

export function SelectField({
  label, value, onChange, options, help,
}: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; help?: string;
}) {
  return (
    <label className="block">
      <span className="t-label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={INPUT}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {help && <span className="mt-1 block text-[11px] text-[color:var(--ink-faint)]">{help}</span>}
    </label>
  );
}

export function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <span className="t-label shrink-0">{label}</span>
      <span className="h-px flex-1 bg-[color:var(--ink)]/[0.08]" />
    </div>
  );
}

/**
 * A percentage a lender wants to FEEL rather than type — a haircut, a utilisation,
 * a graduation step. The slider is the control; the readout is the truth.
 */
export function SliderField({
  label, value, onChange, min, max, step = 1, help, format,
}: {
  label: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step?: number; help?: string;
  format?: (v: number) => string;
}) {
  const shown = format ? format(value) : String(value);
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-2">
        <span className="t-label">{label}</span>
        <span className="text-[13px] font-bold tabular-nums text-[color:var(--ink)]">{shown}</span>
      </span>
      <input
        type="range" min={min} max={max} step={step}
        value={Number.isFinite(value) ? value : min}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full accent-[color:var(--brand)]"
      />
      {help && <span className="mt-1 block text-[11px] text-[color:var(--ink-faint)]">{help}</span>}
    </label>
  );
}

/** A row of on/off pills — the control for "which of these are refused". */
export function PillSet<T extends string>({
  label, options, selected, onChange, help, tone = "danger",
}: {
  label: string;
  options: { value: T; label: string }[];
  selected: T[];
  onChange: (next: T[]) => void;
  help?: string;
  /** `danger` reads as "this one is blocked"; `brand` as "this one is chosen". */
  tone?: "danger" | "brand";
}) {
  const on = (v: T) => selected.includes(v);
  const toggle = (v: T) => onChange(on(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  return (
    <div>
      <p className="t-label mb-2">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const active = on(o.value);
          const bg = tone === "danger" ? "rgba(220,38,38,0.10)" : "var(--brand-soft)";
          const ring = tone === "danger" ? "rgba(220,38,38,0.45)" : "var(--brand)";
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={active}
              onClick={() => toggle(o.value)}
              className="rounded-full px-3 py-1.5 text-[12px] font-semibold ring-1 transition-colors"
              style={
                active
                  ? { backgroundColor: bg, color: tone === "danger" ? "#991b1b" : "var(--ink)", ["--tw-ring-color" as never]: ring }
                  : { color: "var(--ink-muted)", ["--tw-ring-color" as never]: "rgba(15,15,25,0.10)" }
              }
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {help && <p className="mt-1.5 text-[11px] text-[color:var(--ink-faint)]">{help}</p>}
    </div>
  );
}
